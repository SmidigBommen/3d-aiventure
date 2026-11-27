import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

app = FastAPI(title="AIVentures 3D", description="D&D 5e adventure in first-person 3D")

# Session middleware for tracking game state
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET", "aiventures-dev-secret"))

# Static files and templates
web_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=web_dir / "static"), name="static")
templates = Jinja2Templates(directory=web_dir / "templates")


@app.get("/classic", response_class=HTMLResponse)
async def home(request: Request):
    """Home page of the classic (server-rendered) interface."""
    from web.game_session import get_session
    from web.save_manager import get_save_count
    session = get_session(request)
    return templates.TemplateResponse(request, "base.html", {
        "request": request,
        "title": "AIVentures",
        "content": "home",
        "has_character": session.character is not None,
        "has_saves": get_save_count() > 0,
    })


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "game": "AIVentures"}


# Register dependency redirect handler
from web.dependencies import add_redirect_handler
add_redirect_handler(app)

# Import and include routers
from web.routes import character, game, battle, shop, inventory, saves

app.include_router(character.router, prefix="/character", tags=["character"])
app.include_router(game.router, prefix="/game", tags=["game"])
app.include_router(battle.router, prefix="/battle", tags=["battle"])
app.include_router(shop.router, prefix="/shop", tags=["shop"])
app.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
app.include_router(saves.router, prefix="/saves", tags=["saves"])

# JSON API for the 3D client
from web.api import world as world_api

app.include_router(world_api.router, prefix="/api", tags=["api"])


# The 3D client (built by `pnpm build` into client/dist) is served at /. Each of its top-level
# entries gets a route of its own; one catch-all mount at / would swallow the redirect from
# /battle to /battle/ that the classic routes rely on. Without a build, / leads to /classic.
CLIENT_DIST = web_dir.parent / "client" / "dist"


def _mount_client(dist: Path) -> None:
    def serve(path: Path):
        async def send_file():
            return FileResponse(path)
        return send_file

    for entry in sorted(dist.iterdir()):
        if entry.is_dir():
            app.mount(f"/{entry.name}", StaticFiles(directory=entry), name=f"client-{entry.name}")
        elif entry.name == "index.html":
            app.add_api_route("/", serve(entry), methods=["GET"], include_in_schema=False)
        else:
            app.add_api_route(f"/{entry.name}", serve(entry), methods=["GET"], include_in_schema=False)


if (CLIENT_DIST / "index.html").is_file():
    _mount_client(CLIENT_DIST)
else:
    @app.get("/", include_in_schema=False)
    async def no_client():
        return RedirectResponse("/classic")
