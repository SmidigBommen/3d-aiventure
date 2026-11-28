"""JSON API of the save slots in the 3D client. The files are those of web/save_manager.py, shared with /saves."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import save_manager, world
from web.api.battle import NO_CHARACTER, read_object
from web.game_session import get_session, save_session

router = APIRouter()

BAD_REQUEST = (400, "bad_request", "That is not something you can do with a save.")
NO_SUCH_SAVE = (404, "no_such_save", "That save does not exist any more.")
SLOTS_FULL = (409, "slots_full", "Every slot is taken. Overwrite or delete a save first.")


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


@router.get("")
async def view(request: Request):
    """The save slots. Read-only; works without a character."""
    return save_manager.saves_view(get_session(request))


@router.post("")
async def save(request: Request):
    """The game as it stands into a new slot. The session itself is not written."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    if save_manager.get_save_count() >= save_manager.MAX_SAVES:
        return _refuse(*SLOTS_FULL)
    made = save_manager.create_save(session)
    return {"saves": save_manager.saves_view(session), "save_id": made["save_id"], "message": "Game saved."}


@router.post("/{save_id}")
async def overwrite(request: Request, save_id: str):
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    if not save_manager.overwrite_save(save_id, session):
        return _refuse(*NO_SUCH_SAVE)
    return {"saves": save_manager.saves_view(session), "save_id": save_id, "message": "Save updated."}


@router.post("/{save_id}/load")
async def load(request: Request, save_id: str):
    """The saved game becomes this client's session, under a new session id."""
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    loaded = save_manager.load_save(save_id)
    if not loaded:
        return _refuse(*NO_SUCH_SAVE)
    save_session(request, loaded)
    return {"saves": save_manager.saves_view(loaded), "state": world.world_state(loaded), "message": "Game loaded."}


@router.post("/{save_id}/delete")
async def delete(request: Request, save_id: str):
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    if not save_manager.delete_save(save_id):
        return _refuse(*NO_SUCH_SAVE)
    return {"saves": save_manager.saves_view(get_session(request)), "message": "Save deleted."}
