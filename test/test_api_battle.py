"""A fight through the JSON API: the view, the actions of web/fight.py, rejections, flee, revive."""

import json
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
from engine.abilities import summarize_ability
import web.game_session as game_session
from web.app import app
from web import fight

WOODS = "Whispering Woods/entrance"
GOBLIN = {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Grak", "weapon": "Club"}
POTION = {"name": "Healing Potion", "description": "", "type": "potion", "healing_amount": 10}
VIEW_KEYS = {"phase", "round", "player_turn", "turn", "player", "monster", "abilities", "items",
             "can_flee", "flee", "log", "rewards", "defeat"}


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
        c.base = load(c)
        yield c


def _path(client) -> Path:
    return next(client.sessions_dir.glob("*.json"))


def raw(client) -> bytes:
    return _path(client).read_bytes()


def load(client) -> dict:
    return json.loads(raw(client))


def edit(client, change):
    data = load(client)
    change(data)
    _path(client).write_text(json.dumps(data), encoding="utf-8")


def place(client, where=WOODS, monster=GOBLIN, **character):
    """The character in `where` with `monster` planted and no fight going on."""
    location_name, area_id = where.split("/")
    data = json.loads(json.dumps(client.base))
    data.update(act_num=1, location_name=location_name, area_id=area_id, pending_event=None, event_result=None,
                area_contents={"location": location_name, "area_id": area_id, "seq": 1, "monster": monster, "event": None})
    data["battle"]["is_active"] = False
    data["character"].update(character)
    _path(client).write_text(json.dumps(data), encoding="utf-8")


def engage(client, content_id=GOBLIN["id"], seed=3):
    random.seed(seed)
    response = client.post("/api/engage", json={"id": content_id})
    assert response.status_code == 200, response.text
    return response.json()


def start(client, monkeypatch, **character):
    """A fight against the planted goblin in which the player won the initiative."""
    place(client, **character)
    rolls = iter([20, 1])
    monkeypatch.setattr(Dice, "roll_d20", lambda: next(rolls))
    answer = engage(client)
    monkeypatch.undo()
    monkeypatch.setattr(game_session, "SESSIONS_DIR", client.sessions_dir)
    assert answer["battle"]["phase"] == "fight"
    return answer


def refused(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["error"] == code and body["message"]


class TestEngage:
    def test_monster_answers_the_fight_and_stays_on_the_classic_url(self, client):
        place(client, max_hit_points=500, current_hit_points=500)
        answer = engage(client)
        assert answer["url"] == "/battle"
        assert answer["battle"]["phase"] == "fight"
        assert answer["battle"]["monster"]["name"] == "Grak" and answer["battle"]["monster"]["race"] == "Goblin"
        assert answer["state"]["pending"] == {"kind": "battle", "url": "/battle"}
        assert load(client)["engaged_monster"] == GOBLIN

    def test_event_has_no_battle(self, client):
        place(client, monster=None)
        edit(client, lambda d: d["area_contents"].update(event={"id": "abandoned_chest"}))
        answer = client.post("/api/engage", json={"id": "abandoned_chest"}).json()
        assert answer["battle"] is None and answer["url"] == "/game/event"

    def test_either_interface_continues_the_fight(self, client, monkeypatch):
        start(client, monkeypatch, max_hit_points=500, current_hit_points=500)
        before = client.get("/api/battle").json()["battle"]["turn"]["seq"]
        assert client.post("/battle/attack", follow_redirects=False).headers["location"] in ("/battle", "/battle/victory")
        assert client.get("/api/battle").json()["battle"]["turn"]["seq"] == before + 1


class TestView:
    def test_keys_and_contents(self, client, monkeypatch):
        start(client, monkeypatch, inventory=[POTION, {"name": "Dagger", "type": "weapon"}, POTION])
        bytes_before, rng_before = raw(client), random.getstate()
        response = client.get("/api/battle")
        assert raw(client) == bytes_before and random.getstate() == rng_before
        body = response.json()
        assert set(body) == {"battle", "state"}
        view = body["battle"]
        assert set(view) == VIEW_KEYS
        assert set(view["turn"]) == {"seq", "events"}
        assert set(view["player"]) == {"name", "level", "hp", "max_hp", "pp", "max_pp", "ac", "effects"}
        assert set(view["monster"]) == {"name", "race", "level", "hp", "max_hp", "ac", "is_boss", "boss_id",
                                        "title", "enraged", "effects"}
        assert view["monster"]["boss_id"] is None and view["monster"]["is_boss"] is False
        assert set(view["flee"]) == {"dc", "modifier"} and view["flee"]["dc"] == 10
        assert view["can_flee"] is True and view["rewards"] is None and view["defeat"] is None
        expected = game_session.get_class_abilities("Fighter", 1)
        assert [a["id"] for a in view["abilities"]] == [a["id"] for a in expected]
        for position, (shown, ability) in enumerate(zip(view["abilities"], expected), start=1):
            assert set(shown) == {"id", "name", "description", "cost", "summary", "usable", "hotkey"}
            assert shown["summary"] == summarize_ability(ability, 1) and shown["hotkey"] == str(position)
            assert shown["cost"] == ability["cost"] and shown["description"] == ability["description"]
        assert len(view["items"]) == 1 and set(view["items"][0]) == {"name", "description", "index", "count", "hotkey"}
        assert {**view["items"][0], "description": ""} == {
            "name": "Healing Potion", "description": "", "index": 0, "count": 2, "hotkey": "q"}
        assert all(set(line) == {"text", "cls"} for line in view["log"]) and view["log"]

    def test_no_power_points_makes_costly_abilities_unusable(self, client, monkeypatch):
        start(client, monkeypatch, level=5, power_points=0)
        abilities = client.get("/api/battle").json()["battle"]["abilities"]
        assert any(a["cost"] > 0 for a in abilities)
        assert all(a["usable"] == (a["cost"] == 0) for a in abilities)

    def test_effects_carry_duration_and_badge(self, client, monkeypatch):
        start(client, monkeypatch, max_hit_points=500, current_hit_points=500)
        edit(client, lambda d: d["battle"]["player_effects"].append(
            {"stat": "ac", "value": 2, "duration": 3, "source": "Test"}))
        player = client.get("/api/battle").json()["battle"]["player"]
        assert player["effects"] == [{"stat": "ac", "value": 2, "duration": 3, "source": "Test", "label": "AC +2", "kind": "buff"}]

    def test_boss_cannot_be_fled(self, client):
        place(client, "Whispering Woods/grove", monster=None, max_hit_points=9999, current_hit_points=9999)
        view = engage(client, "Shard Guardian")["battle"]
        assert view["can_flee"] is False and view["monster"]["is_boss"] is True
        assert view["monster"]["boss_id"] == "Shard Guardian" and view["monster"]["title"]
        assert load(client)["engaged_monster"] is None

    def test_phases(self, client, monkeypatch):
        assert client.get("/api/battle").json()["battle"]["phase"] == "none"
        start(client, monkeypatch, max_hit_points=9999, current_hit_points=9999)
        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        for _ in range(100):
            body = client.post("/api/battle/attack").json()
            if body["battle"]["phase"] != "fight":
                break
        view = body["battle"]
        assert view["phase"] == "victory" and view["rewards"] == load(client)["battle_rewards"]
        assert body["state"]["contents"]["monster"] is None and body["state"]["pending"] is None
        assert client.get("/api/battle").json()["battle"]["phase"] == "victory"
        refused(client.post("/api/engage", json={"id": GOBLIN["id"]}), 404, "not_here")
        after = client.post("/api/battle/continue").json()
        assert after["battle"]["phase"] == "none" and load(client)["battle_rewards"] is None
        refused(client.post("/api/battle/continue"), 409, "nothing_to_continue")

    def test_defeat(self, client, monkeypatch):
        start(client, monkeypatch, current_hit_points=1, gold=31)
        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        for _ in range(100):
            body = client.post("/api/battle/defend").json()
            if body["battle"]["phase"] != "fight":
                break
        assert body["battle"]["phase"] == "defeat"
        assert body["battle"]["defeat"] == {"monster_name": "Grak", "gold": 31, "gold_cost": 15}
        assert body["state"]["pending"]["kind"] == "defeat"
        assert load(client)["engaged_monster"] is None


class TestShared:
    def test_both_interfaces_call_the_same_action(self, client, monkeypatch):
        start(client, monkeypatch)
        calls = []
        monkeypatch.setattr(fight, "attack", lambda session: calls.append(1) or "fight")
        before = load(client)
        assert client.post("/battle/attack", follow_redirects=False).headers["location"] == "/battle"
        assert client.post("/api/battle/attack").json()["battle"]["phase"] == "fight"
        assert len(calls) == 2 and load(client) == before

    @pytest.mark.parametrize("prefix", ["/battle", "/api/battle"])
    def test_every_accepted_action_finishes_the_turn_once(self, client, monkeypatch, prefix):
        original = fight.finish_player_turn
        calls = []

        def spy(session):
            calls.append(1)
            return original(session)

        def post(action, **fields):
            if prefix == "/battle":
                return client.post(f"/battle/{action}", data=fields, follow_redirects=False)
            return client.post(f"/api/battle/{action}", json=fields or None)

        for action, fields in (("attack", {}), ("defend", {}), ("ability", {"ability_id": "power_strike"}),
                               ("item", {"item_index": 0}), ("flee", {})):
            start(client, monkeypatch, max_hit_points=9999, current_hit_points=9999, inventory=[POTION])
            edit(client, lambda d: d["battle"]["monster"].update(hp=9999, max_hp=9999))
            monkeypatch.setattr(fight, "finish_player_turn", spy)
            monkeypatch.setattr(Dice, "roll_d20", lambda: 1)
            seq = load(client)["battle"]["turn_seq"]
            calls.clear()
            post(action, **fields)
            assert len(calls) == 1, action
            assert load(client)["battle"]["turn_seq"] == seq + 1


class TestRejections:
    def check(self, client, path, body, status, code):
        before = raw(client)
        refused(client.post(path, json=body), status, code)
        assert raw(client) == before

    def test_api_rejections_write_nothing(self, client, monkeypatch):
        start(client, monkeypatch, level=1, power_points=0, inventory=[{"name": "Dagger", "type": "weapon"}])
        costly = next(a["id"] for a in game_session.get_class_abilities("Fighter", 1) if a["cost"] > 0)
        too_high = next(i for i, a in game_session.get_abilities().items()
                        if "Fighter" in a["classes"] and a["unlock_level"] > 1)
        self.check(client, "/api/battle/ability", {"ability_id": costly}, 409, "not_enough_pp")
        self.check(client, "/api/battle/ability", {"ability_id": "nope"}, 404, "no_such_ability")
        self.check(client, "/api/battle/ability", {"ability_id": "fire_bolt"}, 404, "no_such_ability")
        self.check(client, "/api/battle/ability", {"ability_id": too_high}, 404, "no_such_ability")
        for index in (5, -1, 0):
            self.check(client, "/api/battle/item", {"item_index": index}, 404, "no_such_item")
        self.check(client, "/api/battle/ability", {"ability_id": 3}, 400, "bad_request")
        self.check(client, "/api/battle/ability", None, 400, "bad_request")
        self.check(client, "/api/battle/item", {"item_index": True}, 400, "bad_request")
        self.check(client, "/api/battle/item", {"item_index": "0"}, 400, "bad_request")
        self.check(client, "/api/battle/item", [0], 400, "bad_request")
        self.check(client, "/api/battle/continue", None, 409, "nothing_to_continue")
        self.check(client, "/api/battle/revive", None, 409, "not_defeated")

    def test_strict_bodies(self, client, monkeypatch):
        start(client, monkeypatch, max_hit_points=500, current_hit_points=500)
        raw_bodies = [b"{", b"not json", b"[]", b"7", b'"power_strike"', b"null", b"\xff\xfe",
                      b'{"ability_id": 5, "ability_id": "power_strike"}', b'{"ability_id": "power_strike", "x": NaN}',
                      b"ability_id=power_strike", b"{'ability_id': 'power_strike'}"]
        for action in ("ability", "item", "attack", "defend", "flee", "continue", "revive"):
            for body in raw_bodies:
                before = raw(client)
                refused(client.post(f"/api/battle/{action}", content=body, headers={"content-type": "application/json"}),
                        400, "bad_request")
                assert raw(client) == before, (action, body)
        # An action that takes nothing accepts no body, blank space or an object.
        for kwargs in ({}, {"content": b"  "}, {"json": {}}, {"json": {"anything": 1}}):
            edit(client, lambda d: d["battle"]["monster"].update(hp=9999, max_hp=9999))
            assert client.post("/api/battle/defend", **kwargs).status_code == 200

    def test_no_fight(self, client):
        place(client)
        for action, body in (("attack", None), ("defend", None), ("flee", None),
                             ("ability", {"ability_id": "power_strike"}), ("item", {"item_index": 0}),
                             ("item", "broken")):
            self.check(client, f"/api/battle/{action}", body, 409, "no_battle")

    def test_no_character(self, tmp_path, monkeypatch):
        monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
        with TestClient(app) as bare:
            refused(bare.get("/api/battle"), 409, "no_character")
            for action in ("attack", "defend", "flee", "ability", "item", "continue", "revive"):
                refused(bare.post(f"/api/battle/{action}"), 409, "no_character")

    def test_flee_from_a_boss(self, client):
        place(client, "Whispering Woods/grove", monster=None, max_hit_points=9999, current_hit_points=9999)
        engage(client, "Shard Guardian")
        self.check(client, "/api/battle/flee", None, 409, "cannot_flee")
        before = load(client)
        assert client.post("/battle/flee", follow_redirects=False).headers["location"] == "/battle"
        after = load(client)
        assert after["_flash"]["battle_message"] == {"text": "There is no escape from this fight!", "type": "error"}
        assert after["battle"] == before["battle"]
        page = client.get("/battle")
        assert "There is no escape from this fight!" in page.text
        assert "battle_message" not in load(client)["_flash"]

    def test_classic_rejections_change_nothing(self, client, monkeypatch):
        start(client, monkeypatch, power_points=0, inventory=[{"name": "Dagger", "type": "weapon"}])
        before = load(client)
        for path, data in (("/battle/ability", {"ability_id": "nope"}), ("/battle/ability", {"ability_id": "second_wind"}),
                           ("/battle/item", {"item_index": "0"}), ("/battle/item", {"item_index": "-1"})):
            assert client.post(path, data=data, follow_redirects=False).headers["location"] == "/battle"
            assert load(client) == before


class TestFleeAndRevive:
    def test_fled_monster_stands_again(self, client, monkeypatch):
        start(client, monkeypatch)
        seq = load(client)["battle"]["turn_seq"]
        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        body = client.post("/api/battle/flee").json()
        assert body["battle"]["phase"] == "fled" and body["state"]["pending"] is None
        assert body["state"]["contents"]["monster"]["id"] == GOBLIN["id"]
        data = load(client)
        assert data["engaged_monster"] is None and data["area_contents"]["monster"] == GOBLIN
        assert data["battle"]["turn_seq"] == seq
        assert client.post("/api/engage", json={"id": GOBLIN["id"]}).status_code == 200

    def test_classic_flee_puts_it_back_too(self, client, monkeypatch):
        start(client, monkeypatch)
        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        assert client.post("/battle/flee", follow_redirects=False).headers["location"] == "/"
        assert load(client)["area_contents"]["monster"] == GOBLIN

    def test_revive(self, client, monkeypatch):
        start(client, monkeypatch, current_hit_points=1, gold=31)
        monkeypatch.setattr(Dice, "roll_d20", lambda: 20)
        for _ in range(100):
            if client.post("/api/battle/defend").json()["battle"]["phase"] == "defeat":
                break
        body = client.post("/api/battle/revive").json()
        character = body["state"]["character"]
        assert body["battle"]["phase"] == "none" and body["state"]["pending"] is None
        assert character["current_hit_points"] == character["max_hit_points"] and character["gold"] == 16
        assert body["state"]["area"]["id"] == "entrance" and body["state"]["contents"] is not None
