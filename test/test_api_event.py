"""Events and bosses in the 3D world: /api/event, the event in the engage answer, what an area
keeps of a resolved event, and the boss keys of the battle view. Both interfaces must play the same game."""

import json
import os
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
from engine.events import scaled_dc
from skills import calculate_skill_modifier
import web.game_session as game_session
from web.app import app
from web.routes.game import location_tier

CAMPAIGN = game_session.get_campaign()
EVENTS = game_session.get_events()
BOSSES = game_session.get_bosses()
AREAS = [(act["number"], loc, area)
         for act in CAMPAIGN["acts"] for loc in act["locations"] for area in loc["areas"]]
GENERAL = ["Rivermeet Town/town_square", "Whispering Woods/entrance", "Abandoned Watchtower/ground_floor"]
AREA_BOSSES = {area["boss"]: (number, loc, area) for number, loc, area in AREAS if area.get("boss")}
SEEDS = range(int(os.environ.get("AIV_PARITY_SEEDS", "3")))
GOBLIN = {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Grak", "weapon": "Club"}
RESULT_KEYS = ("label", "success", "check", "text", "gold", "xp", "heal", "pp", "damage", "item", "battle")


def location_of(name):
    return next(loc for _, loc, _ in AREAS if loc["name"] == name)


def act_of(name):
    return next(number for number, loc, _ in AREAS if loc["name"] == name)


def where_for(event_id):
    event = EVENTS[event_id]
    if event.get("special"):
        return next(f"{loc['name']}/{area['id']}" for _, loc, area in AREAS
                    if area.get("special") == event["special"])
    types = event.get("location_types")
    return next(w for w in GENERAL if not types or location_of(w.split("/")[0])["type"] in types)


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


def load(client) -> dict:
    return json.loads(_path(client).read_text(encoding="utf-8"))


def contents(where, monster=None, event=None):
    location_name, area_id = where.split("/")
    return {"location": location_name, "area_id": area_id, "seq": 1, "monster": monster,
            "event": {"id": event} if event else None}


def place(client, where, **changes):
    """Write the base session back, standing in `where` ("Location/area") with nothing going on."""
    location_name, area_id = where.split("/")
    data = json.loads(json.dumps(client.base))
    data.update(act_num=act_of(location_name), location_name=location_name, area_id=area_id,
                area_contents=contents(where), pending_event=None, event_result=None)
    data["battle"]["is_active"] = False
    for key, value in changes.items():
        if key.startswith("char_"):
            data["character"][key[5:]] = value
        else:
            data[key] = value
    _path(client).write_text(json.dumps(data), encoding="utf-8")


def refused(client, response, status, code, before):
    assert response.status_code == status, response.text
    assert response.json()["error"] == code and response.json()["message"]
    assert _path(client).read_bytes() == before


class TestEventParity:
    @pytest.mark.parametrize("event_id", sorted(EVENTS))
    def test_api_resolves_as_the_classic_route_does(self, client, event_id):
        where = where_for(event_id)
        for index in range(len(EVENTS[event_id]["choices"])):
            for seed in SEEDS:
                place(client, where, pending_event=event_id)
                random.seed(seed)
                client.post("/game/event/choose", data={"choice": index}, follow_redirects=False)
                classic = load(client)
                fights = classic["event_result"]["battle"]
                if fights:
                    answer = client.post("/game/event/continue", follow_redirects=False)
                    assert answer.headers["location"] == "/battle/start"
                    random.seed(seed + 1000)
                    client.get("/battle/start", follow_redirects=False)
                    classic_after = load(client)

                place(client, where, pending_event=event_id)
                random.seed(seed)
                answer = client.post("/api/event/choose", json={"choice": index})
                assert answer.status_code == 200, answer.text
                result = answer.json()["result"]
                api = load(client)
                for key in RESULT_KEYS:
                    assert result[key] == classic["event_result"][key], key
                assert result["leveled_up"] == classic["event_result"].get("leveled_up", False)
                assert result["new_level"] == classic["event_result"].get("new_level")
                for key in ("character", "completed_events", "events_resolved", "pending_event"):
                    assert api[key] == classic[key], key
                if fights:
                    random.seed(seed + 1000)
                    after = client.post("/api/event/continue").json()
                    api_after = load(client)
                    assert api_after["battle"] == classic_after["battle"]
                    assert api_after["character"] == classic_after["character"]
                    if api_after["battle"]["is_active"]:
                        assert after["battle"]["phase"] == "fight"
                        expected = "landmark" if EVENTS[event_id].get("special") else "event"
                        assert after["battle"]["monster"]["place"] == expected
                        assert classic_after.get("battle_place", "monster") == "monster"
                    else:
                        # No fight can start here, or the opening blow ended it
                        fallen = api_after["character"]["current_hit_points"] <= 0
                        assert after["battle"] is None or (fallen and after["battle"]["phase"] == "defeat")


class TestEventView:
    def test_choices_carry_the_numbers_of_the_classic_page(self, client):
        where = "Whispering Woods/entrance"
        place(client, where, pending_event="abandoned_chest")
        before = _path(client).read_bytes()
        answer = client.get("/api/event").json()
        assert _path(client).read_bytes() == before
        assert answer["result"] is None and answer["state"]["pending"]["kind"] == "event"
        view = answer["event"]
        assert {key: view[key] for key in ("id", "title", "text", "object", "label", "landmark")} == {
            "id": "abandoned_chest", "title": EVENTS["abandoned_chest"]["title"],
            "text": EVENTS["abandoned_chest"]["text"], "object": "chest",
            "label": "the abandoned chest", "landmark": False}
        session = game_session.GameSession.from_dict(load(client))
        tier = location_tier(session.current_location)
        for index, (shown, choice) in enumerate(zip(view["choices"], EVENTS["abandoned_chest"]["choices"])):
            assert shown["index"] == index and shown["hotkey"] == str(index + 1)
            assert shown["label"] == choice["label"]
            if choice.get("skill"):
                assert shown["skill"] == choice["skill"]
                assert shown["dc"] == scaled_dc(choice.get("dc", 10), tier)
                assert shown["modifier"] == calculate_skill_modifier(session.character, choice["skill"])
                assert shown["proficient"] == session.character.has_skill_proficiency(choice["skill"])
            else:
                assert (shown["skill"], shown["dc"], shown["modifier"], shown["proficient"]) == (None,) * 4

    @pytest.mark.parametrize("roll, success", [(20, True), (1, False)])
    def test_the_die_decides(self, client, monkeypatch, roll, success):
        place(client, "Whispering Woods/entrance", pending_event="abandoned_chest")
        monkeypatch.setattr(Dice, "roll_d20", lambda: roll)
        answer = client.post("/api/event/choose", json={"choice": 0}).json()
        assert answer["event"] is None
        assert answer["result"]["success"] is success and answer["result"]["check"]["roll"] == roll
        assert set(answer["result"]) == {
            "title", "label", "success", "check", "text", "gold", "xp", "heal", "pp", "damage", "item",
            "battle", "leveled_up", "new_level"}
        assert client.get("/api/event").json()["result"] == answer["result"]

    def test_nothing_pending(self, client):
        place(client, "Whispering Woods/entrance")
        answer = client.get("/api/event").json()
        assert answer["event"] is None and answer["result"] is None


class TestRefusals:
    def test_each_leaves_the_file_alone(self, client):
        where = "Whispering Woods/entrance"
        place(client, where)
        before = _path(client).read_bytes()
        refused(client, client.post("/api/event/choose", json={"choice": 0}), 409, "no_event", before)
        refused(client, client.post("/api/event/continue"), 409, "nothing_to_continue", before)
        refused(client, client.post("/api/event/continue", content=b"[]"), 400, "bad_request", before)

        place(client, where, pending_event="abandoned_chest")
        before = _path(client).read_bytes()
        count = len(EVENTS["abandoned_chest"]["choices"])
        for index in (-1, count):
            refused(client, client.post("/api/event/choose", json={"choice": index}), 404, "no_such_choice", before)
        for body in ({"choice": "0"}, {"choice": True}, {"choice": 0.0}, [], {}):
            refused(client, client.post("/api/event/choose", json=body), 400, "bad_request", before)
        refused(client, client.post("/api/event/choose", content=b'{"choice": 0, "choice": 1}'),
                400, "bad_request", before)
        refused(client, client.post("/api/event/continue"), 409, "nothing_to_continue", before)

    def test_no_character(self, tmp_path, monkeypatch):
        monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
        with TestClient(app) as bare:
            for answer in (bare.get("/api/event"), bare.post("/api/event/choose", json={"choice": 0}),
                           bare.post("/api/event/continue")):
                assert answer.status_code == 409 and answer.json()["error"] == "no_character"


class TestEngageAndSpent:
    @pytest.mark.parametrize("event_id", ["abandoned_chest", "bridge_runes"])
    def test_engage_carries_the_event_and_the_area_keeps_it_spent(self, client, event_id):
        where = where_for(event_id)
        landmark = bool(EVENTS[event_id].get("special"))
        place(client, where, area_contents=contents(where, event=event_id))
        state = client.get("/api/state").json()
        assert state["contents"]["event"]["landmark"] is landmark and state["contents"]["spent"] is None

        answer = client.post("/api/engage", json={"id": event_id}).json()
        assert answer["url"] == "/game/event" and answer["battle"] is None
        assert answer["event"] == client.get("/api/event").json()["event"]
        assert answer["event"]["landmark"] is landmark

        after = client.post("/api/event/choose", json={"choice": len(EVENTS[event_id]["choices"]) - 1}).json()
        shown = after["state"]["contents"]
        assert shown["event"] is None
        assert shown["spent"] == {**state["contents"]["event"]}
        assert load(client)["area_contents"]["spent"] == {"id": event_id}
        # What is spent can be neither met again nor does it block a search
        assert client.post("/api/engage", json={"id": event_id}).status_code == 409  # the result is pending
        assert client.post("/api/event/continue").json()["battle"] is None
        assert client.post("/api/engage", json={"id": event_id}).json()["error"] == "not_here"
        searched = client.post("/api/search")
        if searched.status_code == 200:
            assert searched.json()["contents"]["spent"] is None
        else:
            assert searched.json()["error"] == "nothing_to_find"

    def test_a_move_forgets_it(self, client):
        where = "Whispering Woods/entrance"
        place(client, where, area_contents={**contents(where), "spent": {"id": "abandoned_chest"}})
        state = client.get("/api/state").json()
        assert state["contents"]["spent"]["id"] == "abandoned_chest"
        moved = client.post("/api/move", json={"area_id": state["exits"][0]["id"]}).json()
        assert moved["contents"]["spent"] is None

    def test_engaging_a_monster_or_boss_carries_no_event(self, client):
        where = "Whispering Woods/entrance"
        place(client, where, area_contents=contents(where, monster=GOBLIN))
        answer = client.post("/api/engage", json={"id": GOBLIN["id"]}).json()
        assert answer["event"] is None
        monster = answer["battle"]["monster"]
        assert (monster["taunt"], monster["enrage_text"], monster["place"]) == (None, None, "monster")


class TestFightFromEvent:
    def test_the_monster_stands_where_the_event_was(self, client, monkeypatch):
        where = "Whispering Woods/entrance"
        place(client, where, area_contents=contents(where, event="strange_tracks"),
              char_max_hit_points=9999, char_current_hit_points=9999)
        client.post("/api/engage", json={"id": "strange_tracks"})
        monkeypatch.setattr(Dice, "roll_d20", lambda: 1)
        assert client.post("/api/event/choose", json={"choice": 0}).json()["result"]["battle"] is True
        answer = client.post("/api/event/continue").json()
        assert answer["event"] is None and answer["result"] is None
        assert answer["battle"]["phase"] == "fight" and answer["battle"]["monster"]["place"] == "event"
        assert answer["state"]["pending"]["kind"] == "battle"
        assert load(client)["battle_place"] == "event"
        assert client.get("/api/battle").json()["battle"] == answer["battle"]

    def test_a_discovery_fight_stands_at_the_landmark(self, client, monkeypatch):
        fighting = [(event_id, index, key) for event_id, event in EVENTS.items() if event.get("special")
                    for index, choice in enumerate(event["choices"])
                    for key in ("success", "failure", "outcome") if choice.get(key, {}).get("battle")]
        for event_id, index, key in fighting:
            where = where_for(event_id)
            place(client, where, area_contents=contents(where, event=event_id),
                  char_max_hit_points=9999, char_current_hit_points=9999)
            client.post("/api/engage", json={"id": event_id})
            with monkeypatch.context() as patch:
                patch.setattr(Dice, "roll_d20", lambda: 1 if key == "failure" else 20)
                assert client.post("/api/event/choose", json={"choice": index}).json()["result"]["battle"]
                answer = client.post("/api/event/continue").json()
            assert answer["battle"]["monster"]["place"] == "landmark"


def start_state(boss_id):
    """Everything that must have fallen before this boss, and where the character stands."""
    if boss_id == "Lady Vex":
        fallen = [b for b, (number, _, _) in AREA_BOSSES.items() if number == 1]
        return fallen + ["Flame Cultist Leader", "Corrupted High Priest"], "Rivermeet Town/town_square"
    number, loc, area = AREA_BOSSES[boss_id]
    fallen = [b for b, (n, _, _) in AREA_BOSSES.items() if n < number or (n == number and b != boss_id)]
    if number > 2:
        fallen.append("Lady Vex")
    if boss_id == "Lady Vex (Final Battle)":
        fallen.remove("Malachar the Void-touched")
    return fallen, f"{loc['name']}/{area['id']}"


def start_boss(client, boss_id, seed, classic):
    fallen, where = start_state(boss_id)
    place(client, where, defeated_bosses=fallen, char_level=BOSSES[boss_id]["level"],
          char_max_hit_points=9999, char_current_hit_points=9999)
    random.seed(seed)
    if boss_id == "Lady Vex":
        answer = client.post("/game/travel", data={"location_name": "Emberforge Mountains"}, follow_redirects=False)
        assert answer.headers["location"] == "/battle"
    elif classic:
        client.post("/battle/boss", follow_redirects=False)
    else:
        return client.post("/api/engage", json={"id": boss_id}).json()["battle"]
    return client.get("/api/battle").json()["battle"]


class TestBossParity:
    @pytest.mark.parametrize("boss_id", sorted(BOSSES))
    def test_both_interfaces_play_the_same_fight(self, client, boss_id):
        for seed in SEEDS:
            views = [start_boss(client, boss_id, seed, classic=False)]
            actions = []
            while views[-1]["phase"] == "fight" and len(actions) < 400:
                k = len(actions)
                usable = [a for a in views[-1]["abilities"] if a["usable"]]
                random.seed(seed * 1000 + k)
                if k % 3 == 2 and usable:
                    actions.append(usable[0]["id"])
                    answer = client.post("/api/battle/ability", json={"ability_id": usable[0]["id"]})
                else:
                    actions.append(None)
                    answer = client.post("/api/battle/attack")
                views.append(answer.json()["battle"])
            api_file = load(client)
            assert views[-1]["phase"] == "victory"

            enraged_at = next(i for i, view in enumerate(views)
                              if any(event["kind"] == "enrage" for event in view["turn"]["events"]))
            assert all(view["monster"]["enraged"] for view in views[enraged_at:])
            boss = BOSSES[boss_id]
            for view in views[:-1]:
                assert view["can_flee"] is False
                assert view["monster"]["enrage_text"] == boss["enrage_text"]
                assert view["monster"]["place"] == ("monster" if boss_id == "Lady Vex" else "boss")
                said = [line["text"] for line in view["log"]
                        if line["text"].startswith(f'{boss["name"]}: "') and line["text"].endswith('"')]
                expected = said[-1][len(boss["name"]) + 3:-1] if said else boss["taunts"]["start"][0]
                assert view["monster"]["taunt"] == expected
            assert views[-1]["monster"]["taunt"] is None
            won = views[-1]["rewards"]["boss"]
            assert won["shard"] == boss.get("shard") and won["defeat_text"] == boss["defeat_text"]

            assert start_boss(client, boss_id, seed, classic=True) == views[0]
            for k, ability_id in enumerate(actions):
                random.seed(seed * 1000 + k)
                if ability_id:
                    client.post("/battle/ability", data={"ability_id": ability_id}, follow_redirects=False)
                else:
                    client.post("/battle/attack", follow_redirects=False)
                assert client.get("/api/battle").json()["battle"] == views[k + 1], (seed, k)
            classic_file = load(client)
            for key in ("character", "defeated_bosses", "battle_rewards"):
                assert classic_file[key] == api_file[key], key


class TestBossView:
    @pytest.mark.parametrize("boss_id", sorted(AREA_BOSSES))
    def test_the_world_shows_title_and_intro(self, client, boss_id):
        fallen, where = start_state(boss_id)
        place(client, where, defeated_bosses=fallen)
        shown = client.get("/api/state").json()["contents"]["boss"]
        assert set(shown) == {"id", "name", "level", "locked", "locked_text", "title", "intro"}
        assert shown["title"] == BOSSES[boss_id].get("title", "") and shown["intro"] == BOSSES[boss_id]["intro"]

    def test_no_escape(self, client):
        start_boss(client, "Shard Guardian", 1, classic=False)
        before = _path(client).read_bytes()
        answer = client.post("/api/battle/flee")
        refused(client, answer, 409, "cannot_flee", before)
        assert answer.json()["message"] == "There is no escape from this fight!"

        stored = load(client)
        answer = client.post("/battle/flee", follow_redirects=False)
        assert answer.status_code == 303 and answer.headers["location"] == "/battle"
        after = load(client)
        assert after["character"] == stored["character"]
        assert after["battle"]["turn_seq"] == stored["battle"]["turn_seq"]
        assert after["battle"]["battle_log"] == stored["battle"]["battle_log"]


class TestAmbush:
    def test_it_is_fought_on_the_classic_pages(self, client):
        fallen, where = start_state("Lady Vex")
        place(client, where, defeated_bosses=fallen, return_to_3d=True, battle_place="boss",
              char_level=BOSSES["Lady Vex"]["level"], char_max_hit_points=9999, char_current_hit_points=9999)
        random.seed(3)
        answer = client.post("/game/travel", data={"location_name": "Emberforge Mountains"}, follow_redirects=False)
        assert answer.status_code == 303 and answer.headers["location"] == "/battle"
        stored = load(client)
        assert stored["battle"]["is_active"] and stored["battle"]["monster"]["boss_id"] == "Lady Vex"
        assert stored["return_to_3d"] is False and stored["battle_place"] == "monster"
        monster = client.get("/api/battle").json()["battle"]["monster"]
        assert monster["boss_id"] == "Lady Vex" and monster["place"] == "monster"

    def test_an_unknown_place_counts_as_the_monster_slot(self, client):
        where = "Whispering Woods/entrance"
        place(client, where, battle_place="nowhere")
        assert client.get("/api/battle").json()["battle"]["monster"]["place"] == "monster"
        data = load(client)
        del data["battle_place"]
        _path(client).write_text(json.dumps(data), encoding="utf-8")
        assert client.get("/api/battle").json()["battle"]["monster"]["place"] == "monster"
