import sys
from pathlib import Path
from fastapi import APIRouter, Request, Form, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web.game_session import (
    get_session, save_session, get_class_abilities, get_monster_portraits, get_bosses,
    get_battle_sprites,
)
from engine.effects import get_effect_bonus
from engine.abilities import summarize_ability
from engine import campaign as campaign_rules
from web.dependencies import require_character, require_battle
from web import fight
# The fight itself lives in web/fight.py. These names stay importable from here.
from web.fight import (  # noqa: F401
    begin_turn, record, weapon_fx, get_monster_taunt, _taunt, get_monster_for_area,
    classify_log_entry, effect_badges, begin_battle, pick_monster, begin_monster_battle,
    begin_random_battle, begin_boss_battle, maybe_enrage, execute_monster_turn,
)

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent.parent / "templates")

PHASE_URLS = {"fight": "/battle", "victory": "/battle/victory", "defeat": "/battle/defeat"}


def _answer(request: Request, session, phase: str):
    """Save and lead to the page of the phase an action ended in."""
    save_session(request, session)
    return RedirectResponse(PHASE_URLS[phase], status_code=303)


def _rejected(request: Request, session, rejection: fight.Rejected):
    """A rejected action changed nothing: back to the arena (or out of it when there is no fight)."""
    if rejection.code == "cannot_flee":
        session.set_flash("battle_message", {"text": rejection.message, "type": "error"})
        save_session(request, session)
    return RedirectResponse("/game" if rejection.code == "no_battle" else "/battle", status_code=303)


async def end_battle(request: Request, session, player_won: bool):
    """End the battle and lead to its result page."""
    return _answer(request, session, fight.end_battle(session, player_won))

# ---------------------------------------------------------------------------
# Starting battles
# ---------------------------------------------------------------------------

@router.get("/start")
async def start_battle(request: Request, session=Depends(require_character)):
    """Initialize a new random encounter in the current area."""
    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)
    area = session.current_area
    if not area or not area.get("monster_types") or session.character.current_hit_points <= 0:
        return RedirectResponse("/game", status_code=303)

    return await opened(request, session, begin_random_battle(session))


async def opened(request: Request, session, player_stands: bool):
    """Answer for a fight that has just begun: the arena, or the defeat when the opening blow ended it."""
    if not player_stands:
        return await end_battle(request, session, player_won=False)
    save_session(request, session)
    return RedirectResponse("/battle", status_code=303)


@router.post("/boss")
async def start_boss_battle(request: Request, session=Depends(require_character)):
    """Challenge the boss guarding the current area."""
    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)

    bosses = get_bosses()
    boss_id = campaign_rules.get_area_boss(session.current_area, bosses, session.defeated_bosses)
    if not boss_id or session.character.current_hit_points <= 0:
        return RedirectResponse("/game", status_code=303)
    if campaign_rules.missing_requirements(bosses[boss_id], session.defeated_bosses):
        return RedirectResponse("/game", status_code=303)

    session.return_to_3d = False
    return await opened(request, session, begin_boss_battle(session, boss_id))


# ---------------------------------------------------------------------------
# Battle view
# ---------------------------------------------------------------------------

def stage_context(session) -> dict:
    """Template data for the battle stage (battle/_stage.html): both combatants, their
    sprites, and the last turn's events for playback. Also used after the fight ends,
    so the final blow can be shown on the victory and defeat screens."""
    battle = session.battle
    monster = battle.monster
    char = session.character

    boss = get_bosses().get(monster.boss_id) if monster.is_boss else None
    portraits = get_monster_portraits()
    default_portrait = portraits.get("default", "/static/images/orc-creature-battle.jpg")
    sprites = get_battle_sprites()

    return {
        "monster": {
            "name": monster.name,
            "race": monster.race,
            "level": monster.level,
            "hp": monster.hp,
            "max_hp": monster.max_hp,
            "ac": monster.ac + get_effect_bonus(monster.effects, "ac"),
            "portrait": (boss or {}).get("portrait") or portraits.get(monster.race, default_portrait),
            "taunt": _taunt(battle, "start") if battle.is_active and battle.round_count <= 1 else None,
            "is_boss": monster.is_boss,
            "title": boss.get("title") if boss else None,
            "enraged": monster.enraged,
        },
        "player_ac": char.armor_class + get_effect_bonus(battle.player_effects, "ac"),
        "player_effects": effect_badges(battle.player_effects),
        "monster_effects": effect_badges(monster.effects),
        "round": battle.round_count,
        "turn": {"seq": battle.turn_seq, "events": battle.turn_events},
        "sprites": {
            "player": sprites["players"].get(session.character_creation.portrait)
                      or sprites.get("default_player"),
            "monster": (sprites["bosses"].get(monster.boss_id) if boss
                        else sprites["monsters"].get(monster.race)) or sprites.get("default_monster"),
            "backdrop": sprites["backdrops"].get("default"),
        },
    }


