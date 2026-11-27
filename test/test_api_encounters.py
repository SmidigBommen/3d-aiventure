"""What an area holds in the 3D world: the roll, POST /api/enter, /api/search, /api/engage and the way back."""

import json
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
import web.game_session as game_session
from web.app import app
from web.routes import game as game_routes
from web import world

CAMPAIGN = game_session.get_campaign()
EVENTS = game_session.get_events()
ALL_AREAS = [
    (act["number"], loc, area)
    for act in CAMPAIGN["acts"] for loc in act["locations"] for area in loc["areas"]
]
RATED = [
    "Rivermeet Town/town_square", "Whispering Woods/entrance", "Whispering Woods/clearing",
    "Abandoned Watchtower/ground_floor", "Emberforge Mountains/mine_tunnels", "The Convergence/main_gate",
    "The Convergence/great_hall", "The Convergence/throne_room", "The Convergence/ritual_chamber",
]
GOBLIN = {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Grak", "weapon": "Club"}


def act_of(location_name):
    return next(number for number, loc, _ in ALL_AREAS if loc["name"] == location_name)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    with TestClient(app) as c:
        c.sessions_dir = tmp_path
        c.post("/character/race", data={"race": "Human"})
        c.post("/character/class", data={"class_name": "Fighter"})
        c.post("/character/create", data={
            "name": "Tester", "weapon": "Longsword", "armor": "Chain Mail",
            "skills": ["Athletics", "Perception"]})
        data = load(c)
        data["character"]["max_hit_points"] = data["character"]["current_hit_points"] = 9999
        c.base = data
        yield c


def _path(client) -> Path:
    return next(client.sessions_dir.glob("*.json"))


def load(client) -> dict:
    return json.loads(_path(client).read_text(encoding="utf-8"))


def place(client, where, contents=None, **changes):
    """Write the strong character back, standing in `where` ("Location/area"), with nothing going on."""
    location_name, area_id = where.split("/")
    data = json.loads(json.dumps(client.base))
    data.update(act_num=act_of(location_name), location_name=location_name, area_id=area_id,
                area_contents=contents, pending_event=None, event_result=None)
    data["battle"]["is_active"] = False
    for key, value in changes.items():
        if key.startswith("char_"):
            data["character"][key[5:]] = value
        else:
            data[key] = value
    _path(client).write_text(json.dumps(data), encoding="utf-8")


def planted(where, seq=4, monster=None, event=None):
    location_name, area_id = where.split("/")
    return {"location": location_name, "area_id": area_id, "seq": seq, "monster": monster,
            "event": {"id": event} if event else None}


def force(monkeypatch, kind):
    monkeypatch.setattr(random, "random", lambda: 0.0 if kind == "monster" else 0.999)
    if kind == "event":
        monkeypatch.setattr(game_routes, "EVENT_CHANCE", 1.1)


def refused(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["error"] == code and body["message"]


def win_fight(client, monkeypatch):
    monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
    for _ in range(200):
        if not load(client)["battle"]["is_active"]:
            return
        client.post("/battle/attack", follow_redirects=False)
    raise AssertionError("the fight did not end")


class TestRoll:
    @pytest.mark.parametrize("where", RATED)
    def test_entry_gives_what_classic_explore_gives(self, client, where):
        for seed in range(150):
            place(client, where)
            random.seed(seed)
            contents = client.post("/api/enter").json()["contents"]
            place(client, where)
            random.seed(seed)
            target = client.post("/game/explore", follow_redirects=False).headers["location"]
            stored = load(client)
            if contents["monster"]:
                assert target == "/battle"
                fought = stored["battle"]["monster"]
                assert (fought["race"], fought["level"], fought["name"]) == (
                    contents["monster"]["race"], contents["monster"]["level"], contents["monster"]["name"])
            elif contents["event"]:
                assert target == "/game/event" and stored["pending_event"] == contents["event"]["id"]
            else:
                assert target == "/game?explored=true"

    def test_roll_explore_changes_nothing(self, client):
        place(client, "Whispering Woods/clearing")
        session = game_session.GameSession.from_dict(load(client))
        before = json.dumps(session.to_dict(), sort_keys=True)
        rolled = world.roll_explore(session)
        assert set(rolled) == {"monster", "event"}
        assert json.dumps(session.to_dict(), sort_keys=True) == before

    def test_the_monster_met_is_the_monster_rolled(self, client):
        where = "The Crystalline Caves/maze_tunnels"
        for seed in range(40):
            place(client, where)
            random.seed(seed)
            monster = client.post("/api/enter").json()["contents"]["monster"]
            assert monster
            body = client.post("/api/engage", json={"id": monster["id"]}).json()
            assert body["url"] == "/battle"
            assert body["state"]["contents"]["monster"] is None
            assert body["state"]["pending"] == {"kind": "battle", "url": "/battle"}
            stored = load(client)
            assert stored["battle"]["is_active"] is True and stored["return_to_3d"] is True
            fought = stored["battle"]["monster"]
            assert (fought["race"], fought["level"], fought["name"]) == (
                monster["race"], monster["level"], monster["name"])

    def test_has_search_spot(self):
        assert world.has_search_spot({"encounters": 0}, "nowhere", []) is False
        assert world.has_search_spot({"encounters": 1, "monster_types": ["Goblin"]}, "nowhere", []) is True
        assert world.has_search_spot({"encounters": 0, "monster_types": ["Goblin"]}, "nowhere", []) is False
        assert world.has_search_spot({"encounters": 0}, "town", []) is True
        assert world.has_search_spot({"encounters": 0, "special": "hidden_treasure"}, "nowhere", []) is True
        assert world.has_search_spot(
            {"encounters": 0, "special": "hidden_treasure"}, "nowhere", ["cellar_cache"]) is False

    def test_every_area_has_a_search_spot(self, client):
        for _, loc, area in ALL_AREAS:
            place(client, f"{loc['name']}/{area['id']}")
            assert client.post("/api/enter").json()["contents"]["search_spot"] is True, area["id"]


class TestState:
    def test_shape(self, client):
        place(client, "Whispering Woods/entrance")
        before = _path(client).read_bytes()
        state = client.get("/api/state").json()
        assert "contents" in state and state["contents"] is None
        assert _path(client).read_bytes() == before

        contents = client.post("/api/enter").json()["contents"]
        assert set(contents) == {"seq", "monster", "event", "boss", "search_spot"}
        assert contents["seq"] == 1 and contents["boss"] is None
        assert not (contents["monster"] and contents["event"])
        saved = _path(client).read_bytes()
        assert client.post("/api/enter").json()["contents"] == contents
        assert client.get("/api/state").json()["contents"] == contents
        assert _path(client).read_bytes() == saved

    def test_planted_contents(self, client):
        where = "Whispering Woods/entrance"
        place(client, where, planted(where, monster=GOBLIN))
        contents = client.get("/api/state").json()["contents"]
        assert contents["seq"] == 4
        assert contents["monster"] == {"id": "planted-1", "race": "Goblin", "name": "Grak", "level": 1}

        place(client, where, planted(where, event="mossy_shrine"))
        assert client.get("/api/state").json()["contents"]["event"] == {
            "id": "mossy_shrine", "title": EVENTS["mossy_shrine"]["title"],
            "object": "shrine", "label": "the old shrine"}

    def test_stale_contents_are_not_shown_and_entering_rolls(self, client):
        place(client, "Whispering Woods/entrance", planted("Whispering Woods/clearing", monster=GOBLIN))
        assert client.get("/api/state").json()["contents"] is None
        assert client.post("/api/enter").json()["contents"]["seq"] == 5
        assert load(client)["area_contents"]["area_id"] == "entrance"

    def test_event_objects_cover_every_event(self):
        objects = game_session.get_event_objects()
        assert set(objects) == set(EVENTS)
        for entry in objects.values():
            assert set(entry) == {"object", "label"}


class TestEntering:
    def test_moves_travel_and_revive_roll_once(self, client):
        place(client, "Whispering Woods/entrance", planted("Whispering Woods/entrance", monster=GOBLIN))
        body = client.post("/api/move", json={"area_id": "clearing"}).json()
        assert body["contents"]["seq"] == 5
        assert load(client)["area_contents"]["area_id"] == "clearing"

        client.post("/game/move", data={"area_id": "entrance"})
        stored = load(client)["area_contents"]
        assert (stored["seq"], stored["area_id"]) == (6, "entrance")
        assert (stored["monster"] or {}).get("id") != "planted-1"

        client.post("/game/travel", data={"location_name": "Rivermeet Town"})
        stored = load(client)["area_contents"]
        assert (stored["seq"], stored["location"], stored["area_id"]) == (7, "Rivermeet Town", "town_square")

    def test_revive(self, client):
        where = "Whispering Woods/clearing"
        place(client, where, planted(where), char_current_hit_points=0, return_to_3d=True)
        response = client.post("/battle/revive", follow_redirects=False)
        assert response.headers["location"] == "/"
        stored = load(client)["area_contents"]
        assert (stored["seq"], stored["area_id"]) == (5, "entrance")

        place(client, where, planted(where), char_current_hit_points=0)
        assert client.post("/battle/revive", follow_redirects=False).headers["location"] == "/game?revived=true"


class TestSearch:
    def test_occupied(self, client):
        where = "Whispering Woods/entrance"
        for contents in (planted(where, monster=GOBLIN), planted(where, event="mossy_shrine")):
            place(client, where, contents)
            before = _path(client).read_bytes()
            refused(client.post("/api/search"), 409, "occupied")
            assert _path(client).read_bytes() == before

    @pytest.mark.parametrize("kind", ["monster", "event", "nothing"])
    def test_forced(self, client, monkeypatch, kind):
        where = "Whispering Woods/clearing"
        place(client, where, planted(where))
        force(monkeypatch, kind)
        contents = client.post("/api/search").json()["contents"]
        assert contents["seq"] == 5
        assert bool(contents["monster"]) is (kind == "monster")
        assert bool(contents["event"]) is (kind == "event")

    def test_unrolled_area_is_rolled(self, client):
        place(client, "Whispering Woods/clearing")
        assert client.post("/api/search").json()["contents"]["seq"] == 1

    def test_nothing_to_find(self, client, monkeypatch):
        where = "Rivermeet Town/town_square"
        place(client, where, planted(where))
        monkeypatch.setattr(world, "get_events", lambda: {})
        before = _path(client).read_bytes()
        refused(client.post("/api/search"), 409, "nothing_to_find")
        assert _path(client).read_bytes() == before

    def test_after_a_won_fight(self, client, monkeypatch):
        where = "Whispering Woods/entrance"
        place(client, where, planted(where, monster=GOBLIN))
        assert client.post("/api/engage", json={"id": "planted-1"}).status_code == 200
        refused(client.post("/api/search"), 409, "pending")
        win_fight(client, monkeypatch)
        assert client.post("/api/search").json()["contents"]["seq"] == 5


class TestOneTimeEvents:
    def test_bridge_runes(self, client, monkeypatch):
        force(monkeypatch, "event")
        place(client, "Rivermeet Town/bridge")
        assert client.post("/api/enter").json()["contents"]["event"]["id"] == "bridge_runes"
        client.post("/api/move", json={"area_id": "docks"})
        body = client.post("/api/move", json={"area_id": "bridge"}).json()
        assert body["contents"]["event"]["id"] == "bridge_runes"
        assert "bridge_runes" not in load(client)["completed_events"]

        body = client.post("/api/engage", json={"id": "bridge_runes"}).json()
        assert body["url"] == "/game/event" and body["state"]["pending"]["url"] == "/game/event"
        assert body["state"]["contents"]["event"] is None
        assert load(client)["pending_event"] == "bridge_runes"
        assert EVENTS["bridge_runes"]["title"] in client.get("/game/event").text
        client.post("/game/event/choose", data={"choice": 0})
        response = client.post("/game/event/continue", follow_redirects=False)
        if load(client)["battle"]["is_active"] or response.headers["location"] != "/":
            pytest.skip("the outcome started a fight")
        assert "bridge_runes" in load(client)["completed_events"]
        for _ in range(25):
            event = client.post("/api/search").json()["contents"]["event"]
            assert event and event["id"] != "bridge_runes"
            client.post("/api/move", json={"area_id": "docks"})
            event = client.post("/api/move", json={"area_id": "bridge"}).json()["contents"]["event"]
            assert event and event["id"] != "bridge_runes"
            # Met and set aside, so that the next search is allowed
            assert client.post("/api/engage", json={"id": event["id"]}).status_code == 200
            data = load(client)
            data["pending_event"] = None
            _path(client).write_text(json.dumps(data), encoding="utf-8")


class TestBoss:
    def test_shown_whatever_the_roll(self, client, monkeypatch):
        where = "Whispering Woods/grove"
        guardian = {"id": "Shard Guardian", "name": "The Shard Guardian", "level": 5,
                    "locked": False, "locked_text": None}
        for kind in ("monster", "event", "nothing"):
            with monkeypatch.context() as m:
                force(m, kind)
                place(client, where)
                assert client.post("/api/enter").json()["contents"]["boss"] == guardian
        place(client, where, planted(where), defeated_bosses=["Shard Guardian"])
        assert client.get("/api/state").json()["contents"]["boss"] is None
        refused(client.post("/api/engage", json={"id": "Shard Guardian"}), 404, "not_here")

    def test_engage(self, client, monkeypatch):
        where = "Whispering Woods/grove"
        place(client, where, planted(where, monster=GOBLIN))
        rolls = iter([20])
        monkeypatch.setattr(Dice, "roll_d20", lambda: next(rolls, 1))
        body = client.post("/api/engage", json={"id": "Shard Guardian"}).json()
        assert body["url"] == "/battle"
        stored = load(client)
        assert stored["battle"]["monster"]["boss_id"] == "Shard Guardian"
        assert stored["area_contents"]["monster"]["id"] == "planted-1"

    def test_not_shown_before_the_area_is_rolled(self, client):
        place(client, "Whispering Woods/grove")
        refused(client.post("/api/engage", json={"id": "Shard Guardian"}), 404, "not_here")

    def test_locked(self, client):
        where = "The Convergence/ritual_chamber"
        place(client, where, planted(where))
        boss = client.get("/api/state").json()["contents"]["boss"]
        assert boss["locked"] is True and boss["locked_text"]
        before = _path(client).read_bytes()
        response = client.post("/api/engage", json={"id": boss["id"]})
        refused(response, 409, "locked")
        assert response.json()["message"] == boss["locked_text"]
        assert _path(client).read_bytes() == before


class TestRefusals:
    def test_no_character(self, tmp_path, monkeypatch):
        monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
        with TestClient(app) as fresh:
            refused(fresh.post("/api/enter"), 409, "no_character")
            refused(fresh.post("/api/search"), 409, "no_character")
            refused(fresh.post("/api/engage", json={"id": "x"}), 409, "no_character")
            assert list(tmp_path.glob("*.json")) == []

    @pytest.mark.parametrize("body", [
        {"json": {}}, {"json": {"id": 3}}, {"json": ["x"]}, {"content": "not json"}, {"content": ""}])
    def test_bad_request(self, client, body):
        where = "Whispering Woods/entrance"
        place(client, where, planted(where, monster=GOBLIN))
        before = _path(client).read_bytes()
        refused(client.post("/api/engage", **body), 400, "bad_request")
        assert _path(client).read_bytes() == before

    def test_not_here(self, client, monkeypatch):
        where = "Whispering Woods/entrance"
        place(client, where, planted(where, monster=GOBLIN))
        before = _path(client).read_bytes()
        refused(client.post("/api/engage", json={"id": "nobody"}), 404, "not_here")
        assert _path(client).read_bytes() == before
        client.post("/api/engage", json={"id": "planted-1"})
        win_fight(client, monkeypatch)
        refused(client.post("/api/engage", json={"id": "planted-1"}), 404, "not_here")

    @pytest.mark.parametrize("change", [
        {"pending_event": "abandoned_chest"}, {"event_result": {"title": "T", "text": "x"}},
        {"char_current_hit_points": 0}, {"battle_active": True}])
    def test_pending(self, client, change):
        where = "Whispering Woods/entrance"
        place(client, where, planted(where, monster=GOBLIN), **{k: v for k, v in change.items() if k != "battle_active"})
        if change.get("battle_active"):
            data = load(client)
            data["battle"]["is_active"] = True
            _path(client).write_text(json.dumps(data), encoding="utf-8")
        before = _path(client).read_bytes()
        refused(client.post("/api/engage", json={"id": "planted-1"}), 409, "pending")
        refused(client.post("/api/search"), 409, "pending")
        assert client.post("/api/enter").status_code == 200
        assert _path(client).read_bytes() == before


class TestClassicExplore:
    @pytest.mark.parametrize("before", [None, "monster", "event"])
    def test_monster(self, client, monkeypatch, before):
        where = "Whispering Woods/clearing"
        place(client, where, planted(where, monster=GOBLIN if before == "monster" else None,
                                     event="mossy_shrine" if before == "event" else None))
        force(monkeypatch, "monster")
        response = client.post("/game/explore", follow_redirects=False)
        assert (response.status_code, response.headers["location"]) == (303, "/battle")
        stored = load(client)
        area = next(a for _, loc, a in ALL_AREAS if loc["name"] == "Whispering Woods" and a["id"] == "clearing")
        assert stored["battle"]["monster"]["race"] in area["monster_types"]
        assert stored["battle"]["monster"]["name"] != "Grak"
        assert stored["area_contents"] == planted(where, seq=5)
        assert stored["pending_event"] is None

    def test_event_and_nothing(self, client, monkeypatch):
        where = "Whispering Woods/clearing"
        with monkeypatch.context() as m:
            force(m, "event")
            place(client, where)
            assert client.post("/game/explore", follow_redirects=False).headers["location"] == "/game/event"
            stored = load(client)
            assert stored["pending_event"] and stored["area_contents"] == planted(where, seq=1)
        force(monkeypatch, "nothing")
        place(client, where)
        assert client.post("/game/explore", follow_redirects=False).headers["location"] == "/game?explored=true"
        assert load(client)["area_contents"] == planted(where, seq=1)

    def test_rolls_nothing_during_a_battle(self, client):
        where = "Whispering Woods/clearing"
        place(client, where, planted(where, monster=GOBLIN))
        client.post("/api/engage", json={"id": "planted-1"})
        before = _path(client).read_bytes()
        assert client.post("/game/explore", follow_redirects=False).headers["location"] == "/battle"
        assert _path(client).read_bytes() == before


class TestWayBack:
    @pytest.mark.parametrize("from_3d", [True, False])
    def test_fight(self, client, monkeypatch, from_3d):
        where = "Whispering Woods/clearing"

        def start():
            place(client, where, planted(where, monster=GOBLIN))
            if from_3d:
                client.post("/api/engage", json={"id": "planted-1"})
            else:
                with monkeypatch.context() as m:
                    force(m, "monster")
                    client.post("/game/explore")
            assert load(client)["battle"]["is_active"] and load(client)["return_to_3d"] is from_3d

        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        start()
        response = client.post("/battle/flee", follow_redirects=False)
        assert response.headers["location"] == ("/" if from_3d else "/game")
        assert ("game_message" in load(client)["_flash"]) is (not from_3d)

        start()
        win_fight(client, monkeypatch)
        link = 'href="/" id="back-link"' if from_3d else 'href="/game" id="back-link"'
        assert link in client.get("/battle/victory").text

        start()
        data = load(client)
        data["battle"]["is_active"] = False
        data["character"]["current_hit_points"] = 0
        _path(client).write_text(json.dumps(data), encoding="utf-8")
        response = client.post("/battle/revive", follow_redirects=False)
        assert response.headers["location"] == ("/" if from_3d else "/game?revived=true")

    @pytest.mark.parametrize("from_3d", [True, False])
    def test_event(self, client, monkeypatch, from_3d):
        where = "Whispering Woods/clearing"
        place(client, where, planted(where, event="mossy_shrine"))
        if from_3d:
            client.post("/api/engage", json={"id": "mossy_shrine"})
        else:
            force(monkeypatch, "event")
            client.post("/game/explore")
        data = load(client)
        data["pending_event"] = None
        data["event_result"] = {"title": "T", "text": "x"}
        _path(client).write_text(json.dumps(data), encoding="utf-8")
        response = client.post("/game/event/continue", follow_redirects=False)
        assert response.headers["location"] == ("/" if from_3d else "/game")
