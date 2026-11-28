# CLAUDE.md

Guidance for agents working in this repository.

## What this is

AIVentures 3D is a first-person 3D version of AIVentures, a D&D 5e-inspired single-player RPG
(campaign "The Shattered Crown": 3 acts, 8 locations, 51 areas, 9 bosses). It started as a copy of
`SmidigBommen/AIVentures` at commit `4bf6977`. The rules, the data and the campaign are the same
game; only the presentation changes. Live at https://aiventure3d.smidigbommen.no.

Work items arrive as GitHub issues and are built by a software factory: a specification is written
from the issue, an independent verifier writes hidden acceptance tests from the specification, an
implementer builds the change, and it is merged and deployed when every gate passes.

## Decisions that hold for every work item

1. **The rules live in Python and nowhere else.** The server rolls every die and decides every
   outcome with the existing code in `engine/`, the root-level domain modules and `json/`. The
   client never computes a rule, a roll, a price or a reward; it shows what the server returned.
   Do not change rule behaviour or numbers unless the work item says so.
2. **The client talks to a JSON API under `/api`.** Routers go in `web/api/`. When the API needs
   logic that sits inside a classic route in `web/routes/`, move that logic into a function both
   call (in `engine/` if it is a rule, otherwise in `web/`); never copy it. Every `POST` returns
   the new state the client needs, so the client does not have to ask again. Errors are a 4xx
   status with `{"error": "<code>", "message": "<text for the player>"}`.
3. **Session.** The API uses the same cookie session and `GameSession` as the classic routes
   (`get_session` / `save_session`), so both interfaces see the same game at any moment.
4. **The classic interface keeps working** at `/classic`, `/character`, `/game`, `/battle`,
   `/shop`, `/inventory`, `/saves` until the work item that removes it. A screen that has no 3D
   version yet is reached by a link to its classic page, and classic pages link back to `/`.
   Its tests in `test/` must keep passing.
5. **World.** One 3D scene per campaign area, built in code from the area's data, the same every
   time for the same area. Each connection to another area is a gate the player walks through.
   What is in an area (monsters, event objects, the boss, the shopkeeper) is decided by the server.
6. **First person.** WASD and arrow keys to move, mouse to look with pointer lock, E to interact,
   Esc to release the mouse. Desktop browsers only. Battles are turn-based and happen where the
   monster stands; the player is held in place facing it. Menus are HTML panels over the 3D view
   and keep the classic hotkeys (battle: A/D/F, 1-5, Q/W/E/R).
7. **Client code is split in two kinds.** Modules without any `three` or DOM import hold the
   logic (layout of an area, movement, collision, what can be interacted with, how a list of turn
   events becomes a timeline) and have Vitest tests next to them. Modules that render or touch
   the DOM stay thin. A work item's acceptance tests can only reach the first kind and the API.
8. **Models** are CC0 files under `client/public/models/`, listed with source and licence in
   `MODELS.md`. A creature without a fitting model uses the nearest one with a tint and a scale,
   recorded in the same table. No other licences.
9. **The smoke test grows with the game.** `execution/smoke.mjs` walks through what exists in a
   real browser and saves a screenshot per step. Each work item extends it to cover what it adds.
   The page exposes `window.__aiv` for it: read-only state plus actions that go through the same
   code a key press or click would. Nothing may behave differently because a test is driving.
10. **Look.** Dark fantasy, matching the classic interface: its colours and the Cinzel heading
    font (see `web/static/css/style.css`). Low-poly, readable at a glance, 60 frames per second
    on an ordinary laptop.

## Commands

```bash
uv sync && pnpm install          # once
pnpm build                       # type-check and build the client into client/dist
uv run pytest -q                 # server tests (test/)
pnpm test                        # client tests (client/src/**/*.test.ts)
node execution/smoke.mjs --serve --out /tmp/smoke    # browser walk-through, after pnpm build
pnpm serve                       # the server on :8000, serving client/dist at /
pnpm dev                         # Vite dev server for the client, passing API calls on to :8000
```

Data (sessions and saves) is written under `$AIVENTURE_DATA` when set (production: the `/data`
volume), otherwise under `web/sessions` and `web/saves`.

## Layout

```
client/index.html, client/src/   the 3D client (TypeScript, Three.js, Vite); world/ the areas, battle/ the fight
client/public/                   files served as they are (models, favicon)
web/app.py                       FastAPI app: API, classic routes, and client/dist mounted at /
web/api/                         JSON API routers (added by work items)
web/fight.py, web/world.py       the fight and the world as functions of a session, shared by both interfaces
web/events.py                    exploration events as functions of a session, shared by both interfaces
web/inventory.py, web/sheet.py   the backpack and the character sheet as functions of a session, shared by both interfaces
web/shop.py                      Elara's shop and the quest board as functions of a session, shared by both interfaces
web/travel.py                    travel, the journal and the ending as functions of a session, shared by both interfaces
web/routes/, web/templates/      the classic server-rendered interface
engine/, *.py, json/             rules engine, domain model and game data
test/                            pytest tests
holdout/                         not in the repository; the factory puts hidden acceptance tests here when it runs them
execution/smoke.mjs              browser smoke test
execution/smoke_server.py        the server as the smoke test starts it: d20 rolls can be set from a file
tools/                           balance simulator, sprite drawing, classic screenshot tour, model manifest
```

## The 3D world so far

- `GET /api/state` (read-only) and `POST /api/move` are in `web/api/world.py` (with the encounter
  routes, see "What an area holds"). The move, the danger
  band, the shop/rest tests and the pending check (battle, defeat, event) are in `web/world.py`;
  the classic routes in `web/routes/game.py` call the same functions.
- `client/src/world/layout.ts` turns an area into a floor plan (`buildLayout`): floor size, one gate
  per exit, solid walls and props, spawn points. It keeps the straight line from the default spawn
  to every gate clear. The client takes floor, gates and spawn from it; what stands on the floor
  comes from the dressing (below). `collision.ts` holds `moveWithCollision` and `gateAt`; `walk.ts` holds one
  frame of walking and turning. All three are pure; `testkit.ts` holds the measuring helpers of
  their tests.
