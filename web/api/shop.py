"""JSON API of Elara's shop and quest board in the 3D world.

Every action is the function of web/shop.py that the classic route calls. The API sets no flash
message and leaves `haggle_result` alone: the roll comes back in the answer.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import fight, shop, world
from web.api.battle import NO_CHARACTER, read_object
from web.api.world import PENDING_MESSAGES
from web.game_session import get_session, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not something you can do in a shop.")
NO_SHOP = (409, "no_shop", "There is no shop here.")
STATUS = {
    "no_such_item": 404,
    "out_of_stock": 409,
    "not_enough_gold": 409,
    "not_sellable": 409,
    "already_haggled": 409,
    "no_such_quest": 404,
    "quest_slots_full": 409,
    "quest_taken": 409,
    "quest_not_ready": 409,
    "quest_not_active": 404,
}


def _refuse(status: int, code: str, message: str, dialog=None) -> JSONResponse:
    return JSONResponse({"error": code, "message": message, "dialog": dialog}, status_code=status)


def _answer(session, context=None, message=None, haggle=None) -> dict:
    return {"shop": shop.shop_view(session, context), "state": world.world_state(session),
            "message": message, "haggle": haggle}


async def _act(request: Request, action, field: str, kind: type):
    """One action: refused with nothing written, or carried out and saved."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    body = await read_object(request)
    value = body.get(field) if body is not None else None
    # A boolean is an int in Python, and no index.
    if not isinstance(value, kind) or isinstance(value, bool):
        return _refuse(*BAD_REQUEST)
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])
    if not world.has_shop(session.current_area):
        return _refuse(*NO_SHOP)
    try:
        done = action(session, value)
    except fight.Rejected as rejection:
        context = shop.REFUSAL_CONTEXT.get(rejection.code)
        return _refuse(STATUS[rejection.code], rejection.code, rejection.message,
                       shop.dialog(context) if context else None)
    save_session(request, session)
    return _answer(session, done["context"], done["message"], done["haggle"])


@router.get("")
async def view(request: Request):
    """The shop as it stands. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if not world.has_shop(session.current_area):
        return _refuse(*NO_SHOP)
    return _answer(session)


@router.post("/buy")
async def buy(request: Request):
    return await _act(request, shop.buy, "item_index", int)


@router.post("/sell")
async def sell(request: Request):
    return await _act(request, shop.sell, "item_index", int)


@router.post("/haggle")
async def haggle(request: Request):
    return await _act(request, shop.haggle, "item_index", int)


@router.post("/quest/accept")
async def accept_quest(request: Request):
    return await _act(request, shop.accept_quest, "quest_id", str)


@router.post("/quest/turn-in")
async def turn_in_quest(request: Request):
    return await _act(request, shop.turn_in_quest, "quest_id", str)


@router.post("/quest/abandon")
async def abandon_quest(request: Request):
    return await _act(request, shop.abandon_quest, "quest_id", str)
