"""JSON API of an exploration event in the 3D world. The logic is web/events.py."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import events, fight, world
from web.api.battle import NO_CHARACTER, read_object
from web.game_session import get_session, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not something you can choose.")
STATUS = {"no_event": 409, "no_such_choice": 404, "nothing_to_continue": 409}


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _rejected(rejection: fight.Rejected) -> JSONResponse:
    return _refuse(STATUS[rejection.code], rejection.code, rejection.message)


@router.get("")
async def view(request: Request):
    """The pending event, or the outcome of the one just resolved. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    result = events.result_view(session)
    return {"event": None if result else events.event_view(session), "result": result,
            "state": world.world_state(session)}


@router.post("/choose")
async def choose(request: Request):
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    body = await read_object(request)
    choice = body.get("choice") if body is not None else None
    # A boolean is an int in Python, and no index.
    if not isinstance(choice, int) or isinstance(choice, bool):
        return _refuse(*BAD_REQUEST)
    try:
        events.choose(session, choice)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    save_session(request, session)
    return {"event": None, "result": events.result_view(session), "state": world.world_state(session)}


@router.post("/continue")
async def carry_on(request: Request):
    """The outcome has been read. Answers with the fight when the outcome led into one."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    try:
        phase = events.carry_on(session)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    save_session(request, session)
    return {"event": None, "result": None, "state": world.world_state(session),
            "battle": fight.battle_view(session) if phase != "world" else None}
