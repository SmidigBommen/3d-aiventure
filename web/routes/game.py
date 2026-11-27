import sys
from pathlib import Path
from fastapi import APIRouter, Request, Form, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web.game_session import (
    get_session, save_session, get_campaign, get_bosses, get_quests,
)
from web.dependencies import require_character
from web import events, fight, world
from engine import campaign as campaign_rules

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent.parent / "templates")

# Chance that exploring without a fight turns up an event
EVENT_CHANCE = 0.65


# Shared with the JSON API (web/world.py); the old names stay for this file and its tests.
_can_rest = world.can_rest
_danger = world.danger_band


# The events themselves live in web/events.py. This name stays importable from here.
location_tier = events.location_tier


def _boss_panel(session):
    """Display data for the boss guarding the current area, if any remains."""
    shown = world.area_boss(session)
    if not shown:
        return None
    boss = get_bosses()[shown["id"]]
    return {
        "name": boss["name"],
        "title": boss.get("title", ""),
        "level": boss["level"],
        "locked": shown["locked"],
        "locked_text": boss.get("locked_text", world.DEFAULT_LOCKED_TEXT),
        "shard": boss.get("shard"),
    }


def build_area_map(location, current_area, defeated_bosses) -> dict:
    """Lay the location's areas out as a top-down map.

    Rows are the number of steps from the location's first area, so the way in
    is at the top and the deepest area at the bottom. Positions are percentages
    of the map box. Returns {"rows", "nodes", "edges"}.
    """
    areas = {a["id"]: a for a in location.get("areas", [])}
    if not areas:
        return {"rows": 0, "nodes": [], "edges": []}
    links = {aid: [c for c in a.get("connections", []) if c in areas] for aid, a in areas.items()}

    # Breadth-first from the entry area; children stay grouped under their parent
    rows, seen, frontier = [], set(), [next(iter(areas))]
    while frontier:
        seen.update(frontier)
        rows.append(frontier)
        nxt = []
        for aid in frontier:
            for conn in links[aid]:
                if conn not in seen and conn not in nxt:
                    nxt.append(conn)
        frontier = nxt
    unreachable = [aid for aid in areas if aid not in seen]
    if unreachable:
        rows.append(unreachable)

    pos = {}
    for r, row in enumerate(rows):
        for i, aid in enumerate(row):
            pos[aid] = (round((i + 0.5) / len(row) * 100, 1),
                        round((r + 0.5) / len(rows) * 100, 1))

    current_id = current_area["id"] if current_area else None
    reachable = set(links.get(current_id, []))
    bosses = get_bosses()

    nodes = []
    for aid, area in areas.items():
        boss_id = area.get("boss")
        nodes.append({
            "id": aid,
            "name": area["name"],
            "x": pos[aid][0],
            "y": pos[aid][1],
            "current": aid == current_id,
            "reachable": aid in reachable,
            "danger": _danger(area),
            "shop": world.has_shop(area),
            "rest": _can_rest(area),
            "boss": bool(boss_id) and boss_id in bosses and boss_id not in defeated_bosses,
            "boss_defeated": bool(boss_id) and boss_id in defeated_bosses,
        })

    edges, drawn = [], set()
    for aid, conns in links.items():
        for conn in conns:
            if (conn, aid) in drawn:
                continue
            drawn.add((aid, conn))
            edges.append({
                "a": aid, "b": conn,
                "x1": pos[aid][0], "y1": pos[aid][1], "x2": pos[conn][0], "y2": pos[conn][1],
                "active": current_id in (aid, conn),
            })
    return {"rows": len(rows), "nodes": nodes, "edges": edges}


@router.get("/", response_class=HTMLResponse)
async def game_view(request: Request, session=Depends(require_character)):
    """Main game view - show current location."""

    # A battle, a defeat or an event comes first
    waiting = world.pending(session)
    if waiting:
        return RedirectResponse(waiting["url"], status_code=303)

    char_data = session.serialize_character()
    location = session.current_location
    area = session.current_area

    message = session.pop_flash("game_message")
    if message:
        save_session(request, session)

    return templates.TemplateResponse(request, "game/location.html", {
        "request": request,
        "title": f"{location['name']} - {area['name']}" if area else location["name"],
        "character": char_data,
        "location": location,
        "area": area,
        "area_map": build_area_map(location, area, session.defeated_bosses),
        "danger": _danger(area) if area else "safe",
        "has_shop": world.has_shop(area),
        "can_rest": _can_rest(area),
        "act": session.act,
        "boss": _boss_panel(session),
        "message": message,
    })


