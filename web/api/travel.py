"""JSON API of travel, the journal and the ending in the 3D world.

Every route is a function of web/travel.py.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import fight, travel, world
from web.api.battle import NO_CHARACTER, read_object
from web.api.world import PENDING_MESSAGES
from web.game_session import get_bosses, get_session, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not a place you can travel to.")
STATUS = {"no_such_location": 404, "act_locked": 409, "not_complete": 409}


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _rejected(rejection: fight.Rejected) -> JSONResponse:
    return _refuse(STATUS[rejection.code], rejection.code, rejection.message)


@router.get("/travel")
async def travel_list(request: Request):
    """Every act and location, with what is locked and where the character is. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    return {"travel": travel.travel_view(session), "state": world.world_state(session)}


@router.post("/travel")
async def travel_to(request: Request):
    """Travel to a location. Lady Vex's ambush, when due, starts instead of the arrival."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    body = await read_object(request)
    name = body.get("location") if body is not None else None
    if not isinstance(name, str):
        return _refuse(*BAD_REQUEST)
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])
    try:
        travel.check_destination(session, name)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    if session.current_location and session.current_location["name"] == name:
        return _refuse(409, "already_here", "You are already there.")

    result = travel.travel(session, name)
    save_session(request, session)
    ambush = None
    if result != "arrived":
        boss_id = session.battle.monster.boss_id
        boss = get_bosses()[boss_id]
        ambush = {"id": boss_id, "name": boss["name"], "title": boss.get("title", ""),
                  "intro": boss.get("intro")}
    return {
        "travel": travel.travel_view(session),
        "state": world.world_state(session),
        "battle": fight.battle_view(session) if ambush else None,
        "ambush": ambush,
    }


@router.get("/journal")
async def journal(request: Request):
    """Main quest, crown shards, bosses and deeds. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    return {"journal": travel.journal_view(session), "state": world.world_state(session)}


@router.get("/ending")
async def ending(request: Request):
    """The epilogue, refused until every act is complete. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    try:
        view = travel.ending_view(session)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    return {"ending": view, "state": world.world_state(session)}
