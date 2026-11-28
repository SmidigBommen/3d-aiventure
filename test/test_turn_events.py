"""Tests for the structured turn events that drive the playback of a fight."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")

import web.game_session as game_session
from dice import Dice
from engine.turn_events import FX_KEYS, TurnRecorder, ability_fx, outcome_of
from test_web_flow import client, load, patch, goto, refused, start_fight  # noqa: F401  (client is a fixture)

ABILITIES = game_session.get_abilities()
MONSTER_ABILITIES = game_session.get_monster_abilities()["abilities"]


class TestRecorder:
    def test_hp_changes_are_measured_between_steps(self):
        rec = TurnRecorder(player_hp=20, monster_hp=30)
        rec.add("player", "attack", 20, 23, name="Longsword", outcome="hit", fx="slashing")
        rec.add("monster", "ability", 14, 26, name="Life Drain", outcome="hit", fx="necrotic")
        assert [(e["player"], e["monster"]) for e in rec.events] == [(0, -7), (-6, 3)]
        assert rec.events[0]["ranged"] is False

    def test_unknown_effect_falls_back_to_impact(self):
        rec = TurnRecorder(10, 10)
        assert rec.add("player", "attack", 10, 10, fx="glitter")["fx"] == "impact"

    def test_outcome(self):
        assert outcome_of(True, crit=True) == "crit"
        assert outcome_of(True) == "hit"
        assert outcome_of(False, half=True) == "half"
        assert outcome_of(False) == "miss"

    @pytest.mark.parametrize("ability_id", sorted(ABILITIES))
    def test_every_player_ability_has_a_known_effect(self, ability_id):
        assert ability_fx(ABILITIES[ability_id]) in FX_KEYS

    @pytest.mark.parametrize("ability_id", sorted(MONSTER_ABILITIES))
    def test_every_monster_ability_has_a_known_effect(self, ability_id):
        assert ability_fx(MONSTER_ABILITIES[ability_id]) in FX_KEYS

    def test_effect_choice(self):
        assert ability_fx(ABILITIES["fireball"]) == "fire"
        assert ability_fx(ABILITIES["second_wind"]) == "heal"
        assert ability_fx(ABILITIES["arcane_shield"]) == "shield"
        assert ability_fx(MONSTER_ABILITIES["war_cry"]) == "buff"
        assert ability_fx(MONSTER_ABILITIES["blight_spores"]) == "poison"


def _start(client, hp=500):
    goto(client, 1, "Whispering Woods", "clearing")
    # Tough enough to survive anything, including an opening blow before the first turn
    patch(client, char_current_hit_points=10_000, char_max_hit_points=10_000)
    start_fight(client)
    data = load(client)
    data["battle"]["monster"].update(hp=hp, max_hp=hp)
    patch(client, battle=data["battle"])


def _turn(client):
    battle = load(client)["battle"]
    return battle["turn_seq"], battle["turn_events"]


def _act(client, action, **body):
    """One action of the fight. Returns the battle view of the answer."""
    response = client.post(f"/api/battle/{action}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["battle"]


class TestTurnEventsThroughRoutes:
    def test_attack_records_player_then_monster(self, client, monkeypatch):
        _start(client)
        seq_before, _ = _turn(client)
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 15))
        hp_before = load(client)["battle"]["monster"]["hp"]
        view = _act(client, "attack")
        seq, events = _turn(client)
        assert seq == seq_before + 1
        # The answer carries the turn that was stored
        assert view["turn"] == {"seq": seq, "events": events}
        first = events[0]
        assert (first["actor"], first["kind"], first["name"]) == ("player", "attack", "Longsword")
        assert first["outcome"] == "hit" and first["fx"] == "slashing" and first["monster"] < 0
        assert events[1]["actor"] == "monster"
        # The deltas add up to the real HP change
        assert hp_before + sum(e["monster"] for e in events) == load(client)["battle"]["monster"]["hp"]
        assert view["monster"]["hp"] == load(client)["battle"]["monster"]["hp"]

    def test_natural_20_is_a_crit_and_natural_1_a_miss(self, client, monkeypatch):
        _start(client)
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 20))
        _act(client, "attack")
        assert _turn(client)[1][0]["outcome"] == "crit"
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 1))
        view = _act(client, "attack")
        events = _turn(client)[1]
        assert events[0]["outcome"] == "miss" and events[0]["monster"] == 0
        assert view["turn"]["events"][0]["outcome"] == "miss"

    def test_defend_item_and_ability(self, client):
        _start(client)
        _act(client, "defend")
        assert _turn(client)[1][0]["kind"] == "defend"

        potion = {"name": "Healing Potion", "description": "", "type": "potion", "healing_amount": 20}
        patch(client, char_inventory=[potion], char_current_hit_points=100)
        _act(client, "item", item_index=0)
        item = _turn(client)[1][0]
        assert (item["kind"], item["fx"], item["player"]) == ("item", "heal", 20)

        patch(client, char_power_points=5, char_current_hit_points=100)
        _act(client, "ability", ability_id="second_wind")
        ability = _turn(client)[1][0]
        assert (ability["kind"], ability["name"], ability["outcome"]) == ("ability", "Second Wind", None)
        assert ability["fx"] == "heal" and ability["player"] > 0

    def test_rejected_actions_do_not_start_a_turn(self, client):
        _start(client)
        seq = _turn(client)[0]
        patch(client, char_power_points=0, char_level=2)   # Action Surge is known from level 2
        refused(client.post("/api/battle/ability", json={"ability_id": "action_surge"}), 409, "not_enough_pp")
        refused(client.post("/api/battle/item", json={"item_index": 99}), 404, "no_such_item")
        assert _turn(client)[0] == seq
        assert client.get("/api/battle").json()["battle"]["turn"]["seq"] == seq

    def test_ranged_weapon_does_not_lunge(self, client, monkeypatch):
        _start(client)
        creation = load(client)["character_creation"]
        creation["weapon"] = "Longbow"
        patch(client, character_creation=creation)
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 15))
        _act(client, "attack")
        first = _turn(client)[1][0]
        assert first["name"] == "Longbow"
        assert first["ranged"] and first["fx"] == "piercing"

    def test_poison_tick_is_a_condition_event(self, client):
        _start(client)
        data = load(client)
        data["battle"]["monster"]["effects"] = [
            {"stat": "poison", "value": 4, "duration": 3, "source": "Test"}]
        patch(client, battle=data["battle"])
        _act(client, "defend")
        conditions = [e for e in _turn(client)[1] if e["kind"] == "condition"]
        assert conditions and conditions[0]["actor"] == "monster"
        assert conditions[0]["fx"] == "poison" and conditions[0]["monster"] == -4

    def test_view_carries_the_turn_and_final_blow_reaches_victory(self, client):
        _start(client, hp=1)
        seq, events = _turn(client)
        shown = client.get("/api/battle").json()["battle"]
        assert shown["phase"] == "fight" and shown["turn"] == {"seq": seq, "events": events}
        for _ in range(60):
            view = _act(client, "attack")
            if view["phase"] != "fight":
                break
        assert view["phase"] == "victory" and view["monster"]["hp"] == 0
        # The turn of the final blow is still there to be played
        last = view["turn"]["events"][-1]
        assert (last["actor"], last["kind"], last["monster"]) == ("player", "attack", -1)
        assert client.get("/api/battle").json()["battle"]["turn"] == view["turn"]

    def test_old_session_without_turn_fields_loads(self, client):
        _start(client)
        data = load(client)
        del data["battle"]["turn_events"], data["battle"]["turn_seq"]
        patch(client, battle=data["battle"])
        response = client.get("/api/battle")
        assert response.status_code == 200
        assert response.json()["battle"]["turn"] == {"seq": 0, "events": []}

