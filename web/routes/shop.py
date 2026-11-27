import sys
from pathlib import Path
from fastapi import APIRouter, Request, Form, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web import shop
from web.fight import Rejected
from web.game_session import save_session, get_shopkeeper
from web.dependencies import require_character
# The shop itself lives in web/shop.py; these names are imported from here by other code.
from web.shop import (  # noqa: F401
    calculate_sell_price, get_effective_price, get_shop_inventory, get_shopkeeper_dialog, restock_shop,
)

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent.parent / "templates")


@router.get("/", response_class=HTMLResponse)
async def shop_view(request: Request, session=Depends(require_character)):
    """Shop view - show items for sale."""

    # Check if shop is available in current area
    area = session.current_area
    special = area.get("special", "") if area else ""
    has_shop = "shop" in str(special).lower() or "market" in str(special).lower()
    if not area or not has_shop:
        return RedirectResponse("/game", status_code=303)

    char_data = session.serialize_character()
    get_shop_inventory(session)
    shop_items = [{**ware, "price": ware["original_price"]} for ware in shop.wares(session)]

    # Check for flash messages and determine dialog context
    message = session.pop_flash("shop_message")
    error = session.pop_flash("shop_error")
    dialog_context = session.pop_flash("shop_dialog_context") or "greeting"
    haggle_result = session.haggle_result
    session.haggle_result = None  # Clear after reading
    active_tab = request.query_params.get("tab", "wares")

    dialog = get_shopkeeper_dialog(dialog_context, session.character.gold)

    # Save to persist flash pops and haggle_result clear
    save_session(request, session)

    return templates.TemplateResponse(request, "shop/index.html", {
        "request": request,
        "title": "Shop",
        "character": char_data,
        "shop_items": shop_items,
        "sellable_items": shop.sellable_items(session),
        "message": message,
        "error": error,
        "shopkeeper": get_shopkeeper(),
        "dialog": dialog,
        "haggle_result": haggle_result,
        "active_quests": shop.active_quests(session),
        "available_quests": shop.available_quests(session),
        "active_tab": active_tab,
        "quest_slots_full": shop.slots_full(session),
    })


def _act(request: Request, session, action, value, back: str = "/shop") -> RedirectResponse:
    """One shop action for the classic page: its outcome as flash messages, saved, and back to the shop."""
    try:
        done = action(session, value)
    except Rejected as rejection:
        session.set_flash("shop_error", rejection.message)
        if rejection.code in shop.REFUSAL_CONTEXT:
            session.set_flash("shop_dialog_context", shop.REFUSAL_CONTEXT[rejection.code])
    else:
        if done["message"]:
            session.set_flash("shop_message", done["message"])
        if done["haggle"]:
            session.haggle_result = done["haggle"]
        session.set_flash("shop_dialog_context", done["context"])
    save_session(request, session)
    return RedirectResponse(back, status_code=303)


@router.post("/buy")
async def buy_item(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Purchase an item from the shop."""
    return _act(request, session, shop.buy, item_index)


@router.post("/sell")
async def sell_item(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Sell an item to the shop."""
    return _act(request, session, shop.sell, item_index)


@router.post("/haggle")
async def haggle_item(request: Request, item_index: int = Form(...), session=Depends(require_character)):
    """Attempt to haggle the price of an item using a Persuasion check."""
    return _act(request, session, shop.haggle, item_index)


@router.post("/quest/accept")
async def accept_quest(request: Request, quest_id: str = Form(...), session=Depends(require_character)):
    """Accept a quest from the quest board."""
    return _act(request, session, shop.accept_quest, quest_id, "/shop?tab=quests")


@router.post("/quest/turn-in")
async def turn_in_quest_route(request: Request, quest_id: str = Form(...), session=Depends(require_character)):
    """Turn in a completed quest for rewards."""
    return _act(request, session, shop.turn_in_quest, quest_id, "/shop?tab=quests")


@router.post("/quest/abandon")
async def abandon_quest(request: Request, quest_id: str = Form(...), session=Depends(require_character)):
    """Abandon an active quest."""
    return _act(request, session, shop.abandon_quest, quest_id, "/shop?tab=quests")
