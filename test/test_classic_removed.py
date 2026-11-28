"""The server-rendered interface is gone: its paths lead to /, its files and names do not exist,
nothing pending carries a URL, and the balance simulator plays through the API."""

import importlib
import json
import random
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

pytest.importorskip("httpx")
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dice import Dice
import web.app as web_app
import web.game_session as game_session
from web import creation, fight, save_manager, world
from web.app import app
from web.game_session import GameSession

PREFIXES = ("/classic", "/character", "/game", "/battle", "/shop", "/inventory", "/saves")
CLASSIC_URL = re.compile(r"^/(classic|character|game|battle|shop|inventory|saves)([/?#].*)?$")
QUOTED_CLASSIC_URL = re.compile(r"""["'`]/(classic|character|game|battle|shop|inventory|saves)["'`/?#]""")
WOODS = next(loc for act in game_session.get_campaign()["acts"] for loc in act["locations"]
             if loc["name"] == "Whispering Woods")


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client with a freshly created Fighter, sessions and saves in a temp dir."""
    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(game_session, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(save_manager, "SAVES_DIR", tmp_path / "saves")
    with TestClient(app, follow_redirects=False) as c:
        made = c.post("/api/new-game", json={
            "race": "Human", "class_name": "Fighter", "name": "Tester", "weapon": "Longsword",
            "armor": "Chain Mail", "portrait": creation.PORTRAITS[0]["path"],
            "skills": ["Athletics", "Perception"]})
        assert made.status_code == 200
        c.sessions_dir = sessions
        yield c


def session_file(client) -> Path:
    files = list(client.sessions_dir.glob("*.json"))
    assert len(files) == 1
    return files[0]


def edit(client, change):
    path = session_file(client)
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def strings(value):
    """Every string value of a JSON answer, with the keys of its objects."""
    if isinstance(value, dict):
        for key, inner in value.items():
            yield ("key", key)
            yield from strings(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from strings(inner)
    elif isinstance(value, str):
        yield ("value", value)


def assert_no_classic_url(answer):
    for kind, text in strings(answer):
        if kind == "key":
            assert text != "url"
        else:
            assert not CLASSIC_URL.match(text), text


class TestRedirects:
    @pytest.mark.parametrize("prefix", PREFIXES)
    @pytest.mark.parametrize("rest", ["", "/", "/x", "/x/y?z=1"])
    @pytest.mark.parametrize("method", ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
    def test_every_classic_url_leads_to_the_game(self, client, prefix, rest, method):
        before = session_file(client).read_bytes()
        response = client.request(method, prefix + rest)
        assert response.status_code == 303
        assert response.headers["location"] == "/"
        assert "set-cookie" not in response.headers
        assert session_file(client).read_bytes() == before

    @pytest.mark.parametrize("method, path", [
        ("GET", "/game"), ("POST", "/game/explore"), ("GET", "/battle/start"), ("POST", "/battle/attack"),
        ("GET", "/battle/status"), ("GET", "/game/status"), ("POST", "/shop/buy"), ("POST", "/inventory/use"),
        ("POST", "/saves/save"), ("GET", "/character/new"), ("POST", "/character/create"), ("GET", "/classic"),
        ("POST", "/saves/load/abc"),
    ])
    def test_named_routes_do_nothing(self, client, method, path):
        before = session_file(client).read_bytes()
        response = client.request(method, path, data={"item_index": "0", "name": "X", "weapon": "Dagger"})
        assert (response.status_code, response.headers["location"]) == (303, "/")
        assert session_file(client).read_bytes() == before
        assert [p.name for p in client.sessions_dir.iterdir()] == [session_file(client).name]

    def test_a_redirect_without_a_session_makes_none(self, tmp_path, monkeypatch):
        sessions = tmp_path / "sessions"
        sessions.mkdir()
        monkeypatch.setattr(game_session, "SESSIONS_DIR", sessions)
        with TestClient(app, follow_redirects=False) as fresh:
            response = fresh.post("/character/create", data={"name": "X", "weapon": "Dagger"})
        assert response.status_code == 303
        assert "set-cookie" not in response.headers
        assert list(sessions.iterdir()) == []

    def test_other_paths_are_not_swept_up(self, client):
        assert client.get("/health").json() == {"status": "healthy", "game": "AIVentures"}
        assert client.get("/gameplay").status_code == 404
        assert client.get("/shopping").status_code == 404
        for path in ("/api/state", "/api/saves", "/api/character", "/api/battle"):
            assert client.get(path).status_code == 200
        assert client.post("/api/move", json={"area_id": "market"}).status_code == 200
        assert client.get("/api/shop").status_code == 200


class TestFiles:
    def test_kept_and_removed_static_files(self, client):
        for name in ("player_fighter.png", "player_berserker.png", "player_wizard.png", "shopkeeper.jpg"):
            assert client.get(f"/static/images/{name}").status_code == 200
        for path in ("/static/css/style.css", "/static/js/main.js", "/static/js/battle.js",
                     "/static/images/sprites/goblin.png"):
            assert client.get(path).status_code == 404
        assert sorted(p.name for p in (ROOT / "web/static/images").iterdir()) == [
            "player_berserker.png", "player_fighter.png", "player_wizard.png", "shopkeeper.jpg"]
        assert all((ROOT / "web/static/images" / Path(p["path"]).name).is_file() for p in creation.PORTRAITS)

    def test_the_classic_files_are_gone(self):
        for path in ("web/routes", "web/templates", "web/dependencies.py", "web/static/css", "web/static/js",
                     "web/static/images/sprites", "json/battle_sprites.json", "json/monster_portraits.json",
                     "tools/ui_tour.py", "tools/make_sprites.py"):
            assert not (ROOT / path).exists(), path
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module("web." + "routes")
        assert not hasattr(game_session, "get_battle_sprites")
        assert not hasattr(game_session, "get_monster_portraits")

    def test_no_python_file_names_what_was_removed(self):
        # Spelled in pieces, so that this file does not contain them itself.
        gone = ("web." + "routes", "Jinja2" + "Templates", "Template" + "Response")
        for folder in ("web", "tools", "execution", "test"):
            for path in (ROOT / folder).rglob("*.py"):
                text = path.read_text(encoding="utf-8")
                for word in gone:
                    assert word not in text, f"{path} contains {word}"
        for path in (ROOT / "web").rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "HTMLResponse" not in text and "Form(" not in text, path
        project = (ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
        for package in ("jinja2", "python-multipart", "pillow"):
            assert package not in project

    def test_client_code_has_no_classic_url(self):
        files = [ROOT / "client/index.html"] + [
            p for p in (ROOT / "client/src").rglob("*") if p.is_file() and not p.name.endswith(".test.ts")]
        for path in files:
            text = path.read_text(encoding="utf-8")
            assert not QUOTED_CLASSIC_URL.search(text), path
            assert "answer.url" not in text and "pending.url" not in text, path
        page = (ROOT / "client/index.html").read_text(encoding="utf-8")
        for removed in ('id="pending-link"', 'id="classic-link"', 'id="menu-location"'):
            assert removed not in page
        assert 'id="btn-retry"' in page

    def test_tools_have_no_classic_url(self):
        for name in ("execution/frames.mjs", "tools/balance_sim.py"):
            assert not QUOTED_CLASSIC_URL.search((ROOT / name).read_text(encoding="utf-8")), name
        # The smoke test names three of them, in the step that checks where they lead.
        lines = [line for line in (ROOT / "execution/smoke.mjs").read_text(encoding="utf-8").splitlines()
                 if QUOTED_CLASSIC_URL.search(line)]
        assert len(lines) == 1
        assert "'/game', '/classic', '/battle/victory'" in lines[0]

    def test_documents_describe_no_classic_interface(self):
        guide = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        for word in ("web/routes", "web/templates", "ui_tour", "make_sprites", "battle.js",
                     "Template" + "Response", "Jinja2"):
            assert word not in guide, word
        decisions = re.findall(r"^(\d+)\. \*\*", guide, re.M)
        assert decisions == [str(n) for n in range(1, 10)]
        assert "classic interface keeps working" not in guide
        assert "/classic" not in (ROOT / "README.md").read_text(encoding="utf-8")


class TestWithoutABuild:
    def test_root_says_the_client_is_not_built(self, tmp_path):
        bare = FastAPI()
        web_app.mount_client(bare, tmp_path / "dist")
        response = TestClient(bare, follow_redirects=False).get("/")
        assert response.status_code == 503
        assert response.json() == {"error": "no_client", "message": "The client is not built. Run pnpm build."}

    def test_a_build_is_served_at_root(self, tmp_path):
        dist = tmp_path / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<p>the game</p>", encoding="utf-8")
        (dist / "assets" / "a.js").write_text("1", encoding="utf-8")
        built = FastAPI()
        web_app.mount_client(built, dist)
        served = TestClient(built)
        assert served.get("/").text == "<p>the game</p>"
        assert served.get("/assets/a.js").text == "1"
        assert served.get("/nothing").status_code == 404


class TestPending:
    def test_a_fight_is_pending_without_a_url(self, client):
        edit(client, lambda data: data.update(location_name="Whispering Woods", area_id="entrance"))

        def begin(data):
            session = GameSession.from_dict(data)
            assert fight.begin_random_battle(session)
            data.clear()
            data.update(session.to_dict())
        Dice_d20 = Dice.roll_d20
        Dice.roll_d20 = staticmethod(lambda: 10)
        try:
            edit(client, begin)
        finally:
            Dice.roll_d20 = Dice_d20
        assert client.get("/api/state").json()["pending"] == {"kind": "battle"}
        assert client.post("/api/move", json={"area_id": "clearing"}).json()["error"] == "pending"

    def test_a_defeat_is_pending_without_a_url(self, client):
        edit(client, lambda data: data["character"].update(current_hit_points=0))
        assert client.get("/api/state").json()["pending"] == {"kind": "defeat"}

    def test_an_event_or_its_outcome_is_pending(self, client):
        edit(client, lambda data: data.update(pending_event="bridge_runes"))
        assert client.get("/api/state").json()["pending"] == {"kind": "event"}
        edit(client, lambda data: data.update(pending_event=None, event_result={"title": "Runes", "text": "Read."}))
        assert client.get("/api/state").json()["pending"] == {"kind": "event"}
        # An outcome is pending even beside an id the data does not have.
        edit(client, lambda data: data.update(pending_event="no-such-event"))
        assert client.get("/api/state").json()["pending"] == {"kind": "event"}

    def test_a_stale_event_id_is_not_pending(self, client):
        edit(client, lambda data: data.update(pending_event="no-such-event"))
        before = session_file(client).read_bytes()
        assert client.get("/api/state").json()["pending"] is None
        assert client.get("/api/event").json()["event"] is None
        assert session_file(client).read_bytes() == before
        moved = client.post("/api/move", json={"area_id": "market"})
        assert moved.status_code == 200
        assert moved.json()["area"]["id"] == "market"
        assert moved.json()["pending"] is None

    def test_pending_of_a_session_as_a_function(self):
        session = GameSession()
        assert world.pending(session) is None
        session.pending_event = "no-such-event"
        assert world.pending(session) is None
        session.pending_event = "bridge_runes"
        assert world.pending(session) == {"kind": "event"}


class TestEngage:
    def plant(self, client, monster=None, event=None, area_id="entrance", location="Whispering Woods"):
        def change(data):
            data["location_name"], data["area_id"] = location, area_id
            data["area_contents"] = {"location": location, "area_id": area_id, "seq": 1,
                                     "monster": monster, "event": event, "spent": None}
        edit(client, change)

    def goblin(self):
        return {"id": "m1", "race": "Goblin", "level": 1, "name": "Grak", "class_name": "Rogue", "weapon": "Club"}

    def test_a_monster_answers_the_fight_and_nothing_else(self, client, monkeypatch):
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 10))
        self.plant(client, monster=self.goblin())
        answer = client.post("/api/engage", json={"id": "m1"})
        assert answer.status_code == 200
        body = answer.json()
        assert set(body) == {"state", "battle", "event"}
        assert body["battle"]["phase"] == "fight" and body["event"] is None
        assert body["state"]["pending"] == {"kind": "battle"}
        assert_no_classic_url(body)

    def test_an_event_answers_the_event(self, client):
        self.plant(client, event={"id": "strange_tracks"})
        body = client.post("/api/engage", json={"id": "strange_tracks"}).json()
        assert set(body) == {"state", "battle", "event"}
        assert body["event"]["id"] == "strange_tracks" and body["battle"] is None
        assert body["state"]["pending"] == {"kind": "event"}
        assert_no_classic_url(body)

    def test_a_boss_answers_the_fight(self, client, monkeypatch):
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 10))
        self.plant(client, area_id="grove")
        edit(client, lambda data: data["character"].update(current_hit_points=9999, max_hit_points=9999))
        body = client.post("/api/engage", json={"id": "Shard Guardian"}).json()
        assert set(body) == {"state", "battle", "event"}
        assert body["battle"]["monster"]["boss_id"] == "Shard Guardian"
        assert body["battle"]["monster"]["place"] == "boss"
        assert_no_classic_url(body)

    def test_an_opening_blow_that_fells_the_character_answers_the_defeat(self, client, monkeypatch):
        # The character rolls 1 for initiative, the monster 20, and then 20 to hit.
        rolls = iter([1, 20])
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: next(rolls, 20)))
        self.plant(client, monster=self.goblin())
        edit(client, lambda data: data["character"].update(current_hit_points=1))
        answer = client.post("/api/engage", json={"id": "m1"})
        assert answer.status_code == 200
        body = answer.json()
        assert body["battle"]["phase"] == "defeat"
        assert body["state"]["pending"] == {"kind": "defeat"}
        stored = json.loads(session_file(client).read_text(encoding="utf-8"))
        assert stored["battle"]["is_active"] is False
        assert stored["engaged_monster"] is None

    def test_opened_is_the_phase_of_a_fight_that_began(self, client):
        session = GameSession.from_dict(json.loads(session_file(client).read_text(encoding="utf-8")))
        assert fight.opened(session, True) == "fight"
        session.character.current_hit_points = 0
        assert fight.opened(session, False) == "defeat"
        assert session.battle.is_active is False


class TestEventChance:
    def test_it_lives_in_the_world_module(self):
        assert world.EVENT_CHANCE == 0.65

    def on_the_bridge(self, client):
        edit(client, lambda data: data.update(location_name="Rivermeet Town", area_id="bridge", area_contents=None))

    def test_it_is_read_at_every_roll(self, client, monkeypatch):
        monkeypatch.setattr(random, "random", lambda: 0.999)
        monkeypatch.setattr(world, "EVENT_CHANCE", 1.1)
        self.on_the_bridge(client)
        entered = client.post("/api/enter").json()
        assert entered["contents"]["monster"] is None
        assert entered["contents"]["event"]["id"] == "bridge_runes"

    def test_without_a_chance_nothing_is_found(self, client, monkeypatch):
        monkeypatch.setattr(random, "random", lambda: 0.999)
        monkeypatch.setattr(world, "EVENT_CHANCE", 0.0)
        self.on_the_bridge(client)
        searched = client.post("/api/search")
        assert searched.status_code == 200
        assert searched.json()["contents"]["monster"] is None
        assert searched.json()["contents"]["event"] is None


class TestNoUrlInAnswers:
    def test_the_get_routes_and_their_refusals(self, client, tmp_path, monkeypatch):
        paths = ["/api/state", "/api/creation", "/api/creation/preview?race=Human&class_name=Fighter",
                 "/api/creation/preview?race=Nobody&class_name=Fighter", "/api/battle", "/api/event",
                 "/api/character", "/api/shop", "/api/travel", "/api/journal", "/api/ending", "/api/saves"]
        for path in paths:
            assert_no_classic_url(client.get(path).json())
        client.post("/api/move", json={"area_id": "market"})
        assert client.get("/api/shop").status_code == 200
        assert_no_classic_url(client.get("/api/shop").json())
        with TestClient(app) as nobody:
            for path in paths:
                assert_no_classic_url(nobody.get(path).json())

    def test_a_journey_into_an_ambush(self, client, monkeypatch):
        monkeypatch.setattr(Dice, "roll_d20", staticmethod(lambda: 10))

        def change(data):
            data["defeated_bosses"] = ["Shard Guardian", "Corrupted Captain", "Flame Cultist Leader",
                                       "Corrupted High Priest"]
            data["character"].update(current_hit_points=9999, max_hit_points=9999)
        edit(client, change)
        body = client.post("/api/travel", json={"location": "Emberforge Mountains"}).json()
        assert body["ambush"]["id"] == "Lady Vex"
        assert body["battle"]["monster"]["place"] == "road"
        assert body["state"]["pending"] == {"kind": "battle"}
        assert_no_classic_url(body)


class TestBalanceSimulator:
    """tools/balance_sim.py plays through the API and gives the same fight for the same seed."""

    @pytest.fixture
    def sim(self, tmp_path, monkeypatch):
        import balance_sim
        # run_fight points the sessions at its own folder; put the real one back afterwards.
        monkeypatch.setattr(game_session, "SESSIONS_DIR", game_session.SESSIONS_DIR)
        folder = tmp_path / "sim"
        folder.mkdir()
        return balance_sim, folder

    def reference(self, sim, folder, class_name, target, level, potions, seed):
        """The same fight with the actions as function calls instead of requests."""
        game_session.SESSIONS_DIR = folder
        for stale in folder.glob("*.json"):
            stale.unlink()
        with TestClient(app) as c:
            weapon, armor = sim.KIT[class_name]
            c.post("/api/new-game", json={"race": "Human", "class_name": class_name, "name": "Sim",
                                          "weapon": weapon, "armor": armor or None})
        data = json.loads(next(folder.glob("*.json")).read_text())
        sim._prepare(data, class_name, target, level, potions)
        random.seed(seed)
        session = GameSession.from_dict(data)
        stands = (fight.begin_random_battle(session) if isinstance(target, tuple)
                  else fight.begin_boss_battle(session, target))
        if not stands:
            fight.end_battle(session, False)
        known = [(aid, a) for aid, a in sim.ABILITIES.items()
                 if class_name in a["classes"] and level >= a["unlock_level"]]
        for sent in range(200):
            session = GameSession.from_dict(json.loads(json.dumps(session.to_dict())))
            view = fight.battle_view(session)
            if view["phase"] != "fight":
                return view["phase"] == "victory", sent, view["player"]["hp"] / view["player"]["max_hp"]
            route, body = sim._next_action(view, known, level, sent)
            if route == "item":
                fight.use_item(session, body["item_index"])
            elif route == "ability":
                fight.use_ability(session, body["ability_id"])
            else:
                fight.attack(session)
        return False, 200, 0.0

    @pytest.mark.parametrize("class_name, target, level, potions", [
        ("Fighter", "Shard Guardian", 5, 3),
        ("Wizard", "Lady Vex", 10, 3),
        ("Wizard", (1, "Whispering Woods", "clearing"), 3, 1),
        ("Fighter", (3, "The Convergence", "outer_ring"), 14, 1),
    ])
    def test_a_seeded_fight_is_the_fight_of_the_functions(self, sim, class_name, target, level, potions):
        tool, folder = sim
        if isinstance(target, tuple):
            target = next(where for where, _ in tool._monster_cases() if where[1] == target[1])
        for seed in range(6):
            played = tool.run_fight(class_name, target, level, potions, folder, seed=seed)
            assert played == tool.run_fight(class_name, target, level, potions, folder, seed=seed)
            assert played == self.reference(tool, folder, class_name, target, level, potions, seed)
            assert isinstance(played[0], bool) and 0 < played[1] <= 200 and 0.0 <= played[2] <= 1.0

    def test_the_command_prints_the_same_line_for_the_same_seed(self, sim):
        tool, folder = sim
        command = [sys.executable, str(ROOT / "tools/balance_sim.py"), "bosses", "--classes", "Fighter",
                   "--trials", "3", "--seed", "5", "--only", "Shard Guardian"]
        first = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)
        second = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)
        assert first.returncode == 0, first.stderr
        assert first.stdout == second.stdout
        lines = first.stdout.splitlines()
        assert len(lines) == 1
        results = [tool.run_fight("Fighter", "Shard Guardian", 5, 3, folder, seed=seed) for seed in (5, 6, 7)]
        wins = sum(won for won, _, _ in results) / 3
        rounds = sum(sent for _, sent, _ in results) / 3
        hp = sum(left for _, _, left in results) / 3
        assert lines[0] == (f"{'Shard Guardian':26s} L{5:<2d} | "
                            f"{'Fight':5s} {wins:4.0%} {rounds:4.1f}rd hp{hp:4.0%}")
