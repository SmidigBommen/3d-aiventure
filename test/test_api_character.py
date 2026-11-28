"""Inventory, character sheet and rest in the 3D world: /api/character, /api/inventory/*, /api/rest.
A route must do to the session what its shared function does."""

import copy
import json
import os
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from engine.abilities import summarize_ability
from engine.leveling import ABILITIES, ASI_LEVELS
from skills import SKILLS, calculate_skill_modifier
import web.game_session as game_session
from web.app import app
from web.game_session import GameSession
from web import creation, fight, inventory, save_manager, sheet, world

CAMPAIGN = game_session.get_campaign()
CLASSES = game_session.get_classes()
AREAS = [(act["number"], loc["name"], area)
         for act in CAMPAIGN["acts"] for loc in act["locations"] for area in loc["areas"]]
REST_AREAS = [(n, loc, a["id"]) for n, loc, a in AREAS if world.can_rest(a)]
OTHER_AREAS = [(n, loc, a["id"]) for n, loc, a in AREAS if not world.can_rest(a)]
WEAPONS = sorted(game_session.get_all_weapons_flat())
ARMORS = sorted(game_session.get_all_armors_flat())
SEEDS = range(int(os.environ.get("AIV_PARITY_SEEDS", "100")))
POSTS = ("/api/character/improve", "/api/inventory/use", "/api/inventory/equip-weapon",
         "/api/inventory/equip-armor", "/api/inventory/unequip-weapon", "/api/inventory/unequip-armor",
         "/api/rest")
VALID = {"/api/character/improve": {"ability": "strength"}, "/api/inventory/use": {"item_index": 0},
         "/api/inventory/equip-weapon": {"item_index": 0}, "/api/inventory/equip-armor": {"item_index": 0}}
STATUS = {"no_such_item": 404, "no_such_ability": 404}
REST_MESSAGE = "You rest. Hit points and power points are restored."


