"""Travel between locations, the journal and the ending as functions of a session.

Shared by the classic routes and the JSON API. No `Request`, no saving. Progression is derived from
`session.defeated_bosses` by engine/campaign.py.
"""

from engine import campaign as campaign_rules
from web import fight, world
from web.game_session import GameSession, get_bosses, get_campaign, get_quests

EPILOGUE = (
    "The wound in the sky above the Convergence closes, and for the first time in a generation "
    "the five provinces of Eldoria wake to the same quiet dawn.",
    "The Crown of Unity is whole again — not because a king willed it, but because {name}, a {race} "
    "{class_name} out of Rivermeet, carried its shards through forest, fire, flood, storm and stone, "
    "and would not put them down.",
    "In the Whispering Woods the trees speak gently again. The beacon on the old watchtower is lit. "
    "And in a tavern called the Flowing Tankard, they are already getting the story wrong.",
)


def locked_reason(act_number: int) -> str:
    return f"Defeat the guardians of Act {act_number - 1} to open the way."


def find_location(location_name):
    """The (act, location) of the campaign with that name, or None."""
    for act in get_campaign()["acts"]:
        for location in act["locations"]:
            if location["name"] == location_name:
                return act, location
    return None


def check_destination(session: GameSession, location_name):
    """The (act, location) one can travel to, or the refusal. Changes nothing."""
    found = find_location(location_name)
    if not found:
        raise fight.Rejected("no_such_location", "There is no such place.")
    act = found[0]
    if act["number"] > campaign_rules.highest_unlocked_act(get_campaign(), session.defeated_bosses):
        raise fight.Rejected("act_locked", locked_reason(act["number"]))
    return found


def travel_view(session: GameSession) -> dict:
    """Every act with all its locations, the current one marked, locked acts with their reason."""
    campaign = get_campaign()
    bosses = get_bosses()
    defeated = session.defeated_bosses
    unlocked = campaign_rules.highest_unlocked_act(campaign, defeated)
    current = session.current_location["name"] if session.current_location else None

    acts = []
    for act in campaign["acts"]:
        locations = []
        for loc in act["locations"]:
            boss_ids = [a["boss"] for a in loc.get("areas", []) if a.get("boss")]
            locations.append({
                "name": loc["name"],
                "description": loc["description"],
                "type": loc.get("type", ""),
                "level_range": loc.get("encounterLevel"),
                "has_boss": any(b in bosses and b not in defeated for b in boss_ids),
                "cleared": bool(boss_ids) and all(b in defeated for b in boss_ids),
                "current": loc["name"] == current,
            })
        locked = act["number"] > unlocked
        acts.append({
            "number": act["number"],
            "title": act["title"],
            "locked": locked,
            "locked_reason": locked_reason(act["number"]) if locked else None,
            "locations": locations,
        })
    return {"current": current, "acts": acts}


def travel(session: GameSession, location_name: str, in_3d: bool = False) -> str:
    """Travel to a location of an unlocked act: "arrived", "ambush" or "defeat".

    The character arrives in the location's starting area and its contents are rolled. A pursuing
    boss may strike on the road: then the fight is pending with the character already at the
    destination. `in_3d` says which interface the fight is played in.
    """
    act, location = check_destination(session, location_name)

    session.act = act
    session.current_location = location
    session.current_area = world.starting_area(location)
    world.roll_contents(session)

    ambush = campaign_rules.pending_ambush(get_bosses(), act, session.defeated_bosses)
    if ambush and session.character.current_hit_points > 0:
        session.return_to_3d = in_3d
        # Fought on the road rather than at a boss's place
        if not fight.begin_boss_battle(session, ambush, place="road" if in_3d else "monster"):
            fight.end_battle(session, False)
            return "defeat"
        return "ambush"
    return "arrived"


def _deeds(session: GameSession) -> dict:
    return {
        "kills": session.monster_kills,
        "bosses": len(session.defeated_bosses),
        "events": session.events_resolved,
        "quests": len(session.completed_quests),
    }


def journal_view(session: GameSession) -> dict:
    """The adventurer's journal: main quest, crown shards, bosses and deeds."""
    campaign = get_campaign()
    bosses = get_bosses()
    defeated = session.defeated_bosses
    unlocked = campaign_rules.highest_unlocked_act(campaign, defeated)
    won_shards = campaign_rules.collected_shards(bosses, defeated)

    acts = []
    for act in campaign["acts"]:
        known = act["number"] <= unlocked
        act_bosses = []
        for location in act["locations"]:
            for area in location.get("areas", []):
                boss_id = area.get("boss")
                if boss_id in bosses:
                    act_bosses.append({
                        "name": bosses[boss_id]["name"] if known else "???",
                        "title": bosses[boss_id].get("title", "") if known else "",
                        "where": f"{location['name']} — {area['name']}" if known else "Unknown",
                        "level": bosses[boss_id]["level"],
                        "defeated": boss_id in defeated,
                    })
        acts.append({
            "number": act["number"],
            "title": act["title"],
            "description": act["description"],
            "main_quest": act["mainQuest"],
            "locked": not known,
            "complete": campaign_rules.is_act_complete(act, defeated),
            "current": act["number"] == unlocked,
            "bosses": act_bosses,
        })

    all_quests = get_quests()
    return {
        "campaign": {"title": campaign["title"], "description": campaign["description"]},
        "acts": acts,
        "shards": [{"name": s, "found": s in won_shards} for s in campaign_rules.all_shards(bosses)],
        "campaign_complete": campaign_rules.is_campaign_complete(campaign, defeated),
        "stats": _deeds(session),
        "active_quests": [
            {"name": all_quests[q]["name"], "progress": state["progress"],
             "target": all_quests[q]["target_count"], "ready": state["status"] == "ready"}
            for q, state in session.active_quests.items() if q in all_quests
        ],
    }


def ending_view(session: GameSession) -> dict:
    """The epilogue, once every act is complete."""
    campaign = get_campaign()
    if not campaign_rules.is_campaign_complete(campaign, session.defeated_bosses):
        raise fight.Rejected("not_complete", "The crown is not yet whole.")
    character = session.serialize_character()
    who = {key: character[key] for key in ("name", "race", "class_name", "level", "gold")}
    return {
        "title": "The Crown Restored",
        "campaign_title": campaign["title"],
        "paragraphs": [paragraph.format(**who) for paragraph in EPILOGUE],
        "character": who,
        "stats": _deeds(session),
        "shards": list(campaign_rules.all_shards(get_bosses())),
    }
