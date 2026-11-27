"""Where the player stands and where they can walk: logic shared by the classic routes and the JSON API.

None of this is a game rule; it reads the campaign data and the session.
"""

import random
import uuid

from engine import campaign as campaign_rules
from engine.events import eligible_events, pick_event
from web.game_session import GameSession, get_bosses, get_event_objects, get_events

DEFAULT_LOCKED_TEXT = "The way is barred. Something else must fall first."

CHARACTER_KEYS = (
    "name", "race", "class_name", "level",
    "current_hit_points", "max_hit_points", "power_points", "max_power_points",
    "xp", "xp_to_next_level", "gold",
)


def danger_band(area) -> str:
    """Danger band of an area from its 0-10 encounter rating."""
    encounters = area.get("encounters", 0)
    if encounters <= 0:
        return "safe"
    if encounters <= 2:
        return "low"
    return "med" if encounters <= 5 else "high"


def can_rest(area) -> bool:
    special = str(area.get("special", "")).lower() if area else ""
    return "rest" in special or "inn" in special or "tavern" in special


def has_shop(area) -> bool:
    """The special can be a string like "shop_location"."""
    return "shop" in str(area.get("special", "")).lower() if area else False


def is_boss_area(area) -> bool:
    """The campaign places a boss here, defeated or not."""
    return bool(area) and area.get("boss") in get_bosses()


def pending(session: GameSession):
    """What the player has to deal with before they can walk on: {"kind", "url"} or None."""
    if session.battle.is_active:
        return {"kind": "battle", "url": "/battle"}
    if session.character and session.character.current_hit_points <= 0:
        return {"kind": "defeat", "url": "/battle/defeat"}
    if session.pending_event or session.event_result:
        return {"kind": "event", "url": "/game/event"}
    return None


def rest(session: GameSession) -> str:
    """Rest where the area allows it: hit points and power points back, effects gone."""
    # Imported here: web.fight imports this module.
    from web.fight import Rejected

    if not session.current_area or not can_rest(session.current_area):
        raise Rejected("cannot_rest", "There is nowhere to rest here.")
    character = session.character
    character.current_hit_points = character.max_hit_points
    character.power_points = character.max_power_points
    character.active_effects = []
    return "You rest. Hit points and power points are restored."


def move_to_area(session: GameSession, area_id) -> bool:
    """Step into a connected area of the current location. False (and no change) when it is not connected."""
    location = session.current_location
    current = session.current_area
    if not location or not current or area_id not in current.get("connections", []):
        return False
    for area in location.get("areas", []):
        if area["id"] == area_id:
            session.current_area = area
            roll_contents(session)
            return True
    return False


def encounter_chance(area) -> float:
    """Chance that a roll in this area gives a monster, from its 0-10 encounter rating."""
    return min(1.0, area.get("encounters", 5) / 5.0)


def roll_explore(session: GameSession) -> dict:
    """The roll for what the current area holds: a monster, an event or nothing.

    The one place this roll exists; classic Explore, entering an area and searching all use it.
    Changes nothing in the session. Returns {"monster": None | {...}, "event": None | id}.
    """
    # Imported here: both modules import this one. EVENT_CHANCE is read at every roll.
    from web.routes import game as game_routes
    from web.routes.battle import pick_monster

    area = session.current_area
    location = session.current_location
    if area.get("monster_types") and random.random() < encounter_chance(area):
        return {"monster": pick_monster(area, location), "event": None}

    # No fight: maybe something more interesting than nothing
    if random.random() < game_routes.EVENT_CHANCE:
        event_id = pick_event(get_events(), location.get("type") if location else None,
                              area.get("special"), session.completed_events)
        if event_id:
            return {"monster": None, "event": event_id}
    return {"monster": None, "event": None}


def has_search_spot(area: dict, location_type, completed_events: list) -> bool:
    """Whether a roll in this area can give anything."""
    if area.get("monster_types") and encounter_chance(area) > 0:
        return True
    return any(eligible_events(get_events(), location_type, area.get("special"), completed_events))


def stored_contents(session: GameSession):
    """The stored contents when they belong to the area the character stands in, else None."""
    contents = session.area_contents
    location = session.current_location
    area = session.current_area
    if not contents or not location or not area:
        return None
    if contents.get("location") != location["name"] or contents.get("area_id") != area["id"]:
        return None
    return contents


