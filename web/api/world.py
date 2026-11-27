"""JSON API for walking through the areas: the state of the world and the step to a connected area."""

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
        return _refuse(409, "no_character", "You have no character yet. Start a new game first.")
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
