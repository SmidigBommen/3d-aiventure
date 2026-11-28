"""The JSON API the 3D client walks with: GET /api/state and POST /api/move."""

import random
import sys
import json
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
import web.app as web_app
import web.game_session as game_session
from web.app import app
from web.game_session import GameSession
from web import creation, events, world

CAMPAIGN = game_session.get_campaign()
NO_CHARACTER = {"has_character": False, "character": None, "location": None, "area": None,
                "exits": [], "pending": None, "asi_points": 0, "quests": []}
ALL_AREAS = [
    (act["number"], loc["name"], area["id"])
    for act in CAMPAIGN["acts"] for loc in act["locations"] for area in loc["areas"]
]


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    with TestClient(app) as c:
        c.sessions_dir = tmp_path
        yield c


@pytest.fixture
def client(fresh):
    response = fresh.post("/api/new-game", json={
        "race": "Human", "class_name": "Fighter", "name": "Tester", "weapon": "Longsword",
        "armor": "Chain Mail", "portrait": creation.PORTRAITS[0]["path"],
        "skills": ["Athletics", "Perception"]})
    assert response.status_code == 200
    return fresh


def meet_the_boss(client):
    """The character in the grove of the Whispering Woods, in a fight with its boss."""
    patch(client, act_num=1, location_name="Whispering Woods", area_id="grove", area_contents={
        "location": "Whispering Woods", "area_id": "grove", "seq": 1, "monster": None, "event": None, "spent": None})
    return client.post("/api/engage", json={"id": "Shard Guardian"})


def _path(client) -> Path:
    files = list(client.sessions_dir.glob("*.json"))
    assert len(files) == 1
    return files[0]


def load(client) -> dict:
    return json.loads(_path(client).read_text(encoding="utf-8"))


def patch(client, **changes):
    data = load(client)
    for key, value in changes.items():
        if key.startswith("char_"):
            data["character"][key[5:]] = value
        else:
            data[key] = value
    _path(client).write_text(json.dumps(data), encoding="utf-8")


def win_initiative(monkeypatch):
    """The player rolls 20 for initiative and the boss 1, so the boss gets no opening blow.

    Without this the boss sometimes acts first and strikes a level 1 character down,
    which ends the battle before the test looks at it.
    """
    rolls = iter([20])
    monkeypatch.setattr(Dice, "roll_d20", lambda: next(rolls, 1))


def find(act_num, location_name, area_id):
    act = next(a for a in CAMPAIGN["acts"] if a["number"] == act_num)
    loc = next(l for l in act["locations"] if l["name"] == location_name)
    return act, loc, next(a for a in loc["areas"] if a["id"] == area_id)


def band(encounters):
    return "safe" if encounters <= 0 else "low" if encounters <= 2 else "med" if encounters <= 5 else "high"


class TestState:
    def test_without_a_character(self, fresh):
        response = fresh.get("/api/state")
        assert response.status_code == 200
        assert response.json() == NO_CHARACTER
        assert list(fresh.sessions_dir.glob("*.json")) == []

    def test_with_a_character(self, client):
        before = _path(client).read_bytes()
        stored = load(client)
        body = client.get("/api/state").json()
        assert _path(client).read_bytes() == before

        act, loc, area = find(stored["act_num"], stored["location_name"], stored["area_id"])
        assert body["has_character"] is True
        assert set(body["character"]) == set(world.CHARACTER_KEYS)
        assert len(world.CHARACTER_KEYS) == 11
        for key in world.CHARACTER_KEYS:
            assert body["character"][key] == stored["character"][key]
        assert body["location"] == {"name": loc["name"], "type": loc["type"],
                                    "act": {"number": act["number"], "title": act["title"]}}
        assert body["area"]["id"] == area["id"]
        assert body["area"]["name"] == area["name"]
        assert body["area"]["description"] == area["description"]
        names = {a["id"]: a["name"] for a in loc["areas"]}
        assert [(e["id"], e["name"]) for e in body["exits"]] == [(c, names[c]) for c in area["connections"]]
        assert body["pending"] is None

    @pytest.mark.parametrize("act_num,location_name,area_id", ALL_AREAS)
    def test_flags_and_bands_of_every_area(self, client, act_num, location_name, area_id):
        _, loc, area = find(act_num, location_name, area_id)
        patch(client, act_num=act_num, location_name=location_name, area_id=area_id)
        body = client.get("/api/state").json()
        special = str(area.get("special", "")).lower()
        assert body["area"]["danger"] == band(area["encounters"])
        assert body["area"]["has_shop"] is ("shop" in special)
        assert body["area"]["can_rest"] is any(word in special for word in ("rest", "inn", "tavern"))
        assert body["area"]["has_boss"] is bool(area.get("boss"))
        assert body["area"]["is_boss_area"] is bool(area.get("boss"))
        assert body["area"]["special"] == area.get("special")
        encounters = {a["id"]: a["encounters"] for a in loc["areas"]}
        assert [e["danger"] for e in body["exits"]] == [band(encounters[c]) for c in area["connections"]]

    def test_a_defeated_boss_is_gone(self, client):
        patch(client, act_num=1, location_name="Whispering Woods", area_id="grove")
        assert client.get("/api/state").json()["area"]["has_boss"] is True
        patch(client, defeated_bosses=["Shard Guardian"])
        assert client.get("/api/state").json()["area"]["has_boss"] is False

    @pytest.mark.parametrize("act_num,location_name,area_id", ALL_AREAS)
    def test_a_boss_area_stays_one_after_the_boss_is_defeated(self, client, act_num, location_name, area_id):
        _, _, area = find(act_num, location_name, area_id)
        patch(client, act_num=act_num, location_name=location_name, area_id=area_id,
              defeated_bosses=list(game_session.get_bosses()))
        body = client.get("/api/state").json()
        assert body["area"]["has_boss"] is False
        assert body["area"]["is_boss_area"] is bool(area.get("boss"))
        assert body["area"]["special"] == area.get("special")

    def test_the_area_keys(self, client):
        assert set(client.get("/api/state").json()["area"]) == {
            "id", "name", "description", "danger", "has_shop", "can_rest", "has_boss", "is_boss_area", "special", "is_start"}

    def test_a_boss_that_is_not_in_the_boss_data_makes_no_boss_area(self):
        assert world.is_boss_area({"boss": "Nobody"}) is False
        assert world.is_boss_area({"boss": "Shard Guardian"}) is True
        assert world.is_boss_area({}) is False
        assert world.is_boss_area(None) is False


