"""Exploration events, as functions of a GameSession: the pending event as the client shows it,
the player's choice and what follows the outcome.

No Request, no saving, no redirects: the classic routes (web/routes/game.py) and the API routes
(web/api/event.py) both call these. The rules themselves are in engine/events.py.
"""

from engine.events import resolve_event_choice, scaled_dc
from engine.leveling import grant_xp
from skills import calculate_skill_modifier
from web import fight, world
from web.game_session import GameSession, get_events, get_primary_modifier

RESULT_DEFAULTS = {
    "title": "", "label": "", "success": True, "check": None, "text": "",
    "gold": 0, "xp": 0, "heal": 0, "pp": 0, "damage": 0,
    "item": None, "battle": False, "leveled_up": False, "new_level": None,
}


def location_tier(location) -> int:
    """Danger tier of a location: the low end of its encounter level range."""
    level_range = str(location.get("encounterLevel", "1")) if location else "1"
    try:
        return max(1, int(level_range.split("-")[0]))
    except ValueError:
        return 1


def pending_definition(session: GameSession):
    """The definition of the pending event, or None when nothing is pending or the id names no event."""
    return get_events().get(session.pending_event) if session.pending_event else None


def event_view(session: GameSession):
    """The pending event with its choices and their checks, or None."""
    event = pending_definition(session)
    if not event:
        return None
    char = session.character
    tier = location_tier(session.current_location)
    choices = []
    for index, choice in enumerate(event["choices"]):
        skill = choice.get("skill") or None
        choices.append({
            "index": index,
            "label": choice["label"],
            "hotkey": str(index + 1),
            "skill": skill,
            "dc": scaled_dc(choice.get("dc", 10), tier) if skill else None,
            "modifier": calculate_skill_modifier(char, skill) if skill else None,
            "proficient": char.has_skill_proficiency(skill) if skill else None,
        })
    return {**world.event_look(session.pending_event), "text": event["text"], "choices": choices}


def result_view(session: GameSession):
    """The outcome of the event just resolved, always with every key, or None."""
    stored = session.event_result
    if not stored:
        return None
    return {key: stored.get(key, default) for key, default in RESULT_DEFAULTS.items()}


def choose(session: GameSession, choice: int) -> dict:
    """Resolve the player's choice for the pending event. Returns the stored result."""
    event_id = session.pending_event
    event = pending_definition(session)
    if not event:
        raise fight.Rejected("no_event", "Nothing here is waiting for your choice.")
    if not 0 <= choice < len(event.get("choices", [])):
        raise fight.Rejected("no_such_choice", "That is not one of the choices.")

    char = session.character
    result = resolve_event_choice(char, event, choice, location_tier(session.current_location))
    if result["xp"]:
        xp_result = grant_xp(char, result["xp"], get_primary_modifier(char))
        result["leveled_up"] = xp_result["leveled_up"]
        result["new_level"] = xp_result["new_level"]

    result["title"] = event["title"]
    # Kept until Continue: a fight that follows stands where the event was
    result["event_id"] = event_id
    session.pending_event = None
    session.event_result = result
    session.events_resolved += 1
    # One-time events are spent whatever the outcome (no retrying a botched check)
    if event.get("once") and event_id not in session.completed_events:
        session.completed_events.append(event_id)
    world.mark_spent(session, event_id)
    return result


def dismiss(session: GameSession):
    """Put the outcome away and return it (None when there was none)."""
    result = session.event_result
    session.event_result = None
    return result


def can_start_battle(session: GameSession) -> bool:
    """Whether a random fight can start where the character stands (the conditions of GET /battle/start)."""
    area = session.current_area
    return bool(not session.battle.is_active and area and area.get("monster_types")
                and session.character.current_hit_points > 0)


def carry_on(session: GameSession) -> str:
    """After the outcome was read: "fight" or "defeat" when it led into a fight, else "world"."""
    if not session.event_result:
        raise fight.Rejected("nothing_to_continue", "There is nothing to carry on from.")
    result = dismiss(session)
    if not result.get("battle") or not can_start_battle(session):
        return "world"
    definition = get_events().get(result.get("event_id"), {})
    place = "landmark" if definition.get("special") else "event"
    if fight.begin_random_battle(session, place=place):
        return "fight"
    return fight.end_battle(session, False)
