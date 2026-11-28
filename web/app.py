import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

app = FastAPI(title="AIVentures 3D", description="D&D 5e adventure in first-person 3D")

# Session middleware for tracking game state
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET", "aiventures-dev-secret"))

# The portraits and Elara's picture, whose paths are stored in sessions and saves
web_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=web_dir / "static"), name="static")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "game": "AIVentures"}


# The server-rendered interface that used to live under these prefixes is gone. A bookmark or an
# old link to one of its pages leads to the game; no session is read for it.
RETIRED_PREFIXES = ("/classic", "/character", "/game", "/battle", "/shop", "/inventory", "/saves")
EVERY_METHOD = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]


async def retired():
    return RedirectResponse("/", status_code=303)


for _prefix in RETIRED_PREFIXES:
    app.add_api_route(_prefix, retired, methods=EVERY_METHOD, include_in_schema=False)
    app.add_api_route(_prefix + "/{rest:path}", retired, methods=EVERY_METHOD, include_in_schema=False)


# JSON API for the 3D client
from web.api import (
    battle as battle_api, character as character_api, creation as creation_api, event as event_api,
    saves as saves_api, shop as shop_api, travel as travel_api, world as world_api,
)

app.include_router(world_api.router, prefix="/api", tags=["api"])
app.include_router(battle_api.router, prefix="/api/battle", tags=["api"])
app.include_router(event_api.router, prefix="/api/event", tags=["api"])
app.include_router(character_api.router, prefix="/api", tags=["api"])
app.include_router(shop_api.router, prefix="/api/shop", tags=["api"])
app.include_router(travel_api.router, prefix="/api", tags=["api"])
app.include_router(creation_api.router, prefix="/api", tags=["api"])
app.include_router(saves_api.router, prefix="/api/saves", tags=["api"])


# The 3D client (built by `pnpm build` into client/dist) is served at /. Each of its top-level
# entries gets a route of its own, so an unknown path stays a 404.
CLIENT_DIST = web_dir.parent / "client" / "dist"


async def no_client():
    return JSONResponse(
        {"error": "no_client", "message": "The client is not built. Run pnpm build."}, status_code=503)


def mount_client(target: FastAPI, dist: Path) -> None:
    """Serve the built client in `dist` from `target`; without a build, / says so."""
    if not (dist / "index.html").is_file():
        target.add_api_route("/", no_client, methods=["GET"], include_in_schema=False)
        return

    def serve(path: Path):
        async def send_file():
            return FileResponse(path)
        return send_file

    for entry in sorted(dist.iterdir()):
        if entry.is_dir():
            target.mount(f"/{entry.name}", StaticFiles(directory=entry), name=f"client-{entry.name}")
        elif entry.name == "index.html":
            target.add_api_route("/", serve(entry), methods=["GET"], include_in_schema=False)
        else:
            target.add_api_route(f"/{entry.name}", serve(entry), methods=["GET"], include_in_schema=False)


mount_client(app, CLIENT_DIST)
