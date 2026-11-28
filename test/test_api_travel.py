"""Travel, the journal and the ending in the 3D world: /api/travel, /api/journal, /api/ending.
Both interfaces must do the same thing to the same session."""

import html
import itertools
import json
import random
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
from engine import campaign as rules
import web.game_session as game_session
from web.app import app

CAMPAIGN = game_session.get_campaign()
BOSSES = game_session.get_bosses()
QUESTS = game_session.get_quests()
ORDER = ["Shard Guardian", "Corrupted Captain", "Flame Cultist Leader", "Corrupted High Priest", "Lady Vex",
         "Ancient Wind Rider", "Primordial Earth Elemental", "Lady Vex (Final Battle)", "Malachar the Void-touched"]
PREFIXES = [ORDER[:n] for n in range(len(ORDER) + 1)]
LOCATIONS = [(act, loc) for act in CAMPAIGN["acts"] for loc in act["locations"]]
ACT2_BOSSES = ["Flame Cultist Leader", "Corrupted High Priest", "Ancient Wind Rider", "Primordial Earth Elemental"]
NO_CHARACTER = "You have no character yet. Start a new game first."
SEED = 4711


def reason(number):
    return f"Defeat the guardians of Act {number - 1} to open the way."


def start_of(loc):
    return next((a for a in loc["areas"] if a["id"] == loc.get("starting_area")), loc["areas"][0])


def expected_travel(defeated, current):
    unlocked = rules.highest_unlocked_act(CAMPAIGN, defeated)
    acts = []
    for act in CAMPAIGN["acts"]:
        locations = []
        for loc in act["locations"]:
            ids = [a["boss"] for a in loc["areas"] if a.get("boss")]
            locations.append({
                "name": loc["name"], "description": loc["description"], "type": loc.get("type", ""),
                "level_range": loc.get("encounterLevel"),
                "has_boss": any(b in BOSSES and b not in defeated for b in ids),
                "cleared": bool(ids) and all(b in defeated for b in ids),
                "current": loc["name"] == current,
            })
        locked = act["number"] > unlocked
        acts.append({"number": act["number"], "title": act["title"], "locked": locked,
                     "locked_reason": reason(act["number"]) if locked else None, "locations": locations})
    return {"current": current, "acts": acts}


