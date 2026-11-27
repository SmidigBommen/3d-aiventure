import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
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


# The 3D client (built by `pnpm build` into client/dist) is served at /. It is mounted last,
# so every route above wins. Without a build, / leads to the classic interface.
CLIENT_DIST = web_dir.parent / "client" / "dist"
if CLIENT_DIST.is_dir():
    app.mount("/", StaticFiles(directory=CLIENT_DIST, html=True), name="client")
else:
    @app.get("/")
    async def no_client():
        return RedirectResponse("/classic")
