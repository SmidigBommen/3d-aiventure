"""JSON API of a fight in the 3D world. Every action is a function of web/fight.py."""

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from web import fight, world
from web.game_session import get_session, save_session

router = APIRouter()

NO_CHARACTER = (409, "no_character", "You have no character yet. Start a new game first.")
BAD_REQUEST = (400, "bad_request", "That is not something you can do in a fight.")
STATUS = {
    "no_battle": 409,
    "not_your_turn": 409,
    "no_such_ability": 404,
    "not_enough_pp": 409,
    "no_such_item": 404,
    "cannot_flee": 409,
    "not_defeated": 409,
}


def _refuse(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _rejected(rejection: fight.Rejected) -> JSONResponse:
    return _refuse(STATUS[rejection.code], rejection.code, rejection.message)


def _answer(session, fled: bool = False) -> dict:
    return {"battle": fight.battle_view(session, fled), "state": world.world_state(session)}


def _strict_object(pairs):
    """A JSON object as a dict; a key given twice is not a body this API reads."""
    made = dict(pairs)
    if len(made) != len(pairs):
        raise ValueError("duplicate key")
    return made


def _not_json(constant):
    raise ValueError(f"{constant} is not JSON")


async def read_object(request: Request):
    """The request body: {} when there is none, the JSON object when it is one, else None.

    Strict JSON: NaN, Infinity and repeated keys are refused, as is anything that is not UTF-8.
    """
    raw = await request.body()
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw.decode("utf-8"), object_pairs_hook=_strict_object, parse_constant=_not_json)
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


async def _act(request: Request, action, field: str = None, kind: type = None):
    """One battle action: refused with nothing written, or carried out and saved.

    `field` names the value the action takes from the body, `kind` its type. An action that takes
    nothing is still refused when it comes with a body that is not a JSON object.
    """
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    try:
        fight.check_turn(session)
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
        phase = action(session, *args)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    save_session(request, session)
    return _answer(session, fled=phase == "fled")


@router.get("")
async def view(request: Request):
    """The fight as it stands. Read-only."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    return _answer(session)


@router.post("/attack")
async def attack(request: Request):
    return await _act(request, lambda session: fight.attack(session))


@router.post("/defend")
async def defend(request: Request):
    return await _act(request, lambda session: fight.defend(session))


@router.post("/ability")
async def ability(request: Request):
    return await _act(request, lambda session, ability_id: fight.use_ability(session, ability_id), "ability_id", str)


@router.post("/item")
async def item(request: Request):
    return await _act(request, lambda session, item_index: fight.use_item(session, item_index), "item_index", int)


@router.post("/flee")
async def flee(request: Request):
    return await _act(request, lambda session: fight.flee(session))


@router.post("/continue")
async def carry_on(request: Request):
    """After a victory: the rewards have been seen."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    if fight.battle_view(session)["phase"] != "victory":
        return _refuse(409, "nothing_to_continue", "There is no victory to carry on from.")
    session.battle_rewards = None
    save_session(request, session)
    return _answer(session)


@router.post("/revive")
async def revive(request: Request):
    """After a defeat: up again in the location's starting area."""
    session = get_session(request)
    if not session.character:
        return _refuse(*NO_CHARACTER)
    if await read_object(request) is None:
        return _refuse(*BAD_REQUEST)
    try:
        fight.revive(session)
    except fight.Rejected as rejection:
        return _rejected(rejection)
    save_session(request, session)
    return _answer(session)