def expected_journal(data):
    defeated = data["defeated_bosses"]
    unlocked = rules.highest_unlocked_act(CAMPAIGN, defeated)
    won = rules.collected_shards(BOSSES, defeated)
    acts = []
    for act in CAMPAIGN["acts"]:
        known = act["number"] <= unlocked
        placed = [(loc, area) for loc in act["locations"] for area in loc["areas"] if area.get("boss") in BOSSES]
        acts.append({
            "number": act["number"], "title": act["title"], "description": act["description"],
            "main_quest": act["mainQuest"], "locked": not known, "complete": rules.is_act_complete(act, defeated),
            "current": act["number"] == unlocked,
            "bosses": [{
                "name": BOSSES[area["boss"]]["name"] if known else "???",
                "title": BOSSES[area["boss"]].get("title", "") if known else "",
                "where": f"{loc['name']} — {area['name']}" if known else "Unknown",
                "level": BOSSES[area["boss"]]["level"], "defeated": area["boss"] in defeated,
            } for loc, area in placed],
        })
    return {
        "campaign": {"title": CAMPAIGN["title"], "description": CAMPAIGN["description"]},
        "acts": acts,
        "shards": [{"name": s, "found": s in won} for s in rules.all_shards(BOSSES)],
        "campaign_complete": rules.is_campaign_complete(CAMPAIGN, defeated),
        "stats": {"kills": data["monster_kills"], "bosses": len(defeated), "events": data["events_resolved"],
                  "quests": len(data["completed_quests"])},
        "active_quests": [{"name": QUESTS[q]["name"], "progress": s["progress"], "target": QUESTS[q]["target_count"],
                           "ready": s["status"] == "ready"} for q, s in data["active_quests"].items()],
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    with TestClient(app) as c:
        c.sessions_dir = tmp_path
        c.post("/character/race", data={"race": "Human"})
        c.post("/character/class", data={"class_name": "Fighter"})
        c.post("/character/create", data={
            "name": "Tester", "weapon": "Longsword", "armor": "Chain Mail",
            "skills": ["Athletics", "Perception"],
        })
        yield c


def session_file(client):
    files = list(client.sessions_dir.glob("*.json"))
    assert len(files) == 1
    return files[0]


def read(client):
    return json.loads(session_file(client).read_text())


def situation(client, location, defeated, area_id=None, hp=9999, **more):
    """Writes the session: the character in a location, these bosses defeated, nothing pending. Returns the bytes."""
    act, loc = next((a, l) for a, l in LOCATIONS if l["name"] == location)
    data = read(client)
    data.update(location_name=location, area_id=area_id or start_of(loc)["id"], act_num=act["number"],
                defeated_bosses=list(defeated), area_contents=None, pending_event=None, event_result=None)
    data["battle"]["is_active"] = False
    data["character"]["max_hit_points"] = max(hp, data["character"]["max_hit_points"])
    data["character"]["current_hit_points"] = hp
    data.update(more)
    session_file(client).write_text(json.dumps(data))
    return session_file(client).read_bytes()


def comparable(client):
    data = read(client)
    data.pop("return_to_3d", None)
    data.pop("battle_place", None)
    if (data.get("area_contents") or {}).get("monster"):
        data["area_contents"]["monster"].pop("id", None)
    return data


def text_of(page):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def post_travel(client, name):
    return client.post("/api/travel", json={"location": name})


def refused(response, status, code, message=None):
    assert response.status_code == status, response.text
    assert response.json()["error"] == code
    if message is not None:
        assert response.json() == {"error": code, "message": message}


class TestTravelList:
    def test_every_act_and_location_for_every_stage_of_the_campaign(self, client):
        for defeated in PREFIXES:
            for _, loc in LOCATIONS:
                before = situation(client, loc["name"], defeated)
                answer = client.get("/api/travel")
                assert answer.status_code == 200
                assert answer.json()["travel"] == expected_travel(defeated, loc["name"])
                assert answer.json()["state"] == client.get("/api/state").json()
                assert session_file(client).read_bytes() == before

    def test_the_classic_page_offers_the_same(self, client):
        for defeated in PREFIXES:
            for _, here in LOCATIONS:
                situation(client, here["name"], defeated)
                view = client.get("/api/travel").json()["travel"]
                page = client.get("/game/travel").text
                offered = [html.unescape(v) for v in re.findall(r'name="location_name" value="([^"]*)"', page)]
                open_ones = [l for act in view["acts"] if not act["locked"] for l in act["locations"] if not l["current"]]
                assert offered == [l["name"] for l in open_ones]
                assert page.count("travel-act-locked") == sum(act["locked"] for act in view["acts"])
                cards = page.split('class="loc-card"')[1:]
                assert len(cards) == len(open_ones)
                for card, loc in zip(cards, open_ones):
                    assert ("Guardian defeated" in card) is loc["cleared"]
                    assert (">Boss<" in card) is (loc["has_boss"] and not loc["cleared"])
                    assert f"Recommended Level: {loc['level_range']}" in card


class TestJourney:
    def test_equals_classic_travel(self, client):
        for defeated in PREFIXES:
            unlocked = rules.highest_unlocked_act(CAMPAIGN, defeated)
            for _, here in LOCATIONS:
                for act, there in LOCATIONS:
                    if there["name"] == here["name"] or act["number"] > unlocked:
                        continue
                    start = situation(client, here["name"], defeated)
                    random.seed(SEED)
                    classic = client.post("/game/travel", data={"location_name": there["name"]}, follow_redirects=False)
                    assert classic.status_code == 303
                    classic_file = comparable(client)

                    session_file(client).write_bytes(start)
                    random.seed(SEED)
                    answer = post_travel(client, there["name"])
                    assert answer.status_code == 200, answer.text
                    body = answer.json()
                    assert comparable(client) == classic_file
                    assert (body["ambush"] is not None) is (classic.headers["location"] in ("/battle", "/battle/defeat"))
                    state = body["state"]
                    assert state["location"]["name"] == there["name"]
                    assert state["location"]["act"]["number"] == act["number"]
                    assert state["area"]["id"] == start_of(there)["id"]
                    assert state["area"]["is_start"] is True
                    assert state["contents"]["seq"] == 1
                    assert body["travel"]["current"] == there["name"]
                    assert state == client.get("/api/state").json()

    def test_the_contents_count_on(self, client):
        situation(client, "Rivermeet Town", [], area_contents={
            "location": "Rivermeet Town", "area_id": "town_square", "seq": 6, "monster": None, "event": None, "spent": None})
        assert post_travel(client, "Whispering Woods").json()["state"]["contents"]["seq"] == 7

    def test_a_locked_act_is_refused_in_both(self, client):
        for defeated in PREFIXES:
            unlocked = rules.highest_unlocked_act(CAMPAIGN, defeated)
            for act, there in LOCATIONS:
                if act["number"] <= unlocked:
                    continue
                before = situation(client, "Rivermeet Town", defeated)
                refused(post_travel(client, there["name"]), 409, "act_locked", reason(act["number"]))
                assert session_file(client).read_bytes() == before
                classic = client.post("/game/travel", data={"location_name": there["name"]}, follow_redirects=False)
                assert (classic.status_code, classic.headers["location"]) == (303, "/game")
                assert session_file(client).read_bytes() == before


class TestRefusals:
    def test_without_a_character(self, tmp_path, monkeypatch):
        monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
        with TestClient(app) as c:
            for answer in (c.get("/api/travel"), post_travel(c, "Whispering Woods"), c.get("/api/journal"), c.get("/api/ending")):
                refused(answer, 409, "no_character", NO_CHARACTER)

    def test_in_their_order_and_nothing_written(self, client):
        bad = "That is not a place you can travel to."
        before = situation(client, "Rivermeet Town", [])
        for body in (b"[]", b'"Whispering Woods"', b"{", b"{}", b'{"location": 3}', b'{"location": null}',
                     b'{"location": ["Whispering Woods"]}', b'{"location": "a", "location": "b"}'):
            answer = client.post("/api/travel", content=body, headers={"Content-Type": "application/json"})
            refused(answer, 400, "bad_request", bad)
        refused(client.post("/api/travel"), 400, "bad_request", bad)
        refused(post_travel(client, "Atlantis"), 404, "no_such_location", "There is no such place.")
        refused(post_travel(client, "Rivermeet Town"), 409, "already_here", "You are already there.")
        assert session_file(client).read_bytes() == before

        # A locked act before "already here": the character stands in an act that is not open.
        before = situation(client, "The Convergence", [])
        refused(post_travel(client, "The Convergence"), 409, "act_locked", reason(3))
        assert session_file(client).read_bytes() == before

    def test_pending_comes_before_the_destination(self, client):
        from web.api.world import PENDING_MESSAGES

        data = read(client)
        data["battle"]["is_active"] = True
        fight = dict(battle=data["battle"])
        event = next(iter(game_session.get_events()))
        for kind, more in (("battle", fight), ("defeat", {"hp": 0}), ("event", {"pending_event": event})):
            hp = more.pop("hp", 9999)
            before = situation(client, "Rivermeet Town", [], hp=hp, **more)
            if kind == "battle":
                data = read(client)
                data["battle"]["is_active"] = True
                session_file(client).write_text(json.dumps(data))
                before = session_file(client).read_bytes()
            for name in ("Whispering Woods", "Emberforge Mountains", "Atlantis", "Rivermeet Town"):
                refused(post_travel(client, name), 409, "pending", PENDING_MESSAGES[kind])
            refused(client.post("/api/travel", content=b"[]"), 400, "bad_request")
            for path in ("/api/travel", "/api/journal"):
                assert client.get(path).status_code == 200
            assert session_file(client).read_bytes() == before


class TestAmbush:
    def test_fires_exactly_when_classic_fires(self, client):
        act1 = ["Shard Guardian", "Corrupted Captain"]
        vex = BOSSES["Lady Vex"]
        seen = set()
        fired = 0
        for order in itertools.permutations(ACT2_BOSSES):
            for count in range(5):
                for with_vex in (False, True):
                    defeated = act1 + list(order[:count]) + (["Lady Vex"] if with_vex else [])
                    unlocked = rules.highest_unlocked_act(CAMPAIGN, defeated)
                    for here in ("Rivermeet Town", "Windswept Plains"):
                        for act, there in LOCATIONS:
                            key = (frozenset(defeated), here, there["name"])
                            if there["name"] == here or act["number"] > unlocked or key in seen:
                                continue
                            seen.add(key)
                            start = situation(client, here, defeated)
                            random.seed(SEED)
                            classic = client.post("/game/travel", data={"location_name": there["name"]}, follow_redirects=False)
                            classic_data = read(client)
                            classic_file = comparable(client)
                            classic_fired = (classic.headers["location"] in ("/battle", "/battle/defeat")
                                             and classic_data["battle"]["monster"]["boss_id"] == "Lady Vex")
                            session_file(client).write_bytes(start)
                            random.seed(SEED)
                            body = post_travel(client, there["name"]).json()
                            wanted = act["number"] == 2 and count >= 2 and not with_vex
                            assert (body["ambush"] is not None) is wanted is classic_fired, key
                            assert comparable(client) == classic_file
                            if not wanted:
                                assert body["battle"] is None and body["ambush"] is None
                                continue
                            fired += 1
                            assert body["ambush"] == {"id": "Lady Vex", "name": vex["name"], "title": vex["title"], "intro": vex["intro"]}
                            assert body["battle"]["phase"] == "fight"
                            assert body["battle"]["monster"]["boss_id"] == "Lady Vex"
                            assert body["battle"]["monster"]["place"] == "road"
                            assert body["state"]["pending"]["kind"] == "battle"
                            assert body["state"]["location"]["name"] == there["name"]
                            assert read(client)["return_to_3d"] is True
                            # Classic: fought on the classic pages, on the monster's place.
                            assert classic_data["return_to_3d"] is False and classic_data["battle_place"] == "monster"
        assert fired > 50

    def test_victory_ends_the_journey_and_she_does_not_come_back(self, client, monkeypatch):
        defeated = ["Shard Guardian", "Corrupted Captain", "Flame Cultist Leader", "Corrupted High Priest"]
        situation(client, "Rivermeet Town", defeated)
        assert post_travel(client, "Windswept Plains").json()["ambush"]["id"] == "Lady Vex"
        refused(post_travel(client, "The Crystalline Caves"), 409, "pending")
        data = read(client)
        data["battle"]["monster"]["hp"] = 1
        data["battle"]["is_player_turn"] = True
        session_file(client).write_text(json.dumps(data))
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 20))
        assert client.post("/api/battle/attack").json()["battle"]["phase"] == "victory"
        state = client.post("/api/battle/continue").json()["state"]
        assert state["pending"] is None
        assert (state["location"]["name"], state["area"]["id"]) == ("Windswept Plains", "plains_edge")
        assert "Lady Vex" in read(client)["defeated_bosses"]
        body = post_travel(client, "The Crystalline Caves").json()
        assert body["ambush"] is None and body["battle"] is None

    def test_defeat_and_rise_again_and_she_waits(self, client, monkeypatch):
        defeated = ["Shard Guardian", "Corrupted Captain", "Flame Cultist Leader", "Corrupted High Priest"]
        situation(client, "Rivermeet Town", defeated, hp=1)
        # Initiative lost and her blow lands: the opening blow ends it during the journey.
        rolls = iter([1, 20, 20])
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: next(rolls, 20)))
        answer = post_travel(client, "Sunken Temple of Dariel")
        assert answer.status_code == 200
        body = answer.json()
        assert body["battle"]["phase"] == "defeat"
        assert body["battle"]["monster"]["place"] == "road"
        assert body["ambush"]["id"] == "Lady Vex"
        assert body["state"]["pending"]["kind"] == "defeat"
        state = client.post("/api/battle/revive").json()["state"]
        assert state["pending"] is None
        assert (state["location"]["name"], state["area"]["id"]) == ("Sunken Temple of Dariel", "coastal_approach")
        assert "Lady Vex" not in read(client)["defeated_bosses"]
        assert post_travel(client, "Windswept Plains").json()["ambush"]["id"] == "Lady Vex"


