"""End-to-end tests through the JSON API: bosses, flee, events, act travel.

These drive the real app with a test client, so they cover the wiring between
routes, session persistence and the engine.
"""

import sys
import json
import random
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
import web.game_session as game_session
from web.app import app
from web import creation, fight, save_manager, world
from engine import campaign as rules

CAMPAIGN = game_session.get_campaign()
ACT1, ACT2, ACT3 = CAMPAIGN["acts"]


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client with a freshly created Fighter, with sessions stored in a temp dir."""
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(game_session, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(save_manager, "SAVES_DIR", tmp_path / "saves")
    orig_d20, orig_roll = Dice.roll_d20, Dice.roll
    with TestClient(app) as c:
        response = c.post("/api/new-game", json={
            "race": "Human", "class_name": "Fighter", "name": "Tester",
            "weapon": "Longsword", "armor": "Chain Mail",
            "portrait": creation.PORTRAITS[0]["path"],
            "skills": ["Athletics", "Perception"]})
        assert response.status_code == 200
        c.sessions_dir = sessions
        yield c
    Dice.roll_d20, Dice.roll = orig_d20, orig_roll


def _session_path(client) -> Path:
    files = list(client.sessions_dir.glob("*.json"))
    assert len(files) == 1
    return files[0]


def load(client) -> dict:
    return json.loads(_session_path(client).read_text(encoding="utf-8"))


def patch(client, **changes):
    """Edit the stored session directly (character sub-dict via char_*)."""
    data = load(client)
    for key, value in changes.items():
        if key.startswith("char_"):
            data["character"][key[5:]] = value
        else:
            data[key] = value
    _session_path(client).write_text(json.dumps(data), encoding="utf-8")


def goto(client, act_num, location_name, area_id):
    patch(client, act_num=act_num, location_name=location_name, area_id=area_id)


def make_strong(client):
    patch(client, char_level=20, char_max_hit_points=9999, char_current_hit_points=9999)


def plant(client, monster=None, event=None):
    """Store what the area the character stands in holds."""
    data = load(client)
    patch(client, area_contents={
        "location": data["location_name"], "area_id": data["area_id"], "seq": 1,
        "monster": monster, "event": {"id": event} if event else None, "spent": None})


def engage(client, content_id):
    return client.post("/api/engage", json={"id": content_id})


def meet_boss(client, boss_id):
    """Turn to the boss of the area the character stands in."""
    plant(client)
    return engage(client, boss_id)


def start_fight(client) -> dict:
    """Meet a monster of the area the character stands in. Returns the battle view."""
    data = load(client)
    location = next(loc for act in CAMPAIGN["acts"] for loc in act["locations"]
                    if loc["name"] == data["location_name"])
    area = next(a for a in location["areas"] if a["id"] == data["area_id"])
    plant(client, monster={"id": "m1", **fight.pick_monster(area, location)})
    response = engage(client, "m1")
    assert response.status_code == 200, response.text
    return response.json()["battle"]


def refused(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"] == code


def fight_until_over(client, max_rounds=300):
    """Attack until the battle ends. Every d20 is a 20 so the fight is short and deterministic
    in outcome (callers pair this with make_strong so the player survives the return crits)."""
    Dice.roll_d20 = lambda: 20
    for _ in range(max_rounds):
        view = client.post("/api/battle/attack", json={}).json()["battle"]
        if view["phase"] != "fight":
            return view["phase"]
    raise AssertionError("battle did not end")


class TestLocationPage:
    def test_renders_with_act_title(self, client):
        response = client.get("/api/state")
        assert response.status_code == 200
        assert response.json()["location"]["act"]["title"] == "The Awakening"

    def test_boss_panel_only_in_boss_area(self, client):
        plant(client)
        state = client.get("/api/state").json()
        assert state["area"]["has_boss"] is False and state["contents"]["boss"] is None
        goto(client, 1, "Whispering Woods", "grove")
        plant(client)
        state = client.get("/api/state").json()
        assert state["area"]["has_boss"] is True
        assert state["contents"]["boss"]["name"] == "The Shard Guardian"

    def test_dead_character_is_sent_to_defeat_screen(self, client):
        patch(client, char_current_hit_points=0)
        assert client.get("/api/state").json()["pending"] == {"kind": "defeat"}
        assert client.get("/api/battle").json()["battle"]["phase"] == "defeat"
        refused(client.post("/api/move", json={"area_id": "market"}), 409, "pending")
        assert load(client)["area_id"] == "town_square"


class TestBossBattle:
    def test_cannot_start_boss_outside_boss_area(self, client):
        refused(meet_boss(client, "Shard Guardian"), 404, "not_here")
        assert load(client)["battle"]["is_active"] is False

    def test_boss_fight_to_victory_unlocks_progress(self, client):
        make_strong(client)
        goto(client, 1, "Whispering Woods", "grove")
        answer = meet_boss(client, "Shard Guardian")
        assert answer.status_code == 200
        data = load(client)
        assert data["battle"]["is_active"] is True
        assert data["battle"]["monster"]["boss_id"] == "Shard Guardian"

        arena = client.get("/api/battle")
        assert arena.status_code == 200
        view = arena.json()["battle"]
        assert view["monster"]["is_boss"] is True and view["monster"]["place"] == "boss"
        assert view["can_flee"] is False
        assert arena.json()["state"]["pending"] == {"kind": "battle"}

        assert fight_until_over(client) == "victory"
        data = load(client)
        assert data["defeated_bosses"] == ["Shard Guardian"]

        victory = client.get("/api/battle").json()
        assert victory["battle"]["rewards"]["boss"]["shard"] == "Shard of Verdance"
        assert victory["battle"]["rewards"]["boss"]["shards_collected"] == 1
        # Boss is gone from the area afterwards
        assert victory["state"]["area"]["has_boss"] is False
        assert victory["state"]["contents"]["boss"] is None
        refused(engage(client, "Shard Guardian"), 404, "not_here")

    def test_boss_cannot_be_fled(self, client):
        make_strong(client)
        goto(client, 1, "Whispering Woods", "grove")
        meet_boss(client, "Shard Guardian")
        Dice.roll_d20 = lambda: 20
        before = load(client)["battle"]
        refused(client.post("/api/battle/flee", json={}), 409, "cannot_flee")
        assert load(client)["battle"]["is_active"] is True
        assert load(client)["battle"] == before

    def test_boss_enrages_at_half_health(self, client):
        make_strong(client)
        goto(client, 1, "Whispering Woods", "grove")
        meet_boss(client, "Shard Guardian")
        data = load(client)
        assert data["battle"]["monster"]["enraged"] is False
        data["battle"]["monster"]["hp"] = data["battle"]["monster"]["max_hp"] // 2
        _session_path(client).write_text(json.dumps(data))
        view = client.post("/api/battle/defend", json={}).json()["battle"]
        data = load(client)
        assert data["battle"]["monster"]["enraged"] is True
        assert view["monster"]["enraged"] is True
        assert any(e["kind"] == "enrage" for e in view["turn"]["events"])
        assert any(e["source"] == "Enraged" for e in view["monster"]["effects"])

    def test_final_boss_is_sealed_until_lieutenant_falls(self, client):
        make_strong(client)
        defeated = rules.act_boss_ids(ACT1) + rules.act_boss_ids(ACT2)
        patch(client, defeated_bosses=defeated)
        goto(client, 3, "The Convergence", "ritual_chamber")
        plant(client)
        assert client.get("/api/state").json()["contents"]["boss"]["locked"] is True
        refused(engage(client, "Malachar the Void-touched"), 409, "locked")
        assert load(client)["battle"]["is_active"] is False

        patch(client, defeated_bosses=defeated + ["Lady Vex (Final Battle)"])
        assert engage(client, "Malachar the Void-touched").status_code == 200
        assert load(client)["battle"]["monster"]["boss_id"] == "Malachar the Void-touched"

        assert fight_until_over(client) == "victory"
        assert client.get("/api/battle").json()["battle"]["rewards"]["boss"]["campaign_complete"] is True
        ending = client.get("/api/ending")
        assert ending.status_code == 200
        assert ending.json()["ending"]["title"] == "The Crown Restored"

    def test_ending_is_locked_until_campaign_complete(self, client):
        refused(client.get("/api/ending"), 409, "not_complete")

    def test_losing_to_a_boss_leaves_it_undefeated(self, client):
        patch(client, char_current_hit_points=1, char_max_hit_points=1)
        goto(client, 1, "Whispering Woods", "grove")
        phase = meet_boss(client, "Shard Guardian").json()["battle"]["phase"]
        if load(client)["battle"]["is_active"]:
            Dice.roll_d20 = lambda: 2   # the player whiffs; the boss' save DCs always land
            for _ in range(200):
                phase = client.post("/api/battle/defend", json={}).json()["battle"]["phase"]
                if phase != "fight":
                    break
        assert phase == "defeat"
        assert load(client)["defeated_bosses"] == []
        after = client.get("/api/battle")
        assert after.status_code == 200
        assert after.json()["battle"]["phase"] == "defeat"
        assert after.json()["state"]["area"]["has_boss"] is True


class TestRandomBattle:
    def _start(self, client):
        goto(client, 1, "Whispering Woods", "entrance")
        view = start_fight(client)
        assert load(client)["battle"]["is_active"] is True
        return view

    def test_no_battle_where_no_monsters_live(self, client):
        # Town Square: an outcome that calls for a fight finds nothing to fight
        patch(client, pending_event="strange_tracks")
        Dice.roll_d20 = lambda: 1
        chosen = client.post("/api/event/choose", json={"choice": 0}).json()
        assert chosen["result"]["battle"] is True
        answer = client.post("/api/event/continue", json={}).json()
        assert answer["battle"] is None and answer["state"]["pending"] is None
        assert load(client)["battle"]["is_active"] is False

    def test_start_does_not_restart_an_active_battle(self, client):
        make_strong(client)
        self._start(client)
        name = load(client)["battle"]["monster"]["name"]
        patch_data = load(client)
        patch_data["battle"]["round_count"] = 7
        patch_data["area_contents"]["monster"] = {
            "id": "m2", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Other", "weapon": "Club"}
        _session_path(client).write_text(json.dumps(patch_data))
        refused(engage(client, "m2"), 409, "pending")
        assert load(client)["battle"]["round_count"] == 7
        assert load(client)["battle"]["monster"]["name"] == name

    def test_monster_gets_racial_abilities(self, client):
        make_strong(client)
        self._start(client)
        assert load(client)["battle"]["monster"]["abilities"] == ["dirty_trick"]

    def test_successful_flee_ends_battle(self, client):
        make_strong(client)
        self._start(client)
        Dice.roll_d20 = lambda: 20
        response = client.post("/api/battle/flee", json={})
        assert response.status_code == 200
        assert response.json()["battle"]["phase"] == "fled"
        assert load(client)["battle"]["is_active"] is False
        state = response.json()["state"]
        assert state["pending"] is None
        # The monster stands in the area again
        assert state["contents"]["monster"]["id"] == "m1"

    def test_failed_flee_costs_the_turn(self, client):
        make_strong(client)
        self._start(client)
        round_before = load(client)["battle"]["round_count"]
        Dice.roll_d20 = lambda: 1
        view = client.post("/api/battle/flee", json={}).json()["battle"]
        data = load(client)
        assert data["battle"]["is_active"] is True
        assert data["battle"]["round_count"] == round_before + 1
        assert view["phase"] == "fight" and view["round"] == round_before + 1
        assert view["turn"]["events"][0]["kind"] == "flee"

    def test_defend_bonus_expires_at_end_of_round(self, client):
        make_strong(client)
        self._start(client)
        ac_before = load(client)["character"]["armor_class"]
        view = client.post("/api/battle/defend", json={}).json()["battle"]
        data = load(client)
        assert data["character"]["armor_class"] == ac_before
        assert not any(e["source"] == "Defend" for e in data["battle"]["player_effects"])
        assert view["player"]["ac"] == ac_before

    def test_invalid_item_does_not_cost_a_turn(self, client):
        make_strong(client)
        self._start(client)
        round_before = load(client)["battle"]["round_count"]
        refused(client.post("/api/battle/item", json={"item_index": 99}), 404, "no_such_item")
        assert load(client)["battle"]["round_count"] == round_before

    def test_full_fight_and_victory_screen(self, client):
        make_strong(client)
        self._start(client)
        assert fight_until_over(client) == "victory"
        # The rewards stay until the player carries on
        shown = client.get("/api/battle")
        assert shown.status_code == 200
        assert shown.json()["battle"]["phase"] == "victory"
        assert shown.json()["battle"]["rewards"]["xp"] > 0
        assert load(client)["monster_kills"] == 1
        after = client.post("/api/battle/continue", json={}).json()["battle"]
        assert after["phase"] == "none" and after["rewards"] is None
        assert load(client)["battle_rewards"] is None

    def test_every_class_ability_works_through_the_route(self, client):
        make_strong(client)
        patch(client, char_power_points=99)
        self._start(client)
        for ability_id in ("power_strike", "second_wind", "action_surge", "rallying_cry", "champions_blow"):
            if not load(client)["battle"]["is_active"]:
                client.post("/api/battle/continue", json={})
                start_fight(client)
            response = client.post("/api/battle/ability", json={"ability_id": ability_id})
            assert response.status_code == 200
            assert response.json()["battle"]["turn"]["events"][0]["kind"] == "ability"

    def test_poison_kills_monster_at_end_of_round(self, client):
        make_strong(client)
        self._start(client)
        data = load(client)
        data["battle"]["monster"]["hp"] = 2
        data["battle"]["monster"]["effects"] = [
            {"stat": "poison", "value": 5, "duration": 3, "source": "test"},
            {"stat": "stun", "value": 1, "duration": 1, "source": "test"}]
        _session_path(client).write_text(json.dumps(data))
        view = client.post("/api/battle/defend", json={}).json()["battle"]
        assert view["phase"] == "victory"
        assert view["monster"]["hp"] == 0

    def test_stunned_player_loses_a_turn(self, client):
        make_strong(client)
        self._start(client)
        data = load(client)
        # Duration 2: survives this round's tick, costs the next turn, then expires
        data["battle"]["player_effects"] = [{"stat": "stun", "value": 1, "duration": 2, "source": "test"}]
        round_before = data["battle"]["round_count"]
        _session_path(client).write_text(json.dumps(data))
        client.post("/api/battle/defend", json={})
        data = load(client)
        assert data["battle"]["round_count"] == round_before + 2
        assert data["battle"]["player_effects"] == []
        assert any("stunned" in line for line in data["battle"]["battle_log"])


class TestEvents:
    def test_event_flow(self, client, monkeypatch):
        monkeypatch.setattr(world, "EVENT_CHANCE", 1.0)
        random.seed(5)
        found = client.post("/api/search").json()   # Town Square: no monsters, so always an event
        event_id = found["contents"]["event"]["id"]
        engaged = engage(client, event_id).json()
        data = load(client)
        assert data["pending_event"] == event_id
        assert event_id

        # Nothing else goes on until the event is dealt with
        assert engaged["state"]["pending"] == {"kind": "event"}
        refused(client.post("/api/move", json={"area_id": "market"}), 409, "pending")
        page = client.get("/api/event")
        assert page.status_code == 200
        assert page.json()["event"]["title"] == game_session.get_events()[event_id]["title"]

        Dice.roll_d20 = lambda: 20
        chosen = client.post("/api/event/choose", json={"choice": 0}).json()
        data = load(client)
        assert data["pending_event"] is None
        assert data["event_result"]["success"] is True
        assert data["events_resolved"] == 1
        assert chosen["result"]["success"] is True
        # The outcome is pending until it has been read
        shown = client.get("/api/event").json()
        assert shown["event"] is None and shown["result"] == chosen["result"]
        assert shown["state"]["pending"] == {"kind": "event"}

        answer = client.post("/api/event/continue", json={})
        assert answer.json()["battle"] is None and answer.json()["state"]["pending"] is None
        assert load(client)["event_result"] is None
        assert client.get("/api/state").status_code == 200

    def test_special_event_is_one_time(self, client, monkeypatch):
        monkeypatch.setattr(random, "random", lambda: 0.999)   # never an encounter
        goto(client, 1, "Rivermeet Town", "bridge")
        monkeypatch.setattr(world, "EVENT_CHANCE", 1.1)
        found = client.post("/api/search").json()
        assert found["contents"]["event"]["id"] == "bridge_runes"
        engage(client, "bridge_runes")
        assert load(client)["pending_event"] == "bridge_runes"
        client.post("/api/event/choose", json={"choice": 0})
        assert "bridge_runes" in load(client)["completed_events"]
        client.post("/api/event/continue", json={})
        client.post("/api/search")
        data = load(client)
        assert data["pending_event"] != "bridge_runes"
        assert (data["area_contents"]["event"] or {}).get("id") != "bridge_runes"

    def test_invalid_choice_keeps_event_pending(self, client):
        patch(client, pending_event="abandoned_chest")
        refused(client.post("/api/event/choose", json={"choice": 42}), 404, "no_such_choice")
        assert load(client)["pending_event"] == "abandoned_chest"

    def test_event_xp_can_level_up(self, client):
        patch(client, pending_event="bridge_runes", char_xp=149)
        Dice.roll_d20 = lambda: 20
        answer = client.post("/api/event/choose", json={"choice": 0}).json()
        data = load(client)
        assert data["character"]["level"] == 2
        assert data["event_result"]["leveled_up"] is True
        assert answer["result"]["leveled_up"] is True and answer["result"]["new_level"] == 2
        assert answer["state"]["character"]["level"] == 2

    def test_battle_outcome_leads_to_a_fight(self, client):
        goto(client, 1, "Whispering Woods", "entrance")
        patch(client, pending_event="strange_tracks")
        Dice.roll_d20 = lambda: 1
        client.post("/api/event/choose", json={"choice": 0})
        assert load(client)["event_result"]["battle"] is True
        answer = client.post("/api/event/continue", json={}).json()
        assert answer["battle"]["phase"] == "fight"
        assert answer["battle"]["monster"]["place"] == "event"
        assert answer["state"]["pending"] == {"kind": "battle"}
        assert load(client)["battle"]["is_active"] is True


class TestTravelAndJournal:
    def test_travel_page_shows_locked_acts(self, client):
        page = client.get("/api/travel")
        assert page.status_code == 200
        acts = page.json()["travel"]["acts"]
        assert "Whispering Woods" in [loc["name"] for loc in acts[0]["locations"]]
        assert acts[0]["locked"] is False
        assert "Emberforge Mountains" in [loc["name"] for loc in acts[1]["locations"]]
        assert acts[1]["locked"] is True and acts[1]["locked_reason"]
        assert acts[2]["locked"] is True

    def test_cannot_travel_to_locked_act(self, client):
        refused(client.post("/api/travel", json={"location": "Emberforge Mountains"}), 409, "act_locked")
        assert load(client)["location_name"] == "Rivermeet Town"

    def test_travel_within_act_arrives_at_starting_area(self, client):
        answer = client.post("/api/travel", json={"location": "Abandoned Watchtower"})
        assert answer.status_code == 200
        data = load(client)
        assert data["location_name"] == "Abandoned Watchtower"
        assert data["area_id"] == "approach"
        assert answer.json()["state"]["area"]["id"] == "approach"
        assert answer.json()["ambush"] is None and answer.json()["battle"] is None

    def test_travel_to_unlocked_act_and_back(self, client):
        patch(client, defeated_bosses=rules.act_boss_ids(ACT1))
        assert client.get("/api/travel").json()["travel"]["acts"][1]["locked"] is False
        answer = client.post("/api/travel", json={"location": "Emberforge Mountains"}).json()
        data = load(client)
        assert (data["act_num"], data["location_name"]) == (2, "Emberforge Mountains")
        assert answer["state"]["location"]["act"]["title"] == "Gathering the Fragments"

        client.post("/api/travel", json={"location": "Rivermeet Town"})
        data = load(client)
        assert (data["act_num"], data["location_name"]) == (1, "Rivermeet Town")

    def test_lady_vex_ambushes_on_the_road(self, client):
        make_strong(client)
        defeated = rules.act_boss_ids(ACT1) + rules.act_boss_ids(ACT2)[:2]
        patch(client, defeated_bosses=defeated)
        goto(client, 2, "Emberforge Mountains", "mountain_pass")
        answer = client.post("/api/travel", json={"location": "Windswept Plains"}).json()
        assert answer["ambush"]["id"] == "Lady Vex"
        assert answer["battle"]["phase"] == "fight"
        assert answer["battle"]["monster"]["place"] == "road"
        assert answer["state"]["pending"] == {"kind": "battle"}
        assert load(client)["battle"]["monster"]["boss_id"] == "Lady Vex"

        assert fight_until_over(client) == "victory"
        client.post("/api/battle/continue", json={})
        # Once beaten she does not ambush again
        answer = client.post("/api/travel", json={"location": "The Crystalline Caves"}).json()
        assert answer["ambush"] is None and answer["battle"] is None
        assert answer["state"]["location"]["name"] == "The Crystalline Caves"
        assert answer["state"]["pending"] is None

    def test_journal_renders_progress(self, client):
        page = client.get("/api/journal")
        assert page.status_code == 200
        journal = page.json()["journal"]
        assert "The Shard Guardian" in [boss["name"] for boss in journal["acts"][0]["bosses"]]
        # Act 2 bosses stay hidden
        assert {boss["name"] for boss in journal["acts"][1]["bosses"]} == {"???"}
        assert {"name": "Shard of Verdance", "found": False} in journal["shards"]

        patch(client, defeated_bosses=["Shard Guardian"])
        journal = client.get("/api/journal").json()["journal"]
        assert {"name": "Shard of Verdance", "found": True} in journal["shards"]
        assert journal["stats"]["bosses"] == 1


class TestSessionCompatibility:
    def test_session_without_new_fields_still_loads(self, client):
        """Saves from before this feature set must keep working."""
        data = load(client)
        for key in ("defeated_bosses", "pending_event", "event_result",
                    "completed_events", "events_resolved"):
            del data[key]
        for key in ("abilities", "cooldowns", "boss_id", "enraged", "con_mod", "wis_mod"):
            data["battle"]["monster"].pop(key, None)
        for item in data["character"]["inventory"]:
            item.pop("healing_amount", None)
        _session_path(client).write_text(json.dumps(data))

        assert client.get("/api/state").status_code == 200
        assert client.get("/api/journal").status_code == 200
        session = game_session.GameSession.from_dict(data)
        assert session.defeated_bosses == []
        assert session.battle.monster.abilities == []
        potions = {i.name: i.healing_amount for i in session.character.inventory}
        assert potions == {"Small Healing Potion": 10, "Medium Healing Potion": 25}

    def test_potion_healing_survives_roundtrip(self, client):
        data = load(client)
        data["character"]["inventory"].append(
            {"name": "Superior Healing Potion", "description": "", "type": "potion", "healing_amount": 50})
        _session_path(client).write_text(json.dumps(data))
        # Travel loads the session and saves it again
        assert client.post("/api/travel", json={"location": "Whispering Woods"}).status_code == 200
        potions = {i["name"]: i["healing_amount"] for i in load(client)["character"]["inventory"]}
        assert potions["Superior Healing Potion"] == 50
        assert potions["Medium Healing Potion"] == 25

    def test_proficiency_is_restored_for_level(self, client):
        patch(client, char_level=8)
        session = game_session.GameSession.from_dict(load(client))
        assert session.character.proficiency_bonus == 3


class TestQuestTurnIn:
    def test_level_up_from_quest_grants_hp_and_power_points(self, client):
        goto(client, 1, "Rivermeet Town", "market")
        patch(client, char_xp=140, char_current_hit_points=5, char_power_points=0,
              active_quests={"goblin_menace": {"progress": 5, "status": "ready"}})
        before = load(client)["character"]
        answer = client.post("/api/shop/quest/turn-in", json={"quest_id": "goblin_menace"})
        assert answer.status_code == 200
        after = load(client)["character"]
        assert after["level"] == 2
        assert after["max_hit_points"] > before["max_hit_points"]
        assert after["current_hit_points"] == 5 + (after["max_hit_points"] - before["max_hit_points"])
        assert after["power_points"] == after["max_power_points"] > 0
        assert answer.json()["state"]["character"]["level"] == 2
        assert answer.json()["state"]["quests"] == []