class TestPending:
    def test_battle(self, client, monkeypatch):
        win_initiative(monkeypatch)
        answer = meet_the_boss(client)
        assert answer.status_code == 200 and set(answer.json()) == {"state", "battle", "event"}
        assert answer.json()["state"]["pending"] == {"kind": "battle"}
        assert load(client)["battle"]["is_active"] is True
        patch(client, pending_event="abandoned_chest", char_current_hit_points=0)
        body = client.get("/api/state").json()
        assert body["pending"] == {"kind": "battle"}
        assert body["character"] and body["location"] and body["area"] and body["exits"]

    def test_defeat_comes_before_an_event(self, client):
        patch(client, char_current_hit_points=0, pending_event="abandoned_chest")
        assert client.get("/api/state").json()["pending"] == {"kind": "defeat"}

    def test_an_event_id_that_names_no_event_is_not_pending(self, client):
        patch(client, pending_event="no_such_event")
        assert client.get("/api/state").json()["pending"] is None
        patch(client, pending_event="no_such_event", event_result={"title": "T", "text": "x"})
        assert client.get("/api/state").json()["pending"] == {"kind": "event"}

    @pytest.mark.parametrize("change", [
        {"pending_event": "abandoned_chest"},
        {"event_result": {"title": "T", "text": "x"}},
    ])
    def test_event(self, client, change):
        patch(client, **change)
        assert client.get("/api/state").json()["pending"] == {"kind": "event"}


