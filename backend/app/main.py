import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as routes_router
from app.api.trips import router as trips_router
from app.api.gpx import router as gpx_router
from app.api.trip_planner import router as trip_planner_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.vehicles import router as vehicles_router
from app.api.groups import router as groups_router
from app.api.ai_planner import router as ai_planner_router
from app.services.valhalla_client import close_client
from app.services.overpass_client import close_overpass_client

# Configure logging so timing info shows up
logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Clean up httpx clients on shutdown
    await close_client()
    await close_overpass_client()


app = FastAPI(
    title="Moto-GPS API",
    description="Smart motorcycle route planning",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(vehicles_router, prefix="/api")
app.include_router(groups_router, prefix="/api")
app.include_router(routes_router, prefix="/api")
app.include_router(trips_router, prefix="/api")
app.include_router(gpx_router, prefix="/api")
app.include_router(trip_planner_router, prefix="/api")
app.include_router(ai_planner_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "moto-gps-api"}
