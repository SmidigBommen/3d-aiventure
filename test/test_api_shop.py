"""Elara's shop and the quests in the 3D world: /api/shop and the quests of the world state.
Both interfaces must do the same thing to the same session."""

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

from dice import Dice
import web.game_session as game_session
from web.app import app
from web.game_session import GameSession

CLASSES = game_session.get_classes()
QUESTS = game_session.get_quests()
KEEPER = game_session.get_shopkeeper()
STOCK = game_session.get_default_shop_inventory()
MONSTERS = json.loads((Path(__file__).parent.parent / "json" / "monster_default_values.json").read_text())
WEAPONS = sorted(game_session.get_all_weapons_flat())
ARMORS = sorted(game_session.get_all_armors_flat())
GATHER = [qid for qid, quest in QUESTS.items() if quest["type"] == "gather"]
SEEDS = range(int(os.environ.get("AIV_PARITY_SEEDS", "100")))
MARKET = (1, "Rivermeet Town", "market")
STATUS = {
    "no_such_item": 404, "out_of_stock": 409, "not_enough_gold": 409, "not_sellable": 409,
    "already_haggled": 409, "no_such_quest": 404, "quest_slots_full": 409, "quest_taken": 409,
    "quest_not_ready": 409, "quest_not_active": 404,
}
CLASSIC = {"buy": "/shop/buy", "sell": "/shop/sell", "haggle": "/shop/haggle", "accept": "/shop/quest/accept",
           "turn-in": "/shop/quest/turn-in", "abandon": "/shop/quest/abandon"}
API = {"buy": "/api/shop/buy", "sell": "/api/shop/sell", "haggle": "/api/shop/haggle",
       "accept": "/api/shop/quest/accept", "turn-in": "/api/shop/quest/turn-in",
       "abandon": "/api/shop/quest/abandon"}
CONTEXT = {"buy": "buy", "sell": "sell", "accept": "quest_accept", "turn-in": "quest_complete",
           "abandon": "quest_abandon"}
LISTS = {"greeting": "greetings", "buy": "buy_reactions", "sell": "sell_reactions"}
WARE_KEYS = {"index", "name", "description", "healing", "quantity", "original_price", "effective_price",
             "haggled", "discount"}
