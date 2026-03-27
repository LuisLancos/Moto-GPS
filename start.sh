#!/bin/bash
# Moto-GPS — Start all services
set -e

echo "=== Moto-GPS Startup ==="
echo ""

# 1. Docker services
echo "[1/3] Starting Docker services (PostGIS, Valhalla, Martin)..."
docker compose up -d
echo "  Waiting for PostGIS..."
until docker exec moto-gps-postgres-1 pg_isready -U motogps -d motogps &>/dev/null; do
  sleep 1
done
echo "  PostGIS ready."

# 2. Backend
echo "[2/3] Starting FastAPI backend on port 8000..."
cd backend
if [ ! -d .venv ]; then
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
else
  source .venv/bin/activate
fi
uvicorn app.main:app --host 0.0.0.0 --port 8000 &>/tmp/motogps-backend.log &
BACKEND_PID=$!
cd ..
sleep 2

# 3. Web frontend
echo "[3/3] Starting Next.js frontend on port 3001..."
cd web
npm run dev &>/tmp/motogps-web.log &
WEB_PID=$!
cd ..
sleep 3

echo ""
echo "=== All services running ==="
echo ""
echo "  Web app:   http://localhost:3001"
echo "  Backend:   http://localhost:8000"
echo "  Valhalla:  http://localhost:8010"
echo "  Martin:    http://localhost:3002"
echo "  PostGIS:   localhost:5434"
echo ""
echo "  Backend PID: $BACKEND_PID"
echo "  Web PID:     $WEB_PID"
echo ""
echo "To stop: docker compose down && kill $BACKEND_PID $WEB_PID"