@router.post("/move")
async def move_to_area(request: Request, area_id: str = Form(...), session=Depends(require_character)):
    """Move to a connected area."""

    if world.move_to_area(session, area_id):
        save_session(request, session)

    return RedirectResponse("/game", status_code=303)


@router.post("/explore")
async def explore_area(request: Request, session=Depends(require_character)):
    """Explore the current area - may trigger an encounter or an event."""

    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)
    area = session.current_area
    if not area or session.pending_event or session.character.current_hit_points <= 0:
        return RedirectResponse("/game", status_code=303)

    # The roll (world.roll_explore) is stored as what the area holds and met at once
    session.return_to_3d = False
    world.roll_contents(session)
    monster = world.take_monster(session)
    if monster:
        from web.routes.battle import begin_monster_battle, opened
        return await opened(request, session, begin_monster_battle(session, monster))
    event_id = world.take_event(session)
    if event_id:
        session.pending_event = event_id
        save_session(request, session)
        return RedirectResponse("/game/event", status_code=303)

    save_session(request, session)
    return RedirectResponse("/game?explored=true", status_code=303)


@router.get("/event", response_class=HTMLResponse)
async def event_view(request: Request, session=Depends(require_character)):
    """Show the pending exploration event, or the outcome of the one just resolved."""
    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)

    char_data = session.serialize_character()

    if session.event_result:
        return templates.TemplateResponse(request, "game/event.html", {
            "request": request,
            "title": session.event_result["title"],
            "character": char_data,
            "event": None,
            "result": session.event_result,
        })

    event = events.event_view(session)
    if not event:
        session.pending_event = None
        save_session(request, session)
        return RedirectResponse("/game", status_code=303)

    return templates.TemplateResponse(request, "game/event.html", {
        "request": request,
        "title": event["title"],
        "character": char_data,
        "event": event,
        "result": None,
    })


@router.post("/event/choose")
async def event_choose(request: Request, choice: int = Form(...), session=Depends(require_character)):
    """Resolve the player's choice for the pending event."""
    try:
        events.choose(session, choice)
    except fight.Rejected as rejection:
        if rejection.code == "no_event":
            session.pending_event = None
            save_session(request, session)
            return RedirectResponse("/game", status_code=303)
        return RedirectResponse("/game/event", status_code=303)

    save_session(request, session)
    return RedirectResponse("/game/event", status_code=303)


@router.post("/event/continue")
async def event_continue(request: Request, session=Depends(require_character)):
    """Dismiss the event outcome. Some outcomes lead straight into a fight."""
    result = events.dismiss(session)
    save_session(request, session)
    if result and result.get("battle"):
        return RedirectResponse("/battle/start", status_code=303)
    return RedirectResponse("/" if session.return_to_3d else "/game", status_code=303)


@router.post("/rest")
async def rest(request: Request, session=Depends(require_character)):
    """Rest to recover HP."""

    try:
        world.rest(session)
    except fight.Rejected:
        return RedirectResponse("/game", status_code=303)
    save_session(request, session)

    return RedirectResponse("/game?rested=true", status_code=303)


@router.get("/travel", response_class=HTMLResponse)
async def travel_menu(request: Request, session=Depends(require_character)):
    """Show available locations to travel to, grouped by unlocked act."""

    campaign = get_campaign()
    current_location = session.current_location
    unlocked = campaign_rules.highest_unlocked_act(campaign, session.defeated_bosses)
    bosses = get_bosses()

    acts = []
    for act in campaign["acts"]:
        locations = []
        for loc in act["locations"]:
            if loc["name"] == current_location["name"]:
                continue
            boss_ids = [a["boss"] for a in loc.get("areas", []) if a.get("boss")]
            locations.append({
                "name": loc["name"],
                "description": loc["description"],
                "type": loc.get("type", ""),
                "level_range": loc.get("encounterLevel"),
                "has_boss": any(b in bosses and b not in session.defeated_bosses for b in boss_ids),
                "cleared": bool(boss_ids) and all(b in session.defeated_bosses for b in boss_ids),
            })
        acts.append({
            "number": act["number"],
            "title": act["title"],
            "locked": act["number"] > unlocked,
            "locations": locations,
        })

    return templates.TemplateResponse(request, "game/travel.html", {
        "request": request,
        "title": "Travel",
        "character": session.serialize_character(),
        "current_location": current_location,
        "acts": acts,
    })