class TestMove:
    def test_to_a_connected_area(self, client):
        before = load(client)
        _, loc, area = find(before["act_num"], before["location_name"], before["area_id"])
        target = area["connections"][0]
        response = client.post("/api/move", json={"area_id": target})
        assert response.status_code == 200
        assert response.json() == client.get("/api/state").json()
        assert response.json()["area"]["id"] == target
        moved = next(a for a in loc["areas"] if a["id"] == target)
        assert response.json()["area"]["special"] == moved.get("special")
        assert response.json()["area"]["is_boss_area"] is bool(moved.get("boss"))
        after = load(client)
        assert after["area_id"] == target
        moving = ("area_id", "area_contents")
        assert {k: v for k, v in after.items() if k not in moving} == {k: v for k, v in before.items() if k not in moving}
        assert after["area_contents"]["area_id"] == target and after["area_contents"]["seq"] == 1
        name = next(a["name"] for a in loc["areas"] if a["id"] == target)
        assert name == response.json()["area"]["name"]

    def test_the_route_moves_as_the_function_does(self, client):
        stored = load(client)
        _, _, area = find(stored["act_num"], stored["location_name"], stored["area_id"])
        target = area["connections"][-1]
        session = GameSession.from_dict(stored)
        random.seed(7)
        assert world.move_to_area(session, target) is True
        random.seed(7)
        response = client.post("/api/move", json={"area_id": target})
        assert response.status_code == 200 and response.json()["area"]["id"] == target

        def without_ids(data):
            data = json.loads(json.dumps(data))
            if data["area_contents"]["monster"]:
                data["area_contents"]["monster"].pop("id", None)
            return data
        assert without_ids(load(client)) == without_ids(session.to_dict())
        assert client.get("/api/state").json()["area"]["id"] == target

    def test_the_function_ignores_an_unconnected_area(self, client):
        before = _path(client).read_bytes()
        session = GameSession.from_dict(load(client))
        assert world.move_to_area(session, "bridge") is False
        assert session.to_dict() == GameSession.from_dict(json.loads(before)).to_dict()
        assert client.post("/api/move", json={"area_id": "bridge"}).json()["error"] == "not_connected"
        assert _path(client).read_bytes() == before

    def test_no_character(self, fresh):
        response = fresh.post("/api/move", json={"area_id": "tavern"})
        assert response.status_code == 409
        assert response.json()["error"] == "no_character"
        assert response.json()["message"]
        assert list(fresh.sessions_dir.glob("*.json")) == []

    @pytest.mark.parametrize("kwargs", [
        {"json": {}}, {"json": {"area_id": 3}}, {"json": {"area_id": None}}, {"json": ["tavern"]},
        {"json": "tavern"}, {"content": b"not json"}, {"content": b""},
    ])
    def test_bad_request(self, client, kwargs):
        before = _path(client).read_bytes()
        response = client.post("/api/move", **kwargs)
        assert response.status_code == 400
        assert response.json()["error"] == "bad_request"
        assert response.json()["message"]
        assert _path(client).read_bytes() == before

    def test_not_connected(self, client):
        patch(client, act_num=1, location_name="Rivermeet Town", area_id="town_square")
        before = _path(client).read_bytes()
        for area_id in ("inn_rooms", "no-such-area", "town_square", ""):
            response = client.post("/api/move", json={"area_id": area_id})
            assert response.status_code == 400, area_id
            assert response.json()["error"] == "not_connected"
            assert response.json()["message"]
        assert _path(client).read_bytes() == before

    @pytest.mark.parametrize("change", [
        {"pending_event": "abandoned_chest"},
        {"event_result": {"title": "T", "text": "x"}},
        {"char_current_hit_points": 0},
    ])
    def test_pending_refuses_even_a_connected_area(self, client, change):
        patch(client, act_num=1, location_name="Rivermeet Town", area_id="town_square", **change)
        before = _path(client).read_bytes()
        for area_id in ("tavern", "no-such-area"):
            response = client.post("/api/move", json={"area_id": area_id})
            assert response.status_code == 409
            assert response.json()["error"] == "pending"
            assert response.json()["message"]
        assert _path(client).read_bytes() == before

    def test_pending_battle(self, client, monkeypatch):
        win_initiative(monkeypatch)
        assert meet_the_boss(client).json()["battle"]["phase"] == "fight"
        before = _path(client).read_bytes()
        response = client.post("/api/move", json={"area_id": "clearing"})
        assert response.status_code == 409 and response.json()["error"] == "pending"
        assert _path(client).read_bytes() == before


class TestRetired:
    """The server-rendered interface is gone: its addresses lead to the game and do nothing."""

    REQUESTS = [("GET", "/game"), ("POST", "/battle/attack"), ("GET", "/classic"), ("GET", "/saves/load/abc"),
                ("POST", "/character/create"), ("POST", "/shop/buy"), ("GET", "/inventory"), ("POST", "/game/move")]

    @pytest.mark.parametrize("method,url", REQUESTS)
    def test_a_classic_address_leads_to_the_game_and_changes_nothing(self, client, monkeypatch, method, url):
        # In a fight, where POST /battle/attack used to play a turn
        rolls = iter([20])
        monkeypatch.setattr(Dice, "roll_d20", lambda: next(rolls, 1))
        assert meet_the_boss(client).status_code == 200
        before = _path(client).read_bytes()
        response = client.request(method, url, data={"area_id": "clearing", "item_index": 0},
                                  follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/"
        assert _path(client).read_bytes() == before
        assert len(list(client.sessions_dir.glob("*.json"))) == 1

    @pytest.mark.parametrize("method,url", REQUESTS)
    def test_a_classic_address_starts_no_session(self, fresh, method, url):
        response = fresh.request(method, url, follow_redirects=False)
        assert (response.status_code, response.headers["location"]) == (303, "/")
        assert list(fresh.sessions_dir.glob("*.json")) == []

    def test_an_address_that_only_begins_like_one_is_unknown(self, client):
        before = _path(client).read_bytes()
        assert client.get("/gameplay", follow_redirects=False).status_code == 404
        assert _path(client).read_bytes() == before

    def test_without_a_built_client_the_root_says_so(self, fresh):
        # web/app.py decides at import time which route answers /.
        if (web_app.CLIENT_DIST / "index.html").is_file():
            pytest.skip("client/dist is built: / serves the client")
        response = fresh.get("/", follow_redirects=False)
        assert response.status_code == 503
        assert response.json() == {"error": "no_client", "message": "The client is not built. Run pnpm build."}

    def test_names_that_moved(self):
        assert world.danger_band({"encounters": 3}) == "med"
        assert world.can_rest({"special": "Inn"}) is True
        assert world.has_shop({"special": "Shop"}) is True
        assert world.EVENT_CHANCE == 0.65
        assert callable(events.location_tier)
