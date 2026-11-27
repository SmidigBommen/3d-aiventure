"""JSON API of the inventory, the character sheet and rest in the 3D world.

Every action is the function of web/inventory.py, web/sheet.py or web/world.py that the classic route calls.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import fight, inventory, sheet, world
from web.api.battle import NO_CHARACTER, read_object
from web.api.world import PENDING_MESSAGES
from web.game_session import get_session, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not something you can do here.")
STATUS = {
    "no_such_item": 404,
    "defeated": 409,
    "full_health": 409,
    "not_a_weapon": 409,
    "not_armor": 409,
    "not_proficient": 409,
    "nothing_equipped": 409,
    "no_such_ability": 404,
    "no_points": 409,
    "score_at_cap": 409,
    "cannot_rest": 409,
}


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _answer(session, message=None) -> dict:
    return {"inventory": inventory.inventory_view(session), "sheet": sheet.sheet_view(session),
            "state": world.world_state(session), "message": message}


async def _act(request: Request, action, field: str = None, kind: type = None):
    """One action: refused with nothing written, or carried out and saved.

    `field` names the value the action takes from the body, `kind` its type. An action that takes
    nothing is still refused when it comes with a body that is not a JSON object.
    """
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    body = await read_object(request)
    if body is None:
        return _refuse(*BAD_REQUEST)
    args = ()
    if field:
        value = body.get(field)
        # A boolean is an int in Python, and no index.
        if not isinstance(value, kind) or isinstance(value, bool):
            return _refuse(*BAD_REQUEST)
        args = (value,)
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])
    try:
        message = action(session, *args)
    except fight.Rejected as rejection:
        return _refuse(STATUS[rejection.code], rejection.code, rejection.message)
    save_session(request, session)
    return _answer(session, message)


@router.get("/character")
async def view(request: Request):
    """The inventory and the character sheet as they stand. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    return _answer(session)


@router.post("/character/improve")
async def improve(request: Request):
    return await _act(request, sheet.improve, "ability", str)


@router.post("/inventory/use")
async def use(request: Request):
    return await _act(request, inventory.use_potion, "item_index", int)


@router.post("/inventory/equip-weapon")
async def equip_weapon(request: Request):
    return await _act(request, inventory.equip_weapon, "item_index", int)


@router.post("/inventory/equip-armor")
async def equip_armor(request: Request):
    return await _act(request, inventory.equip_armor, "item_index", int)


@router.post("/inventory/unequip-weapon")
async def unequip_weapon(request: Request):
    return await _act(request, inventory.unequip_weapon)


@router.post("/inventory/unequip-armor")
async def unequip_armor(request: Request):
    return await _act(request, inventory.unequip_armor)


@router.post("/rest")
async def rest(request: Request):
    return await _act(request, world.rest)
