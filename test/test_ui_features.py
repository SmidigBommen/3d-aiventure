"""Tests for what the panels of the client show: the walk through a location, inventory
use/stacking/comparison, ability summaries, the battle view and the character creation previews."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")

import web.game_session as game_session
from engine.abilities import summarize_ability
from test_web_flow import client, load, patch, goto, refused, start_fight  # noqa: F401  (client is a fixture)

CAMPAIGN = game_session.get_campaign()
ABILITIES = game_session.get_abilities()
POTION = {"name": "Healing Potion", "description": "", "type": "potion", "healing_amount": 20}


class TestAreaMap:
    def test_location_page_moves_through_the_map(self, client):
        town = CAMPAIGN["acts"][0]["locations"][0]
        state = client.get("/api/state").json()
        assert state["area"]["id"] == "town_square" and state["area"]["danger"] == "safe"
        # Only areas one step away can be walked to
        assert [e["id"] for e in state["exits"]] == town["areas"][0]["connections"]
        refused(client.post("/api/move", json={"area_id": "inn_rooms"}), 400, "not_connected")
        assert load(client)["area_id"] == "town_square"

        response = client.post("/api/move", json={"area_id": "market"})
        assert response.status_code == 200
        assert load(client)["area_id"] == "market"
        market = response.json()["area"]
        assert market["id"] == "market" and market["has_shop"] and not market["can_rest"]
        assert "town_square" in [e["id"] for e in response.json()["exits"]]

        client.post("/api/move", json={"area_id": "town_square"})
        tavern = client.post("/api/move", json={"area_id": "tavern"}).json()["area"]
        assert tavern["can_rest"] and not tavern["has_shop"]


class TestInventory:
    def test_drinking_a_potion_heals_and_consumes_it(self, client):
        patch(client, char_inventory=[POTION, POTION], char_current_hit_points=1)
        response = client.post("/api/inventory/use", json={"item_index": 0})
        assert response.status_code == 200
        char = load(client)["character"]
        assert char["current_hit_points"] == min(char["max_hit_points"], 21)
        assert len(char["inventory"]) == 1
        assert "recover" in response.json()["message"]
        assert response.json()["state"]["character"]["current_hit_points"] == char["current_hit_points"]

    def test_potion_is_kept_at_full_health(self, client):
        patch(client, char_inventory=[POTION])
        response = client.post("/api/inventory/use", json={"item_index": 0})
        refused(response, 409, "full_health")
        assert len(load(client)["character"]["inventory"]) == 1
        assert "already at full health" in response.json()["message"]

    def test_only_potions_can_be_used(self, client):
        patch(client, char_inventory=[{"name": "Dagger", "type": "weapon"}], char_current_hit_points=1)
        refused(client.post("/api/inventory/use", json={"item_index": 0}), 404, "no_such_item")
        refused(client.post("/api/inventory/use", json={"item_index": 7}), 404, "no_such_item")
        char = load(client)["character"]
        assert char["current_hit_points"] == 1 and len(char["inventory"]) == 1

    def test_identical_potions_are_stacked(self, client):
        patch(client, char_inventory=[POTION, POTION, POTION])
        items = client.get("/api/character").json()["inventory"]["items"]
        assert len(items) == 1
        assert items[0]["name"] == "Healing Potion" and items[0]["count"] == 3

    def test_gear_is_compared_with_what_is_equipped(self, client):
        patch(client, char_inventory=[
            {"name": "Greatsword", "type": "weapon"}, {"name": "Dagger", "type": "weapon"},
            {"name": "Leather", "type": "armor"}])
        view = client.get("/api/character").json()["inventory"]
        compare = {item["name"]: item["compare"] for item in view["items"]}
        # 2d6 against the Longsword's 1d8
        assert compare["Greatsword"] == {"cls": "better", "text": "+2.5 avg damage"}
        assert compare["Dagger"] == {"cls": "worse", "text": "-2 avg damage"}
        assert compare["Leather"]["cls"] == "worse" and compare["Leather"]["text"].endswith(" AC")
        # Previewing armor must not change what is worn
        assert load(client)["character"]["armor"] == "Chain Mail"
        assert view["armor"]["name"] == "Chain Mail"


class TestAbilitySummary:
    def test_damage_scales_with_level(self):
        strike = ABILITIES["power_strike"]
        assert summarize_ability(strike, 1) == ["1d8 + mod slashing"]
        assert summarize_ability(strike, 5) == ["2d8 + mod slashing"]

    def test_heal_and_effects_are_listed(self):
        assert summarize_ability(ABILITIES["second_wind"], 1) == ["Heal 1d10 + level"]
        assert summarize_ability(ABILITIES["rallying_cry"], 4) == [
            "Heal 1d6 + mod", "Self: damage bonus +2, whole fight"]

    @pytest.mark.parametrize("ability_id", sorted(ABILITIES))
    def test_every_ability_has_a_summary(self, ability_id):
        assert summarize_ability(ABILITIES[ability_id], 20)


class TestBattleScreen:
    def test_abilities_and_stacked_items_have_hotkeys(self, client):
        patch(client, char_inventory=[POTION, POTION],
              char_current_hit_points=10_000, char_max_hit_points=10_000)
        goto(client, 1, "Whispering Woods", "clearing")
        start_fight(client)
        view = client.get("/api/battle").json()["battle"]
        strike = view["abilities"][0]
        assert strike["id"] == "power_strike" and strike["hotkey"] == "1"
        assert strike["summary"] == ["1d8 + mod slashing"]
        assert len(view["items"]) == 1
        assert view["items"][0]["count"] == 2 and view["items"][0]["hotkey"] == "q"
        assert view["monster"]["race"] in ("Goblin", "Orc") and view["monster"]["hp"] > 0

    def test_victory_rewards_survive_a_refresh(self, client):
        goto(client, 1, "Whispering Woods", "clearing")
        patch(client, char_current_hit_points=10_000, char_max_hit_points=10_000)
        start_fight(client)
        data = load(client)
        data["battle"]["monster"]["hp"] = 1
        patch(client, battle=data["battle"])
        for _ in range(60):
            answer = client.post("/api/battle/attack", json={}).json()
            if answer["battle"]["phase"] != "fight":
                break
        assert answer["battle"]["phase"] == "victory"
        assert answer["battle"]["rewards"]["xp"] > 0
        again = client.get("/api/battle").json()
        assert again["battle"]["phase"] == "victory"
        assert again["battle"]["rewards"] == answer["battle"]["rewards"]
        assert again["state"]["character"]["xp"] == answer["state"]["character"]["xp"] > 0


class TestCharacterCreation:
    def test_class_cards_show_playstyle_and_abilities(self, client):
        classes = {entry["name"]: entry for entry in client.get("/api/creation").json()["classes"]}
        for class_name, props in game_session.get_classes().items():
            assert classes[class_name]["playstyle"] == props["playstyle"]
        names = [ability["name"] for ability in classes["Fighter"]["abilities"]]
        assert "Power Strike" in names and "Champion's Blow" in names

    def test_details_preview_shows_final_numbers(self, client):
        response = client.get("/api/creation/preview", params={"race": "Human", "class_name": "Monk"})
        assert response.status_code == 200
        preview = response.json()
        assert preview["power_points"] > 0 and preview["hit_points"] > 0
        # Monk's Unarmored Defense is part of the previewed AC
        assert preview["unarmored_ac"] == 10 + 2 + 1
        created = client.post("/api/new-game", json={
            "race": "Human", "class_name": "Monk", "name": "Preview", "weapon": "Quarterstaff", "armor": None})
        assert created.status_code == 200
        character = load(client)["character"]
        assert preview["unarmored_ac"] == character["armor_class"]
        assert preview["hit_points"] == character["max_hit_points"]
        assert preview["power_points"] == character["max_power_points"]
