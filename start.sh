#!/bin/bash
# ============================================================
# Moto-GPS — Start All Services
# ============================================================
# Usage:
#   ./start.sh          Start all services (Docker + backend + frontend)
#   ./start.sh --stop   Stop all services
#   ./start.sh --status Check service health
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/.motogps.pids"

# ---------- Stop ----------
if [ "$1" = "--stop" ]; then
  echo -e "${YELLOW}Stopping Moto-GPS...${NC}"
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null && echo "  Stopped PID $pid" || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  cd "$PROJECT_DIR" && docker compose down
  echo -e "${GREEN}All services stopped.${NC}"
  exit 0
fi

# ---------- Status ----------
if [ "$1" = "--status" ]; then
  echo -e "${BLUE}=== Moto-GPS Service Status ===${NC}"
  echo ""

  # Docker services
  echo "Docker services:"
  docker compose -f "$PROJECT_DIR/docker-compose.yml" ps --format "  {{.Name}}: {{.Status}}" 2>/dev/null || echo "  Docker not running"
  echo ""

  # Backend
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "  Backend:   ${GREEN}healthy${NC} (http://localhost:8000)"
  else
    echo -e "  Backend:   ${RED}not running${NC}"
  fi

  # Frontend
  if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo -e "  Frontend:  ${GREEN}running${NC} (http://localhost:3001)"
  else
    echo -e "  Frontend:  ${RED}not running${NC}"
  fi

  # Valhalla
  if curl -s http://localhost:8010/status > /dev/null 2>&1; then
    echo -e "  Valhalla:  ${GREEN}healthy${NC} (http://localhost:8010)"
  else
    echo -e "  Valhalla:  ${RED}not running${NC}"
  fi

  exit 0
fi

# ---------- Pre-flight checks ----------
echo -e "${BLUE}"
echo "  __  __       _          ____ ____  ____  "
echo " |  \/  | ___ | |_ ___   / ___|  _ \/ ___| "
echo " | |\/| |/ _ \| __/ _ \ | |  _| |_) \___ \ "
echo " | |  | | (_) | || (_) || |_| |  __/ ___) |"
echo " |_|  |_|\___/ \__\___/  \____|_|   |____/ "
echo -e "${NC}"
echo ""

# Check .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo -e "${RED}Error: .env file not found.${NC}"
  echo "  Run: cp .env.example .env"
  echo "  Then edit .env with your API keys."
  exit 1
fi

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker is not running.${NC}"
  echo "  Please start Docker Desktop and try again."
  exit 1
fi

# Check MapTiler key
MAPTILER_KEY=$(grep NEXT_PUBLIC_MAPTILER_KEY "$PROJECT_DIR/.env" | cut -d= -f2)
if [ "$MAPTILER_KEY" = "your_maptiler_key_here" ] || [ -z "$MAPTILER_KEY" ]; then
  echo -e "${YELLOW}Warning: MapTiler key not set in .env${NC}"
  echo "  The map won't load without it."
  echo "  Get a free key at: https://www.maptiler.com/cloud/"
  echo ""
fi

# ---------- 1. Docker services ----------
echo -e "${BLUE}[1/4] Starting Docker services...${NC}"
cd "$PROJECT_DIR"
docker compose up -d

echo "  Waiting for PostGIS..."
TRIES=0
until docker exec moto-gps-postgres-1 pg_isready -U motogps -d motogps &>/dev/null; do
  sleep 1
  TRIES=$((TRIES + 1))
  if [ $TRIES -gt 30 ]; then
    echo -e "${RED}  PostGIS failed to start after 30s${NC}"
    exit 1
  fi
done
echo -e "  ${GREEN}PostGIS ready.${NC}"

echo "  Waiting for Valhalla (first start may take 2-5 min to build tiles)..."
TRIES=0
until curl -s http://localhost:8010/status > /dev/null 2>&1; do
  sleep 5
  TRIES=$((TRIES + 1))
  if [ $TRIES -gt 60 ]; then
    echo -e "${YELLOW}  Valhalla still starting — continuing anyway (it will be ready soon)${NC}"
    break
  fi
  printf "."
