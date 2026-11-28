"""JSON API of character creation in the 3D client: the data, the preview and the new game.

The rules are the functions of web/creation.py that the classic routes call.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import creation, fight, world
from web.api.battle import read_object
from web.game_session import GameSession, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not a character the game can make.")


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@router.get("/creation")
async def view():
    """Everything the creation steps show. Read-only."""
    return creation.creation_view()


@router.get("/creation/preview")
async def preview(race: str = "", class_name: str = ""):
    """The scores, hit points, power points and armour class of a race and class. Read-only."""
    try:
        return creation.preview(race, class_name)
    except fight.Rejected as rejection:
        return _refuse(400, rejection.code, rejection.message)


def _strings(value) -> bool:
    return isinstance(value, list) and all(isinstance(entry, str) for entry in value)


@router.post("/new-game")
async def new_game(request: Request):
    """Creates the character in a fresh session: nothing of an earlier game remains."""
    body = await read_object(request)
    if body is None:
        return _refuse(*BAD_REQUEST)
    required = [body.get(field) for field in ("race", "class_name", "name", "weapon")]
    armor = body.get("armor")
    portrait = body.get("portrait")
    skills = body.get("skills", [])
    if (not all(isinstance(value, str) for value in required)
            or not (armor is None or isinstance(armor, str))
            or not (portrait is None or isinstance(portrait, str))
            or not _strings(skills)):
        return _refuse(*BAD_REQUEST)
    session = GameSession(request.session.get("session_id"))
    try:
        creation.create(session, *required, armor,
                        creation.DEFAULT_PORTRAIT if portrait is None else portrait, skills)
    except fight.Rejected as rejection:
        return _refuse(400, rejection.code, rejection.message)
    save_session(request, session)
    return {"state": world.world_state(session), "opening": creation.opening()}