@router.post("/travel")
async def travel_to_location(request: Request, location_name: str = Form(...), session=Depends(require_character)):
    """Travel to a different location in any unlocked act."""
    if session.battle.is_active:
        return RedirectResponse("/battle", status_code=303)

    campaign = get_campaign()
    unlocked = campaign_rules.highest_unlocked_act(campaign, session.defeated_bosses)

    for act in campaign["acts"]:
        if act["number"] > unlocked:
            continue
        for location in act["locations"]:
            if location["name"] != location_name:
                continue
            session.act = act
            session.current_location = location
            # Arrive at the location's entry point
            areas = location.get("areas", [])
            start_id = location.get("starting_area")
            session.current_area = next(
                (a for a in areas if a["id"] == start_id), areas[0] if areas else None)
            world.roll_contents(session)

            # The road is not always safe: a pursuing boss may strike mid-journey
            ambush = campaign_rules.pending_ambush(get_bosses(), act, session.defeated_bosses)
            if ambush and session.character.current_hit_points > 0:
                from web.routes.battle import begin_boss_battle, end_battle
                # The ambush is fought on the classic pages, on the road rather than at a boss's place
                session.return_to_3d = False
                if not begin_boss_battle(session, ambush, place="monster"):
                    return await end_battle(request, session, player_won=False)
                save_session(request, session)
                return RedirectResponse("/battle", status_code=303)

            save_session(request, session)
            return RedirectResponse("/game", status_code=303)

    return RedirectResponse("/game", status_code=303)


@router.get("/journal", response_class=HTMLResponse)
async def journal(request: Request, session=Depends(require_character)):
    """The adventurer's journal: main quest, crown shards, bosses and deeds."""
    campaign = get_campaign()
    bosses = get_bosses()
    defeated = session.defeated_bosses
    unlocked = campaign_rules.highest_unlocked_act(campaign, defeated)
    won_shards = campaign_rules.collected_shards(bosses, defeated)

    acts = []
    for act in campaign["acts"]:
        act_bosses = []
        for location in act["locations"]:
            for area in location.get("areas", []):
                boss_id = area.get("boss")
                if boss_id in bosses:
                    known = act["number"] <= unlocked
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
            "locked": act["number"] > unlocked,
            "complete": campaign_rules.is_act_complete(act, defeated),
            "current": act["number"] == unlocked,
            "bosses": act_bosses,
        })

    all_quests = get_quests()
    return templates.TemplateResponse(request, "game/journal.html", {
        "request": request,
        "title": "Journal",
        "character": session.serialize_character(),
        "campaign": {"title": campaign["title"], "description": campaign["description"]},
        "acts": acts,
        "shards": [{"name": s, "found": s in won_shards} for s in campaign_rules.all_shards(bosses)],
        "campaign_complete": campaign_rules.is_campaign_complete(campaign, defeated),
        "stats": {
            "kills": session.monster_kills,
            "bosses": len(defeated),
            "events": session.events_resolved,
            "quests": len(session.completed_quests),
        },
        "active_quests": [
            {"name": all_quests[q]["name"], "progress": state["progress"],
             "target": all_quests[q]["target_count"], "ready": state["status"] == "ready"}
            for q, state in session.active_quests.items() if q in all_quests
        ],
    })


@router.get("/ending", response_class=HTMLResponse)
async def ending(request: Request, session=Depends(require_character)):
    """Epilogue, shown once the campaign's final boss has fallen."""
    campaign = get_campaign()
    if not campaign_rules.is_campaign_complete(campaign, session.defeated_bosses):
        return RedirectResponse("/game", status_code=303)

    return templates.TemplateResponse(request, "game/ending.html", {
        "request": request,
        "title": "The Crown Restored",
        "character": session.serialize_character(),
        "campaign": campaign,
        "stats": {
            "kills": session.monster_kills,
            "bosses": len(session.defeated_bosses),
            "events": session.events_resolved,
            "quests": len(session.completed_quests),
        },
    })


@router.get("/status")
async def game_status(request: Request):
    """Get current game status as JSON."""
    session = get_session(request)

    if not session.character:
        return {"error": "No character"}

    char_data = session.serialize_character()

    return {
        "character": char_data,
        "location": session.current_location.get("name") if session.current_location else None,
        "area": session.current_area.get("name") if session.current_area else None,
        "in_battle": session.battle.is_active
    }