@router.get("/", response_class=HTMLResponse)
async def battle_view(request: Request, session=Depends(require_battle)):
    """Battle view - show combat arena."""
    battle = session.battle
    monster = battle.monster
    char = session.character
    char_data = session.serialize_character()

    message = session.pop_flash("battle_message")
    if message:
        save_session(request, session)

    abilities = [{**ability, "summary": summarize_ability(ability, char.level)}
                 for ability in get_class_abilities(char.class_name, char.level)]

    return templates.TemplateResponse(request, "battle/arena.html", {
        "request": request,
        "title": "Boss Battle!" if monster.is_boss else "Battle!",
        "character": char_data,
        **stage_context(session),
        "round": battle.round_count,
        "battle_log": fight.log_entries(battle),
        "is_player_turn": battle.is_player_turn,
        "usable_items": fight.item_stacks(char.inventory),
        "abilities": abilities,
        "flee_dc": 10 + monster.level // 2,
        "flee_mod": char.dexterity_modifier,
        "message": message,
    })


# ---------------------------------------------------------------------------
# Player actions
# ---------------------------------------------------------------------------

@router.post("/attack")
async def player_attack(request: Request, session=Depends(require_battle)):
    """Player attacks the monster."""
    try:
        return _answer(request, session, fight.attack(session))
    except fight.Rejected as rejection:
        return _rejected(request, session, rejection)


@router.post("/defend")
async def player_defend(request: Request, session=Depends(require_battle)):
    """Player takes a defensive stance: +1d4 AC until the end of the round."""
    try:
        return _answer(request, session, fight.defend(session))
    except fight.Rejected as rejection:
        return _rejected(request, session, rejection)


@router.post("/item")
async def use_item(request: Request, item_index: int = Form(...), session=Depends(require_battle)):
    """Use an item during battle."""
    try:
        return _answer(request, session, fight.use_item(session, item_index))
    except fight.Rejected as rejection:
        return _rejected(request, session, rejection)


@router.post("/ability")
async def use_ability(request: Request, ability_id: str = Form(...), session=Depends(require_battle)):
    """Use a class ability in battle."""
    try:
        return _answer(request, session, fight.use_ability(session, ability_id))
    except fight.Rejected as rejection:
        return _rejected(request, session, rejection)


@router.post("/flee")
async def flee(request: Request, session=Depends(require_battle)):
    """Try to escape: d20 + DEX vs DC 10 + half the monster's level. Bosses can't be fled."""
    try:
        phase = fight.flee(session)
    except fight.Rejected as rejection:
        return _rejected(request, session, rejection)
    if phase != "fled":
        return _answer(request, session, phase)
    if session.return_to_3d:
        save_session(request, session)
        return RedirectResponse("/", status_code=303)
    roll = session.battle.flee_roll
    session.set_flash("game_message", {
        "text": f"You slip away from {session.battle.monster.name}! "
                f"(Rolled {roll['total']} vs DC {roll['dc']})",
        "type": "info"})
    save_session(request, session)
    return RedirectResponse("/game", status_code=303)


# ---------------------------------------------------------------------------
# Battle resolution
# ---------------------------------------------------------------------------

@router.get("/victory", response_class=HTMLResponse)
async def victory_screen(request: Request, session=Depends(require_character)):
    """Display victory screen with rewards."""
    # Rewards stay until the next battle ends, so a refresh shows them again
    rewards = session.battle_rewards or {}
    char_data = session.serialize_character() if session.character else None

    return templates.TemplateResponse(request, "battle/victory.html", {
        "request": request,
        "title": "Victory!",
        "character": char_data,
        "rewards": rewards,
        "monster_name": session.battle.monster_name,
        "stage": stage_context(session) if session.battle.monster.name else None,
        "back_url": "/" if session.return_to_3d else "/game",
    })


@router.get("/defeat", response_class=HTMLResponse)
async def defeat_screen(request: Request, session=Depends(require_character)):
    """Display defeat screen."""
    session.battle_rewards = None
    save_session(request, session)
    char_data = session.serialize_character() if session.character else None

    gold = session.character.gold if session.character else 0
    gold_cost = gold // 2

    return templates.TemplateResponse(request, "battle/defeat.html", {
        "request": request,
        "title": "Defeat",
        "character": char_data,
        "monster_name": session.battle.monster_name,
        "stage": stage_context(session) if session.battle.monster.name else None,
        "gold_cost": gold_cost,
        "current_gold": gold,
    })


@router.post("/revive")
async def revive(request: Request, session=Depends(require_character)):
    """Revive the character at the current location's starting area."""
    try:
        fight.revive(session)
    except fight.Rejected:
        return RedirectResponse("/game", status_code=303)
    save_session(request, session)
    return RedirectResponse("/" if session.return_to_3d else "/game?revived=true", status_code=303)


@router.get("/status")
async def battle_status(request: Request):
    """Get current battle status as JSON."""
    session = get_session(request)

    if not session.battle.is_active:
        return {"active": False}

    return {
        "active": True,
        "player": {
            "current_hp": session.character.current_hit_points,
            "max_hp": session.character.max_hit_points
        },
        "monster": {
            "current_hp": session.battle.monster_hp,
            "max_hp": session.battle.monster_max_hp
        },
        "round": session.battle.round_count,
        "is_player_turn": session.battle.is_player_turn
    }