done
echo ""
echo -e "  ${GREEN}Valhalla ready.${NC}"

# ---------- 2. Backend setup ----------
echo -e "${BLUE}[2/4] Setting up backend...${NC}"
cd "$PROJECT_DIR/backend"
if [ ! -d .venv ]; then
  echo "  Creating Python virtual environment..."
  python3 -m venv .venv
  source .venv/bin/activate
  echo "  Installing dependencies..."
  pip install -r requirements.txt -q
else
  source .venv/bin/activate
fi

# Check if admin user exists, seed if not
python -c "
import asyncio, os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
async def check():
    url = f\"postgresql+asyncpg://{os.environ.get('POSTGRES_USER','motogps')}:{os.environ.get('POSTGRES_PASSWORD','motogps_dev')}@{os.environ.get('POSTGRES_HOST','localhost')}:{os.environ.get('POSTGRES_PORT','5434')}/{os.environ.get('POSTGRES_DB','motogps')}\"
    e = create_async_engine(url)
    async with e.connect() as c:
        r = await c.execute(text('SELECT count(*) FROM users WHERE is_admin = true'))
        return r.scalar()
c = asyncio.run(check())
if c == 0:
    print('NO_ADMIN')
" 2>/dev/null | grep -q "NO_ADMIN" && {
  echo "  Seeding admin user..."
  python -m app.cli.seed_admin 2>/dev/null
  echo -e "  ${GREEN}Admin user created.${NC}"
} || echo "  Admin user exists."

# ---------- 3. Start backend ----------
echo -e "${BLUE}[3/4] Starting FastAPI backend (port 8000)...${NC}"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/motogps-backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"
cd "$PROJECT_DIR"
sleep 2

# Verify backend
if curl -s http://localhost:8000/health > /dev/null 2>&1 || curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
  echo -e "  ${GREEN}Backend running.${NC}"
else
  echo -e "  ${YELLOW}Backend starting... (check /tmp/motogps-backend.log if issues)${NC}"
fi

# ---------- 4. Start frontend ----------
echo -e "${BLUE}[4/4] Starting Next.js frontend (port 3001)...${NC}"
cd "$PROJECT_DIR/web"
if [ ! -d node_modules ]; then
  echo "  Installing npm dependencies..."
  npm install --silent 2>/dev/null
fi
npx next dev --port 3001 > /tmp/motogps-web.log 2>&1 &
WEB_PID=$!
echo "$WEB_PID" >> "$PID_FILE"
cd "$PROJECT_DIR"
sleep 3

# ---------- Summary ----------
echo ""
echo -e "${GREEN}=== Moto-GPS is running ===${NC}"
echo ""
echo -e "  ${BLUE}Web app${NC}     http://localhost:3001"
echo -e "  ${BLUE}Backend API${NC} http://localhost:8000"
echo -e "  ${BLUE}Valhalla${NC}    http://localhost:8010"
echo -e "  ${BLUE}Martin${NC}      http://localhost:3002"
echo -e "  ${BLUE}PostGIS${NC}     localhost:5434"
echo ""
echo -e "  Logs: /tmp/motogps-backend.log, /tmp/motogps-web.log"
echo ""
echo -e "  ${YELLOW}Stop all:${NC}   ./start.sh --stop"
echo -e "  ${YELLOW}Status:${NC}     ./start.sh --status"
echo ""

# Check if data pipeline has been run
ROAD_COUNT=$(docker exec moto-gps-postgres-1 psql -U motogps -d motogps -t -c "SELECT count(*) FROM road_segments" 2>/dev/null | tr -d ' ')
if [ "$ROAD_COUNT" = "0" ] || [ -z "$ROAD_COUNT" ]; then
  echo -e "${YELLOW}Note: Road data not imported yet. Run the pipeline first:${NC}"
  echo "  cd pipeline && source .venv/bin/activate"
  echo "  python run_pipeline.py --step download,import,score"
  echo "  python import_pois.py  # Optional: 83k UK POIs"
  echo ""
fi