- `area` in both answers carries what the client dresses the area by: `has_shop`, `can_rest`,
  `is_boss_area` (the campaign places a boss there, defeated or not; `world.is_boss_area`),
  `special` (the campaign's string, or null) and `is_start` (travel arrives here: `world.starting_area`).
- `client/src/world/models.json` is the model manifest: per `.glb` under `client/public/models/`
  its bounding size and triangle count. `node tools/make_model_manifest.mjs` writes it (`--check`
  compares); run it after adding or changing a model. Never edit it by hand.
- `client/src/world/dressing.ts` (pure) decides what an area looks like. `dressArea(layout, spec)`
  returns the placements (model, role, position, rotation, scale, tint, solid box), the mood and
  the layout to walk in: the floor, gates and spawn of `buildLayout`, with the placements' solid
  boxes as the only obstacles. The props `buildLayout` places are not used any more. A `Theme`
  per location (default per type) lists the models: paving or scatter for the ground, the run
  along the edge, the backdrop outside, the gateway, props, the boss arena. Landmarks: market
  stall (shop), inn front or campfire (rest), arena (boss area), and `SPECIAL_LANDMARKS` by the
  area's `special`. `moodFor(location, type)` gives sky, fog, main light and ground tint per
  location. Rules it keeps, all measured in `dressing.test.ts` with the helpers of
  `dressingkit.ts`: footprints of props and landmarks do not overlap each other, the trigger
  zones or the spawn squares; solids stay 1 m off the straight lines from the spawns to the
  gates; at most 150,000 triangles and 40 models per area.
- The gateway is `env/dungeon/arch_stone`, scaled so that its legs stand `gate.width` apart
  (3 file units between them), turned a quarter for east and west gates.
- `client/src/world/modelLoader.ts` loads a model once per page load and keeps it; a model that
  fails is recorded and drawn as a box. `client/src/world/areaScene.ts` draws a dressing: one
  instanced mesh per model part and tint, light, fog and sky from the mood, the sign above each
  gateway. It holds no table of which model goes where; what it knows about single models is
  which ones burn (they get a light). Plain geometry is limited to the floor plane, the backing
  behind dungeon walls, the passage behind a dungeon gate, the road out of an outdoor gate and
  the signs.
- `client/src/ui.ts` fills the HTML panels, `client/src/main.ts` holds the screens (title, world,
  pending), the input and the frame loop. Entering an area is asynchronous: `#loading` is shown
  and nobody walks until the models are in and the scene is built.
- `window.__aiv`: `ready`, `frames`, `screen`, `state`, `player`, `layout` (the dressing's
  layout, with `slots`), `menuOpen`, `loading`, `modelErrors`, `dressing`, `triangles` (drawn in
  the last frame), `contents`, `interaction`, `prompt`, `battle` (null, or `{view, playing, locked,
  result}` during a fight, when `screen` is `'battle'` and `player` is the battle stance), `event`
  (null, or `{view, result}` while the event panel is open and `screen` is `'event'`), `intro` (null,
  or the boss id while the boss introduction is open and `screen` is `'intro'`), `panel` (null,
  `'inventory'`, `'sheet'` or `'shop'` while that panel is on screen; `screen` stays `'world'`, `prompt` and
  `interaction` are null), `inventory` and `sheet` (the views of the last answer), `shop` (null, or
  `{view, tab, haggle}` while the shop panel is open), `resting`, what "Travel, journal, compass and
  the ending" below adds (`travel`, `journal`, `arrival`, `compass`, `road`, `ending`, `travelling`), and the
  actions `lookAt(x, z)` and `interact()` (what the E key runs: it also opens the event panel and the
  boss introduction). A fight, an event and an introduction have no actions here: the smoke test
  presses the real keys.
- The smoke test visits all eight locations with `--serve` (it marks every boss defeated in its
  own session file to unlock Acts 2 and 3); with `--url` it stays in Act 1. With `--serve` it also
  plants monsters and events in its session file (`plant`), fights in the world (a win, an
  ability and an item, a flight, a defeat with Rise Again, a reload in the middle of a fight), plays
  events in the event panel (a success, a failure, a reload, one that ends in a fight, a discovery at
  its landmark), searches, and fights the first boss from the introduction to the defeat scene; in
  both modes it walks up to the first boss and opens the inventory and the character sheet in the
  tavern (I, C, Esc, the menu entries). With `--serve` it then edits its session (wounded, level 4,
  a second weapon and armour) and drinks a potion, equips both, spends an ability point and rests at
  the inn front, with the answer of `/api/rest` held back for the screenshot of the black view. In both
  modes it then talks to Elara in the market and opens the three tabs of her shop; with `--serve` it
  haggles (d20 19 and 2), buys two potions, sells a dagger, accepts Goblin Menace, wins two planted
  goblin fights at the docks and turns the quest in. `walkTo(slot, range)` finds a way around what stands on
  the floor.
- With `--serve` the smoke test starts the server through `execution/smoke_server.py`, which wraps
  `Dice.roll_d20`: while `$AIVENTURE_DATA/d20.txt` holds numbers, a d20 roll takes the first one and
  removes it. Nothing under `web/`, `engine/` or `client/` reads a test setting.
- Saves still happen on the classic pages, reached from the menu (M or Esc); the classic navigation
  links back with "3D world". Travel, the journal and the ending are in the world ("Travel, journal,
  compass and the ending" below); their classic pages keep working. Battles, events and bosses are met
  and played in the world ("Fighting in the world" and "Events and bosses in the world" below);
  inventory, character sheet and rest are panels and a landmark in the world ("Inventory, character
  sheet and rest" below); the shop and the quests are Elara in her stall ("Elara's shop and quests"
  below). The classic `/shop` page keeps working.

### Travel, journal, compass and the ending

- **Shared functions** in `web/travel.py`, in the pattern of `web/inventory.py`: `travel_view`,
  `travel(session, location_name, in_3d=False)` (`"arrived"`, `"ambush"` or `"defeat"`; raises
  `fight.Rejected` `no_such_location` or `act_locked` before anything changed, through
  `check_destination`), `journal_view`, `ending_view` (raises `not_complete`) and `EPILOGUE`, the
  only copy of the epilogue text. The classic routes `/game/travel`, `/game/journal` and
  `/game/ending` are thin wrappers; the travel page drops the current location from the view.
- **API** (`web/api/travel.py`, under `/api`): `GET travel`, `POST travel` (`{"location"}`),
  `GET journal`, `GET ending`. The GET routes write nothing and are answered whatever is pending.
  `POST travel` checks in this order: `no_character`, `bad_request`, `pending`, `no_such_location`,
  `act_locked`, `already_here` (the last one and `pending` exist in the API only). Its answer is
  `{"travel", "state", "battle", "ambush"}`; `battle` and `ambush` (`id`, `name`, `title`, `intro`)
  are non-null exactly when Lady Vex strikes.
- **The ambush in 3D**: `POST /api/travel` sets `return_to_3d` and the battle place `"road"` (a
  value of `BATTLE_PLACES`); the character is already at the destination in the session. Classic
  `POST /game/travel` still sets `return_to_3d = False` and place `"monster"`.
- **Signpost**: `DressSpec.travel` (from `area.is_start`) places one `landmark: 'travel'`
  (`env/town/signpost`, 2.6 m) after the other landmarks. `slots.travel` is where one stands at
  it (`landmarkPoint`, chosen after `slots.landmark` and `slots.rest`, 1.5 m off every other slot).
  `interactionAt` offers `{kind: 'travel', prompt: 'E: travel'}` within 3 m, last in a tie.
  Measured in `travel.test.ts`.
- **`ROAD_SPEC`** in `dressing.ts` is the road of the ambush: a wilderness area without gates.
  `enterRoad` in `main.ts` builds it in place of the area, with a dirt strip from the spawn through
  `slots.monster` (`buildAreaScene(..., road)`, the only scene with that geometry). While `road`
  is true `contentsOf` gives null, so nothing of the destination is drawn or offered there.
- **`client/src/world/campaign.ts`** (pure): the types of the three views and the lines
  (`travelChoices`, `travelChoiceForKey`, `arrivalTitle`, `shardSockets`, `SHARD_COLOURS`,
  `actBadge`, `endingSteps`, `legendLines`, `ARRIVAL_SECONDS`). **`client/src/world/compass.ts`**
  (pure): `compassMarks(layout, exits, contents, player)`, gates first, then shop, rest, boss,
  signpost; bearing 0 is straight ahead, positive to the left.
  **`client/src/world/campaignPanel.ts`** fills `#travel-panel`, `#journal-panel`, `#arrival`,
  `#hud-compass` and `#ending-panel`. **`client/src/endingScene.ts`** is the crown under the dawn
  sky, plain geometry.
- **`main.ts`**: E at the signpost opens the map (`openTravel`); keys 1 to 8 or a click choose
  (`chooseTravel`: a disabled choice shows its reason in `.panel-message`), Esc closes. `travelTo`
  fades to black, posts, enters the area (`enterArea`) or the road (`enterRoad`, then the
  introduction without Step back), fades back and shows `#arrival`; `travelling` is true
  meanwhile. After an ambush `resumeWalk` and `riseAgain` end in `finishJourney`. A reload with a
  pending fight whose place is `'road'` builds the road again. J and `#menu-journal` open the
  journal (`openJournal`); I, C and J switch between the three panels. The compass is drawn every
  frame while `screen` is `'world'` and not on the road. `proceed` plays the ending
  (`playEnding`, `screen` `'ending'`) after the victory whose rewards say `campaign_complete`;
  "Relive the ending" in the journal plays it too. The ending posts nothing.
- The smoke test travels from the signpost of Rivermeet to the Whispering Woods in both modes
  (map, locked act, fade, arrival, compass, journal); with `--serve` it also travels into Act 2,
  is ambushed and wins (with a reload on the road), reads the journal with three shards, and
  fells Malachar for the ending, which it then relives from the journal.

### What an area holds

- **The roll** is `world.roll_explore(session)` in `web/world.py`: a monster (race, level, name,
  class, weapon drawn by `pick_monster` in `web/fight.py`, nothing built), an event id, or
  nothing, with the odds of classic Explore. It is the first use of `random` in a request and the
  only place this roll exists. `world.roll_contents(session)` stores it.
- **Session**: `area_contents` (`{"location", "area_id", "seq", "monster", "event", "spent"}`, at most one of
  monster and event, `seq` up by one per roll, `spent` the `{"id"}` of the event resolved here since the
  roll: `world.mark_spent`), `return_to_3d` and `engaged_monster` (the contents
  dict of the monster being fought when it was met through engage, else null; a successful flee puts
  it back into the contents, the end of a fight clears it). Contents that name another area
  count as not rolled (`world.stored_contents`). They are rolled by `move_to_area`, classic travel,
  revive, `POST /api/enter` (only when not rolled) and `POST /api/search`. Meeting something takes
  it out (`take_monster`, `take_event`). The undefeated boss of the area is derived
  (`world.area_boss`), never stored.
- **API** (`web/api/world.py`): `POST /api/enter`, `POST /api/search` (refused `occupied` while a
  monster or event is there, `nothing_to_find` without a search spot: `world.has_search_spot`) and
  `POST /api/engage` with `{"id"}`, which answers `{"url", "state", "battle", "event"}`: `/battle` and the
  battle view for a monster (`begin_monster_battle`) or boss, `/game/event` and the event view for an
  event. The world state carries `contents`
  (`seq`, `monster`, `event` with `object` and `label` from `json/event_objects.json` and `landmark`,
  `spent` in the same shape, `boss` with `title` and `intro`, `search_spot`). `spent` is neither
  engageable nor a reason to refuse a search. `GET /api/state` never rolls.
- **Classic Explore** makes the same roll, stores it and meets it at once. `return_to_3d` is set by
  engage and cleared by classic Explore and `POST /battle/boss`; while set, a successful flee, the
  event's Continue, revive and the victory page's `#back-link` lead to `/`.
- **Slots**: `dressArea(...).layout.slots` (`ContentSlots` in `layout.ts`; null from `buildLayout`)
  gives the place of the monster, the event object, the search spot and the boss, and `landmark`:
  where one stands at the special landmark (non-null exactly when the dressing placed one;
  `landmarkPoint` in `dressing.ts`: free, within 2 m of the landmark, reachable, 2 m off trigger zones,
  1.5 m off spawn points, measured in `landmark.test.ts`). `chooseSlots` in
  `dressing.ts` picks them last: 5 m from spawn points and gates, 1.5 m inside the edge, 1 m clear
  of solids, 4 m apart, reachable (its own flood fill), the monster, event and boss off the straight
  lines to the gates. The arena is built around the boss's place (`bossSpot`), which later props
  keep away from. `contents.test.ts` measures all of it for the campaign.
- **`client/src/world/contents.ts`** (pure): `interactionAt(pos, layout, contents)` (what is within
  3 m, its prompt, `auto` for a monster within 1.2 m, `locked` for a barred boss), `contentSolids`
  (the event object and the boss block), and the tables `CREATURES` (race or boss id to model,
  scale, tint, opacity), `EVENT_OBJECTS` (object kind to model and height) and `SEARCH_MARKERS`.
  `MODELS.md` has the same tables.
- **`client/src/world/contentScene.ts`** draws the contents on the slots: figures from
  `loadFigures` (a copy of the file's scene, skinned, playing its idle clip), name plates as
  sprites, the glow of an event object. `main.ts` rebuilds it when the contents change, walks in the
  dressed layout plus `contentSolids`, shows `#prompt` and `#notice`, and runs E.
- **Where the player stood**: before `POST /api/engage` the client saves `{location, area, x, z, yaw}`
  under `sessionStorage['aiv.return']`. An event keeps it until its panel closes, so a reload puts
  the player back in front of it; a fight drops it. When `/` loads with a matching entry and nothing
  pending it posts `/api/enter`, skips the title screen and puts the player there. Continue on the
  title screen posts `/api/enter` too. Nothing met in the world leaves `/`.

### Elara's shop and quests

- **Shared functions** in `web/shop.py`, in the pattern of `web/inventory.py`: `shop_view(session,
  context=None)`, `buy`, `sell`, `haggle`, `accept_quest`, `turn_in_quest`, `abandon_quest`, each
  action returning `{"message", "context", "haggle"}` or raising `fight.Rejected` before anything
  changed; also `tracked_quests`, `dialog(context)`, `REFUSAL_CONTEXT` and the helpers the classic
  page uses (`wares`, `sellable_items`, `active_quests`, `available_quests`, `restock_shop`, ...).
  An action rolls its dice first; Elara's line (`random.choice` in `dialog`) is drawn after, when the
  view is built. `web/routes/shop.py` is the page plus thin wrappers that turn the outcome into the
  flash keys (`shop_message`, `shop_error`, `shop_dialog_context`) and `session.haggle_result`.
  `web/shop.py` imports `Rejected` inside a function: `web.fight` imports `restock_shop` from it.
- **Selling a quest item is refused** in both interfaces (`not_sellable`).
- **API** (`web/api/shop.py`, under `/api/shop`): `GET` (writes nothing, pops no flash; a null
  `shop_inventory` is shown as full stock), `POST buy`, `sell`, `haggle` (`{"item_index"}`),
  `quest/accept`, `quest/turn-in`, `quest/abandon` (`{"quest_id"}`). Every answer is `{"shop",
  "state", "message", "haggle"}`. Checks in this order: `no_character`, `bad_request`, `pending`
  (POST only), `no_shop`, then the action's own refusal (`STATUS` in the router), which carries
  `dialog` for `already_haggled` and `quest_slots_full`. The API sets no flash and leaves
  `haggle_result` alone.
- **State**: `world_state` has the top-level `quests`: the active quests in the order of
  `active_quests` (`id`, `name`, `type`, `target_monster`, `target_count`, `progress`, `status`).
- **Shop slot**: `slots.shop` is where Elara stands, non-null exactly when the dressing placed the
  `shop` landmark: inside the stall's solid box, 0.85 m behind the middle of its table on the side
  away from the default spawn (`keeperPoint`, `stallFront` in `dressing.ts`). She adds no obstacle.
  `interactionAt` offers `{kind: 'shop', prompt: 'E: talk to Elara'}` within 3 m, last in a tie.
  `ELARA` and `ELARA_IDLE` in `contents.ts` are her look and clip; measured in `shop.test.ts`.
- **`client/src/world/shop.ts`** (pure): the types of the views and the lines (`tabForKey`,
  `wareLine`, `wareActions`, `haggleFeedback`, `trackerLines`, `readyCount`, `questBadge`,
  `killAnnouncement`). **`client/src/world/shopPanel.ts`** fills `#shop-panel`, `#shop-haggle`
  (class `haggle-success` or `haggle-failure`, a 0.6 s animation in `style.css`), `#hud-quests` and
  `#hud-quest-ready`; `showHud` in `ui.ts` calls `showQuests` with every state.
- **`contentScene.ts`** draws Elara on `slots.shop` whatever the area holds, with her name plate and
  a gold "!" (`setQuestReady`, set every frame from `readyCount(state.quests)`).
- **`main.ts`**: E at Elara opens the panel from `GET /api/shop` (`openShop`); `panel` is `'shop'`
  and `store` holds the view, the tab and the last haggle. Keys 1, 2, 3 switch tabs, Esc closes; E,
  I, C and M do nothing. A button posts its action (`shopAction`) and the panel and the heads-up
  display are drawn again from the answer. After a victory, Continue shows
  `killAnnouncement(rewards.quest_updates)` in `#notice`.

### Inventory, character sheet and rest

- **Shared functions**, in the pattern of `web/fight.py` (no `Request`, no saving; the line for the
  player comes back, or `fight.Rejected` is raised before anything changed): `web/inventory.py`
  (`inventory_view`, `annotated_items`, `use_potion`, `equip_weapon`, `equip_armor`,
  `unequip_weapon`, `unequip_armor`), `web/sheet.py` (`sheet_view`, `improve`) and `world.rest`.
  The classic routes (`/inventory/*`, `POST /character/improve`, `POST /game/rest`) are thin
  wrappers that turn the line or the refusal into their flash message and redirect.
- **API** (`web/api/character.py`): `GET /api/character` (writes nothing, pops no flash),
  `POST /api/character/improve` (`{"ability"}`), `POST /api/inventory/use`, `equip-weapon`,
  `equip-armor` (`{"item_index"}`), `unequip-weapon`, `unequip-armor` and `POST /api/rest`. Every
  answer is `{"inventory", "sheet", "state", "message"}`, so an equip shows in the sheet's attack
  and AC without another request. Checks in this order: `no_character`, `bad_request` (body through
  `read_object`), `pending` (every POST while `world.pending` is set), then the action's own
  refusal (`STATUS` in the router). The API sets no flash message.
- **State**: `world_state` has the top-level `asi_points` (0 without a character);
  `CHARACTER_KEYS` is unchanged.
- **`client/src/world/sheet.ts`** (pure): the types of both views and the lines of the panels
  (`panelForKey`, `signed`, `itemTitle`, `itemLines`, `itemAction`, `attackLine`, `xpFraction`,
  `asiBadge`). **`client/src/world/sheetPanel.ts`** fills `#inventory-panel` and `#sheet-panel`.
- **`main.ts`**: I and C (and `#menu-inventory`, `#menu-character`) open a panel from
  `GET /api/character`; the key of the open panel or Esc closes it, the other key switches. While
  one is open `screen` stays `'world'`, nobody walks, the pointer is free, and E and M do nothing.
  A button posts its action and the panel is drawn again from the answer, with the answer's or the
  refusal's `message` in `.panel-message`. `#hud-asi` shows `asiBadge(state.asi_points)`.
- **Rest slot**: `slots.rest` is where one stands at the rest landmark (`landmarkPoint` in
  `dressing.ts`, chosen after `slots.landmark` and 1.5 m off every other slot), non-null exactly
  when the dressing placed a `rest` landmark; measured in `sheet.test.ts`. `interactionAt` offers
  `{kind: 'rest', prompt: 'E: rest'}` within 3 m, last in a tie. E fades the view to black over
  0.5 s (`fade` in `ui.ts`), posts `/api/rest`, fades back and shows the message in `#notice`;
  meanwhile `resting` is true and keys do nothing.

### Events and bosses in the world

- **`web/events.py`** is an event as functions of a `GameSession`: `event_view` (the pending event,
  each choice with `skill`, `dc`, `modifier`, `proficient`, `hotkey`), `choose` (resolves, grants XP,
  stores `event_result` with the `event_id`, spends a `once` event, `world.mark_spent`), `dismiss`
  and `carry_on` (clears the result; `"fight"` or `"defeat"` when the outcome started a fight under
  the conditions of `GET /battle/start`, else `"world"`), `result_view` and `location_tier`. It raises
  `fight.Rejected` (`no_event`, `no_such_choice`, `nothing_to_continue`) before anything changed. The
  classic routes in `web/routes/game.py` call the same functions; classic Continue still leads to
  `GET /battle/start`, which starts the fight.
- **API** (`web/api/event.py`, under `/api/event`): `GET` (`{"event", "result", "state"}`, writes
  nothing), `POST choose` (`{"choice"}`) and `POST continue` (adds `battle`: the view when a fight
  began, else null). Bodies go through `read_object` of `web/api/battle.py`; a refusal leaves the
  session file untouched.
- **Discoveries**: an event with `special` is marked `landmark: true`. It has no object on the event
  slot: the special landmark of the area glows and carries the name plate, and the prompt shows within
  3 m of `slots.landmark` (`eventPlace` in `contents.ts`).
- **What is left**: `contents.spent` is drawn by `remainsOf(object)`: `'stays'` objects without glow,
  light and plate (a chest opened, the rest darkened) and still blocking, `'gone'` ones not at all.
- **Where a fight stands**: the session key `battle_place` (`monster`, `event`, `landmark`, `boss`;
  missing or unknown counts as `monster`) is set by `fight.begin_battle(..., place)` and answered as
  `battle.monster.place`; `fightSlot(slots, place)` in `contents.ts` gives the point. `boss`: engage
  with a boss id and classic `POST /battle/boss`. `event` / `landmark`: `POST /api/event/continue`.
  `monster`: everything else.
- **Boss keys of the battle view**: `monster.taunt` (boss in a fight only: its last line in the
  stored log, else the first of `taunts.start`; no dice) and `monster.enrage_text`.
- **`client/src/world/event.ts`** (pure) has the types and the lines of the panel (`choiceForKey`,
  `choiceLine`, `rollLine`, `verdict`, `outcomeChips`); **`client/src/battle/boss.ts`** (pure) has
  `bossLook(id, enraged)`, `ENRAGE_LOOK`, `enrageCue(events, timeline)` and `victoryLines(boss)`.
- **`client/src/world/eventPanel.ts`** fills `#event-panel` and `#boss-intro`. `main.ts` holds both
  (`openEvent`, `chooseEvent`, `proceedEvent`, `openIntro`, `fightBoss`): keys 1-4 choose, Enter,
  Space or E continue; E at a boss opens the introduction and sends nothing until Fight (Enter,
  Space, E), Esc steps back. While either is open nobody walks and M and Esc open no menu. When `/`
  loads with an event pending, the area is entered and the panel opened from `GET /api/event`.
- **Boss fight on screen**: `#battle-monster` gets the classes `boss` and `enraged`, the title and
  `#battle-taunt`; at the banner cue of an `enrage` event `#battle-enrage` shows the line for 2.5 s and
  `battleScene.setEnraged` gives the model its rage look; the result panel shows `victoryLines` as
  `.boss-line[data-kind]` (the defeat text before the rewards, the rest after).
- **Lady Vex's ambush is fought in the classic interface.** Only classic `POST /game/travel` starts
  it; the route sets `return_to_3d = False` and place `monster`, so victory, defeat and revive lead to
  classic pages. Opening `/` during it shows it like any pending fight, on the monster slot.

### Fighting in the world

- **`web/fight.py`** is the fight as functions of a `GameSession`: `attack`, `defend`,
  `use_ability`, `use_item`, `flee`, `finish_player_turn` (the round loop, once), `end_battle`,
  `revive`, and the helpers that start a fight (`begin_battle`, `begin_monster_battle`,
  `begin_boss_battle`, `pick_monster`). No `Request`, no saving, no redirects. An action returns
  the phase after it (`"fight"`, `"victory"`, `"defeat"`, `"fled"`) or raises `Rejected(code,
  message)` before anything changed (`no_battle`, `not_your_turn`, `no_such_ability`,
  `not_enough_pp`, `no_such_item`, `cannot_flee`, `not_defeated`): a rejected action starts no turn
  and writes no log line. Both routers call them as `fight.attack(session)`, and the actions call
  `finish_player_turn` by its module-level name.
- **Classic routes** (`web/routes/battle.py`) are the pages plus thin wrappers: call the action,
  save, redirect by phase; on `Rejected` back to `/battle` without saving. Fleeing from a boss
  sets the flash `battle_message`, which `GET /battle` shows once as a toast. The names other code
  imports from there (`begin_boss_battle`, `opened`, `end_battle`, `pick_monster`, ...) still exist.
- **API** (`web/api/battle.py`, under `/api/battle`): `GET` (the view; writes and rolls nothing),
  `POST attack`, `defend`, `ability` (`{"ability_id"}`), `item` (`{"item_index"}`), `flee`,
  `continue` (after a victory: clears `battle_rewards`) and `revive`. Every answer is
  `{"battle", "state"}`. A refusal leaves the session file untouched. Bodies are read as strict
  JSON (no NaN, no repeated keys, UTF-8 only); a body that is not a JSON object is `bad_request` on
  every POST, also on the ones that take nothing.
- **Battle view** (`fight.battle_view(session, fled)`): `phase` (`fight`, `victory`, `defeat`,
  `fled`, `none`), `round`, `player_turn`, `turn` (`seq`, `events`), `player`, `monster`,
  `abilities` (with `summary`, `usable`, `hotkey`), `items` (stacks with `index`, `count`,
  `hotkey`), `can_flee`, `flee`, `log`, `rewards`, `defeat`. It carries no taunt, so building it
  uses no randomness. `client/src/battle/view.ts` (pure) has the same shape as `BattleView` and
  `actionForKey(view, code)`, the classic hotkeys (A/D/F, 1-5, Q/W/E/R).
- **`client/src/battle/timeline.ts`** (pure): `buildTimeline(events, after, finale)` turns a turn's
  events into cues (`banner`, `anim`, `fx`, `float`, `hp`) on a clock: 0.25 s lead-in, a slot per
  event, 0.9 s for the loser's fall, never more than 6 s (a longer turn is played faster).
  `inputAt` is when input opens again. `client/src/battle/fx.ts` (pure) gives each of the 23
  effect keys a colour and a particle pattern.
- **`client/src/world/contents.ts`** also holds `CREATURE_CLIPS` (clip names per model, as in
  `MODELS.md`), `creatureMotion(model, slot)` (the clip, or the fallback motion `lunge`, `shake`,
  `sink`) and `battleStance(from, slot, layout)`: 2.5 m in front of the monster on the side the
  player came from, or the nearest free point 1.5 to 2.5 m from it.
- **`client/src/battle/battleScene.ts`** draws the fight: the monster where the view's `place`
  puts it (`fightSlot`) with its clips, particles per effect key, what flies for a ranged hit, and
  the offsets of the player's eye (lunge, rise, shake, sidestep, fall). `battle/panel.ts` fills
  `#battle-panel` (`#battle-monster`, `#battle-player`, `#battle-actions`, `#battle-log`,
  `#battle-banner`, `#battle-result`), the floating texts and the flash of an effect on the player.
  Both run cues and show the view; neither decides anything.
- **`main.ts`** holds the fight (`startBattle`, `present`, `act`, `proceed`, `riseAgain`): after
  an engage answer (or an event's Continue) with a battle the client stays on `/`, the view glides to the stance in 0.4 s,
  and M, Esc, E and the movement keys do nothing. A turn whose `seq` differs from
  `sessionStorage['aiv.turn']` and has events is played once; otherwise the result is shown at once.
  Buttons and hotkeys are locked from sending an action until `inputAt`. Victory shows the rewards
  and Continue (Enter or Space) posts `continue`; defeat shows Rise Again (`revive`) and Start
  Over; a flight closes the panel. When `/` loads with a battle or defeat pending, the area is
  entered and the panel opened from `GET /api/battle`, without the title screen.

## Classic application (the code this repository started from)

Everything below describes the Python rules engine and the server-rendered interface copied from AIVentures. The rules engine stays. The server-rendered pages are replaced screen by screen and removed at the end.

### Commands (classic)

### Run the web app
```bash
uv sync
uv run uvicorn web.app:app --reload --port 8000
```

### Run tests
```bash
uv run pytest                          # all tests
uv run pytest test/test_battle.py      # single test file
uv run pytest -k "test_name"           # single test by name
```

### Screenshot every screen
```bash
uv run python tools/ui_tour.py OUT_DIR --mobile      # all screens, desktop + 390px
uv run python tools/ui_tour.py OUT_DIR --only battle,battle-hit,location
uv run python tools/make_sprites.py --preview OUT_DIR   # redraw the sprite sheets, with 4x previews
```
Plays a scripted game through the routes with a temp session folder and captures each screen with headless Chrome (flatpak by default, `--chrome` to override). Run it after changing templates or CSS. Key hints (`<kbd>`) are hidden in these captures because headless Chrome reports no hover.

## Architecture

### Domain Model (root-level `.py` files)

The game uses a D&D 5e rules engine with an `Entity` base class:

- **`Entity`** → base class with ability scores (STR/DEX/CON/INT/WIS/CHA), modifiers, AC calculation (light/medium/heavy armor rules), skill checks, saving throws, proficiency bonus, and equipment slots (`EquipmentType` enum)
- **`Character(Entity)`** → player: weapon slots (`WeaponSlot.MAIN_HAND`/`OFF_HAND`), inventory, XP/leveling, hit die, gold, healing potions, `power_points`/`max_power_points`/`active_effects` for the ability system
- **`Monster(Entity)`** → enemy: created by `MonsterFactory`, has a single `weapon` attribute (not slots)
- **`Weapon(Equipment)`** → damage_die, damage_dice_count, damage_type, category (Simple/Martial), properties (finesse, ammunition determine attack modifier)
- **`Armor(Equipment)`** → base_ac, category (Light/Medium/Heavy), affects AC calculation differently per category
- **`QuestItem(Item)`** → quest-specific item with `quest_id` field, `is_usable_in_battle=False`. Used for gather quests.

### Factory Pattern

All entity/item creation goes through factories that read from `json/` data files:
- **`CharacterFactory`** → reads `races.json`, `races_default_values.json`, `classes_properties.json`. Call: `factory.create_character(name, race, class_name)`
- **`MonsterFactory`** → reads `monster_default_values.json`. Call: `factory.create_monster(name, race, class_name, level, weapon_name)`
- **`WeaponFactory`** → reads `weapon-catalog.json`. Call: `factory.get_weapon_by_name(name)`
- **`ArmorFactory`** → reads `armor_catalog.json`. Call: `factory.get_armor_by_name(name)`
- **`LootGenerator`** → tier-based loot drops (potion/gold/weapon/armor) with weighted chances

### Game Engine (`engine/`)

Headless game logic shared across the application — no I/O, no web framework imports:

- **`engine/combat.py`** → `resolve_attack_roll()` (nat 20 crit / nat 1 miss), `resolve_weapon_attack()`, `resolve_flee()`, `get_weapon_attack_modifier()`, `roll_initiative()`, `calculate_xp_reward()`, `calculate_gold_reward()`
- **`engine/abilities.py`** → `resolve_player_ability()` — player class abilities (all attack methods, damage, healing, effects)
- **`engine/monster_ai.py`** → `choose_monster_action()`, `resolve_monster_ability()`, `tick_cooldowns()` — monster decisions and special abilities
- **`engine/effects.py`** → `get_effect_bonus()`, `tick_effects()`, `is_stunned()`, `resolve_round_conditions()`, `describe_effect()` — effect duration, stacking, conditions
- **`engine/leveling.py`** → `calculate_max_pp()`, `grant_xp()`, `asi_points_available()`, `improve_ability()`, `apply_ability_increases()` — power points; XP award with level-up HP and PP handling; Ability Score Improvements
- **`engine/campaign.py`** → `highest_unlocked_act()`, `is_act_complete()`, `get_area_boss()`, `collected_shards()`, `pending_ambush()` — pure progression rules derived from the defeated-boss list
- **`engine/events.py`** → `pick_event()`, `resolve_event_choice()`, `apply_outcome()` — exploration skill-check events
- **`engine/quests.py`** → `check_quest_progress()`, `turn_in_quest()` — quest state mutations after kills and turn-ins
- **`engine/combatant.py`** → `CombatantState`, `WeaponState` dataclasses — serializable battle state for monsters (replaces flat fields)

### Ability / Magic System

All 11 classes have unique abilities powered by **Power Points (PP)**:
- **Data**: `json/abilities.json` — 55 abilities (5 per class), each with cost, unlock_level, attack_method, damage/heal/effects
- **PP calculation** in `engine/leveling.py`: `calculate_max_pp(class_name, level, primary_modifier)` — full casters get `level + mod`, half casters and Monk `level//2 + mod`, martial `level//3 + mod` (min 2)
- **Scaling**: `scaling` (`{"level": {"dice_count": n}}`) applies to the damage dice, or to the heal dice of an ability with no damage. Every damage ability costing 2+ PP must scale (a test enforces it), otherwise the free abilities overtake it
- **`self_effects`**: effects an enemy-targeted ability puts on the player whether it hits or not (Reckless Attack: -3 AC for the round)
- **Display**: `summarize_ability(ability, level)` in `engine/abilities.py` returns the stat lines shown on the battle ability cards ("2d10 + mod slashing", "Self: damage bonus +2, whole fight")
- **Helpers** in `web/game_session.py`: `get_abilities()`, `get_class_abilities(class_name, level)`, `get_primary_modifier(character)`
- **Combat resolution** in `engine/abilities.py`: `resolve_player_ability()` handles all attack methods (melee_attack, spell_attack, spell_save, auto_hit), crits, damage, healing, and effect application. Enemy-targeted effects only apply if the ability lands (hit / failed save)
- **Active effects**: stored on `BattleState` (`player_effects`) and `CombatantState` (`effects`). Each effect has `stat`, `value`, `duration`, `source`. Duration 0 = lasts entire combat, positive = rounds remaining. `tick_effects()` decrements each round. `get_effect_bonus(effects, stat)` sums bonuses.
- **Stat modifiers**: `ac`, `attack_bonus`, `damage_bonus`, `damage_reduction` — applied in weapon attacks, ability attacks, and monster turns
- **Conditions** (same effect dict, special `stat`): `poison`/`burn`/`bleed` deal `value` damage at end of each round, `regen` heals, `stun` skips the bearer's turn. Bosses are immune to stun
- PP initialized on character creation, restored on rest, recalculated on level up

### Ability Scores

- Starting scores = race defaults + race bonus + class `ability_bonuses` (`json/classes_properties.json`: +4 primary, +2 secondary)
- **Ability Score Improvements**: 2 points at each of levels 4, 8, 12, 16, 19 (`ASI_LEVELS`), +1 per point, cap 20. Unspent points are derived (`asi_points_available()` = earned for level − spent), so old saves get theirs automatically
- Spent points live in `Character.ability_increases` (`{"strength": 2, ...}`), serialized with the character and re-applied by `apply_ability_increases()` in `_restore_character()` — characters are rebuilt from the factory on every request, so scores themselves are never stored
- `improve_ability()` handles side effects: Constitution adds `level` HP per modifier point, the class primary ability grows the PP pool, AC is recalculated
- AC is always derived (`update_ac()` on restore), never read from the save. `unarmored_defense` in class data (Monk: Wisdom, Barbarian: Constitution) adds that modifier to AC when no armor is worn
- UI: `/character/summary` is the character sheet with +1 buttons (`POST /character/improve`); the nav shows a badge while points are unspent

### Quest System

JSON-driven quest system with kill and gather quest types:
- **Data**: `json/quests.json` — 9 quests across 3 acts (4 Act 1, 3 Act 2, 2 Act 3)
- **Quest types**: Kill quests track monster kills; gather quests drop `QuestItem`s with a % chance on matching monster kills
- **Engine**: `engine/quests.py` — `check_quest_progress()` called after each kill, `turn_in_quest()` handles rewards and inventory cleanup
- **Session state**: `active_quests: dict` (`{quest_id: {"progress": int, "status": "active"|"ready"}}`), `completed_quests: list` (max 3 active)
- **Shop UI**: 3-tab interface (Wares/Sell/Quests) in `web/templates/shop/index.html`. Quest board shows available + active quests with progress bars, accept/turn-in/abandon actions
- **Routes**: `POST /shop/quest/accept`, `POST /shop/quest/turn-in`, `POST /shop/quest/abandon`
- **Rewards**: Gold + XP granted on turn-in; gather quest items removed from inventory on completion
- **Dialog**: Shopkeeper Elara has quest-specific dialog lines in `json/shopkeeper.json`

### Battle System

Combat is handled by `web/fight.py` (the actions and the round loop, called by the routes in `web/routes/battle.py` and by the JSON API) with game logic in `engine/`:

- **Round loop**: every player action ends in `finish_player_turn()` — monster turn (skipped if stunned) → end-of-round conditions (DoT/regen) → tick effects and cooldowns → next round. A stunned player loops again and loses their turn. All of this is in `web/fight.py`, shared with the JSON API. Add a new player action there: check with `check_turn(session)`, raise `Rejected` before changing anything, then `begin_turn`, mutate, `record`, and `return finish_player_turn(session)`; give it a thin route in `web/routes/battle.py` and `web/api/battle.py`
- **Critical hits**: natural 20 always hits and doubles damage dice; natural 1 always misses (weapon attacks and attack-roll abilities, both sides)
- **Monster abilities**: `json/monster_abilities.json` (`races` → ability ids, `abilities` → definitions with `kind` attack/save/self, `cooldown`, `use_below_hp`, `lifesteal`, effects). Timed effects applied on the monster's turn get +1 duration because the monster acts last in the round
- **Bosses**: `json/bosses.json`, keyed by the `boss` id on a `campaign.json` area. Built with `CombatantState.from_boss()` (authored HP/AC/scores, no factory). Enrage once at ≤50% HP, cannot be fled, fixed XP/gold rewards, guaranteed loot. Started via `POST /battle/boss` or `begin_boss_battle()` (travel ambush)
- **Flee**: `POST /battle/flee` — d20 + DEX vs DC 10 + monster level // 2; failure costs the turn. From a boss it is rejected with a toast and no log line
- **Player defend** is a 1-round `ac` effect, not a mutation of `armor_class`
- **Monster state**: `CombatantState` dataclass (in `engine/combatant.py`) with `to_dict()`/`from_dict()`/`from_monster()` for serialization
- **Attack resolution**: `engine/combat.py` `resolve_weapon_attack()` — d20 + ability mod + proficiency + effect bonuses vs AC + effect bonuses. Returns `{hit, attack_roll, target_ac, damage}`
- **Weapon modifiers**: `get_weapon_attack_modifier()` — finesse uses max(STR,DEX), ammunition uses DEX, else STR
- **Monster AI**: `choose_monster_action()` — heal when wounded, use abilities off cooldown (chance rises with level; higher for bosses), otherwise attack/defend
- **Effects**: `engine/effects.py` — `tick_effects()` per round, `get_effect_bonus()` for stat queries
- **Battle actions**: `POST /battle/attack`, `POST /battle/defend`, `POST /battle/ability` (with `ability_id` form field), `POST /battle/item`, `POST /battle/flee`
- **Battle screen**: abilities are cards (`.ability-card`) with cost, description and stat lines; identical items share one button. Hotkeys via `data-hotkey`: A/D/F, 1–5 abilities, Q/W/E/R items
- **Turn events**: every turn is recorded as a list of event dicts (`engine/turn_events.py`: actor, kind, name, outcome, fx, ranged, HP change per side) in `BattleState.turn_events`, with `turn_seq` going up each turn. Routes call `begin_turn(session)` before a player action and `record(session, actor, kind, ...)` after each step; HP changes are measured between steps, not passed in. A rejected action (no PP, bad item) must not call `begin_turn`
- **Battle stage** (`web/templates/battle/_stage.html`, `web/static/js/battle.js`): status plates, two actors on a backdrop and an effects canvas. `battle.js` rewinds the HP bars to before the turn and plays the events in order (actor animation, effect on the target, floating number, bar step). Each `turn_seq` plays once per browser tab (`sessionStorage`), so a refresh shows the result without replaying. `stage_context(session)` builds the template data; the victory and defeat pages include the same partial with `finale` set, so the final blow and the loser's death are shown there
- **Effects**: `FX` in `battle.js` has one particle effect per key in `FX_KEYS` (every damage type plus heal, buff, debuff, shield, stun, rage, bleed, burn, regen). `ability_fx()` picks the key for an ability; a new damage type needs an entry in both places
- **Sprites**: `json/battle_sprites.json` maps player portraits, monster races and boss ids to `{sheet, scale}` (sheets in `web/static/images/sprites/`; `scale` enlarges big creatures on the stage). Unmapped races and portraits use `default_monster` / `default_player`; a test requires a sprite for every campaign race and every boss. Sheets are 4x4 frames of 64x48, facing right: rows idle, attack, hurt, death
- **Drawing sprites**: `tools/make_sprites.py` draws every sheet in code (needs Pillow). Two-legged and floating creatures are entries in `FIGURES`: a pose style (`swing`, `thrust`, `cast`, `punch`) and a spec dict (build, colours, head, weapon, extras) for the shared rig `draw_figure()`. The Knight, Goblin, Sea Serpent and Fire Salamander have their own draw functions. To add a creature: add a `FIGURES` entry, run the tool with `--preview DIR` and check `overview.png`, then map it in the JSON. A sheet from Aseprite or a pack works if it keeps the layout
- **Victory**: `battle_rewards` stays in the session until the next battle ends, so the victory page survives a refresh
- **Monster data**: Taunts in `json/monster_taunts.json`, portraits in `json/monster_portraits.json`
- **Player portraits**: Selected during character creation (3 options: Knight, Berserker, Wizard). Stored in `CharacterCreationState.portrait`

### Campaign Progression

- `GameSession.defeated_bosses` is the only stored progression state; unlocked act, shards and completion are **derived** by `engine/campaign.py`
- An act is complete when every boss placed on one of its areas is defeated → next act unlocks for travel (`/game/travel` lists all acts, locked ones greyed out)
- Bosses may declare `requires` (other bosses first — Malachar needs Lady Vex), `shard` (crown shard awarded), `ambush` (`{"act", "after_act_bosses"}` — sprung on travel; Lady Vex in Act 2)
- `GET /game/journal` shows main quest, shards, bosses, stats; `GET /game/ending` is the epilogue once all acts are complete

### Location Screen

- `build_area_map(location, current_area, defeated_bosses)` in `web/routes/game.py` lays the location's areas out top-down: row = steps from the location's first area, positions in percent. The template draws edges in an SVG and nodes as absolutely positioned boxes; only areas one step away are buttons (`POST /game/move`)
- Node markers: danger band on the top border (`_danger()`: safe/low/med/high from `encounters`), Shop, Rest, Boss/Cleared tags
- Hotkeys: E explore, R rest, S shop, T travel

### Exploration Events

- `POST /game/explore`: encounter roll first; otherwise `EVENT_CHANCE` (65%) to pick an event from `json/events.json`
- Events are filtered by `location_types`; events with `special` only fire in areas with that `special` string, take priority, and are `once`
- Each choice is a skill check (`skill`, `dc`, `success`/`failure` outcomes) or a no-check `outcome`. Outcome keys: `text`, `gold`, `xp`, `heal_pct`, `pp`, `damage` `[count, size]`, `potion`, `battle`. Rewards and DCs scale with the location tier (low end of `encounterLevel`)
- State: `pending_event` (awaiting choice — `/game` redirects to `/game/event`), `event_result` (shown once), `completed_events`
- Routes: `GET /game/event`, `POST /game/event/choose`, `POST /game/event/continue`

### Balance

Class kits, boss and monster numbers were tuned with `tools/balance_sim.py`, which plays fights through the real routes (`uv run python tools/balance_sim.py bosses` / `monsters`, see its docstring; pass `--classes` with all 12 names for a class comparison). Targets: every class averages roughly 60–80% against at-level bosses with 3 potions (the simulated player spends its ASIs on the primary ability), regular fights 90%+ with most HP left. The simulator never uses one-round defensive abilities (Arcane Shield, Patient Defense, Cunning Dodge), so classes built around them are slightly better in real play than their numbers. Re-run it after changing combat numbers.

### Web Application (`web/`)

- **`web/app.py`** → FastAPI app, mounts static files, includes route blueprints at `/character`, `/game`, `/battle`, `/shop`, `/inventory`
- **`web/game_session.py`** → `GameSession` class with server-side file storage. Contains `CharacterCreationState`, `BattleState`, quest state, shop state, and references to campaign location/area data. Character objects are recreated from factory on each request via `_restore_character()`. Also contains JSON data loaders with caching.
- **`web/dependencies.py`** → FastAPI dependencies `require_character` and `require_battle` for route guards (replaces boilerplate `if not session.character` checks)
- **Inventory** (`web/routes/inventory.py`): `POST /inventory/use` drinks a healing potion outside battle; identical potions and quest items are stacked; backpack weapons show average damage and armor shows resulting AC (`Character.ac_if_wearing()`) against what is equipped
- **Character creation**: class cards show `playstyle` (from `classes_properties.json`) and the class's abilities; the details page previews final scores, HP, PP and the AC for each armor choice
- **Nav**: XP progress bar under the level (`xp_to_next_level` in the serialized character)
- **Routes** use server-side rendering with Jinja2 templates and POST/Redirect/GET pattern (303 redirects)
- **Templates** are rendered with `templates.TemplateResponse(request, "name.html", {...})` (request first — required by current Starlette)
- **Templates** in `web/templates/` extend `base.html` — all styling in `web/static/css/style.css`, JS in `web/static/js/main.js` plus `battle.js` for the battle stage (no inline scripts in templates; inline `style` only for computed values such as bar widths)

### Session / Save System

Game state uses **server-side file storage**:
- **Cookie**: Contains only a `session_id` string (~100 bytes) via Starlette `SessionMiddleware`
- **Server files**: `web/sessions/{session_id}.json` stores the full serialized `GameSession`
- **`get_session(request)`**: Reads session_id from cookie, loads JSON file from disk
- **`save_session(request, session)`**: Writes JSON file to disk, sets session_id in cookie
- **Flash messages**: `session.set_flash(key, value)` / `session.pop_flash(key)` for one-time display messages (shop notifications, inventory messages)
- **All state in one place**: Character, battle, shop inventory, haggle state, quest progress, battle rewards — all stored in `GameSession.to_dict()`, no scattered `request.session` keys

### Shop System

- **Shopkeeper NPC** (Elara) with portrait and dialog system — all dialog lines in `json/shopkeeper.json`
- **Default inventory** in `json/shop_inventory.json`
- **Haggling**: Persuasion skill check → tiered discounts (nat20: 40% off, nat1: 25% markup). Each item can only be haggled once per restock
- **Buy/sell** with price calculation (sell = 50% of buy price)
- **Restocking**: After 10 monster kills or player death
- **3-tab UI**: Wares, Sell, Quests — tab state preserved via `?tab=` query param
- **Quest items filtered** from sell list (can't sell quest items)

### UI Design System (`web/static/css/style.css`)

Consolidated CSS design system with:
- CSS custom properties for colors, spacing, typography, radii, shadows
- Cinzel font for headings (loaded from Google Fonts in `base.html`)
- Reusable components: `.glass`, `.panel`, `.btn-*`, `.selection-card`, `.stat-box`, `.health-bar`, `.toast`, `.steps` (step indicator), `.effect-badge`, `.btn-ability`/`.btn-ability-free`
- Battle arena uses glassmorphism with background image overlay
- Portrait styles: `.player-portrait`, `.monster-portrait`, `.summary-portrait`, `.portrait-grid` (selection)
- Shop tabs: `.shop-tabs`, `.shop-tab`, `.shop-tab-panel`
- Quest board: `.quest-card`, `.quest-progress-bar`, `.quest-type-badge`
- Monster taunt bubble: `.monster-taunt`
- Bosses: `.boss-panel` (location), `.boss-banner`, `.combatant.boss`/`.enraged`, `.boss-defeat-panel`, `.shard-gem`
- Events: `.event-card`, `.event-choice`, `.outcome-chip`; reuses `.haggle-roll-result` for the d20 breakdown
- Journal/travel: `.journal-act`, `.shard-row`, `.travel-act`, `.loc-tag`
- Area map: `.area-map`, `.map-node`, `.map-edge`, `.map-tag`, `.map-danger-*`
- Battle: `.ability-card`, `.float-number`; HP bar colour via `.hp-mid`/`.hp-low`
- Battle stage: `.battle-scene`, `.stage-hud`/`.hud-plate`, `.battle-stage` (`--px` = screen pixels per sprite pixel), `.actor`, `.sprite`, `.actor-portrait`, `.stage-banner`, poses `.pose-lunge`/`.pose-cast`/`.pose-dodge`/`.is-hit`/`.is-dead`
- `kbd` key hints (hidden on touch devices), `.xp-bar`, `.item-compare`, `.char-preview`, `.class-abilities`
- Responsive breakpoints at 768px and 480px

### JavaScript (`web/static/js/main.js`)

- `SFX` object: Web Audio API synthesized sounds (hit, crit, miss, heal, defend, spell, victory, defeat, levelup, coin, click)
- Toast notification system (`showToast`, `initToasts` — reads `data-toast` elements)
- Confetti effect (`showConfetti`) and screen shake (`screenShake`) triggered by `data-confetti`/`data-screen-shake` attributes
- `initShopTabs()`: Tab switching with URL param auto-select (`?tab=quests`)
- `initHotkeys()`: pressing a key clicks the enabled element with that `data-hotkey`; ignored while typing in a field
- `initSubmitGuard()`: a POST form can only be submitted once per page load
- `initFillBars()` (`data-fill` bars animate on load), `initArmorPreview()`
- `battle.js` is a second file, loaded only by the arena, victory and defeat templates (after `main.js`, whose `SFX` it uses)
- Selection card handler, skill counter, battle log auto-scroll, health bar coloring, active nav link detection

### Game World (`json/campaign.json`)

Campaign data defines acts → locations → areas. Each area has `connections` (list of area IDs for navigation), `encounters` (0-10 rating for encounter chance), `monster_types`, optional `special` strings (e.g., "shop", "inn" which enable shop/rest features in the web UI, or a key matched by one-time events), and optional `boss` (id into `json/bosses.json`).

### Key Design Patterns

- Factories load JSON config once and create domain objects
- Ability modifiers derived as `(score - 10) // 2` everywhere
- `sys.path.insert(0, ...)` used in web modules to import root-level game modules
- `CombatantState` dataclass stores monster battle state with `to_dict()`/`from_dict()` for serialization
- `BattleState` has backward-compatible properties proxying to `CombatantState` for gradual migration
- Shop restocks after 10 monster kills or player death
- All game data is JSON-driven — abilities, quests, taunts, portraits, shopkeeper dialog, shop inventory
- Active effects are flat stat modifiers (`{stat, value, duration, source}`) applied per-round via `get_effect_bonus()`
- Server-side session files replace cookie storage — no 4KB limit, state persists across browser restarts
- Flash messages (`set_flash`/`pop_flash`) for one-time notifications
- FastAPI `Depends()` for route guards (`require_character`, `require_battle`)
- `Character.level_up()` and `gain_xp()` return result dicts instead of printing — callers decide presentation