class TestJournal:
    def test_every_stage_and_the_classic_page(self, client):
        first, second, third = list(QUESTS)[:3]
        stages = [(defeated, {}) for defeated in PREFIXES]
        stages.append((ORDER[:3], {
            "monster_kills": 37, "events_resolved": 12, "completed_quests": [third],
            "active_quests": {first: {"progress": 1, "status": "active"},
                              second: {"progress": QUESTS[second]["target_count"], "status": "ready"}},
        }))
        for defeated, more in stages:
            before = situation(client, "Rivermeet Town", defeated, **more)
            answer = client.get("/api/journal")
            assert answer.status_code == 200
            journal = answer.json()["journal"]
            assert journal == expected_journal(read(client))
            assert answer.json()["state"] == client.get("/api/state").json()
            assert session_file(client).read_bytes() == before
            assert [s["name"] for s in journal["shards"] if s["found"]] == [
                s for s in rules.all_shards(BOSSES) if s in rules.collected_shards(BOSSES, defeated)]

            page = client.get("/game/journal").text
            shown = text_of(page)
            assert journal["campaign"]["title"] in shown
            for act in journal["acts"]:
                if act["locked"]:
                    continue
                for value in (act["title"], act["description"], act["main_quest"]):
                    assert value in shown
                for boss in act["bosses"]:
                    assert boss["name"] in shown and boss["where"] in shown and f"Lvl {boss['level']}" in shown
            for shard in journal["shards"]:
                if shard["found"]:
                    assert shard["name"] in shown
            boxes = re.findall(r'<span class="label">([^<]*)</span><span class="value">(\d+)</span>', page)
            assert boxes == [("Monsters Slain", str(journal["stats"]["kills"])), ("Bosses Felled", str(journal["stats"]["bosses"])),
                             ("Events", str(journal["stats"]["events"])), ("Quests Done", str(journal["stats"]["quests"]))]
            for quest in journal["active_quests"]:
                assert quest["name"] in shown
                assert ("Ready to turn in" if quest["ready"] else f"{quest['progress']} / {quest['target']}") in shown
            assert len(journal["active_quests"]) == len(more.get("active_quests", {}))

    def test_the_shards_along_the_campaign(self, client):
        counts = []
        for defeated in PREFIXES:
            situation(client, "Rivermeet Town", defeated)
            counts.append(sum(s["found"] for s in client.get("/api/journal").json()["journal"]["shards"]))
        assert counts == [0, 1, 1, 2, 3, 3, 4, 5, 5, 5]
        situation(client, "Rivermeet Town", ORDER[:4])
        journal = client.get("/api/journal").json()["journal"]
        assert [s["name"] for s in journal["shards"]] == [
            "Shard of Verdance", "Shard of Embers", "Shard of Tides", "Shard of Gales", "Shard of Stone"]
        assert sum(s["found"] for s in journal["shards"]) == 3