QUEST_KEYS = {"id", "name", "description", "type", "target_monster", "target_count", "rewards"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    with TestClient(app) as c:
        c.sessions_dir = tmp_path
        c.post("/character/race", data={"race": "Human"})
        c.post("/character/class", data={"class_name": "Fighter"})
        c.post("/character/create", data={
            "name": "Tester", "weapon": "Longsword", "armor": "Chain Mail",
            "skills": ["Athletics", "Perception"],
        })
        edit(c, lambda data: place(data, MARKET))
        yield c


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(game_session, "SESSIONS_DIR", tmp_path)
    with TestClient(app) as c:
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
    data["act_num"], data["location_name"], data["area_id"] = where


def full_stock():
    return [{**item, "quantity": 5} for item in STOCK]


def normal(text):
    """The session without what only the classic page reads, and with the stock spelled out."""
    data = json.loads(text)
    data.pop("_flash", None)
    data.pop("haggle_result", None)
    if data.get("shop_inventory") is None:
        data["shop_inventory"] = full_stock()
    return data


def seeded(client, seed):
    """A session in the market from a seed: character, gold, backpack, stock, haggles, quests."""
    rng = random.Random(seed)
    data = read(client)
    creation, character = data["character_creation"], data["character"]
    creation["class_name"] = rng.choice(sorted(CLASSES))
    creation["race"] = rng.choice(sorted(game_session.get_races()))
    character["class_name"], character["race"] = creation["class_name"], creation["race"]
    character["level"] = rng.randint(1, 20)
    character["max_hit_points"] = rng.randint(10, 200)
    character["current_hit_points"] = rng.randint(1, character["max_hit_points"])
    character["gold"] = rng.randint(0, 5) if rng.random() < 0.2 else rng.randint(0, 300)
    inventory = []
    for _ in range(rng.randint(0, 10)):
        kind = rng.choice(("weapon", "armor", "potion", "stocked", "quest"))
        if kind == "weapon":
            inventory.append({"name": rng.choice(WEAPONS), "type": "weapon"})
        elif kind == "armor":
            inventory.append({"name": rng.choice(ARMORS), "type": "armor"})
        elif kind == "potion":
            inventory.append({"name": "Odd Potion", "type": "potion", "healing_amount": rng.randint(1, 30)})
        elif kind == "stocked":
            item = rng.choice(STOCK)
            inventory.append({"name": item["name"], "type": "potion", "healing_amount": item["healing"]})
        else:
            quest_id = rng.choice(GATHER)
            item = QUESTS[quest_id]["quest_item"]
            inventory.append({"name": item["name"], "description": item["description"], "type": "quest_item",
                              "quest_id": quest_id})
    character["inventory"] = inventory
    data["shop_inventory"] = (None if rng.random() < 0.3
                              else [{**item, "quantity": rng.randint(0, 5)} for item in STOCK])
    data["haggled_items"] = {str(i): rng.choice((40, 25, 15, 10, 0, -25)) for i in range(3) if rng.random() < 0.4}
    taken = rng.sample(sorted(QUESTS), rng.randint(0, 3))
    data["active_quests"] = {}
    for quest_id in taken:
        target = QUESTS[quest_id]["target_count"]
        progress = target if rng.random() < 0.4 else rng.randint(0, target)
        data["active_quests"][quest_id] = {"progress": progress, "status": "ready" if progress >= target else "active"}
    data["completed_quests"] = [q for q in sorted(QUESTS) if q not in taken and rng.random() < 0.3]
    data["monster_kills"] = rng.randint(0, 50)
    data["kills_at_last_restock"] = max(0, data["monster_kills"] - rng.randint(0, 9))
    place(data, MARKET)
    data["battle"]["is_active"] = False
    data["pending_event"] = data["event_result"] = None
    return write(client, data)


def actions(length):
    made = []
    for index in range(-1, 4):
        made += [("buy", {"item_index": index}), ("haggle", {"item_index": index})]
    made += [("sell", {"item_index": index}) for index in range(-1, length + 1)]
    for quest_id in (*QUESTS, "nope"):
        made += [(action, {"quest_id": quest_id}) for action in ("accept", "turn-in", "abandon")]
    return made


def check_dialog(dialog, context):
    assert dialog["context"] == context
    assert dialog["line"] in KEEPER[LISTS.get(context, context)]


def check_view(shop, stored):
    """The shop view against the session file it was made from."""
    assert set(shop) == {"keeper", "dialog", "gold", "wares", "sell", "quests"}
    assert shop["keeper"] == {"name": "Elara", "title": "The Collector", "portrait": "/static/images/shopkeeper.jpg"}
    assert shop["gold"] == stored["character"]["gold"]
    stock = stored["shop_inventory"] or full_stock()
    haggled = stored["haggled_items"]
    assert len(shop["wares"]) == len(stock)
    for i, (ware, item) in enumerate(zip(shop["wares"], stock)):
        assert set(ware) == WARE_KEYS
        discount = haggled.get(str(i), 0)
        price = max(1, int(item["price"] * (1 - discount / 100))) if str(i) in haggled else item["price"]
        assert ware == {"index": i, "name": item["name"], "description": item["description"],
                        "healing": item["healing"], "quantity": item["quantity"], "original_price": item["price"],
                        "effective_price": price, "haggled": str(i) in haggled, "discount": discount}
    inventory = stored["character"]["inventory"]
    assert [(entry["index"], entry["name"]) for entry in shop["sell"]] == [
        (i, item["name"]) for i, item in enumerate(inventory) if item["type"] != "quest_item"]
    for entry in shop["sell"]:
        assert set(entry) == {"index", "name", "description", "sell_price"}
        assert entry["sell_price"] >= 1
    act = stored["act_num"]
    active, done = stored["active_quests"], stored["completed_quests"]
    assert [q["id"] for q in shop["quests"]["available"]] == [
        qid for qid, quest in QUESTS.items() if quest["act"] <= act and qid not in active and qid not in done]
    for quest in shop["quests"]["available"]:
        assert set(quest) == QUEST_KEYS | {"dialog_offer"}
        assert quest == {"id": quest["id"], **{k: QUESTS[quest["id"]][k] for k in QUEST_KEYS - {"id"}},
                         "dialog_offer": QUESTS[quest["id"]]["dialog_offer"]}
    assert [q["id"] for q in shop["quests"]["active"]] == list(active)
    for quest in shop["quests"]["active"]:
        assert set(quest) == QUEST_KEYS | {"progress", "progress_pct", "status"}
        state = active[quest["id"]]
        assert (quest["progress"], quest["status"]) == (state["progress"], state["status"])
        assert quest["progress_pct"] == min(100, int(state["progress"] / quest["target_count"] * 100))
    assert shop["quests"]["slots_full"] is (len(active) >= 3)


def tracked(stored):
    return [{"id": qid, "name": QUESTS[qid]["name"], "type": QUESTS[qid]["type"],
             "target_monster": QUESTS[qid]["target_monster"], "target_count": QUESTS[qid]["target_count"],
             "progress": state["progress"], "status": state["status"]}
            for qid, state in stored["active_quests"].items()]


# --- parity -------------------------------------------------------------------------------------------


def test_parity_refusals_and_successes(client):
    refused, succeeded = set(), set()
    for seed in SEEDS:
        s0 = seeded(client, seed)
        path = session_file(client)
        start = json.loads(s0)
        check_view(client.get("/api/shop").json()["shop"], start)
        assert path.read_text() == s0
        for k, (action, fields) in enumerate(actions(len(start["character"]["inventory"]))):
            where = (seed, action, fields)
            path.write_text(s0)
            random.seed(k)
            classic = client.post(CLASSIC[action], data=fields, follow_redirects=False)
            assert classic.status_code == 303, where
            a = path.read_text()
            path.write_text(s0)
            random.seed(k)
            response = client.post(API[action], json=fields)
            b = path.read_text()
            assert normal(a) == normal(b), where
            body = response.json()
            assert (response.status_code == 200) == (normal(a) != normal(s0)), where
            if response.status_code == 200:
                assert set(body) == {"shop", "state", "message", "haggle"}, where
                stored = json.loads(b)
                assert stored.get("_flash") == start.get("_flash"), where
                assert stored.get("haggle_result") == start.get("haggle_result"), where
                check_view(body["shop"], stored)
                assert body["state"]["quests"] == tracked(stored), where
                assert body["state"]["character"]["gold"] == stored["character"]["gold"], where
                flash = json.loads(a)["_flash"]
                if action == "haggle":
                    assert body["message"] is None, where
                    assert body["haggle"] == json.loads(a)["haggle_result"], where
                    check_dialog(body["shop"]["dialog"], "haggle_" + body["haggle"]["tier"])
                    assert flash["shop_dialog_context"] == body["shop"]["dialog"]["context"], where
                else:
                    assert body["haggle"] is None, where
                    assert body["message"] == flash["shop_message"], where
                    check_dialog(body["shop"]["dialog"], CONTEXT[action])
                    assert flash["shop_dialog_context"] == CONTEXT[action], where
                succeeded.add(action)
            else:
                code = body["error"]
                assert response.status_code == STATUS[code], where
                assert b == s0, where
                flash = json.loads(a)["_flash"]
                assert body["message"] == flash["shop_error"], where
                if code in ("already_haggled", "quest_slots_full"):
                    check_dialog(body["dialog"], {"already_haggled": "browse", "quest_slots_full": "quest_full"}[code])
                    assert flash["shop_dialog_context"] == body["dialog"]["context"], where
                else:
                    assert body.get("dialog") is None, where
                    assert "shop_dialog_context" not in flash, where
                refused.add(code)
    if len(SEEDS) >= 100:
        assert refused == set(STATUS)
        assert succeeded == set(CLASSIC)


# --- haggle -------------------------------------------------------------------------------------------


def tier_of(roll, total):
    if roll == 20:
        return 40, "nat20"
    if total >= 20:
        return 25, "great"
    if total >= 16:
        return 15, "good"
    if total >= 12:
        return 10, "okay"
    if roll == 1:
        return -25, "nat1"
    return 0, "fail"


@pytest.mark.parametrize("roll", range(1, 21))
def test_haggle_tiers(client, monkeypatch, roll):
    edit(client, lambda data: data["character"].update(gold=500))
    skills = client.get("/api/character").json()["sheet"]["skills"]
    modifier = next(skill["modifier"] for skill in skills if skill["name"] == "Persuasion")
    monkeypatch.setattr(Dice, "roll_d20", lambda *args, **kwargs: roll)
    body = client.post("/api/shop/haggle", json={"item_index": 1}).json()
    discount, tier = tier_of(roll, roll + modifier)
    price = max(1, int(25 * (1 - discount / 100)))
    assert body["haggle"] == {"roll": roll, "modifier": modifier, "total": roll + modifier, "discount": discount,
                              "tier": tier, "item_name": "Healing Potion", "original_price": 25, "new_price": price}
    assert body["message"] is None
    ware = body["shop"]["wares"][1]
    assert (ware["haggled"], ware["discount"], ware["effective_price"]) == (True, discount, price)
    check_dialog(body["shop"]["dialog"], "haggle_" + tier)
    stored = read(client)
    assert stored["haggle_result"] is None and not stored.get("_flash")

    bought = client.post("/api/shop/buy", json={"item_index": 1}).json()
    assert bought["shop"]["gold"] == 500 - price
    assert bought["message"] == f"Purchased Healing Potion for {price} gold!"

    assert client.post("/api/shop/haggle", json={"item_index": 0}).status_code == 200
    before = session_file(client).read_bytes()
    again = client.post("/api/shop/haggle", json={"item_index": 1})
    assert again.status_code == 409
    assert again.json()["error"] == "already_haggled"
    assert again.json()["message"] == "You've already haggled over this item!"
    check_dialog(again.json()["dialog"], "browse")
    assert session_file(client).read_bytes() == before


# --- restock ------------------------------------------------------------------------------------------

GOBLIN = {"id": "planted-1", "race": "Goblin", "class_name": "Rogue", "level": 1, "name": "Grak", "weapon": "Club"}


def start_fight(client, monster=GOBLIN, where=("Whispering Woods", "entrance"), strong=True):
    """The character in a fight with `monster` at 1 hit point, the player to move."""
    def change(data):
        data["act_num"], data["location_name"], data["area_id"] = 1, *where
        data["area_contents"] = {"location": where[0], "area_id": where[1], "seq": 1, "monster": monster, "event": None}
        if strong:
            data["character"].update(level=20, max_hit_points=9999, current_hit_points=9999)
    edit(client, change)
    assert client.post("/api/engage", json={"id": monster["id"]}).status_code == 200

    def ready(data):
        data["battle"]["monster"]["hp"] = 1
        data["battle"]["is_player_turn"] = True
    return edit(client, ready)


def worn_shop(data, kills, since):
    data["monster_kills"], data["kills_at_last_restock"] = kills, kills - since
    data["shop_inventory"] = [{**item, "quantity": 2} for item in STOCK]
    data["haggled_items"] = {"0": 15, "2": -25}


def shop_now(client):
    edit(client, lambda data: place(data, MARKET))
    return client.get("/api/shop").json()["shop"]


@pytest.mark.parametrize("since, restocked", [(9, True), (8, False)])
def test_restock_after_ten_kills(client, monkeypatch, since, restocked):
    edit(client, lambda data: worn_shop(data, 30, since))
    start_fight(client)
    monkeypatch.setattr(Dice, "roll_d20", lambda *args, **kwargs: 20)
    won = client.post("/api/battle/attack").json()
    assert won["battle"]["phase"] == "victory"
    client.post("/api/battle/continue")
    wares = shop_now(client)["wares"]
    if restocked:
        assert all(w["quantity"] == 5 and not w["haggled"] and w["effective_price"] == w["original_price"] for w in wares)
        assert client.post("/api/shop/haggle", json={"item_index": 0}).status_code == 200
    else:
        assert [w["quantity"] for w in wares] == [2, 2, 2]
        assert [w["haggled"] for w in wares] == [True, False, True]
        assert [w["discount"] for w in wares] == [15, 0, -25]
        assert client.post("/api/shop/haggle", json={"item_index": 0}).json()["error"] == "already_haggled"


def test_restock_after_a_defeat(client, monkeypatch):
    edit(client, lambda data: worn_shop(data, 30, 2))
    start_fight(client, strong=False)

    def weak(data):
        data["character"]["current_hit_points"] = 1
        data["battle"]["monster"]["hp"] = 500
        data["battle"]["monster"]["max_hp"] = 500
    edit(client, weak)
    monkeypatch.setattr(Dice, "roll_d20", lambda *args, **kwargs: 20)
    phase = "fight"
    for _ in range(30):
        phase = client.post("/api/battle/defend").json()["battle"]["phase"]
        if phase != "fight":
            break
    assert phase == "defeat"
    client.post("/api/battle/revive")
    wares = shop_now(client)["wares"]
    assert all(w["quantity"] == 5 and not w["haggled"] and w["effective_price"] == w["original_price"] for w in wares)


# --- buy and sell -------------------------------------------------------------------------------------


def test_buy_and_sell(client):
    def change(data):
        data["character"]["gold"] = 100
        data["character"]["inventory"] = [
            {"name": "Dagger", "type": "weapon"},
            {"name": "Goblin Ear", "description": "An ear.", "type": "quest_item", "quest_id": "goblin_ears"},
            {"name": "Greater Healing Potion", "type": "potion", "healing_amount": 20},
        ]
        data["haggled_items"] = {"1": 40}
    edit(client, change)
    body = client.post("/api/shop/buy", json={"item_index": 1}).json()
    stored = read(client)
    assert stored["character"]["gold"] == 85 == body["shop"]["gold"] == body["state"]["character"]["gold"]
    assert body["shop"]["wares"][1]["quantity"] == 4
    assert stored["character"]["inventory"][-1] == {
        **stored["character"]["inventory"][-1], "name": "Healing Potion", "type": "potion", "healing_amount": 10}
    check_dialog(body["shop"]["dialog"], "buy")
    assert [(entry["index"], entry["name"]) for entry in body["shop"]["sell"]] == [
        (0, "Dagger"), (2, "Greater Healing Potion"), (3, "Healing Potion")]
    assert body["shop"]["sell"][1]["sell_price"] == 25

    before = session_file(client).read_bytes()
    refused = client.post("/api/shop/sell", json={"item_index": 1})
    assert (refused.status_code, refused.json()["error"]) == (409, "not_sellable")
    assert refused.json()["message"] == "Elara does not buy quest items."
    assert session_file(client).read_bytes() == before
    client.post("/shop/sell", data={"item_index": 1}, follow_redirects=False)
    after = session_file(client).read_text()
    assert normal(after) == normal(before.decode())
    assert json.loads(after)["_flash"]["shop_error"] == "Elara does not buy quest items."

    session_file(client).write_bytes(before)
    sold = client.post("/api/shop/sell", json={"item_index": 2}).json()
    assert sold["message"] == "Sold Greater Healing Potion for 25 gold!"
    assert sold["shop"]["gold"] == 110
    assert [item["name"] for item in read(client)["character"]["inventory"]] == ["Dagger", "Goblin Ear", "Healing Potion"]
    check_dialog(sold["shop"]["dialog"], "sell")

    edit(client, lambda data: data["shop_inventory"][0].update(quantity=0))
    out = client.post("/api/shop/buy", json={"item_index": 0})
    assert (out.status_code, out.json()["error"], out.json()["message"]) == (409, "out_of_stock", "Minor Healing Potion is out of stock!")
    edit(client, lambda data: data["character"].update(gold=3))
    poor = client.post("/api/shop/buy", json={"item_index": 2})
    assert (poor.status_code, poor.json()["error"], poor.json()["message"]) == (409, "not_enough_gold", "Not enough gold! You need 50 gold.")


# --- quests -------------------------------------------------------------------------------------------


def test_quests(client):
    ids = list(QUESTS)
    for quest_id in ids[:3]:
        body = client.post("/api/shop/quest/accept", json={"quest_id": quest_id}).json()
        assert body["message"] == f"Quest accepted: {QUESTS[quest_id]['name']}"
        check_dialog(body["shop"]["dialog"], "quest_accept")
        assert read(client)["active_quests"][quest_id] == {"progress": 0, "status": "active"}
    assert body["shop"]["quests"]["slots_full"] is True
    assert [q["id"] for q in body["state"]["quests"]] == ids[:3]
    for quest_id in ids:
        client.post("/api/shop/quest/accept", json={"quest_id": quest_id})
    assert list(read(client)["active_quests"]) == ids[:3]
    full = client.post("/api/shop/quest/accept", json={"quest_id": ids[5]})
    assert (full.status_code, full.json()["error"]) == (409, "quest_slots_full")
    check_dialog(full.json()["dialog"], "quest_full")

    early = client.post("/api/shop/quest/turn-in", json={"quest_id": "goblin_menace"})
    assert (early.status_code, early.json()["error"]) == (409, "quest_not_ready")

    def ready(data):
        data["active_quests"]["goblin_ears"] = {"progress": 4, "status": "ready"}
        data["character"]["inventory"] += [
            {"name": "Goblin Ear", "description": "An ear.", "type": "quest_item", "quest_id": "goblin_ears"}] * 4
    edit(client, ready)
    before = read(client)
    done = client.post("/api/shop/quest/turn-in", json={"quest_id": "goblin_ears"}).json()
    after = read(client)
    assert done["message"].startswith(f"Quest complete: {QUESTS['goblin_ears']['name']}! +40 gold, +150 XP")
    check_dialog(done["shop"]["dialog"], "quest_complete")
    assert after["character"]["gold"] == before["character"]["gold"] + 40
    assert after["completed_quests"] == ["goblin_ears"]
    assert "goblin_ears" not in after["active_quests"]
    assert not any(item["type"] == "quest_item" for item in after["character"]["inventory"])
    assert [q["id"] for q in done["state"]["quests"]] == ["goblin_menace", "orc_raiders"]

    gone = client.post("/api/shop/quest/abandon", json={"quest_id": "orc_raiders"}).json()
    assert gone["message"] == f"Quest abandoned: {QUESTS['orc_raiders']['name']}"
    check_dialog(gone["shop"]["dialog"], "quest_abandon")
    assert [q["id"] for q in client.get("/api/state").json()["quests"]] == ["goblin_menace"]
    missing = client.post("/api/shop/quest/abandon", json={"quest_id": "orc_raiders"})
    assert (missing.status_code, missing.json()["error"]) == (404, "quest_not_active")
    taken = client.post("/api/shop/quest/accept", json={"quest_id": "goblin_ears"})
    assert (taken.status_code, taken.json()["error"]) == (409, "quest_taken")
    unknown = client.post("/api/shop/quest/accept", json={"quest_id": "nope"})
    assert (unknown.status_code, unknown.json()["error"]) == (404, "no_such_quest")


def test_turn_in_levels_up_as_classic(client):
    def change(data):
        data["active_quests"] = {"shadow_knights": {"progress": 5, "status": "ready"}}
    s0 = edit(client, change)
    random.seed(4)
    client.post("/shop/quest/turn-in", data={"quest_id": "shadow_knights"}, follow_redirects=False)
    a = session_file(client).read_text()
    session_file(client).write_text(s0)
    random.seed(4)
    body = client.post("/api/shop/quest/turn-in", json={"quest_id": "shadow_knights"}).json()
    assert normal(a) == normal(session_file(client).read_text())
    assert body["message"] == json.loads(a)["_flash"]["shop_message"]
    assert "Level up! You are now level" in body["message"]
    assert body["state"]["character"]["level"] > 1


@pytest.mark.parametrize("act", [1, 2, 3])
def test_the_board_by_act(client, act):
    location = game_session.get_campaign()["acts"][act - 1]["locations"][0]

    def change(data):
        data["act_num"], data["location_name"], data["area_id"] = act, location["name"], location["areas"][0]["id"]
        data["active_quests"] = {"orc_raiders": {"progress": 1, "status": "active"}}
        data["completed_quests"] = ["goblin_menace"]
    edit(client, change)
    assert client.get("/api/shop").json()["error"] == "no_shop"
    assert client.get("/api/state").json()["quests"] == tracked(read(client))


# --- quest progress after a kill ------------------------------------------------------------------------


def kill_run(client, monkeypatch, quest_id, progress, seed):
    quest = QUESTS[quest_id]
    race = quest["target_monster"]
    monster = {"id": "planted-q", "race": race, "class_name": MONSTERS[race]["class_options"][0], "level": 1,
               "name": "Mark", "weapon": MONSTERS[race]["weapons"][0]}
    edit(client, lambda data: data.update(active_quests={quest_id: {"progress": progress, "status": "active"}}))
    start = start_fight(client, monster)
    monkeypatch.setattr(Dice, "roll_d20", lambda *args, **kwargs: 20)
    path = session_file(client)
    random.seed(seed)
    response = client.post("/api/battle/attack")
    b = json.loads(path.read_text())
    path.write_text(start)
    random.seed(seed)
    client.post("/battle/attack", follow_redirects=False)
    a = json.loads(path.read_text())
    a.pop("_flash", None)
    b.pop("_flash", None)
    assert a == b
    return a, response.json()


@pytest.mark.parametrize("quest_id", list(QUESTS))
def test_quest_progress_after_a_kill(client, monkeypatch, quest_id):
    quest = QUESTS[quest_id]
    base = session_file(client).read_text()
    for progress in (0, quest["target_count"] - 1):
        dropped = set()
        for seed in range(20 if quest["type"] == "gather" else 1):
            session_file(client).write_text(base)
            a, body = kill_run(client, monkeypatch, quest_id, progress, seed)
            assert body["battle"]["phase"] == "victory"
            updates = body["battle"]["rewards"]["quest_updates"]
            assert updates == a["battle_rewards"]["quest_updates"]
            entry = next(q for q in body["state"]["quests"] if q["id"] == quest_id)
            stored = a["active_quests"][quest_id]
            assert (entry["progress"], entry["status"]) == (stored["progress"], stored["status"])
            if quest["type"] == "kill":
                assert stored["progress"] == progress + 1
                assert updates == [f"{quest['name']}: {progress + 1}/{quest['target_count']}"]
                assert (stored["status"] == "ready") == (progress + 1 >= quest["target_count"])
            else:
                dropped.add("found" in updates[0])
        if quest["type"] == "gather":
            assert dropped == {True, False}


# --- reading and refusing -----------------------------------------------------------------------------


def test_reading_writes_nothing(client):
    def change(data):
        data["shop_inventory"] = None
        data["_flash"] = {"shop_message": "kept", "shop_dialog_context": "buy"}
        data["haggle_result"] = {"roll": 3}
        data["character"]["gold"] = 6
    edit(client, change)
    data = read(client)
    data["_flash"] = {"shop_message": "kept", "shop_dialog_context": "buy"}
    session_file(client).write_text(json.dumps(data))
    before = session_file(client).read_bytes()
    body = client.get("/api/shop").json()
    assert session_file(client).read_bytes() == before
    assert set(body) == {"shop", "state", "message", "haggle"}
    assert body["message"] is None and body["haggle"] is None
    assert [w["quantity"] for w in body["shop"]["wares"]] == [5, 5, 5]
    check_dialog(body["shop"]["dialog"], "greeting")
    check_view(body["shop"], data)
    edit(client, lambda d: d["character"].update(gold=5))
    check_dialog(client.get("/api/shop").json()["shop"]["dialog"], "low_gold")


BODIES = [("buy", {"item_index": 0}), ("sell", {"item_index": 0}), ("haggle", {"item_index": 0}),
          ("accept", {"quest_id": "goblin_menace"}), ("turn-in", {"quest_id": "goblin_menace"}),
          ("abandon", {"quest_id": "goblin_menace"})]


def refusal(response):
    return response.status_code, response.json()["error"]


def test_refusals_in_order(client, fresh):
    assert refusal(fresh.get("/api/shop")) == (409, "no_character")
    for action, fields in BODIES:
        assert refusal(fresh.post(API[action], content=b"[1]")) == (409, "no_character")
    assert fresh.get("/api/state").json()["quests"] == []
    assert client.get("/api/state").json()["quests"] == []

    before = session_file(client).read_bytes()
    for action, fields in BODIES:
        field = next(iter(fields))
        bad = [b"[]", b"nope", b'"x"', b"", b"{}", json.dumps({field: None}).encode(),
               json.dumps({field: True}).encode(), json.dumps({field: 1.5}).encode(),
               json.dumps({field: "0" if field == "item_index" else 3}).encode()]
        for body in bad:
            assert refusal(client.post(API[action], content=body)) == (400, "bad_request"), (action, body)
    assert session_file(client).read_bytes() == before

    # Pending comes before the shop and before the action's own refusal; a bad body before pending.
    for change in (lambda d: d["battle"].update(is_active=True),
                   lambda d: d["character"].update(current_hit_points=0),
                   lambda d: d.update(pending_event="lost_traveler")):
        for where in (MARKET, (1, "Rivermeet Town", "tavern")):
            data = json.loads(before)
            place(data, where)
            change(data)
            session_file(client).write_text(json.dumps(data))
            kept = session_file(client).read_bytes()
            for action, fields in BODIES:
                assert refusal(client.post(API[action], json=fields)) == (409, "pending")
                assert refusal(client.post(API[action], content=b"[]")) == (400, "bad_request")
            assert session_file(client).read_bytes() == kept

    data = json.loads(before)
    place(data, (1, "Rivermeet Town", "tavern"))
    session_file(client).write_text(json.dumps(data))
    kept = session_file(client).read_bytes()
    response = client.get("/api/shop")
    assert refusal(response) == (409, "no_shop")
    assert response.json()["message"] == "There is no shop here."
    for action, fields in BODIES:
        assert refusal(client.post(API[action], json=fields)) == (409, "no_shop")
        assert refusal(client.post(API[action], json={next(iter(fields)): -1 if "item_index" in fields else "nope"})) == (409, "no_shop")
    assert session_file(client).read_bytes() == kept


def test_classic_page_still_shows_the_shop(client):
    edit(client, lambda data: data["character"].update(gold=100))
    client.post("/shop/haggle", data={"item_index": 0}, follow_redirects=False)
    assert read(client)["haggle_result"]["item_name"] == "Minor Healing Potion"
    page = client.get("/shop/")
    assert page.status_code == 200
    assert "Minor Healing Potion" in page.text and "Elara" in page.text
    assert read(client)["haggle_result"] is None
    client.post("/shop/quest/accept", data={"quest_id": "goblin_menace"}, follow_redirects=False)
    page = client.get("/shop/?tab=quests")
    assert "Quest accepted: Goblin Menace" in page.text


def test_names_other_code_imports():
    from web.routes.shop import (  # noqa: F401
        calculate_sell_price, get_effective_price, get_shop_inventory, get_shopkeeper_dialog, restock_shop)
