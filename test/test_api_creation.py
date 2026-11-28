"""Character creation in the 3D client: /api/creation, /api/creation/preview, /api/new-game.
Both interfaces must make the same character and refuse the same input."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

import web.game_session as game_session
from web import creation
from web.app import app

RACES = game_session.get_races()
CLASSES = game_session.get_classes()
WEAPONS = game_session.get_all_weapons_flat()
ARMORS = game_session.get_all_armors_flat()
CAMPAIGN = game_session.get_campaign()
ABILITIES = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
PATHS = [p["path"] for p in creation.PORTRAITS]
VALID = {"race": "Human", "class_name": "Fighter", "name": "Tester", "weapon": "Longsword",
         "armor": "Chain Mail", "portrait": PATHS[0], "skills": ["Athletics", "Perception"]}


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    return tmp_path


def only_file(folder):
    files = list(folder.glob("*.json"))
    assert len(files) == 1
    return files[0]


def classic(sessions, body):
    """The session file and the sheet the classic routes make for `body`."""
    with TestClient(app) as c:
        before = set(sessions.glob("*.json"))
        c.post("/character/race", data={"race": body["race"]})
        c.post("/character/class", data={"class_name": body["class_name"]})
        c.post("/character/create", data={
            "name": body["name"], "weapon": body["weapon"], "armor": body.get("armor") or "",
            "portrait": body["portrait"], "skills": body["skills"]}, follow_redirects=False)
        files = set(sessions.glob("*.json")) - before
        data = json.loads(files.pop().read_text()) if files else None
        return data, c.get("/api/character").json(), c.get("/api/state").json()


def through_api(sessions, body):
    with TestClient(app) as c:
        before = set(sessions.glob("*.json"))
        answer = c.post("/api/new-game", json=body)
        files = set(sessions.glob("*.json")) - before
        data = json.loads(files.pop().read_text()) if files else None
        return answer, data, c.get("/api/character").json(), c.get("/api/state").json()


def without_id(data):
    return {k: v for k, v in data.items() if k != "session_id"}


def combinations(view):
    for cls in view["classes"]:
        weapons = [w["name"] for w in cls["weapons"]]
        armors = [a["name"] for a in cls["armors"]]
        skills = cls["skill_choices"][:cls["num_skills"]]
        picks = [(w, armors[0] if armors else None) for w in weapons] + [(weapons[0], a) for a in armors + [None]]
        for weapon, armor in picks:
            yield cls["name"], weapon, armor, skills


def test_creation_data(sessions):
    with TestClient(app) as c:
        view = c.get("/api/creation").json()
        assert not list(sessions.glob("*.json"))
    assert [r["name"] for r in view["races"]] == list(RACES)
    assert len(view["races"]) == len(RACES) and len(view["classes"]) == 12
    for race in view["races"]:
        assert race["bonuses"] == {a: RACES[race["name"]][f"{a}_bonus"] for a in ABILITIES}
    assert view["races"][1]["bonus_display"] == "+2 CON"
    assert [c["name"] for c in view["classes"]] == list(CLASSES)
    abilities = game_session.get_abilities()
    for cls in view["classes"]:
        props = CLASSES[cls["name"]]
        prof = props["weapon_proficiencies"]
        assert [w["name"] for w in cls["weapons"]] == [
            n for n, w in WEAPONS.items()
            if (w["category"] == "Simple" and "Simple" in prof) or (w["category"] == "Martial" and "Martial" in prof) or n in prof]
        assert [a["name"] for a in cls["armors"]] == [n for n, a in ARMORS.items() if a["category"] in props["armor_training"]]
        assert cls["weapons"], cls["name"]
        assert cls["skill_choices"] == props["skill_proficiency_choices"]
        assert cls["num_skills"] == props["num_skill_choices"]
        assert cls["primary_ability"] == props["primary_ability"].lower()
        assert cls["saving_throws"] == [s.lower() for s in props["saving_throw_proficiencies"]]
        mine = sorted(((a["unlock_level"], a["cost"]), i) for i, a in abilities.items() if cls["name"] in a["classes"])
        assert [(a["unlock_level"], a["cost"]) for a in cls["abilities"]] == [k for k, _ in mine]
        assert sorted(a["id"] for a in cls["abilities"]) == sorted(i for _, i in mine)
    assert view["portraits"] == creation.PORTRAITS
    assert view["name_max"] == 30
    act = CAMPAIGN["acts"][0]
    assert view["opening"] == {
        "campaign": {"title": CAMPAIGN["title"], "description": CAMPAIGN["description"]},
        "act": {"number": 1, "title": act["title"], "description": act["description"], "main_quest": act["mainQuest"]}}


def test_same_character_through_both_interfaces(sessions):
    with TestClient(app) as c:
        view = c.get("/api/creation").json()
    count = 0
    for race in RACES:
        for class_name, weapon, armor, skills in combinations(view):
            body = {"race": race, "class_name": class_name, "name": "Tester", "weapon": weapon, "armor": armor,
                    "portrait": PATHS[count % 3], "skills": skills}
            count += 1
            answer, made, sheet, state = through_api(sessions, body)
            assert answer.status_code == 200, (body, answer.text)
            old, old_sheet, old_state = classic(sessions, body)
            assert without_id(made) == without_id(old), body
            assert sheet == old_sheet
            assert answer.json()["state"] == state == old_state
            assert answer.json()["opening"] == creation.opening()
            assert made["character_creation"]["skills"] == skills
            for path in sessions.glob("*.json"):
                path.unlink()
    assert count > len(RACES) * 12


def test_preview_equals_the_result(sessions):
    with TestClient(app) as c:
        view = c.get("/api/creation").json()
        for race in RACES:
            for cls in view["classes"]:
                preview = c.get("/api/creation/preview", params={"race": race, "class_name": cls["name"]}).json()
                assert [a["name"] for a in preview["armors"]] == [a["name"] for a in cls["armors"]]
                assert [s["name"] for s in preview["scores"] if s["primary"]] == [cls["primary_ability"]]
                assert preview["starting_abilities"] == [a["name"] for a in game_session.get_class_abilities(cls["name"], 1)]
                for armor, ac in [(None, preview["unarmored_ac"])] + [(a["name"], a["total_ac"]) for a in preview["armors"]]:
                    body = {"race": race, "class_name": cls["name"], "name": "T", "weapon": cls["weapons"][0]["name"], "armor": armor}
                    with TestClient(app) as fresh:
                        assert fresh.post("/api/new-game", json=body).status_code == 200
                        char = fresh.get("/api/character").json()["sheet"]
                    made = json.loads(max(sessions.glob("*.json"), key=lambda p: p.stat().st_mtime_ns).read_text())["character"]
                    assert made["armor_class"] == ac, body
                    assert made["max_hit_points"] == preview["hit_points"]
                    assert made["max_power_points"] == preview["power_points"]
                    for score in preview["scores"]:
                        assert made[f"{score['name']}_score"] == score["score"]
                        assert made[f"{score['name']}_modifier"] == score["modifier"]
                    assert char
        assert c.get("/api/creation/preview").json()["error"] == "unknown_race"
        assert c.get("/api/creation/preview", params={"race": "Human"}).json()["error"] == "unknown_class"
        refused = c.get("/api/creation/preview", params={"race": "Orc?", "class_name": "Nope"})
        assert (refused.status_code, refused.json()["error"]) == (400, "unknown_race")


REFUSED = [
    ({"race": "Martian"}, "unknown_race"),
    ({"class_name": "Plumber"}, "unknown_class"),
    ({"name": ""}, "bad_name"),
    ({"name": "   "}, "bad_name"),
    ({"name": "x" * 31}, "bad_name"),
    ({"weapon": "Banana"}, "bad_weapon"),
    ({"class_name": "Wizard", "weapon": "Longsword", "armor": None, "skills": []}, "bad_weapon"),
    ({"armor": "Tinfoil"}, "bad_armor"),
    ({"class_name": "Wizard", "weapon": "Dagger", "armor": "Chain Mail", "skills": []}, "bad_armor"),
    ({"portrait": "/static/images/nobody.png"}, "bad_portrait"),
    ({"skills": ["Athletics", "Perception", "History"]}, "bad_skills"),
    ({"skills": ["Arcana"]}, "bad_skills"),
    ({"skills": ["Athletics", "Athletics"]}, "bad_skills"),
    ({"race": "Martian", "class_name": "Plumber", "name": ""}, "unknown_race"),
    ({"class_name": "Plumber", "name": "", "weapon": "Banana"}, "unknown_class"),
    ({"name": "", "weapon": "Banana", "armor": "Tinfoil"}, "bad_name"),
    ({"weapon": "Banana", "armor": "Tinfoil", "portrait": "x"}, "bad_weapon"),
    ({"armor": "Tinfoil", "portrait": "x", "skills": ["Arcana"]}, "bad_armor"),
    ({"portrait": "x", "skills": ["Arcana"]}, "bad_portrait"),
]


@pytest.mark.parametrize("change,code", REFUSED)
def test_invalid_input_is_refused_in_both(sessions, change, code):
    body = {**VALID, **change}
    answer, made, _, state = through_api(sessions, body)
    assert (answer.status_code, answer.json()["error"]) == (400, code)
    assert answer.json()["message"]
    assert made is None and state["has_character"] is False
    _, _, old_state = classic(sessions, body)
    assert old_state["has_character"] is False


@pytest.mark.parametrize("raw", [
    "[]", "7", '"x"', "{", "null",
    *(json.dumps({k: v for k, v in VALID.items() if k != gone}) for gone in ("race", "class_name", "name", "weapon")),
    json.dumps({**VALID, "skills": "Athletics"}), json.dumps({**VALID, "skills": [1]}),
    json.dumps({**VALID, "skills": None}), json.dumps({**VALID, "name": 5}),
    json.dumps({**VALID, "armor": 3}), json.dumps({**VALID, "portrait": []}),
])
def test_bad_request(sessions, raw):
    with TestClient(app) as c:
        answer = c.post("/api/new-game", content=raw, headers={"Content-Type": "application/json"})
        assert (answer.status_code, answer.json()["error"]) == (400, "bad_request")
        assert not list(sessions.glob("*.json"))


def test_accepted_edges(sessions):
    for change in ({"name": "x" * 30}, {"skills": []}, {"skills": ["Athletics"]}, {"armor": ""}):
        body = {**VALID, **change}
        answer, made, _, _ = through_api(sessions, body)
        assert answer.status_code == 200
        old, _, _ = classic(sessions, body)
        assert without_id(made) == without_id(old)
    minimal = {k: VALID[k] for k in ("race", "class_name", "name", "weapon")}
    answer, made, _, _ = through_api(sessions, minimal)
    assert answer.status_code == 200
    assert made["character_creation"]["portrait"] == PATHS[0]
    assert made["character_creation"]["armor"] is None and made["character_creation"]["skills"] == []
    answer, made, _, _ = through_api(sessions, {**VALID, "name": " Sp ace "})
    assert made["character"]["name"] == " Sp ace "


def test_a_refusal_changes_nothing_and_new_game_starts_clean(sessions):
    with TestClient(app) as c:
        assert c.post("/api/new-game", json=VALID).status_code == 200
        path = only_file(sessions)
        clean = json.loads(path.read_text())
        data = dict(clean)
        data.update(defeated_bosses=["goblin_king"], monster_kills=7, act_num=1, location_name="Whispering Woods",
                    area_id="entrance", active_quests={"goblin_menace": {"progress": 1, "status": "active"}},
                    area_contents={"location": "Whispering Woods", "area_id": "entrance", "seq": 1, "event": None,
                                   "monster": {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1,
                                               "name": "Grak", "weapon": "Club"}})
        path.write_text(json.dumps(data))
        assert c.post("/api/engage", json={"id": "planted-1"}).status_code == 200
        assert c.get("/api/state").json()["pending"]["kind"] == "battle"
        before = path.read_bytes()
        for change, _ in REFUSED:
            assert c.post("/api/new-game", json={**VALID, **change}).status_code == 400
        assert c.post("/api/new-game", content="[]").status_code == 400
        assert path.read_bytes() == before
        answer = c.post("/api/new-game", json=VALID)
        assert answer.status_code == 200
        assert json.loads(only_file(sessions).read_text()) == clean
        state = answer.json()["state"]
        assert state["pending"] is None and state["area"]["id"] == "town_square"
        assert state["location"]["name"] == "Rivermeet Town"


def test_classic_pages_still_answer(sessions):
    with TestClient(app) as c:
        assert c.get("/character/new").status_code == 200
        c.post("/character/race", data={"race": "Elf"})
        c.post("/character/class", data={"class_name": "Wizard"})
        page = c.get("/character/details")
        assert page.status_code == 200 and "Quarterstaff" in page.text and "Longsword" not in page.text
        refused = c.post("/character/create", data={"name": "W", "weapon": "Longsword"}, follow_redirects=False)
        assert (refused.status_code, refused.headers["location"]) == (303, "/character/details")
        done = c.post("/character/create", data={"name": "W", "weapon": "Quarterstaff"}, follow_redirects=False)
        assert (done.status_code, done.headers["location"]) == (303, "/character/summary")
        assert c.get("/character/summary").status_code == 200
