"""Where the player stands and where they can walk: logic shared by the classic routes and the JSON API.

None of this is a game rule; it reads the campaign data and the session.
"""

from engine import campaign as campaign_rules
from web.game_session import GameSession, get_bosses

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


def pending(session: GameSession):
    """What the player has to deal with before they can walk on: {"kind", "url"} or None."""
    if session.battle.is_active:
        return {"kind": "battle", "url": "/battle"}
    if session.character and session.character.current_hit_points <= 0:
        return {"kind": "defeat", "url": "/battle/defeat"}
    if session.pending_event or session.event_result:
        return {"kind": "event", "url": "/game/event"}
    return None


def move_to_area(session: GameSession, area_id) -> bool:
    """Step into a connected area of the current location. False (and no change) when it is not connected."""
    location = session.current_location
    current = session.current_area
    if not location or not current or area_id not in current.get("connections", []):
        return False
    for area in location.get("areas", []):
        if area["id"] == area_id:
            session.current_area = area
            return True
    return False


def world_state(session: GameSession) -> dict:
    """What the 3D client needs to show the place the character stands in."""
    if not session.character:
        return {"has_character": False, "character": None, "location": None, "area": None,
                "exits": [], "pending": None}

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
        } if area else None,
        "exits": [
            {"id": aid, "name": by_id[aid]["name"], "danger": danger_band(by_id[aid])}
            for aid in (area.get("connections", []) if area else []) if aid in by_id
        ],
        "pending": pending(session),
    }
