"""The save slots of the 3D client: /api/saves. The files are the ones the classic /saves page uses."""

import json
import random
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

pytest.importorskip("httpx")
from fastapi.testclient import TestClient

from dice import Dice
import web.game_session as game_session
from web import save_manager
from web.app import app
from web.game_session import GameSession

CAMPAIGN = game_session.get_campaign()
AREAS = [(act["number"], loc["name"], area["id"])
         for act in CAMPAIGN["acts"] for loc in act["locations"] for area in loc["areas"]]
GOBLIN = {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Grak", "weapon": "Club"}
VALID = {"race": "Human", "class_name": "Fighter", "name": "Tester", "weapon": "Longsword",
         "armor": "Chain Mail", "skills": ["Athletics", "Perception"]}


@pytest.fixture
def folders(tmp_path, monkeypatch):
    sessions, saves = tmp_path / "sessions", tmp_path / "saves"
    sessions.mkdir()
    monkeypatch.setattr(game_session, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(save_manager, "SAVES_DIR", saves)
    return sessions, saves


def new_client(sessions, body=VALID):
    """A client with a character, and the path of its session file."""
    client = TestClient(app)
    before = set(sessions.glob("*.json"))
    assert client.post("/api/new-game", json=body).status_code == 200
    (path,) = set(sessions.glob("*.json")) - before
    return client, path


def edit(path, change):
    data = json.loads(path.read_text())
    change(data)
    path.write_text(json.dumps(data))


def norm(data):
    return GameSession.from_dict(data).to_dict()


def snapshot(folder):
    return {p.name: p.read_bytes() for p in folder.glob("*.json")} if folder.exists() else {}


def refused(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"] == code and response.json()["message"]


def vary(rng, client, path, view):
    """Edits of plain session fields and real requests, drawn by `rng`."""
    act, location, area = rng.choice(AREAS)

    def change(d):
        c = d["character"]
        if rng.random() < 0.7:
            c["gold"] = rng.randrange(0, 900)
        if rng.random() < 0.5:
            c["level"] = rng.randrange(1, 9)
            c["max_hit_points"] = rng.randrange(10, 90)
            c["xp"] = rng.randrange(0, 200)
        if rng.random() < 0.5:
            c["current_hit_points"] = rng.randrange(1, c["max_hit_points"] + 1)
        if rng.random() < 0.6:
            d.update(act_num=act, location_name=location, area_id=area)
        if rng.random() < 0.4:
            d["defeated_bosses"] = rng.sample(list(game_session.get_bosses()), 2)
        if rng.random() < 0.4:
            d["active_quests"] = {"goblin_menace": {"progress": rng.randrange(3), "status": "active"}}
            d["completed_quests"] = ["goblin_ears"]
        d["monster_kills"] = rng.randrange(40)
        if rng.random() < 0.3:
            d["completed_events"] = ["abandoned_chest"]
            d["haggled_items"] = {"0": 0.8}

    edit(path, change)
    state = client.get("/api/state").json()
    if rng.random() < 0.5:
        client.post("/api/enter")
    if rng.random() < 0.5 and state["exits"]:
        client.post("/api/move", json={"area_id": rng.choice(state["exits"])["id"]})


def start_fight(client, path, monkeypatch):
    edit(path, lambda d: (d.update(act_num=1, location_name="Whispering Woods", area_id="entrance",
                                   area_contents={"location": "Whispering Woods", "area_id": "entrance", "seq": 1,
                                                  "monster": GOBLIN, "event": None}),
                          d["character"].update(max_hit_points=500, current_hit_points=500)))
    monkeypatch.setattr(Dice, "roll_d20", lambda: 2)   # everybody misses: the fight goes on
    assert client.post("/api/engage", json={"id": "planted-1"}).status_code == 200
    assert client.post("/api/battle/attack").status_code == 200
    assert json.loads(path.read_text())["battle"]["is_active"]


def test_round_trip_of_varied_sessions(folders, monkeypatch):
    sessions, saves = folders
    rng = random.Random(20261128)
    with TestClient(app) as c:
        view = c.get("/api/creation").json()
    for number in range(50):
        cls = rng.choice(view["classes"])
        body = {"race": rng.choice(view["races"])["name"], "class_name": cls["name"], "name": f"Hero {number}",
                "weapon": rng.choice(cls["weapons"])["name"],
                "armor": rng.choice([None] + [a["name"] for a in cls["armors"]]),
                "skills": rng.sample(cls["skill_choices"], cls["num_skills"])}
        client, path = new_client(sessions, body)
        fighting = number % 10 == 0
        if fighting:
            start_fight(client, path, monkeypatch)
            battle = client.get("/api/battle").json()
        else:
            vary(rng, client, path, view)
        saved = json.loads(path.read_text())
        state = client.get("/api/state").json()
        raw = path.read_bytes()
        answer = client.post("/api/saves")
        assert answer.status_code == 200 and answer.json()["message"] == "Game saved."
        save_id = answer.json()["save_id"]
        assert path.read_bytes() == raw
        assert save_id in [s["id"] for s in client.get("/api/saves").json()["saves"]]

        if fighting:
            assert client.post("/api/battle/attack").status_code == 200
        else:
            edit(path, lambda d: (d["character"].update(gold=12345), d.update(act_num=1, location_name="Rivermeet Town", area_id="docks")))
        before = set(sessions.glob("*.json"))
        answer = client.post(f"/api/saves/{save_id}/load")
        assert answer.status_code == 200 and answer.json()["message"] == "Game loaded."
        (current,) = set(sessions.glob("*.json")) - before
        loaded = json.loads(current.read_text())
        a, b = norm(loaded), norm(saved)
        for key in a:
            if key not in ("session_id", "_flash", "battle_rewards"):
                assert a[key] == b[key], (number, key)
        assert loaded["_flash"] == {} and loaded["battle_rewards"] is None
        assert loaded["session_id"] != saved["session_id"]
        assert answer.json()["state"] == state == client.get("/api/state").json()
        if fighting:
            assert client.get("/api/battle").json() == battle
            assert client.post("/api/battle/attack").status_code == 200
        (saves / f"{save_id}.json").unlink()
        client.close()


def test_slots(folders):
    sessions, saves = folders
    stranger = TestClient(app)
    assert stranger.get("/api/saves").json() == {"saves": [], "max_saves": 10, "can_save": False}
    refused(stranger.post("/api/saves"), 409, "no_character")
    assert not sessions.exists() or not list(sessions.glob("*.json"))
    client, path = new_client(sessions)
    edit(path, lambda d: d.update(act_num=1, location_name="Whispering Woods", area_id="entrance"))
    first = client.post("/api/saves").json()
    assert first["saves"]["can_save"] is True
    entry = first["saves"]["saves"][0]
    assert {k: entry[k] for k in ("id", "name", "level", "race", "class_name", "location", "portrait")} == {
        "id": first["save_id"], "name": "Tester", "level": 1, "race": "Human", "class_name": "Fighter",
        "location": "Whispering Woods", "portrait": "/static/images/player_fighter.png"}
    assert entry["saved_at"] == entry["created_at"] and len(entry["saved_at"]) == 19
    refused(stranger.post(f"/api/saves/{first['save_id']}"), 409, "no_character")

    for _ in range(9):
        assert client.post("/api/saves").status_code == 200
    kept = snapshot(saves)
    raw = path.read_bytes()
    refused(client.post("/api/saves"), 409, "slots_full")
    assert snapshot(saves) == kept and len(kept) == 10 and path.read_bytes() == raw

    # Overwriting still works in a full folder, keeps created_at and comes first in the list.
    time.sleep(1.1)
    edit(path, lambda d: (d["character"].update(gold=777), d["character_creation"].update(name="Second")))
    raw = path.read_bytes()
    answer = client.post(f"/api/saves/{first['save_id']}")
    assert answer.status_code == 200 and answer.json()["message"] == "Save updated."
    assert answer.json()["save_id"] == first["save_id"] and path.read_bytes() == raw
    listed = answer.json()["saves"]["saves"]
    assert len(listed) == 10 and listed[0]["id"] == first["save_id"] and listed[0]["name"] == "Second"
    assert listed[0]["created_at"] == entry["created_at"] and listed[0]["saved_at"] > entry["saved_at"]
    assert [s["saved_at"] for s in listed] == sorted((s["saved_at"] for s in listed), reverse=True)

    # Loading needs no character and leaves the save in place.
    loaded = stranger.post(f"/api/saves/{first['save_id']}/load")
    assert loaded.status_code == 200 and loaded.json()["state"]["character"]["gold"] == 777
    assert loaded.json()["saves"]["can_save"] is True
    assert stranger.get("/api/state").json()["character"]["name"] == "Second"
    assert (saves / f"{first['save_id']}.json").exists()

    gone = client.post(f"/api/saves/{first['save_id']}/delete")
    assert gone.status_code == 200 and gone.json()["message"] == "Save deleted."
    assert first["save_id"] not in [s["id"] for s in gone.json()["saves"]["saves"]]
    kept, raw = snapshot(saves), snapshot(sessions)
    for suffix in ("", "/load", "/delete"):
        refused(client.post(f"/api/saves/{first['save_id']}{suffix}"), 404, "no_such_save")
    other = next(iter(kept)).removesuffix(".json")
    for url in ("/api/saves", f"/api/saves/{other}", f"/api/saves/{other}/load", f"/api/saves/{other}/delete"):
        refused(client.post(url, content="[1]"), 400, "bad_request")
    (saves / "broken.json").write_text("{")
    refused(client.post("/api/saves/broken/load"), 404, "no_such_save")
    (saves / "broken.json").unlink()
    assert snapshot(saves) == kept and snapshot(sessions) == raw


def test_saves_cross_the_interfaces(folders):
    sessions, saves = folders
    client, path = new_client(sessions)
    edit(path, lambda d: d["character"].update(gold=31))
    save_id = client.post("/api/saves").json()["save_id"]
    other = TestClient(app)
    assert other.post(f"/saves/load/{save_id}", follow_redirects=False).status_code == 303
    assert other.get("/api/state").json()["character"]["gold"] == 31

    edit(path, lambda d: d["character"].update(gold=47))
    assert client.post("/saves/save", follow_redirects=False).status_code == 303
    newest = client.get("/api/saves").json()["saves"]
    classic_id = next(s["id"] for s in newest if s["id"] != save_id)
    third = TestClient(app)
    assert third.post(f"/api/saves/{classic_id}/load").json()["state"]["character"]["gold"] == 47
    assert client.get("/saves").status_code == 200


def test_the_classic_page_still_refuses_a_save_in_a_fight(folders, monkeypatch):
    sessions, saves = folders
    client, path = new_client(sessions)
    start_fight(client, path, monkeypatch)
    client.post("/saves/save")
    assert not snapshot(saves)
    assert client.post("/api/saves").status_code == 200
    assert len(snapshot(saves)) == 1
