import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.config import settings
from api.routes import collect, topology, config, diagnosis, share, ws, telemetry, metrics, iac


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="NetXray API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(topology.router, prefix="/api")
app.include_router(collect.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(diagnosis.router, prefix="/api")
app.include_router(share.router, prefix="/api")
app.include_router(ws.router, prefix="/api")
app.include_router(telemetry.router, prefix="/api")
app.include_router(metrics.router)
app.include_router(iac.router, prefix="/api")
 # /metrics typically at root


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Serve frontend from /static folder (built by Docker)
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Prevent shadowing /api or /health
        if full_path.startswith("api") or full_path == "health":
            return None
        
        # If file exists in static_dir (e.g. favicon.svg), serve it
        file_path = static_dir / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        
        # Fallback to index.html for SPA routing
        return FileResponse(static_dir / "index.html")