class TestEnding:
    PARAGRAPHS = [
        "The wound in the sky above the Convergence closes, and for the first time in a generation the five provinces "
        "of Eldoria wake to the same quiet dawn.",
        "The Crown of Unity is whole again — not because a king willed it, but because Tester, a Human Fighter out "
        "of Rivermeet, carried its shards through forest, fire, flood, storm and stone, and would not put them down.",
        "In the Whispering Woods the trees speak gently again. The beacon on the old watchtower is lit. And in a "
        "tavern called the Flowing Tankard, they are already getting the story wrong.",
    ]

    def test_only_when_the_crown_is_whole(self, client):
        for defeated in PREFIXES + [[b for b in ORDER if b != "Lady Vex"]]:
            before = situation(client, "The Convergence", defeated, monster_kills=5, events_resolved=2)
            whole = rules.is_campaign_complete(CAMPAIGN, defeated)
            assert whole is (len([b for b in defeated if b != "Lady Vex"]) == 8)
            answer = client.get("/api/ending")
            classic = client.get("/game/ending", follow_redirects=False)
            if not whole:
                refused(answer, 409, "not_complete", "The crown is not yet whole.")
                assert (classic.status_code, classic.headers["location"]) == (303, "/game")
                assert session_file(client).read_bytes() == before
                continue
            assert answer.status_code == 200 and classic.status_code == 200
            character = read(client)["character"]
            state = client.get("/api/state").json()
            assert answer.json()["ending"] == {
                "title": "The Crown Restored",
                "campaign_title": CAMPAIGN["title"],
                "paragraphs": self.PARAGRAPHS,
                "character": {"name": "Tester", "race": "Human", "class_name": "Fighter",
                              "level": state["character"]["level"], "gold": character["gold"]},
                "stats": {"kills": 5, "bosses": len(defeated), "events": 2, "quests": 0},
                "shards": ["Shard of Verdance", "Shard of Embers", "Shard of Tides", "Shard of Gales", "Shard of Stone"],
            }
            assert answer.json()["state"] == state
            shown = text_of(classic.text)
            for paragraph in self.PARAGRAPHS:
                assert paragraph in shown
            assert session_file(client).read_bytes() == before
            assert state["has_character"] is True and state["character"]["name"] == "Tester"

    def test_the_epilogue_is_one_text(self):
        from web import travel

        assert [p.format(name="Tester", race="Human", class_name="Fighter") for p in travel.EPILOGUE] == self.PARAGRAPHS


class TestState:
    def test_is_start_in_the_eight_starting_areas(self, client):
        starts = []
        for _, loc in LOCATIONS:
            for area in loc["areas"]:
                situation(client, loc["name"], ORDER, area_id=area["id"])
                state = client.get("/api/state").json()
                assert state["area"]["id"] == area["id"]
                assert state["area"]["is_start"] is (area["id"] == loc["starting_area"])
                if state["area"]["is_start"]:
                    starts.append((loc["name"], area["id"]))
        assert len(starts) == 8
