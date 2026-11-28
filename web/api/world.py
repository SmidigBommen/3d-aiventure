"""JSON API of the 3D world: its state, the step to a connected area, and meeting what an area holds."""

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import world
from web.game_session import get_session, save_session

router = APIRouter()

PENDING_MESSAGES = {
    "battle": "You are in a battle. Finish it first.",
    "defeat": "You have fallen and cannot walk on.",
    "event": "Something here needs your attention first.",
}


NO_CHARACTER = (409, "no_character", "You have no character yet. Start a new game first.")


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@router.get("/state")
async def state(request: Request):
    """Where the character is and what is around. Read-only."""
    return world.world_state(get_session(request))


@router.post("/move")
async def move(request: Request):
    """Walk through a gate into a connected area. Answers with the new state."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = None
    area_id = body.get("area_id") if isinstance(body, dict) else None
    if not isinstance(area_id, str):
        return _refuse(400, "bad_request", "That is not a place you can walk to.")
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])
    if not world.move_to_area(session, area_id):
        return _refuse(400, "not_connected", "There is no way there from here.")
    save_session(request, session)
    return world.world_state(session)


@router.post("/enter")
async def enter(request: Request):
    """Arrive in the current area: what it holds is rolled when that has not happened yet."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if session.current_area and not world.stored_contents(session) and not world.pending(session):
        world.roll_contents(session)
        save_session(request, session)
    return world.world_state(session)


@router.post("/search")
async def search(request: Request):
    """Search the area further: a new roll for what it holds."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])
    contents = world.stored_contents(session)
    if contents and (contents.get("monster") or contents.get("event")):
        return _refuse(409, "occupied", "Deal with what is here before you search further.")
    area = session.current_area
    location = session.current_location
    if not area or not world.has_search_spot(area, location.get("type"), session.completed_events):
        return _refuse(409, "nothing_to_find", "There is nothing more to find here.")
    world.roll_contents(session)
    save_session(request, session)
    return world.world_state(session)


@router.post("/engage")
async def engage(request: Request):
    """Meet the monster, event or boss with this id. Answers the fight or the event it starts."""
    # Imported here: web.fight imports web.world, which this module imports too.
    from web import events, fight

    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = None
    content_id = body.get("id") if isinstance(body, dict) else None
    if not isinstance(content_id, str):
        return _refuse(400, "bad_request", "That is not something you can turn to.")
    waiting = world.pending(session)
    if waiting:
        return _refuse(409, "pending", PENDING_MESSAGES[waiting["kind"]])

    contents = world.stored_contents(session) or {}
    monster = contents.get("monster")
    event = contents.get("event")
    boss = world.area_boss(session) if contents else None
    if monster and monster["id"] == content_id:
        session.engaged_monster = world.take_monster(session)
        fight.opened(session, fight.begin_monster_battle(session, session.engaged_monster))
    elif event and event["id"] == content_id:
        session.engaged_monster = None
        session.pending_event = world.take_event(session)
        save_session(request, session)
        return {"state": world.world_state(session), "battle": None, "event": events.event_view(session)}
    elif boss and boss["id"] == content_id:
        if boss["locked"]:
            return _refuse(409, "locked", boss["locked_text"])
        session.engaged_monster = None
        fight.opened(session, fight.begin_boss_battle(session, content_id))
    else:
        return _refuse(404, "not_here", "That is not here any more.")
    save_session(request, session)
    return {"state": world.world_state(session), "battle": fight.battle_view(session), "event": None}
