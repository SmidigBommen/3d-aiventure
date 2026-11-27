import sys
from pathlib import Path
from fastapi import APIRouter, Request, Form, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web import inventory
from web.fight import Rejected
from web.game_session import save_session
from web.dependencies import require_character

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent.parent / "templates")


async def _act(request: Request, session, action, *args):
    """One action of web/inventory.py: its line as a flash message, then back to the page."""
    try:
        session.set_flash("inventory_message", action(session, *args))
    except Rejected as rejection:
        session.set_flash("inventory_error", rejection.message)
    save_session(request, session)
    return RedirectResponse("/inventory", status_code=303)


@router.get("/", response_class=HTMLResponse)
async def inventory_view(request: Request, session=Depends(require_character)):
    """Inventory and equipment management page."""
    char_data = session.serialize_character()
    char_data["inventory"] = inventory.annotated_items(session, char_data)

    message = session.pop_flash("inventory_message")
    error = session.pop_flash("inventory_error")
    if message or error:
        save_session(request, session)

    return templates.TemplateResponse(request, "inventory/index.html", {
        "request": request,
        "title": "Inventory",
        "character": char_data,
        "message": message,
        "error": error,
    })


@router.post("/use")
async def use_item(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Drink a healing potion outside of battle."""
    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)
    return await _act(request, session, inventory.use_potion, item_index)


@router.post("/equip-weapon")
async def equip_weapon(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Equip a weapon from inventory."""
    return await _act(request, session, inventory.equip_weapon, item_index)


@router.post("/unequip-weapon")
async def unequip_weapon(request: Request, session=Depends(require_character)):
    """Unequip the main hand weapon."""
    return await _act(request, session, inventory.unequip_weapon)


@router.post("/equip-armor")
async def equip_armor(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Equip armor from inventory."""
    return await _act(request, session, inventory.equip_armor, item_index)


@router.post("/unequip-armor")
async def unequip_armor(request: Request, session=Depends(require_character)):
    """Unequip current armor."""
    return await _act(request, session, inventory.unequip_armor)