def roll_contents(session: GameSession):
    """Roll for the current area and store the result in place of whatever was stored."""
    if not session.current_area or not session.current_location:
        session.area_contents = None
        return None
    rolled = roll_explore(session)
    previous = session.area_contents or {}
    session.area_contents = {
        "location": session.current_location["name"],
        "area_id": session.current_area["id"],
        "seq": int(previous.get("seq", 0)) + 1,
        "monster": {"id": uuid.uuid4().hex, **rolled["monster"]} if rolled["monster"] else None,
        "event": {"id": rolled["event"]} if rolled["event"] else None,
        "spent": None,
    }
    return session.area_contents


def take_monster(session: GameSession):
    """Remove the monster from the current area's contents and return it (None when there is none)."""
    contents = stored_contents(session)
    monster = contents.get("monster") if contents else None
    if monster:
        contents["monster"] = None
    return monster


def take_event(session: GameSession):
    """Remove the event from the current area's contents and return its id (None when there is none)."""
    contents = stored_contents(session)
    event = contents.get("event") if contents else None
    if event:
        contents["event"] = None
    return event["id"] if event else None


def area_boss(session: GameSession):
    """The undefeated boss of the current area as the client shows it, or None."""
    bosses = get_bosses()
    boss_id = campaign_rules.get_area_boss(session.current_area, bosses, session.defeated_bosses)
    if not boss_id:
        return None
    boss = bosses[boss_id]
    locked = bool(campaign_rules.missing_requirements(boss, session.defeated_bosses))
    return {
        "id": boss_id,
        "name": boss["name"],
        "level": boss["level"],
        "locked": locked,
        "locked_text": boss.get("locked_text", DEFAULT_LOCKED_TEXT) if locked else None,
        "title": boss.get("title", ""),
        "intro": boss.get("intro"),
    }


def event_look(event_id: str) -> dict:
    """An event as the client places and names it. A discovery (an event with `special`) is met at the landmark."""
    definition = get_events().get(event_id, {})
    title = definition.get("title", event_id)
    look = get_event_objects().get(event_id, {"object": "chest", "label": title})
    return {"id": event_id, "title": title, "object": look["object"], "label": look["label"],
            "landmark": bool(definition.get("special"))}


def mark_spent(session: GameSession, event_id: str) -> None:
    """Remember the event resolved in the current area until its contents are rolled again."""
    contents = stored_contents(session)
    if contents is not None:
        contents["spent"] = {"id": event_id}


def contents_view(session: GameSession):
    """The contents of the current area for the client, or None when they are not rolled."""
    contents = stored_contents(session)
    if not contents:
        return None
    monster = contents.get("monster")
    event = contents.get("event")
    spent = contents.get("spent")
    location = session.current_location
    return {
        "seq": contents.get("seq", 1),
        "monster": {key: monster[key] for key in ("id", "race", "name", "level")} if monster else None,
        "event": event_look(event["id"]) if event else None,
        "spent": event_look(spent["id"]) if spent else None,
        "boss": area_boss(session),
        "search_spot": has_search_spot(session.current_area, location.get("type"), session.completed_events),
    }


def world_state(session: GameSession) -> dict:
    """What the 3D client needs to show the place the character stands in."""
    # Imported here: web.shop is imported by web.fight, which imports this module.
    from web.shop import tracked_quests

    if not session.character:
        return {"has_character": False, "character": None, "location": None, "area": None,
                "exits": [], "pending": None, "asi_points": 0, "quests": []}

    serialized = session.serialize_character()
    location = session.current_location
    area = session.current_area if location else None
    by_id = {a["id"]: a for a in location.get("areas", [])} if location else {}
    act = session.act or {}

    return {
        "has_character": True,
        "character": {key: serialized[key] for key in CHARACTER_KEYS},
        "location": {
            "name": location["name"],
            "type": location.get("type"),
            "act": {"number": act.get("number"), "title": act.get("title")},
        } if location else None,
        "area": {
            "id": area["id"],
            "name": area["name"],
            "description": area.get("description", ""),
            "danger": danger_band(area),
            "has_shop": has_shop(area),
            "can_rest": can_rest(area),
            "has_boss": campaign_rules.get_area_boss(area, get_bosses(), session.defeated_bosses) is not None,
            "is_boss_area": is_boss_area(area),
            "special": area.get("special"),
        } if area else None,
        "exits": [
            {"id": aid, "name": by_id[aid]["name"], "danger": danger_band(by_id[aid])}
            for aid in (area.get("connections", []) if area else []) if aid in by_id
        ],
        "pending": pending(session),
        "contents": contents_view(session) if area else None,
        "asi_points": serialized["asi_points"],
        "quests": tracked_quests(session),
    }