@pytest.fixture
def client(tmp_path, monkeypatch):
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(game_session, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(save_manager, "SAVES_DIR", tmp_path / "saves")
    with TestClient(app) as c:
        c.sessions_dir = sessions
        assert c.post("/api/new-game", json={
            "race": "Human", "class_name": "Fighter", "name": "Tester", "weapon": "Longsword",
            "armor": "Chain Mail", "portrait": creation.PORTRAITS[0]["path"],
            "skills": ["Athletics", "Perception"],
        }).status_code == 200
        yield c


def session_file(client):
    files = list(client.sessions_dir.glob("*.json"))
    assert len(files) == 1
    return files[0]


def read(client):
    return json.loads(session_file(client).read_text())


def write(client, data):
    """Write the session normalised and return the text."""
    text = json.dumps(GameSession.from_dict(data).to_dict())
    text = json.dumps(GameSession.from_dict(json.loads(text)).to_dict())
    session_file(client).write_text(text)
    return text


def edit(client, change):
    data = read(client)
    change(data)
    return write(client, data)


def place(data, where):
    number, location, area_id = where
    data["act_num"], data["location_name"], data["area_id"] = number, location, area_id


def seeded(client, seed):
    """A session from a seed: class, race, level, hit points, spent points, gear, backpack, place."""
    rng = random.Random(seed)
    data = read(client)
    creation, character = data["character_creation"], data["character"]
    creation["class_name"] = rng.choice(sorted(CLASSES))
    creation["race"] = rng.choice(sorted(game_session.get_races()))
    creation["weapon"] = rng.choice(WEAPONS + [None])
    creation["armor"] = rng.choice(ARMORS + [None])
    character["class_name"], character["race"] = creation["class_name"], creation["race"]
    character["level"] = rng.randint(1, 20)
    character["max_hit_points"] = rng.randint(10, 200)
    character["current_hit_points"] = (character["max_hit_points"] if rng.random() < 0.3
                                       else rng.randint(1, character["max_hit_points"]))
    character["ability_increases"] = {}
    inventory = []
    for _ in range(rng.randint(0, 10)):
        kind = rng.choice(("weapon", "armor", "potion", "potion", "quest"))
        if kind == "weapon":
            inventory.append({"name": rng.choice(WEAPONS), "type": "weapon"})
        elif kind == "armor":
            inventory.append({"name": rng.choice(ARMORS), "type": "armor"})
        elif kind == "potion":
            inventory.append(rng.choice((
                {"name": "Small Healing Potion", "type": "potion", "healing_amount": 10},
                {"name": "Medium Healing Potion", "type": "potion", "healing_amount": 25})))
        else:
            n = rng.randint(1, 2)
            inventory.append({"name": f"Wolf Pelt {n}", "description": "A pelt.", "type": "quest_item",
                              "quest_id": f"q{n}"})
    character["inventory"] = inventory
    place(data, rng.choice(REST_AREAS) if rng.random() < 0.5 else rng.choice(OTHER_AREAS))
    data["battle"]["is_active"] = False
    data["pending_event"] = data["event_result"] = None

    # Spend between none and all of the earned points, never above 20; some seeds push one score to 20.
    base = GameSession.from_dict(copy.deepcopy(data)).serialize_character()
    earned = 2 * sum(1 for level in ASI_LEVELS if character["level"] >= level)
    to_spend = rng.randint(0, earned)
    increases = {}
    favourite = rng.choice(ABILITIES) if rng.random() < 0.4 else None
    for _ in range(to_spend):
        ability = favourite or rng.choice(ABILITIES)
        if base[f"{ability}_score"] + increases.get(ability, 0) >= 20:
            favourite = None
            continue
        increases[ability] = increases.get(ability, 0) + 1
    character["ability_increases"] = increases
    return write(client, data)


FUNCTIONS = {
    "/api/inventory/use": inventory.use_potion,
    "/api/inventory/equip-weapon": inventory.equip_weapon,
    "/api/inventory/equip-armor": inventory.equip_armor,
    "/api/inventory/unequip-weapon": inventory.unequip_weapon,
    "/api/inventory/unequip-armor": inventory.unequip_armor,
    "/api/character/improve": sheet.improve,
    "/api/rest": world.rest,
}


def actions(length):
    made = []
    for route in ("use", "equip-weapon", "equip-armor"):
        for index in range(-1, length + 1):
            made.append((f"/api/inventory/{route}", {"item_index": index}))
    made += [("/api/inventory/unequip-weapon", {}), ("/api/inventory/unequip-armor", {})]
    made += [("/api/character/improve", {"ability": ability}) for ability in (*ABILITIES, "luck")]
    made.append(("/api/rest", {}))
    return made


def through_function(text, route, fields):
    """What the shared function of `route` does to the session `text`: the session after, the line, the refusal."""
    session = GameSession.from_dict(json.loads(text))
    try:
        message = FUNCTIONS[route](session, *fields.values())
    except fight.Rejected as rejection:
        return session.to_dict(), None, rejection
    return session.to_dict(), message, None


def test_parity_refusals_and_successes(client):
    seen = set()
    for seed in SEEDS:
        s0 = seeded(client, seed)
        path = session_file(client)
        length = len(json.loads(s0)["character"]["inventory"])
        for route, fields in actions(length):
            a, message, rejection = through_function(s0, route, fields)
            path.write_text(s0)
            response = client.post(route, json=fields)
            b = path.read_text()
            where = (seed, route, fields)
            assert a == json.loads(b), where
            assert (response.status_code == 200) is (rejection is None), where
            body = response.json()
            if response.status_code == 200:
                assert set(body) == {"inventory", "sheet", "state", "message"}, where
                assert isinstance(body["message"], str) and body["message"] == message, where
                again = client.get("/api/character").json()
                assert again == {**body, "message": None}, where
            else:
                assert body == {"error": rejection.code, "message": rejection.message}, where
                assert response.status_code == STATUS.get(body["error"], 409), where
                assert b == s0, where
                assert a == json.loads(s0), where
                code = body["error"]
                if code == "not_proficient":
                    code += route
                seen.add(code)
    if len(SEEDS) >= 100:
        assert seen >= {"no_such_item", "full_health", "not_a_weapon", "not_armor",
                        "not_proficient/api/inventory/equip-weapon", "not_proficient/api/inventory/equip-armor",
                        "nothing_equipped", "no_such_ability", "no_points", "score_at_cap", "cannot_rest"}


def test_views_match_the_session(client):
    for seed in SEEDS:
        s0 = seeded(client, seed)
        body = client.get("/api/character").json()
        assert session_file(client).read_text() == s0
        session = GameSession.from_dict(json.loads(s0))
        shown = session.serialize_character()
        assert body["inventory"]["items"] == inventory.annotated_items(session, session.serialize_character())
        assert body["inventory"]["weapon"] == shown["weapon_details"]
        assert body["inventory"]["armor"] == shown["armor_details"]
        assert body["inventory"]["armor_class"] == shown["armor_class"] == session.character.armor_class

        sheet = body["sheet"]
        character = session.character
        serialized = session.serialize_character()
        props = CLASSES[character.class_name]
        expected = {key: serialized[key] for key in (
            "name", "race", "class_name", "level", "portrait", "xp", "xp_to_next_level", "gold",
            "current_hit_points", "max_hit_points", "power_points", "max_power_points", "armor_class",
            "weapon", "armor", "asi_points", "ability_score_cap",
            *(f"{a}_{part}" for a in ABILITIES for part in ("score", "modifier")))}
        expected.update({
            "primary_ability": props.get("primary_ability", "").lower(),
            "unarmored_defense": (props.get("unarmored_defense") or "").lower(),
            "improvable": [a for a in ABILITIES if serialized[f"{a}_score"] < 20]
                          if serialized["asi_points"] > 0 else [],
            "proficiency_bonus": character.proficiency_bonus,
            "weapon_proficiencies": props.get("weapon_proficiencies", []),
            "armor_training": props.get("armor_training", []),
            "saving_throws": [s.lower() for s in props.get("saving_throw_proficiencies", [])],
            "save_modifiers": game_session.get_save_modifiers(character),
            "skills": [{"name": name, "ability": ability.lower(),
                        "modifier": calculate_skill_modifier(character, name),
                        "proficient": character.has_skill_proficiency(name)}
                       for name, ability in SKILLS.items()],
            "abilities": [{"id": a["id"], "name": a["name"], "description": a.get("description", ""),
                           "cost": a["cost"], "unlock_level": a["unlock_level"],
                           "summary": summarize_ability(a, character.level)}
                          for a in game_session.get_class_abilities(character.class_name, character.level)],
        })
        attack = sheet["attack"]
        assert {key: sheet[key] for key in expected} == expected, seed
        assert set(sheet) == set(expected) | {"attack"}
        assert len(sheet["skills"]) == 18
        assert attack["bonus"] == attack["damage_modifier"] + character.proficiency_bonus
        if serialized["weapon_details"]:
            details = serialized["weapon_details"]
            assert attack["weapon"] == details["name"]
            assert attack["damage_dice"] == f"{details['damage_dice_count']}d{details['damage_die']}"
            assert attack["damage_type"] == details["damage_type"]
        else:
            assert attack == {"weapon": "Unarmed Strike", "bonus": character.strength_modifier + character.proficiency_bonus,
                              "damage_dice": "1d4", "damage_modifier": character.strength_modifier,
                              "damage_type": "bludgeoning"}


def test_equip_shows_at_once(client):
    def change(data):
        data["character"]["inventory"] = [{"name": "Greatsword", "type": "weapon"}, {"name": "Leather", "type": "armor"}]
    edit(client, change)
    body = client.post("/api/inventory/equip-weapon", json={"item_index": 0}).json()
    assert body["message"] == "Equipped Greatsword."
    assert body["sheet"]["attack"]["weapon"] == "Greatsword"
    assert body["sheet"]["attack"]["damage_dice"] == "2d6"
    assert body["inventory"]["weapon"]["name"] == "Greatsword"
    assert "Longsword" in [item["name"] for item in body["inventory"]["items"]]

    index = next(item["index"] for item in body["inventory"]["items"] if item["name"] == "Leather")
    body = client.post("/api/inventory/equip-armor", json={"item_index": index}).json()
    saved = GameSession.from_dict(read(client)).character.armor_class
    assert body["sheet"]["armor_class"] == body["inventory"]["armor_class"] == saved
    assert body["inventory"]["armor"]["name"] == "Leather"

    body = client.post("/api/inventory/unequip-armor").json()
    saved = GameSession.from_dict(read(client)).character.armor_class
    assert body["message"] == "Unequipped Leather."
    assert body["sheet"]["armor_class"] == body["inventory"]["armor_class"] == saved
    assert body["inventory"]["armor"] is None
    assert client.post("/api/inventory/unequip-armor", json={}).json()["error"] == "nothing_equipped"


def test_potion(client):
    def change(data):
        data["character"]["current_hit_points"] = data["character"]["max_hit_points"] - 4
        data["character"]["inventory"] = [
            {"name": "Small Healing Potion", "type": "potion", "healing_amount": 10}] * 2
    edit(client, change)
    body = client.post("/api/inventory/use", json={"item_index": 0}).json()
    assert body["message"] == "You drink the Small Healing Potion and recover 4 HP."
    character = body["state"]["character"]
    assert character["current_hit_points"] == character["max_hit_points"]
    assert [item["count"] for item in body["inventory"]["items"]] == [1]
    before = session_file(client).read_text()
    response = client.post("/api/inventory/use", json={"item_index": 0})
    assert (response.status_code, response.json()) == (
        409, {"error": "full_health", "message": "You are already at full health."})
    assert session_file(client).read_text() == before


def test_ability_points(client):
    edit(client, lambda data: data["character"].update(level=4, ability_increases={}))
    body = client.get("/api/character").json()
    assert body["state"]["asi_points"] == body["sheet"]["asi_points"] == 2
    score = body["sheet"]["strength_score"]
    body = client.post("/api/character/improve", json={"ability": "strength"}).json()
    assert body["sheet"]["strength_score"] == score + 1
    assert body["sheet"]["asi_points"] == body["state"]["asi_points"] == 1
    assert body["message"].startswith(f"Strength is now {score + 1}")
    body = client.post("/api/character/improve", json={"ability": "Strength"}).json()
    assert body["sheet"]["strength_score"] == score + 2
    assert body["sheet"]["improvable"] == []
    response = client.post("/api/character/improve", json={"ability": "strength"})
    assert (response.status_code, response.json()["error"]) == (409, "no_points")


def test_constitution_adds_hit_points(client):
    def change(data):
        data["character"].update(level=4, ability_increases={})
    edit(client, change)
    before = client.get("/api/character").json()["sheet"]
    body = client.post("/api/character/improve", json={"ability": "constitution"}).json()
    if before["constitution_score"] % 2 == 0:
        body = client.post("/api/character/improve", json={"ability": "constitution"}).json()
    assert body["sheet"]["max_hit_points"] == before["max_hit_points"] + 4
    assert body["sheet"]["current_hit_points"] == before["current_hit_points"] + 4
    assert body["message"].endswith(", +4 max HP.")


@pytest.mark.parametrize("where", REST_AREAS)
def test_rest(client, where):
    def change(data):
        place(data, where)
        data["character"].update(current_hit_points=1, power_points=0, active_effects=[
            {"stat": "ac", "value": 2, "duration": 0, "source": "Test"}])
    edit(client, change)
    response = client.post("/api/rest")
    assert response.status_code == 200
    body = response.json()
    character = body["state"]["character"]
    assert character["current_hit_points"] == character["max_hit_points"]
    assert character["power_points"] == character["max_power_points"]
    assert read(client)["character"]["active_effects"] == []
    assert body["message"] == REST_MESSAGE


def test_three_rest_areas_and_no_rest_elsewhere(client):
    assert sorted(f"{loc}/{area}" for _, loc, area in REST_AREAS) == [
        "Rivermeet Town/inn_rooms", "Rivermeet Town/tavern", "The Crystalline Caves/meditation_grove"]
    before = edit(client, lambda data: place(data, OTHER_AREAS[0]))
    assert client.get("/api/state").json()["area"]["can_rest"] is False
    response = client.post("/api/rest")
    assert (response.status_code, response.json()) == (
        409, {"error": "cannot_rest", "message": "There is nowhere to rest here."})
    assert session_file(client).read_text() == before


def test_no_character(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    refusal = {"error": "no_character", "message": "You have no character yet. Start a new game first."}
    with TestClient(app) as c:
        assert (c.get("/api/character").status_code, c.get("/api/character").json()) == (409, refusal)
        for path in POSTS:
            response = c.post(path, json=VALID.get(path, {}))
            assert (response.status_code, response.json()) == (409, refusal)
            assert c.post(path, content=b"[1]").json() == refusal
    assert list(tmp_path.glob("*.json")) == []


BAD_BODIES = [b"[1]", b'"x"', b'{"item_index": NaN}', b'{"a": 1, "a": 1}', b"\xff\xfe"]
BAD_FIELDS = [b"{}", b'{"item_index": "0"}', b'{"item_index": true}', b'{"item_index": 1.5}', b'{"ability": 3}']


def pending_setups():
    return {
        "battle": lambda data: data["battle"].update(is_active=True),
        "defeat": lambda data: data["character"].update(current_hit_points=0),
        "event": lambda data: data.update(pending_event="abandoned_chest"),
    }


@pytest.mark.parametrize("kind", [None, "battle", "defeat", "event"])
def test_bodies_and_pending(client, kind):
    def change(data):
        place(data, REST_AREAS[0])
        data["character"]["inventory"] = [{"name": "Small Healing Potion", "type": "potion", "healing_amount": 10}]
        if kind:
            pending_setups()[kind](data)
    before = edit(client, change)
    bad = {"error": "bad_request", "message": "That is not something you can do here."}
    for path in POSTS:
        bodies = BAD_BODIES + (BAD_FIELDS if path in VALID else [])
        for raw in bodies:
            response = client.post(path, content=raw, headers={"content-type": "application/json"})
            assert (response.status_code, response.json()) == (400, bad), (path, raw)
        if kind:
            response = client.post(path, json=VALID.get(path, {}))
            assert response.status_code == 409, path
            assert response.json() == {"error": "pending",
                                       "message": __import__("web.api.world", fromlist=["x"]).PENDING_MESSAGES[kind]}
        assert session_file(client).read_text() == before, path
    assert client.get("/api/character").status_code == 200
    assert session_file(client).read_text() == before


def test_reading_writes_nothing(client):
    before = edit(client, lambda data: None)
    body = client.get("/api/character").json()
    assert set(body) == {"inventory", "sheet", "state", "message"} and body["message"] is None
    assert set(body["inventory"]) == {"weapon", "armor", "armor_class", "items"}
    assert session_file(client).read_text() == before
    state = client.get("/api/state").json()
    assert state["asi_points"] == 0
    assert set(state["character"]) == set(world.CHARACTER_KEYS) and len(world.CHARACTER_KEYS) == 11
    assert session_file(client).read_text() == before
