#!/usr/bin/env node
// Browser smoke test.
//   node execution/smoke.mjs --url URL --out DIR     against a server that is already running
//   node execution/smoke.mjs --serve --out DIR       builds nothing, but starts its own server on a
//                                                    free port with an empty data folder (run `pnpm build` first)
// In both modes it makes its character in the creation panel of the 3D client (no classic creation route is
// called), reads the opening, changes the settings and reloads, saves, loads and deletes a save from the menu
// and quits to the title screen. With --url and ten saves on the server the save steps are skipped.
// With --serve it also fights in the 3D world: a win, an ability and an item, a flight, a defeat with
// Rise Again, and a reload in the middle of a fight; it plays events in the event panel (a success, a
// failure, one that ends in a fight, a discovery at its landmark) and fights the first boss to the end.
// In both modes it opens the inventory and the character sheet; with --serve it also drinks a potion,
// equips a weapon and an armour, spends an ability point and rests at the inn front.
// In both modes it talks to Elara in the market and looks at the three tabs of her shop; with --serve it
// also haggles (a success and a failure), buys, sells, and takes a quest from accepted to turned in.
// The d20 of those events is fixed through execution/smoke_server.py, which it starts the server with.
// In both modes it travels from the signpost of Rivermeet to the Whispering Woods (the map, a locked act, the
// fade, the arrival title), reads the compass and opens the journal. With --serve it also travels into Act 2,
// is ambushed by Lady Vex on the road and wins, reads the journal with three shards, and fells Malachar to see
// the ending, once after the fight and once from the journal.
// Loads the 3D client and the classic interface from a running server in headless Chromium,
// saves a screenshot of each step to DIR, and exits 1 on a page error, console error,
// failed request, HTTP status >= 400, a 3D view that renders nothing, a model that did not load,
// or a frame of more than 150,000 triangles.
// With --serve it owns the data folder: it marks every boss as defeated in its session file to
// unlock Acts 2 and 3 and visits all eight locations. With --url it stays in Act 1 and prints
// which screenshots it skipped.
// Needs playwright-core (pnpm install) and a Chromium in ~/.cache/ms-playwright.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const campaign = JSON.parse(readFileSync(join(repo, 'json/campaign.json'), 'utf8'));
const bosses = JSON.parse(readFileSync(join(repo, 'json/bosses.json'), 'utf8'));
const MAX_TRIANGLES = 150000;

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
let url = arg('--url');
const out = arg('--out');
const serve = args.includes('--serve');
if ((!url && !serve) || !out || args.includes('--help')) {
  console.log('usage: node execution/smoke.mjs (--url URL | --serve) --out DIR');
  process.exit(args.includes('--help') ? 0 : 2);
}
mkdirSync(out, { recursive: true });

let server;
let dataDir;
if (serve) {
  const port = await new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  url = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(join(tmpdir(), 'aiv-smoke-'));
  server = spawn('uv', ['run', 'python', join(repo, 'execution/smoke_server.py'), '--port', String(port)], {
    cwd: repo,
    env: { ...process.env, AIVENTURE_DATA: dataDir },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${url}/health`).then((r) => r.ok, () => false);
  }
  if (!up) {
    server.kill();
    console.log('the server did not answer on /health within 30 s');
    process.exit(1);
  }
}

const cache = join(homedir(), '.cache', 'ms-playwright');
const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const sub = readdirSync(join(cache, dir)).find((d) => d.startsWith('chrome'));
const browser = await chromium.launch({
  executablePath: join(cache, dir, sub, 'chrome'),
  // Software WebGL, so the test also runs on a machine without a GPU.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errors = [];
/** Reports what goes wrong on a page. A line for which `tolerate` answers true is let through. */
function watch(p, tolerate = () => false) {
  const report = (line) => tolerate(line) || errors.push(line);
  p.on('pageerror', (e) => report(`page error: ${e}`));
  p.on('console', (m) => m.type() === 'error' && report(`console: ${m.text()} (${m.location().url})`));
  p.on('response', (r) => r.status() >= 400 && report(`${r.status()} ${r.url()}`));
  p.on('requestfailed', (r) => report(`request failed: ${r.url()}`));
  // The character is made in the 3D client: nothing here goes to a classic creation route.
  p.on('request', (r) => new URL(r.url()).pathname.startsWith('/character') && report(`a request to ${r.url()}`));
}
let page = await context.newPage();
watch(page);

let shots = 0;
async function shot(name) {
  shots += 1;
  await page.screenshot({ path: join(out, `${String(shots).padStart(2, '0')}-${name}.png`) });
}

/** Share of sampled pixels in the 3D canvas that differ from its first pixel. 0 means nothing was drawn. */
async function canvasVariety() {
  const png = await page.locator('canvas#view').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let differ = 0;
    for (let i = 4; i < d.length; i += 4) {
      if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 24) differ += 1;
    }
    return differ / (d.length / 4);
  }, png.toString('base64'));
}

/** In the page: the area is loaded, its scene is built and the player stands in it. */
const inWorld = () => window.__aiv.screen === 'world' && window.__aiv.loading === false && window.__aiv.layout !== null && window.__aiv.player !== null;

/**
 * Waits until the area is loaded and drawn, then saves the screenshot. Fails on a blank view,
 * on a model that did not load (other than those in `missing`) and on too many triangles.
 */
async function worldShot(name, missing = []) {
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  const frames = await page.evaluate(() => window.__aiv.frames);
  await page.waitForFunction((n) => window.__aiv.frames > n + 5, frames, { timeout: 30000 });
  let variety = 0;
  for (let i = 0; i < 10 && variety < 0.05; i++) {
    await page.waitForTimeout(300);
    variety = await canvasVariety();
  }
  await shot(name);
  if (variety < 0.05) errors.push(`${name}: the 3D view is blank: only ${(variety * 100).toFixed(1)}% of sampled pixels differ from the background`);
  const seen = await page.evaluate(() => ({ modelErrors: window.__aiv.modelErrors, triangles: window.__aiv.triangles }));
  if (JSON.stringify(seen.modelErrors) !== JSON.stringify(missing)) {
    errors.push(`${name}: models that did not load: ${JSON.stringify(seen.modelErrors)}, expected ${JSON.stringify(missing)}`);
  }
  if (!(seen.triangles > 0 && seen.triangles <= MAX_TRIANGLES)) errors.push(`${name}: ${seen.triangles} triangles in the frame, the limit is ${MAX_TRIANGLES}`);
}

/** A form POST from the page, so it carries the page's session cookie. Repeated fields are allowed. */
async function post(path, fields) {
  const result = await page.evaluate(async ([p, f]) => {
    const r = await fetch(p, { method: 'POST', body: new URLSearchParams(f) });
    await r.text(); // read to the end, or the next navigation aborts the request
    return { ok: r.ok, status: r.status };
  }, [path, fields]);
  if (!result.ok) throw new Error(`POST ${path} answered ${result.status}`);
}

/** Opens / and waits for the title panel to offer Continue. */
async function openTitle() {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 10000 });
}

/** Clicks Continue and waits for the loaded world; checks that the HUD names the area the server reported. */
async function enterWorld() {
  await page.click('#btn-continue');
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  if (await page.isVisible('#loading')) errors.push('the loading indicator is still visible in the world');
  const { area, location } = await page.evaluate(() => window.__aiv.state);
  const shown = await page.textContent('#hud-area');
  if (shown !== area.name) errors.push(`the HUD shows "${shown}", the server says "${area.name}"`);
  if (!(await page.evaluate(() => window.__aiv.layout === window.__aiv.dressing.layout))) errors.push('the player does not walk in the layout of the dressing');
  return { area, location };
}

/** Travels through the classic route, then enters the world there, in the location's starting area. */
async function travelAndEnter(locationName, name) {
  await post('/game/travel', [['location_name', locationName]]);
  await openTitle();
  const { location } = await enterWorld();
  if (location.name !== locationName) errors.push(`travelled to ${locationName} but the world shows ${location.name}`);
  await worldShot(name);
}

/** Walks to an area of the current location with POST /api/move, along the connections, then enters the world there. */
async function moveAndEnter(areaId) {
  const now = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  const areas = campaign.acts.flatMap((act) => act.locations).find((loc) => loc.name === now.location.name).areas;
  const from = new Map([[now.area.id, null]]);
  const queue = [now.area.id];
  while (queue.length && !from.has(areaId)) {
    const at = queue.shift();
    for (const next of areas.find((a) => a.id === at).connections) {
      if (from.has(next)) continue;
      from.set(next, at);
      queue.push(next);
    }
  }
  const steps = [];
  for (let at = areaId; from.get(at) != null; at = from.get(at)) steps.unshift(at);
  for (const step of steps) {
    const status = await page.evaluate(
      async (id) => {
        const r = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area_id: id }) });
        await r.text(); // read to the end, or the next navigation aborts the request
        return r.status;
      },
      step,
    );
    if (status !== 200) throw new Error(`POST /api/move to ${step} answered ${status}`);
  }
  await openTitle();
  const { area } = await enterWorld();
  if (area.id !== areaId) errors.push(`moved to ${areaId} but the world shows ${area.id}`);
}

/** Turns the view to the area's landmark of `kind` (the tallest piece of it), then saves the screenshot. */
async function landmarkShot(kind, name, missing = []) {
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  const found = await page.evaluate((k) => {
    const height = (p) => (p.solid ? p.solid.height : 0);
    const marks = window.__aiv.dressing.placements.filter((p) => p.landmark === k);
    if (!marks.length) return null;
    const mark = marks.reduce((a, b) => (height(b) > height(a) ? b : a));
    window.__aiv.lookAt(mark.x, mark.z);
    return mark.model;
  }, kind);
  if (!found) errors.push(`${name}: the area has no "${kind}" landmark`);
  await worldShot(name, missing);
}

/** Changes the one session file of the data folder this test owns. */
function editSession(change) {
  const folder = join(dataDir, 'sessions');
  const files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected one session file in ${folder}, found ${files.length}`);
  const session = JSON.parse(readFileSync(join(folder, files[0]), 'utf8'));
  change(session);
  writeFileSync(join(folder, files[0]), JSON.stringify(session));
}

/** Marks every boss as defeated, to unlock Acts 2 and 3. */
function defeatEveryBoss() {
  editSession((session) => {
    session.defeated_bosses = Object.keys(bosses);
  });
}

/** Puts a monster or an event (or neither) into the area the character stands in, as the next roll would. */
function plant(monster, event, more = () => {}) {
  editSession((session) => {
    session.character.max_hit_points = session.character.current_hit_points = 9999;
    more(session);
    session.area_contents = {
      location: session.location_name, area_id: session.area_id, seq: (session.area_contents?.seq ?? 0) + 1, monster, event,
    };
  });
}

/** Turns the view to a slot of the area and saves the screenshot. */
async function slotShot(kind, name) {
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  await page.evaluate((k) => {
    const slot = window.__aiv.layout.slots[k];
    window.__aiv.lookAt(slot.x, slot.z);
  }, kind);
  await worldShot(name);
}

/**
 * Walks with the W key to within `range` m of a slot, around what stands in the way and around a
 * monster that is not the goal (walking into it would start the fight). Ends facing the slot.
 */
async function walkTo(kind, range) {
  const path = await page.evaluate(([k, r]) => {
    const { layout, player, contents } = window.__aiv;
    const goal = layout.slots[k];
    const boxes = [...layout.walls, ...layout.props];
    if ((contents?.event && !contents.event.landmark) || (contents?.spent && !contents.spent.landmark)) boxes.push({ ...layout.slots.event, halfX: 0.5, halfZ: 0.5 });
    if (contents?.boss && layout.slots.boss) boxes.push({ ...layout.slots.boss, halfX: 0.7, halfZ: 0.7 });
    const avoid = contents?.monster && k !== 'monster' ? layout.slots.monster : null;
    const { halfX, halfZ } = layout.floor;
    const step = 0.25;
    const nx = Math.round((halfX * 2) / step) + 1;
    const nz = Math.round((halfZ * 2) / step) + 1;
    const at = (i) => ({ x: -halfX + (i % nx) * step, z: -halfZ + Math.floor(i / nx) * step });
    const free = (p) =>
      Math.abs(p.x) <= halfX - 1.6 && Math.abs(p.z) <= halfZ - 1.6
      && boxes.every((b) => Math.hypot(Math.max(Math.abs(p.x - b.x) - b.halfX, 0), Math.max(Math.abs(p.z - b.z) - b.halfZ, 0)) >= 0.65)
      && (!avoid || Math.hypot(p.x - avoid.x, p.z - avoid.z) >= 1.8);
    const start = Math.round((player.z + halfZ) / step) * nx + Math.round((player.x + halfX) / step);
    const from = new Map([[start, -1]]);
    const queue = [start];
    let end = -1;
    for (let head = 0; head < queue.length && end < 0; head++) {
      const cell = queue[head];
      const p = at(cell);
      if (Math.hypot(p.x - goal.x, p.z - goal.z) <= r) end = cell;
      for (const next of [cell - 1, cell + 1, cell - nx, cell + nx]) {
        if (next < 0 || next >= nx * nz || from.has(next) || Math.abs((next % nx) - (cell % nx)) > 1 || !free(at(next))) continue;
        from.set(next, cell);
        queue.push(next);
      }
    }
    if (end < 0) return null;
    const cells = [];
    for (let cell = end; cell !== start; cell = from.get(cell)) cells.unshift(at(cell));
    return cells.filter((_, i) => i % 2 === 1 || i === cells.length - 1);
  }, [kind, range]);
  if (!path) throw new Error(`no way to the ${kind} slot`);
  await page.keyboard.down('KeyW');
  for (const point of path) {
    for (let tries = 0; ; tries++) {
      const left = await page.evaluate((p) => {
        const me = window.__aiv.player;
        if (!me) return -1;
        window.__aiv.lookAt(p.x, p.z);
        return Math.hypot(p.x - me.x, p.z - me.z);
      }, point);
      if (left < 0) throw new Error(`left the world on the way to the ${kind} slot`);
      if (left < 0.3) break;
      if (tries > 400) throw new Error(`stuck on the way to the ${kind} slot`);
      await page.waitForTimeout(16);
    }
  }
  await page.keyboard.up('KeyW');
  await page.evaluate((k) => {
    const slot = window.__aiv.layout.slots[k];
    window.__aiv.lookAt(slot.x, slot.z);
  }, kind);
  await page.waitForTimeout(100);
}

/** Checks the prompt, in the page's report and on screen, and saves the screenshot. */
async function promptShot(text, name) {
  const seen = await page.evaluate(() => ({ prompt: window.__aiv.prompt, kind: window.__aiv.interaction?.kind ?? null }));
  if (seen.prompt !== text) errors.push(`${name}: the prompt is ${JSON.stringify(seen.prompt)}, expected "${text}"`);
  await page.waitForFunction((t) => !document.getElementById('prompt').hidden && document.getElementById('prompt').textContent === t, text, { timeout: 5000 })
    .catch(() => errors.push(`${name}: #prompt does not show "${text}"`));
  await worldShot(name);
}

/**
 * Presses E in front of the monster and waits for the fight: still on /, the battle screen, the panel
 * shown, the mouse free, the player 1.5 to 2.5 m from the monster. Returns the battle stance.
 */
async function startFight(name) {
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__aiv.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 30000 });
  const seen = await page.evaluate(() => ({
    path: window.location.pathname, player: window.__aiv.player, slot: window.__aiv.layout.slots.monster, locked: document.pointerLockElement !== null,
    interaction: window.__aiv.interaction, prompt: window.__aiv.prompt, menu: window.__aiv.menuOpen,
  }));
  const distance = Math.hypot(seen.player.x - seen.slot.x, seen.player.z - seen.slot.z);
  if (seen.path !== '/') errors.push(`${name}: the fight left / for ${seen.path}`);
  if (seen.locked) errors.push(`${name}: the pointer is still locked`);
  if (!(distance >= 1.5 - 1e-6 && distance <= 2.5 + 1e-6)) errors.push(`${name}: the player stands ${distance.toFixed(2)} m from the monster`);
  if (seen.interaction !== null || seen.prompt !== null) errors.push(`${name}: there is an interaction or a prompt during the fight`);
  await page.keyboard.press('KeyM');
  if (seen.menu || (await page.evaluate(() => window.__aiv.menuOpen))) errors.push(`${name}: the menu opens during a fight`);
  // The view has arrived at the stance.
  await page.waitForTimeout(500);
  return seen.player;
}

/** Waits until the fight takes a key again, shows its result, or is over. */
async function untilOpen() {
  await page.waitForFunction(() => window.__aiv.screen !== 'battle' || (window.__aiv.battle !== null && (window.__aiv.battle.result !== null || !window.__aiv.battle.locked)), null, { timeout: 30000 });
}

/** Presses `key` each time the fight takes one, until the result panel shows `result`. */
async function fightUntil(key, result, name) {
  for (let turns = 0; turns < 200; turns++) {
    await untilOpen();
    const now = await page.evaluate(() => (window.__aiv.battle ? window.__aiv.battle.result ?? 'fight' : 'over'));
    if (now === result) {
      await page.waitForSelector('#battle-result', { state: 'visible', timeout: 5000 });
      return;
    }
    if (now !== 'fight') throw new Error(`${name}: the fight ended in ${now}, expected ${result}`);
    await page.keyboard.press(key);
    await page.waitForFunction(() => window.__aiv.battle === null || window.__aiv.battle.locked || window.__aiv.battle.result !== null, null, { timeout: 30000 });
  }
  throw new Error(`${name}: the fight did not end`);
}

/** After a fight: walking again at the battle stance, the panel gone. */
async function backToWalking(stance, name) {
  await page.waitForFunction(inWorld, null, { timeout: 30000 });
  const seen = await page.evaluate(() => ({ player: window.__aiv.player, battle: window.__aiv.battle, panel: !document.getElementById('battle-panel').hidden, path: window.location.pathname }));
  if (Math.hypot(seen.player.x - stance.x, seen.player.z - stance.z) > 0.05) errors.push(`${name}: walking again at ${JSON.stringify(seen.player)}, the stance was ${JSON.stringify(stance)}`);
  if (seen.battle !== null || seen.panel || seen.path !== '/') errors.push(`${name}: after the fight: battle ${JSON.stringify(seen.battle)}, panel shown ${seen.panel}, path ${seen.path}`);
}

/** The URL has not left / (the events and the boss fight are played in the 3D view). */
async function stillHome(name) {
  const path = await page.evaluate(() => window.location.pathname);
  if (path !== '/') errors.push(`${name}: the page left / for ${path}`);
}

/** Presses E at an event and waits for the panel with its `count` choices; still on /, the mouse free. */
async function openEventPanel(name, count) {
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__aiv.screen === 'event' && window.__aiv.event?.view && !document.getElementById('event-panel').hidden, null, { timeout: 30000 });
  await page.waitForSelector('#event-choices button[data-choice]', { state: 'visible', timeout: 5000 });
  const seen = await page.evaluate(() => ({
    title: document.getElementById('event-title').textContent, text: document.getElementById('event-text').textContent,
    choices: [...document.querySelectorAll('#event-choices button[data-choice]')].map((b) => b.dataset.choice),
    view: window.__aiv.event.view, locked: document.pointerLockElement !== null, prompt: window.__aiv.prompt,
    result: !document.getElementById('event-result').hidden,
  }));
  if (seen.title !== seen.view.title || seen.text !== seen.view.text) errors.push(`${name}: the panel shows "${seen.title}"`);
  if (seen.choices.join() !== Array.from({ length: count }, (_, i) => i).join()) errors.push(`${name}: the choices are ${JSON.stringify(seen.choices)}, expected ${count}`);
  if (seen.locked || seen.prompt !== null || seen.result) errors.push(`${name}: pointer locked ${seen.locked}, prompt ${JSON.stringify(seen.prompt)}, result shown ${seen.result}`);
  await stillHome(name);
}

/** Sets the next d20 of the server, presses 1 and waits for the outcome. Returns what the panel shows of it. */
async function chooseWith(d20, name) {
  writeFileSync(join(dataDir, 'd20.txt'), String(d20));
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__aiv.event?.result && !document.getElementById('event-result').hidden, null, { timeout: 30000 });
  await page.waitForSelector('#event-continue', { state: 'visible', timeout: 5000 });
  await stillHome(name);
  return page.evaluate(() => ({
    roll: document.getElementById('event-roll').textContent, verdict: document.getElementById('event-verdict').textContent,
    outcome: document.getElementById('event-outcome').textContent,
    kinds: [...document.querySelectorAll('#event-chips [data-kind]')].map((chip) => chip.dataset.kind),
    chips: [...document.querySelectorAll('#event-chips [data-kind]')].map((chip) => chip.textContent),
  }));
}

/** In the page: a POST with a JSON body, answered with the status and the body. */
async function postJson(path, body) {
  return page.evaluate(async ([p, b]) => {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json() };
  }, [path, body]);
}

/** Walks to the signpost, looks at it and presses E: the map panel is open, the mouse free. */
async function openMap(name) {
  await walkTo('travel', 0.4);
  await page.evaluate(() => {
    const post = window.__aiv.dressing.placements.find((p) => p.landmark === 'travel');
    window.__aiv.lookAt(post.x, post.z);
  });
  await page.waitForTimeout(100);
  if (name) await promptShot('E: travel', name);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__aiv.panel === 'travel' && window.__aiv.travel !== null && !document.getElementById('travel-panel').hidden, null, { timeout: 10000 });
}

/** After a choice on the map: the journey is over, the area of `locationName` is entered and its name is on screen. */
async function arrived(locationName, areaId, act, name) {
  await page.waitForFunction(() => window.__aiv.arrival !== null && window.__aiv.screen === 'world' && window.__aiv.loading === false && window.__aiv.layout !== null, null, { timeout: 60000 });
  const seen = await page.evaluate(() => ({
    arrival: window.__aiv.arrival, location: window.__aiv.state.location, area: window.__aiv.state.area, pending: window.__aiv.state.pending, road: window.__aiv.road,
    shown: !document.getElementById('arrival').hidden, title: document.getElementById('arrival-title').textContent, subtitle: document.getElementById('arrival-subtitle').textContent,
    player: window.__aiv.player, spawn: window.__aiv.layout.spawn, panel: window.__aiv.panel, path: window.location.pathname,
  }));
  const subtitle = `Act ${act}: ${campaign.acts[act - 1].title}`;
  if (seen.location.name !== locationName || seen.area.id !== areaId || !seen.area.is_start || seen.pending !== null || seen.road) {
    errors.push(`${name}: arrived in ${seen.location.name}/${seen.area.id}, pending ${JSON.stringify(seen.pending)}, road ${seen.road}`);
  }
  if (seen.arrival.title !== locationName || seen.arrival.subtitle !== subtitle || !seen.shown || seen.title !== locationName || seen.subtitle !== subtitle) {
    errors.push(`${name}: the arrival shows ${JSON.stringify([seen.arrival, seen.shown, seen.title, seen.subtitle])}`);
  }
  if (Math.hypot(seen.player.x - seen.spawn.x, seen.player.z - seen.spawn.z) > 0.05) errors.push(`${name}: arrived at ${JSON.stringify(seen.player)}, not at the default spawn`);
  if (seen.panel !== null || seen.path !== '/') errors.push(`${name}: panel ${seen.panel}, path ${seen.path}`);
  // The view is back and the title stands.
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('veil')).opacity) <= 0.05, null, { timeout: 15000 }).catch(() => {});
  await shot(name);
  await page.waitForFunction(() => window.__aiv.arrival === null && window.__aiv.travelling === false && document.getElementById('arrival').hidden, null, { timeout: 10000 })
    .catch(() => errors.push(`${name}: the arrival title does not go away`));
}

/** Opens the journal with J and returns what its crown shows. */
async function openJournal() {
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__aiv.panel === 'journal' && window.__aiv.journal !== null && !document.getElementById('journal-panel').hidden, null, { timeout: 10000 });
  return page.evaluate(() => ({
    sockets: [...document.querySelectorAll('#journal-crown .shard-socket')].map((node) => ({
      found: node.classList.contains('found'), label: node.querySelector('.shard-label').textContent, colour: node.querySelector('.shard-gem').style.background,
    })),
    view: window.__aiv.journal,
    acts: [...document.querySelectorAll('#journal-acts .journal-act')].map((node) => node.textContent),
    deeds: [...document.querySelectorAll('#journal-deeds .journal-deed')].map((node) => node.textContent),
    complete: !document.getElementById('journal-complete').hidden, locked: document.pointerLockElement !== null,
  }));
}

/** Walks through the epilogue with the keys given (or a click for 'click') and checks every step against the view. */
async function throughEnding(name, shotNames) {
  await page.waitForFunction(() => window.__aiv.screen === 'ending' && window.__aiv.ending !== null && !document.getElementById('ending-panel').hidden, null, { timeout: 30000 });
  const view = await page.evaluate(() => window.__aiv.ending.view);
  const texts = [view.title, ...view.paragraphs, 'Your Legend'];
  if (view.paragraphs.length !== 3 || !view.paragraphs[1].includes('Smoke, a Human Fighter out of Rivermeet')) errors.push(`${name}: the paragraphs are ${JSON.stringify(view.paragraphs).slice(0, 300)}`);
  const keys = ['Enter', 'Space', 'KeyE', 'click', 'Enter'];
  for (let step = 0; step < texts.length; step++) {
    await page.waitForFunction((n) => window.__aiv.ending?.step === n, step, { timeout: 5000 }).catch(() => errors.push(`${name}: step ${step} is not reached`));
    const seen = await page.evaluate(() => ({
      text: document.getElementById('ending-panel').textContent, button: document.getElementById('ending-continue').textContent,
      rows: [...document.querySelectorAll('#ending-legend .reward-row')].map((row) => [row.querySelector('.label').textContent, row.querySelector('.value').textContent]),
      hud: !document.getElementById('hud').hidden, title: !document.getElementById('title-screen').hidden,
    }));
    if (!seen.text.includes(texts[step])) errors.push(`${name}: step ${step} shows "${seen.text.slice(0, 200)}"`);
    if (seen.button !== (step === texts.length - 1 ? 'Return to the title screen' : 'Continue')) errors.push(`${name}: the button of step ${step} reads "${seen.button}"`);
    if (seen.hud || seen.title) errors.push(`${name}: the HUD or the title screen shows during the ending`);
    if (step === texts.length - 1) {
      const wanted = [['Level reached', view.character.level], ['Monsters slain', view.stats.kills], ['Bosses felled', view.stats.bosses],
        ['Events braved', view.stats.events], ['Quests completed', view.stats.quests], ['Gold in purse', view.character.gold]].map(([label, value]) => [label, String(value)]);
      if (JSON.stringify(seen.rows) !== JSON.stringify(wanted)) errors.push(`${name}: the legend shows ${JSON.stringify(seen.rows)}`);
    }
    if (shotNames[step]) {
      await page.waitForTimeout(400);
      const variety = await canvasVariety();
      if (variety < 0.05) errors.push(`${shotNames[step]}: the view behind the ending is blank`);
      await shot(shotNames[step]);
    }
    if (keys[step] === 'click') await page.click('#ending-continue');
    else await page.keyboard.press(keys[step]);
  }
  await page.waitForFunction(() => window.__aiv.screen === 'title' && window.__aiv.ending === null && document.getElementById('ending-panel').hidden, null, { timeout: 10000 });
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 10000 });
  const after = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  if (!after.has_character || after.character.name !== 'Smoke' || after.pending !== null) errors.push(`${name}: after the ending the state is ${JSON.stringify(after).slice(0, 200)}`);
}

/** In the page: the creation panel is at this step. */
const atStep = (name) => window.__aiv.screen === 'creation' && window.__aiv.creation?.step === name;
const choicesNow = () => page.evaluate(() => JSON.stringify(window.__aiv.creation.choices));

/** One creation step: waits for it, checks that Next waits for a choice when `needed`, makes the choice, saves the screenshot. */
async function creationStep(name, needed, choose) {
  await page.waitForFunction(atStep, name, { timeout: 10000 });
  const marked = await page.evaluate(() => document.querySelector('#creation-steps .current')?.dataset.step ?? null);
  if (marked !== name) errors.push(`create-${name}: the step row marks ${marked}`);
  if (needed) {
    if (!(await page.isDisabled('#creation-next'))) errors.push(`create-${name}: Next is open before anything is chosen`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    if (!(await page.evaluate(atStep, name))) errors.push(`create-${name}: Enter went on from an incomplete step`);
  }
  await choose();
  await page.waitForFunction(() => !document.getElementById('creation-next').disabled, null, { timeout: 5000 }).catch(() => errors.push(`create-${name}: Next stays closed after the choice`));
  await shot(`create-${name}`);
}

const pick = (value) => page.click(`#creation-body [data-value="${value}"]`);

/** New game on the title screen, the eight creation steps for Human Fighter "Smoke", and Begin up to the opening. */
async function createCharacter() {
  const offered = await page.evaluate(() => fetch('/api/creation').then((r) => r.json()));
  // First a detour: the preview answers late, while the name is being typed. The field keeps its focus and
  // its text; then Esc leads step by step back to the title screen.
  await page.click('#btn-new-game');
  await page.waitForFunction(atStep, 'race', { timeout: 10000 });
  await pick('Human');
  await page.keyboard.press('Enter');
  await page.waitForFunction(atStep, 'class', { timeout: 5000 });
  let answerPreview;
  const previewHeld = new Promise((done) => (answerPreview = done));
  await page.route('**/api/creation/preview**', async (route) => {
    await previewHeld;
    await route.continue();
  });
  await pick('Wizard');
  await page.keyboard.press('Enter');
  await page.waitForFunction(atStep, 'skills', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(atStep, 'name', { timeout: 5000 });
  await page.keyboard.type('Ab');
  if ((await page.evaluate(() => window.__aiv.creation.preview)) !== null) errors.push('late-preview: the preview is in before the server answered');
  answerPreview();
  await page.waitForFunction(() => window.__aiv.creation.preview !== null && !document.getElementById('creation-preview').hidden, null, { timeout: 10000 });
  await page.unroute('**/api/creation/preview**');
  await page.keyboard.type('c');
  const typed = await page.evaluate(() => ({ focused: document.activeElement?.id, field: document.getElementById('creation-name')?.value, name: window.__aiv.creation.choices.name }));
  if (typed.focused !== 'creation-name' || typed.field !== 'Abc' || typed.name !== 'Abc') errors.push(`late-preview: after the preview arrived the name field is ${JSON.stringify(typed)}`);
  for (const back of ['skills', 'class', 'race']) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(atStep, back, { timeout: 5000 });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aiv.screen === 'title' && window.__aiv.creation === null && !document.getElementById('title-screen').hidden && document.getElementById('creation-panel').hidden, null, { timeout: 5000 })
    .catch(() => errors.push('create-race: Esc on the first step does not lead back to the title screen'));

  await page.click('#btn-new-game');
  await page.waitForFunction(atStep, 'race', { timeout: 10000 });
  if ((await choicesNow()) !== JSON.stringify({ race: null, class_name: null, skills: [], name: '', weapon: null, armor: null, portrait: null })) errors.push('create-race: a new creation starts with choices');
  if (await page.isVisible('#title-screen')) errors.push('create-race: the title panel stays behind the creation panel');
  if ((await page.locator('#creation-steps .create-step').count()) !== 8) errors.push('create-race: the step row does not have eight steps');

  await creationStep('race', true, async () => {
    const cards = await page.locator('#creation-body [data-value]').count();
    if (cards !== offered.races.length) errors.push(`create-race: ${cards} cards for ${offered.races.length} races`);
    if (!(await page.isHidden('#creation-preview'))) errors.push('create-race: the preview shows before race and class are chosen');
    await pick('Human');
  });
  await page.keyboard.press('Enter');

  await creationStep('class', true, async () => {
    const cards = await page.locator('#creation-body [data-value]').count();
    if (cards !== offered.classes.length) errors.push(`create-class: ${cards} cards for ${offered.classes.length} classes`);
    await pick('Fighter');
    await page.waitForFunction(() => window.__aiv.creation.preview !== null && !document.getElementById('creation-preview').hidden, null, { timeout: 10000 });
  });
  const preview = await page.evaluate(() => window.__aiv.creation.preview);
  const served = await page.evaluate(() => fetch('/api/creation/preview?race=Human&class_name=Fighter').then((r) => r.json()));
  if (JSON.stringify(preview) !== JSON.stringify(served)) errors.push('create-class: the preview is not the one the server answers');
  const box = await page.textContent('#creation-preview');
  if (!box.includes(`Hit points ${served.hit_points}`) || !box.includes(`Power points ${served.power_points}`) || !box.includes(`Armour class ${served.unarmored_ac}`)) errors.push(`create-class: the preview reads "${box}"`);
  await page.click('#creation-next');

  await creationStep('skills', false, async () => {
    await pick('Athletics');
    await pick('Perception');
    await pick('History'); // one more than a Fighter may choose: nothing happens
    const seen = await page.evaluate(() => ({ skills: window.__aiv.creation.choices.skills, count: document.querySelector('.create-count').textContent }));
    if (JSON.stringify(seen.skills) !== JSON.stringify(['Athletics', 'Perception']) || seen.count !== '2 / 2 chosen') errors.push(`create-skills: ${JSON.stringify(seen)}`);
  });
  await page.keyboard.press('Enter');

  await creationStep('name', true, async () => {
    const field = await page.evaluate(() => ({ max: document.getElementById('creation-name').maxLength, focused: document.activeElement?.id }));
    if (field.max !== offered.name_max || field.focused !== 'creation-name') errors.push(`create-name: the field is ${JSON.stringify(field)}`);
    await page.keyboard.type('Smoke');
    if ((await page.evaluate(() => window.__aiv.creation.choices.name)) !== 'Smoke') errors.push('create-name: the typed name is not in the choices');
  });
  await page.keyboard.press('Enter');

  await creationStep('weapon', true, async () => {
    const cards = await page.locator('#creation-body [data-value]').count();
    const fighter = offered.classes.find((c) => c.name === 'Fighter');
    if (cards !== fighter.weapons.length) errors.push(`create-weapon: ${cards} cards for ${fighter.weapons.length} weapons`);
    await pick('Longsword');
  });
  await page.keyboard.press('Enter');

  await creationStep('armour', false, async () => {
    if ((await page.evaluate(() => window.__aiv.creation.choices.armor)) !== null) errors.push('create-armour: the default is not "no armour"');
    await pick('Chain Mail');
    const ac = served.armors.find((a) => a.name === 'Chain Mail').total_ac;
    const shown = await page.textContent('#creation-preview .create-ac');
    if (shown !== `Armour class ${ac}`) errors.push(`create-armour: the preview shows "${shown}" for Chain Mail, the server says ${ac}`);
  });
  await page.keyboard.press('Enter');

  await creationStep('portrait', true, async () => {
    if ((await page.locator('#creation-body [data-value] img').count()) !== 3) errors.push('create-portrait: there are not three portraits');
    await pick('/static/images/player_fighter.png');
  });
  await page.keyboard.press('Enter');

  await page.waitForFunction(atStep, 'summary', { timeout: 10000 });
  const summary = await page.evaluate(() => ({ text: document.getElementById('creation-body').textContent, next: document.getElementById('creation-next').textContent }));
  for (const word of ['Smoke', 'Human', 'Fighter', 'Knight', 'Longsword', 'Chain Mail', 'Athletics, Perception', ...served.starting_abilities]) {
    if (!summary.text.includes(word)) errors.push(`create-summary: "${word}" is missing`);
  }
  if (summary.next !== 'Begin the adventure') errors.push(`create-summary: the button reads "${summary.next}"`);
  await shot('create-summary');

  // Two steps back and forward again: every choice is kept.
  const chosen = await choicesNow();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(atStep, 'armour', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.click('#creation-next');
  await page.waitForFunction(atStep, 'summary', { timeout: 5000 });
  if ((await choicesNow()) !== chosen) errors.push(`create-summary: back and forward changed the choices to ${await choicesNow()}`);
  if (chosen !== JSON.stringify({ race: 'Human', class_name: 'Fighter', skills: ['Athletics', 'Perception'], name: 'Smoke', weapon: 'Longsword', armor: 'Chain Mail', portrait: '/static/images/player_fighter.png' })) {
    errors.push(`create-summary: the choices are ${chosen}`);
  }

  await page.click('#creation-next');
  await page.waitForFunction(() => window.__aiv.screen === 'opening' && !document.getElementById('opening-panel').hidden, null, { timeout: 10000 });
  const act = campaign.acts[0];
  const read = await page.evaluate(() => ({
    heading: document.getElementById('opening-heading').textContent, act: document.getElementById('opening-act').textContent,
    text: [...document.querySelectorAll('#opening-text p')].map((p) => p.textContent), quest: document.getElementById('opening-quest').textContent,
    creation: !document.getElementById('creation-panel').hidden, state: window.__aiv.state,
  }));
  if (read.heading !== campaign.title || read.act !== `Act 1: ${act.title}` || read.quest !== `Your quest: ${act.mainQuest}`
    || JSON.stringify(read.text) !== JSON.stringify([campaign.description, act.description])) errors.push(`opening: it reads ${JSON.stringify(read).slice(0, 300)}`);
  if (read.creation) errors.push('opening: the creation panel stays');
  const made = read.state.character;
  if (!made || made.name !== 'Smoke' || made.race !== 'Human' || made.class_name !== 'Fighter' || made.max_hit_points !== served.hit_points) errors.push(`opening: the character is ${JSON.stringify(made)}`);
  await shot('opening');
}

const openMenu = async () => {
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#menu', { state: 'visible', timeout: 5000 });
};
const settingsNow = () => page.evaluate(() => JSON.stringify(window.__aiv.settings));

/** The settings panel: a change is in use at once and still there after a reload. Ends walking, with the defaults back. */
async function settingsSteps() {
  await openMenu();
  if (await page.locator('#menu-saves').count()) errors.push('settings: the menu still links to the classic saves page');
  await page.click('#menu-settings');
  await page.waitForFunction(() => window.__aiv.settingsOpen && !document.getElementById('settings-panel').hidden && document.getElementById('menu').hidden, null, { timeout: 5000 });
  if ((await settingsNow()) !== JSON.stringify({ sensitivity: 1, invertY: false, fov: 70 })) errors.push(`settings: they start as ${await settingsNow()}`);
  if ((await page.locator('#settings-keys > *').count()) !== 11) errors.push('settings: the key list does not have eleven lines');
  await page.fill('#set-fov', '90');
  await page.check('#set-invert-y');
  const changed = JSON.stringify({ sensitivity: 1, invertY: true, fov: 90 });
  if ((await settingsNow()) !== changed) errors.push(`settings: after the change they are ${await settingsNow()}`);
  if ((await page.evaluate(() => localStorage.getItem('aiv.settings'))) !== changed) errors.push('settings: the change is not in localStorage');
  await page.waitForTimeout(200);
  await shot('settings');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__aiv.settingsOpen && !document.getElementById('menu').hidden && window.__aiv.menuOpen, null, { timeout: 5000 })
    .catch(() => errors.push('settings: Esc does not lead back to the menu'));

  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready, null, { timeout: 30000 });
  if ((await settingsNow()) !== changed) errors.push(`settings: after a reload they are ${await settingsNow()}`);
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 10000 });
  await enterWorld();

  // Back to the defaults, so that the rest of the walk-through looks as it always did.
  await openMenu();
  await page.click('#menu-settings');
  await page.waitForFunction(() => window.__aiv.settingsOpen, null, { timeout: 5000 });
  await page.fill('#set-fov', '70');
  await page.uncheck('#set-invert-y');
  await page.click('#settings-close');
  await page.click('#menu-back');
  await page.waitForFunction(() => !window.__aiv.menuOpen, null, { timeout: 5000 });
  if ((await settingsNow()) !== JSON.stringify({ sensitivity: 1, invertY: false, fov: 70 })) errors.push(`settings: the defaults are not back: ${await settingsNow()}`);
}

/** Opens the save slots from the menu in `mode` and waits for the panel. */
async function openSlots(mode) {
  await openMenu();
  await page.click(mode === 'save' ? '#menu-save' : '#menu-load');
  await page.waitForFunction((m) => window.__aiv.saves?.mode === m && !document.getElementById('saves-panel').hidden && document.getElementById('menu').hidden, mode, { timeout: 10000 });
}

const slotMessage = (text) => page.waitForFunction((t) => {
  const line = document.querySelector('#saves-panel .panel-message');
  return !line.hidden && line.textContent === t;
}, text, { timeout: 10000 });

/** With --serve: the session file the browser's cookie names is the only one kept (a load makes a new one). */
async function keepCurrentSession() {
  const cookie = (await context.cookies()).find((c) => c.name === 'session');
  const id = JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64').toString('utf8')).session_id;
  const folder = join(dataDir, 'sessions');
  for (const file of readdirSync(folder)) if (file.endsWith('.json') && file !== `${id}.json`) unlinkSync(join(folder, file));
}

/** Save into an empty slot, change the game, back away from overwriting, load the save, delete it. Ends walking. */
async function saveSteps() {
  await openSlots('save');
  const before = await page.evaluate(() => window.__aiv.saves.view);
  const rows = await page.locator('#saves-slots .save-slot').count();
  if (rows !== Math.max(before.max_saves, before.saves.length) || before.max_saves !== 10) errors.push(`save-panel: ${rows} rows for ${before.max_saves} slots`);
  if (before.saves.length >= before.max_saves) {
    console.log('skipped (the server already holds 10 saves): save-panel, save-confirm, load-panel');
    await page.keyboard.press('Escape');
    await page.click('#menu-back');
    return;
  }
  await page.click('#saves-slots .save-slot.empty button[data-action="save"]');
  await slotMessage('Game saved.');
  const after = await page.evaluate(() => window.__aiv.saves.view);
  const mine = after.saves.find((s) => !before.saves.some((old) => old.id === s.id));
  if (!mine || after.saves.length !== before.saves.length + 1) throw new Error('save-panel: the new save is not in the list');
  const row = `#saves-slots .save-slot[data-save-id="${mine.id}"]`;
  const line = await page.textContent(`${row} .save-line`);
  if (line !== `Smoke · Level 1 Human Fighter · Rivermeet Town · ${mine.saved_at.slice(0, 16).replace('T', ' ')}`) errors.push(`save-panel: the row reads "${line}"`);
  await shot('save-panel');
  const saved = await page.evaluate(() => ({ area: window.__aiv.state.area.id, character: window.__aiv.state.character }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aiv.saves === null && !document.getElementById('menu').hidden, null, { timeout: 5000 }).catch(() => errors.push('save-panel: Esc does not lead back to the menu'));
  await page.click('#menu-back');

  // Something changes: through the first gate into the next area, and with --serve the purse.
  const gate = await page.evaluate(() => {
    const g = window.__aiv.layout.gates[0];
    window.__aiv.lookAt(g.x, g.z);
    return g;
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction((id) => window.__aiv.state.area.id === id && window.__aiv.screen === 'world' && !window.__aiv.loading && window.__aiv.player !== null, gate.exitId, { timeout: 60000 });
  await page.keyboard.up('KeyW');
  if (serve) {
    editSession((session) => {
      session.character.gold += 500;
    });
  }

  // Overwrite asks first, and No sends nothing.
  await openSlots('save');
  await page.click(`${row} button[data-action="overwrite"]`);
  await page.waitForFunction(() => window.__aiv.saves.confirm?.action === 'overwrite' && !document.getElementById('saves-confirm').hidden, null, { timeout: 5000 });
  if ((await page.textContent('#saves-question')) !== 'Overwrite this save?') errors.push(`save-confirm: the question reads "${await page.textContent('#saves-question')}"`);
  await shot('save-confirm');
  await page.click('#saves-no');
  await page.waitForFunction(() => window.__aiv.saves.confirm === null && document.getElementById('saves-confirm').hidden, null, { timeout: 5000 });
  const kept = await page.evaluate(() => fetch('/api/saves').then((r) => r.json()));
  if (kept.saves.find((s) => s.id === mine.id)?.saved_at !== mine.saved_at) errors.push('save-confirm: No overwrote the save');
  await page.keyboard.press('Escape');
  await page.click('#menu-back');

  // Load: the game is the saved one again.
  await openSlots('load');
  if ((await page.locator('#saves-slots .save-slot.empty button').count()) !== 0) errors.push('load-panel: an empty row has a button');
  if ((await page.locator(`${row} button[data-action="overwrite"]`).count()) !== 0) errors.push('load-panel: a row offers Overwrite');
  await shot('load-panel');
  // The answer is held back: Esc and Close do not take the panel away while the load is on its way.
  let answerLoad;
  const loadHeld = new Promise((done) => (answerLoad = done));
  await page.route('**/api/saves/*/load', async (route) => {
    await loadHeld;
    await route.continue();
  });
  await page.click(`${row} button[data-action="load"]`);
  await page.keyboard.press('Escape');
  await page.click('#saves-close');
  await page.waitForTimeout(200);
  if (await page.evaluate(() => window.__aiv.saves === null || document.getElementById('saves-panel').hidden)) errors.push('load-panel: the panel can be closed while the load is on its way');
  answerLoad();
  await page.waitForFunction((id) => window.__aiv.saves === null && window.__aiv.state?.area?.id === id && window.__aiv.screen === 'world' && !window.__aiv.loading && window.__aiv.player !== null && !window.__aiv.menuOpen, saved.area, { timeout: 60000 });
  const loaded = await page.evaluate(() => ({ character: window.__aiv.state.character, kept: sessionStorage.getItem('aiv.return') }));
  if (JSON.stringify(loaded.character) !== JSON.stringify(saved.character)) errors.push(`load-panel: the character is ${JSON.stringify(loaded.character)}, saved was ${JSON.stringify(saved.character)}`);
  if (loaded.kept !== null) errors.push('load-panel: aiv.return is kept after a load');
  const told = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  if (told.area.id !== saved.area || JSON.stringify(told.character) !== JSON.stringify(saved.character)) errors.push('load-panel: the server does not hold the saved game');
  if (serve) await keepCurrentSession();
  await worldShot('loaded');

  // Delete asks first; Yes takes the save away.
  await openSlots('load');
  await page.click(`${row} button[data-action="delete"]`);
  await page.waitForFunction(() => window.__aiv.saves.confirm?.action === 'delete', null, { timeout: 5000 });
  if ((await page.textContent('#saves-question')) !== 'Delete this save?') errors.push(`delete: the question reads "${await page.textContent('#saves-question')}"`);
  await page.click('#saves-yes');
  await slotMessage('Save deleted.');
  if ((await page.locator(row).count()) !== 0) errors.push('delete: the row is still there');
  const left = await page.evaluate(() => fetch('/api/saves').then((r) => r.json()));
  if (left.saves.some((s) => s.id === mine.id)) errors.push('delete: the server still lists the save');
  await page.click('#saves-close');
  await page.click('#menu-back');
  await page.waitForFunction(() => !window.__aiv.menuOpen, null, { timeout: 5000 });
}

/** Quit to title from the menu: New game and Continue are offered, and nothing was sent. */
async function quitToTitle() {
  await openMenu();
  const posts = [];
  const note = (request) => request.method() === 'POST' && posts.push(request.url());
  page.on('request', note);
  await page.click('#menu-quit');
  await page.waitForFunction(() => window.__aiv.screen === 'title' && !document.getElementById('title-screen').hidden && !window.__aiv.menuOpen, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  page.off('request', note);
  if (posts.length) errors.push(`title-after-quit: quitting posted to ${posts.join(', ')}`);
  for (const id of ['#btn-new-game', '#btn-continue']) if (!(await page.isVisible(id))) errors.push(`title-after-quit: ${id} is not offered`);
  if (await page.isVisible('#hud')) errors.push('title-after-quit: the HUD stays');
  if (serve && (await page.isVisible('#btn-load-game'))) errors.push('title-after-quit: Load game is offered without a save');
  await shot('title-after-quit');
}

try {
  // 1. The 3D client loads and draws; without a character it offers a new game.
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForSelector('#btn-new-game', { state: 'visible', timeout: 10000 });
  if (await page.isVisible('#btn-continue')) errors.push('Continue is offered without a character');
  if (await page.isVisible('#loading')) errors.push('the loading indicator is visible on the title screen');
  await page.waitForTimeout(500);
  const variety = await canvasVariety();
  await shot('title-new');
  if (await page.locator('#btn-new-game').evaluate((b) => b.tagName !== 'BUTTON' || b.hasAttribute('href'))) errors.push('New game is not a button');
  if (serve && (await page.isVisible('#btn-load-game'))) errors.push('Load game is offered without a save');
  if (variety < 0.05) errors.push(`the 3D view is blank: only ${(variety * 100).toFixed(1)}% of sampled pixels differ from the background`);

  // 2. The classic interface still answers.
  await page.goto(`${url}/classic`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.home-hero', { timeout: 10000 });
  await shot('classic-home');

  // 3. A character, made in the creation panel with clicks and typed keys, then the opening.
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForSelector('#btn-new-game', { state: 'visible', timeout: 10000 });
  await createCharacter();

  // 4. The opening leads into the town square the character starts in, and the player walks.
  await page.keyboard.press('Enter');
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  const begun = await page.evaluate(() => ({ area: window.__aiv.state.area.id, location: window.__aiv.state.location.name, opening: window.__aiv.opening, panel: !document.getElementById('opening-panel').hidden, player: window.__aiv.player }));
  if (begun.area !== 'town_square' || begun.location !== 'Rivermeet Town') errors.push(`a new character starts in ${begun.area} of ${begun.location}, not in the town square of Rivermeet Town`);
  if (begun.opening !== null || begun.panel) errors.push('the opening stays after Continue');
  await page.keyboard.down('KeyW');
  await page.waitForFunction((from) => window.__aiv.player && Math.hypot(window.__aiv.player.x - from.x, window.__aiv.player.z - from.z) > 0.5, begun.player, { timeout: 10000 })
    .catch(() => errors.push('after the opening the player does not walk'));
  await page.keyboard.up('KeyW');

  // 4a. Settings, save, load, delete and quit, all from the menu.
  await settingsSteps();
  await saveSteps();
  await quitToTitle();

  // 5. Into the world again with Continue.
  const start = await enterWorld();
  if (start.area.id !== 'town_square') errors.push(`after the load and Continue the character is in ${start.area.id}, not in town_square`);
  await worldShot('loc-rivermeet-town');

  // 5a. The signpost of the town square: the prompt, the map of the realm, a locked act.
  await openMap('signpost');
  const map = await page.evaluate(() => ({
    title: document.querySelector('#travel-panel h2').textContent,
    acts: [...document.querySelectorAll('#travel-acts .travel-act h3')].map((node) => node.textContent),
    cards: [...document.querySelectorAll('#travel-acts button[data-location]')].map((card) => ({
      location: card.dataset.location, hotkey: card.dataset.hotkey, off: card.classList.contains('unavailable'), text: card.textContent,
    })),
    reasons: [...document.querySelectorAll('#travel-acts .travel-reason')].map((node) => node.textContent),
    view: window.__aiv.travel, locked: document.pointerLockElement !== null, prompt: window.__aiv.prompt,
  }));
  const everywhere = campaign.acts.flatMap((act) => act.locations.map((loc) => loc.name));
  if (map.title !== 'The Realm of Eldoria') errors.push(`travel-panel: the title is "${map.title}"`);
  if (JSON.stringify(map.acts) !== JSON.stringify(campaign.acts.map((act) => `Act ${act.number}: ${act.title}`))) errors.push(`travel-panel: the acts are ${JSON.stringify(map.acts)}`);
  if (JSON.stringify(map.cards.map((card) => card.location)) !== JSON.stringify(everywhere) || map.cards.map((card) => card.hotkey).join('') !== '12345678') {
    errors.push(`travel-panel: the locations are ${JSON.stringify(map.cards.map((card) => [card.hotkey, card.location]))}`);
  }
  if (!map.cards[0].off || !map.cards[0].text.includes('You are here.') || map.view.current !== 'Rivermeet Town') errors.push(`travel-panel: the current location: ${JSON.stringify(map.cards[0])}`);
  if (map.cards[1].off || !map.cards[1].text.includes('Level 2-4') || !map.cards[1].text.includes('Boss')) errors.push(`travel-panel: the Whispering Woods: ${JSON.stringify(map.cards[1])}`);
  if (map.locked || map.prompt !== null) errors.push(`travel-panel: pointer locked ${map.locked}, prompt ${JSON.stringify(map.prompt)}`);
  // Nobody walks, and E, I, C, J and M do nothing while the map is open.
  const atPost = await page.evaluate(() => window.__aiv.player);
  await page.keyboard.down('KeyW');
  for (const key of ['KeyE', 'KeyI', 'KeyC', 'KeyJ', 'KeyM']) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  const mapStill = await page.evaluate(() => ({ player: window.__aiv.player, panel: window.__aiv.panel, menu: window.__aiv.menuOpen }));
  if (mapStill.panel !== 'travel' || mapStill.menu || mapStill.player.x !== atPost.x || mapStill.player.z !== atPost.z) errors.push(`travel-panel: ${JSON.stringify(mapStill)}`);
  await shot('travel-panel');

  // A fresh campaign has Act 2 locked: the key says why, and the server refuses the journey.
  const fresh = map.view.acts[1].locked;
  if (fresh) {
    const reason = 'Defeat the guardians of Act 1 to open the way.';
    if (map.reasons[0] !== reason || !map.cards[3].off) errors.push(`travel-locked: the reasons are ${JSON.stringify(map.reasons)}`);
    await page.keyboard.press('Digit4');
    await page.waitForFunction((r) => document.querySelector('#travel-panel .panel-message')?.textContent === r, reason, { timeout: 5000 })
      .catch(() => errors.push('travel-locked: the panel does not say why the act is locked'));
    const refused = await postJson('/api/travel', { location: 'Emberforge Mountains' });
    if (refused.status !== 409 || refused.body.error !== 'act_locked' || refused.body.message !== reason) errors.push(`travel-locked: the server answered ${JSON.stringify(refused)}`);
    // That refusal is the 409 this step asks for: its status line and console message are taken out of the report.
    for (const line of errors.filter((made) => made.includes('/api/travel'))) errors.splice(errors.indexOf(line), 1);
    if (await page.evaluate(() => window.__aiv.panel !== 'travel' || window.__aiv.travelling || window.__aiv.state.location.name !== 'Rivermeet Town')) errors.push('travel-locked: the locked location was travelled to');
    await shot('travel-locked');
  } else {
    console.log('skipped (this campaign has Act 2 open): travel-locked');
  }
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => document.querySelector('#travel-panel .panel-message')?.textContent === 'You are here.', null, { timeout: 5000 })
    .catch(() => errors.push('travel-panel: the current location does not say "You are here."'));
  // Esc closes; E opens it again.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aiv.panel === null && document.getElementById('travel-panel').hidden, null, { timeout: 5000 });
  if (await page.evaluate(() => window.__aiv.menuOpen)) errors.push('travel-panel: Esc opened the menu');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__aiv.panel === 'travel', null, { timeout: 10000 });

  // 5b. The journey to the Whispering Woods: the view goes black while the answer is held back, then the arrival.
  {
    let wake;
    const asleep = new Promise((done) => (wake = done));
    await page.route('**/api/travel', async (route) => {
      if (route.request().method() === 'POST') await asleep;
      await route.continue();
    });
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => window.__aiv.travelling === true, null, { timeout: 5000 });
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('veil')).opacity) > 0.99, null, { timeout: 15000 })
      .catch(() => errors.push('travel-fade: the view did not go black'));
    await page.keyboard.down('KeyW');
    for (const key of ['KeyE', 'KeyI', 'KeyJ', 'KeyM']) await page.keyboard.press(key);
    const dark = await page.evaluate(() => ({ travelling: window.__aiv.travelling, panel: window.__aiv.panel, menu: window.__aiv.menuOpen, prompt: window.__aiv.prompt, location: window.__aiv.state.location.name }));
    if (!dark.travelling || dark.panel !== null || dark.menu || dark.prompt !== null || dark.location !== 'Rivermeet Town') errors.push(`travel-fade: ${JSON.stringify(dark)}`);
    await shot('travel-fade');
    await page.keyboard.up('KeyW');
    wake();
    await arrived('Whispering Woods', 'entrance', 1, 'arrival-act1');
    await page.unroute('**/api/travel');
  }

  // 5c. The compass: a mark per gate with the name of the area behind it, and the signpost.
  {
    const seen = await page.evaluate(() => ({
      marks: window.__aiv.compass, exits: window.__aiv.state.exits, gates: window.__aiv.layout.gates.map((g) => g.exitId), player: window.__aiv.player,
      labels: [...document.querySelectorAll('#hud-compass .compass-label')].map((node) => [node.dataset.kind, node.textContent]),
      shown: !document.getElementById('hud-compass').hidden,
    }));
    const names = seen.gates.map((id) => seen.exits.find((exit) => exit.id === id)?.name);
    const gateMarks = (seen.marks ?? []).filter((mark) => mark.kind === 'gate');
    if (!seen.shown || seen.marks === null) errors.push('compass: it does not show in the world');
    else {
      if (JSON.stringify(gateMarks.map((mark) => mark.label)) !== JSON.stringify(names) || names.length !== seen.exits.length) errors.push(`compass: the gates are ${JSON.stringify(gateMarks.map((mark) => mark.label))}, the exits ${JSON.stringify(seen.exits)}`);
      if (seen.marks[seen.marks.length - 1].kind !== 'travel' || seen.marks[seen.marks.length - 1].label !== 'Signpost') errors.push(`compass: no mark for the signpost: ${JSON.stringify(seen.marks.map((mark) => mark.kind))}`);
      if (JSON.stringify(seen.labels) !== JSON.stringify(seen.marks.map((mark) => [mark.kind, mark.label]))) errors.push(`compass: the labels on screen are ${JSON.stringify(seen.labels)}`);
      for (const mark of seen.marks) {
        const bearing = Math.atan2(-(mark.x - seen.player.x), -(mark.z - seen.player.z)) - seen.player.yaw;
        if (Math.abs(Math.sin(bearing - mark.bearing)) > 1e-6 || Math.cos(bearing - mark.bearing) < 0) errors.push(`compass: the bearing of ${mark.label} is ${mark.bearing}`);
      }
    }
    // Turning the view turns the ring: the first gate straight ahead is at the top.
    await page.evaluate(() => {
      const g = window.__aiv.layout.gates[0];
      window.__aiv.lookAt(g.x, g.z);
    });
    await page.waitForFunction(() => Math.abs(window.__aiv.compass?.[0]?.bearing ?? 1) < 0.01, null, { timeout: 5000 }).catch(() => errors.push('compass: the gate looked at is not straight ahead'));
    await worldShot('compass');
  }

  // 5d. The journal: J opens it, I and C switch, J and Esc close, and the menu has it.
  {
    const book = await openJournal();
    if (book.sockets.length !== 5 || book.locked) errors.push(`journal-0-shards: ${book.sockets.length} sockets, pointer locked ${book.locked}`);
    for (const [i, socket] of book.sockets.entries()) {
      const shard = book.view.shards[i];
      if (socket.found !== shard.found || socket.label !== (shard.found ? shard.name : '???') || (socket.colour !== '') !== shard.found) errors.push(`journal-0-shards: socket ${i} shows ${JSON.stringify(socket)} for ${JSON.stringify(shard)}`);
    }
    if (serve && book.sockets.some((socket) => socket.found)) errors.push(`journal-0-shards: a fresh campaign has shards: ${JSON.stringify(book.sockets)}`);
    if (book.acts.length !== 3 || !book.acts[0].includes(campaign.acts[0].title) || !book.acts[0].includes(`Main quest: ${campaign.acts[0].mainQuest}`)) errors.push(`journal-0-shards: Act 1 reads "${(book.acts[0] ?? '').slice(0, 200)}"`);
    if (serve && !(book.acts[0].includes('In progress') && book.acts[1].includes('???') && book.acts[1].includes('Locked') && book.acts[1].includes('The road ahead is not yet known.'))) {
      errors.push(`journal-0-shards: the acts read ${JSON.stringify(book.acts).slice(0, 400)}`);
    }
    if (book.deeds.length !== 4 || !book.deeds[0].startsWith('Monsters Slain') || book.complete !== book.view.campaign_complete) errors.push(`journal-0-shards: the deeds are ${JSON.stringify(book.deeds)}`);
    await shot('journal-0-shards');
    await page.keyboard.press('KeyM');
    await page.keyboard.press('KeyE');
    if (await page.evaluate(() => window.__aiv.menuOpen || window.__aiv.panel !== 'journal')) errors.push('journal: M or E did something while it was open');
    await page.keyboard.press('KeyI');
    await page.waitForFunction(() => window.__aiv.panel === 'inventory' && document.getElementById('journal-panel').hidden, null, { timeout: 10000 }).catch(() => errors.push('journal: I does not switch to the inventory'));
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__aiv.panel === 'journal' && document.getElementById('inventory-panel').hidden, null, { timeout: 10000 }).catch(() => errors.push('journal: J does not switch from the inventory'));
    await page.keyboard.press('KeyC');
    await page.waitForFunction(() => window.__aiv.panel === 'sheet', null, { timeout: 10000 }).catch(() => errors.push('journal: C does not switch to the character sheet'));
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__aiv.panel === 'journal', null, { timeout: 10000 }).catch(() => errors.push('journal: J does not switch from the character sheet'));
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__aiv.panel === null && document.getElementById('journal-panel').hidden, null, { timeout: 5000 }).catch(() => errors.push('journal: J does not close it'));
    await page.keyboard.press('KeyM');
    await page.waitForSelector('#menu-journal', { state: 'visible', timeout: 5000 });
    await page.click('#menu-journal');
    await page.waitForFunction(() => window.__aiv.panel === 'journal' && !window.__aiv.menuOpen, null, { timeout: 10000 }).catch(() => errors.push('journal: the menu entry does not open it'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__aiv.panel === null, null, { timeout: 5000 }).catch(() => errors.push('journal: Esc does not close it'));
    if (await page.evaluate(() => window.__aiv.menuOpen)) errors.push('journal: Esc opened the menu');
    await stillHome('journal');
  }

  // Back to the town square for the walk through its gate.
  await post('/game/travel', [['location_name', 'Rivermeet Town']]);
  await openTitle();
  await enterWorld();

  // 6. Walk through the first gate with the W key held down.
  const gate = await page.evaluate(() => {
    const g = window.__aiv.layout.gates[0];
    window.__aiv.lookAt(g.x, g.z);
    return g;
  });
  // The next area (the tavern) needs a model the square has not loaded; it is held back, so that the
  // state on the way from gate to gate can be looked at: loading, and no player or layout to report.
  let letGo;
  const kept = new Promise((done) => (letGo = done));
  await page.route('**/models/**', async (route) => {
    await kept;
    await route.continue();
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__aiv.loading === true, null, { timeout: 60000 });
  const between = await page.evaluate(() => ({
    screen: window.__aiv.screen, player: window.__aiv.player, layout: window.__aiv.layout, dressing: window.__aiv.dressing,
    indicator: !document.getElementById('loading').hidden,
  }));
  if (between.player !== null || between.layout !== null || between.dressing !== null || between.screen !== 'world' || !between.indicator) {
    errors.push(`between two areas: ${JSON.stringify(between).slice(0, 300)}`);
  }
  letGo();
  await page.waitForFunction((id) => window.__aiv.state.area.id === id && window.__aiv.screen === 'world' && !window.__aiv.loading, gate.exitId, { timeout: 60000 });
  await page.keyboard.up('KeyW');
  await page.unroute('**/models/**');
  const served = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  if (served.area.id !== gate.exitId) errors.push(`walked to ${gate.exitId} but the server says ${served.area.id}`);
  const shownArea = await page.textContent('#hud-area');
  if (shownArea !== served.area.name) errors.push(`after the gate the HUD shows "${shownArea}", the server says "${served.area.name}"`);
  await worldShot('world-after-gate');

  // 7. The menu.
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#menu', { state: 'visible', timeout: 5000 });
  if (!(await page.evaluate(() => window.__aiv.menuOpen))) errors.push('the menu is visible but __aiv.menuOpen is false');
  await shot('menu');

  // 8. From the menu to the classic location page, which is in the area just walked to.
  await Promise.all([page.waitForURL(/\/game\/?$/, { timeout: 30000 }), page.click('#menu-location')]);
  await page.waitForSelector('.nav-3d', { timeout: 10000 });
  if (!(await page.content()).includes(served.area.name)) errors.push(`the classic location page does not name ${served.area.name}`);
  await shot('classic-location');

  // 9. And back through the link in the classic navigation.
  await Promise.all([page.waitForURL((u) => u.pathname === '/', { timeout: 30000 }), page.click('.nav-3d')]);
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready, null, { timeout: 30000 });
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 10000 });
  await shot('title-return');

  // 10. The landmarks of the town: the market stall and the inn front.
  await moveAndEnter('market');
  await landmarkShot('shop', 'area-shop');
  await moveAndEnter('tavern');
  await landmarkShot('rest', 'area-rest');

  // 11. The loading indicator, with the model requests held back until the screenshot is taken.
  let release;
  const held = new Promise((done) => (release = done));
  await page.route('**/models/**', async (route) => {
    await held;
    await route.continue();
  });
  await openTitle();
  await page.click('#btn-continue');
  await page.waitForSelector('#loading', { state: 'visible', timeout: 10000 });
  const waiting = await page.evaluate(() => ({
    loading: window.__aiv.loading, screen: window.__aiv.screen, player: window.__aiv.player, layout: window.__aiv.layout,
    text: document.getElementById('loading').textContent,
  }));
  if (waiting.loading !== true || waiting.screen !== 'title' || waiting.player !== null || waiting.layout !== null) errors.push(`while loading: ${JSON.stringify(waiting)}`);
  if (waiting.text !== 'Loading the area…') errors.push(`the loading indicator says "${waiting.text}"`);
  await shot('loading');
  release();
  await page.waitForFunction(inWorld, null, { timeout: 60000 });
  await page.unroute('**/models/**');
  if (await page.isVisible('#loading')) errors.push('the loading indicator stays after the area is loaded');

  // 12. The Whispering Woods. With --serve a goblin is planted at the entrance before the world is entered.
  const GOBLIN = { id: 'smoke-goblin', race: 'Goblin', class_name: 'Rogue', level: 1, name: 'Grak', weapon: 'Club' };
  const ORC = { id: 'smoke-orc', race: 'Orc', class_name: 'Fighter', level: 4, name: 'Thurg', weapon: 'Greatclub' };
  await post('/game/travel', [['location_name', 'Whispering Woods']]);
  if (serve) plant(GOBLIN, null);
  await openTitle();
  const woods = await enterWorld();
  if (woods.location.name !== 'Whispering Woods' || woods.area.id !== 'entrance') errors.push(`travelled to the Whispering Woods but the world shows ${woods.location.name}/${woods.area.id}`);
  await worldShot('loc-whispering-woods');

  // 13. What an area holds: a monster, an event object and the search spot, met and come back from.
  const encounters = ['content-monster', 'prompt-monster', 'battle-start', 'battle-turn', 'battle-victory', 'battle-after', 'content-monster-gone',
    'battle-ability', 'battle-item', 'battle-flee', 'battle-defeat', 'battle-revived', 'battle-reload', 'content-event', 'prompt-event', 'event-panel', 'event-reload',
    'event-success', 'event-spent', 'event-failure', 'event-fight-result', 'event-fight', 'content-event-gone', 'prompt-search', 'after-search'];
  if (serve) {
    await slotShot('monster', 'content-monster');
    const met = await page.evaluate(() => window.__aiv.contents?.monster ?? null);
    if (met?.id !== GOBLIN.id || met.name !== GOBLIN.name || met.race !== 'Goblin' || met.level !== 1) errors.push(`the planted goblin is shown as ${JSON.stringify(met)}`);
    await walkTo('monster', 2.6);
    await promptShot('E: fight Grak the Goblin', 'prompt-monster');

    // 13a. The fight starts where the monster stands: no navigation, the panel over the view.
    let stance = await startFight('battle-start');
    await untilOpen();
    await shot('battle-start');

    // 13b. A turn is played; while it is, keys send nothing.
    const sent = [];
    const count = (request) => request.method() === 'POST' && request.url().includes('/api/battle/') && sent.push(request.url());
    page.on('request', count);
    await page.keyboard.press('KeyA');
    await page.waitForFunction(() => window.__aiv.battle?.playing === true, null, { timeout: 30000 })
      .catch(() => errors.push('battle-turn: no turn was played after A'));
    for (const key of ['KeyA', 'KeyD', 'Digit1', 'KeyF']) await page.keyboard.press(key);
    if (await page.evaluate(() => window.__aiv.battle?.locked !== true)) errors.push('battle-turn: the fight was not locked while the keys were pressed');
    await shot('battle-turn');
    await page.waitForTimeout(150);
    if (sent.length !== 1) errors.push(`battle-turn: ${sent.length} requests were sent, expected the one attack: ${sent.join(', ')}`);
    page.off('request', count);

    // 13c. Attacks until the goblin falls: the result panel with the rewards.
    await fightUntil('KeyA', 'victory', 'battle-victory');
    const won = await page.textContent('#battle-result');
    if (!/\+\d+ XP/.test(won) || !/\+\d+ gold/.test(won)) errors.push(`battle-victory: the result panel shows no XP and gold: "${won}"`);
    await shot('battle-victory');

    // 13d. Continue: walking again from the battle stance, the monster gone, the HUD with the new values.
    await page.keyboard.press('Enter');
    await backToWalking(stance, 'battle-after');
    const after = await page.evaluate(() => ({ monster: window.__aiv.contents?.monster ?? null, character: window.__aiv.state.character }));
    if (after.monster !== null) errors.push('battle-after: the monster is still in the area after the fight');
    const hud = await page.textContent('#hud-character');
    for (const part of [`XP ${after.character.xp}/${after.character.xp_to_next_level}`, `Gold ${after.character.gold}`]) {
      if (!hud.includes(part)) errors.push(`battle-after: the HUD shows "${hud}", without "${part}"`);
    }
    // A fight of exactly five rounds gives the 150 XP of level 2, which leaves 0 XP at level 2.
    if (!((after.character.xp > 0 || after.character.level > 1) && after.character.gold > 0)) errors.push(`battle-after: no XP or gold after the victory: ${JSON.stringify(after.character)}`);
    await worldShot('battle-after');
    await worldShot('content-monster-gone');

    // 13e. A second fight, against something that lasts, with a potion: an ability, then an item, then the win.
    plant(ORC, null, (session) => {
      session.character.inventory.push({ name: 'Healing Potion', description: '', type: 'potion', healing_amount: 10 });
    });
    await openTitle();
    await enterWorld();
    await walkTo('monster', 2.6);
    stance = await startFight('battle-ability');
    const potions = await page.evaluate(() => window.__aiv.battle.view.items.reduce((sum, stack) => sum + stack.count, 0));
    for (const [key, name, kind] of [['Digit1', 'battle-ability', 'ability'], ['KeyQ', 'battle-item', 'item']]) {
      await untilOpen();
      const before = await page.evaluate(() => window.__aiv.battle?.view.turn.seq ?? null);
      await page.keyboard.press(key);
      await page.waitForFunction((n) => window.__aiv.battle?.playing === true && window.__aiv.battle.view.turn.seq !== n, before, { timeout: 30000 })
        .catch(() => errors.push(`${name}: no turn was played after the key`));
      const first = await page.evaluate(() => window.__aiv.battle?.view.turn.events[0] ?? null);
      if (first?.actor !== 'player' || first.kind !== kind) errors.push(`${name}: the turn starts with ${JSON.stringify(first)}, expected the player's ${kind}`);
      await page.waitForTimeout(450);
      await shot(name);
    }
    const potionsLeft = await page.evaluate(() => (window.__aiv.battle?.view.items ?? []).reduce((sum, stack) => sum + stack.count, 0));
    if (potionsLeft !== potions - 1) errors.push(`battle-item: ${potionsLeft} potions left of ${potions}`);
    await fightUntil('KeyA', 'victory', 'battle-item');
    await page.keyboard.press('Enter');
    await backToWalking(stance, 'battle-item');

    // 13f. A third fight, fled from: walking again, the monster back on its slot with its id.
    plant({ ...GOBLIN, id: 'smoke-goblin-3' }, null);
    await openTitle();
    await enterWorld();
    await walkTo('monster', 2.6);
    stance = await startFight('battle-flee');
    for (let tries = 0; tries < 60; tries++) {
      await untilOpen();
      if (await page.evaluate(() => window.__aiv.screen !== 'battle')) break;
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.__aiv.screen !== 'battle' || window.__aiv.battle?.locked === true, null, { timeout: 30000 });
    }
    await backToWalking(stance, 'battle-flee');
    const fled = await page.evaluate(() => window.__aiv.contents?.monster?.id ?? null);
    if (fled !== 'smoke-goblin-3') errors.push(`battle-flee: the monster in the area after the flight is ${JSON.stringify(fled)}`);
    await worldShot('battle-flee');

    // 13g. A fight that is lost: one hit point, defending until the end, then Rise Again.
    editSession((session) => {
      session.character.current_hit_points = 1;
    });
    await openTitle();
    await enterWorld();
    await walkTo('monster', 2.6);
    await startFight('battle-defeat');
    await fightUntil('KeyD', 'defeat', 'battle-defeat');
    const lost = await page.textContent('#battle-result');
    if (!lost.includes('You have been slain by Grak') || !lost.includes('Rise Again')) errors.push(`battle-defeat: the result panel says "${lost}"`);
    await shot('battle-defeat');
    await page.click('#battle-revive');
    await page.waitForFunction(inWorld, null, { timeout: 60000 });
    const risen = await page.evaluate(() => ({ area: window.__aiv.state.area.id, character: window.__aiv.state.character, battle: window.__aiv.battle }));
    if (risen.area !== 'entrance' || risen.character.current_hit_points !== risen.character.max_hit_points || risen.battle !== null) {
      errors.push(`battle-revived: ${JSON.stringify(risen).slice(0, 300)}`);
    }
    if (await page.isVisible('#battle-panel')) errors.push('battle-revived: the battle panel is still shown');
    await worldShot('battle-revived');

    // 13h. A reload in the middle of a fight: the panel is back without the title screen, and nothing is played again.
    plant({ ...ORC, id: 'smoke-orc-2' }, null);
    await openTitle();
    await enterWorld();
    await walkTo('monster', 2.6);
    await startFight('battle-reload');
    await untilOpen();
    await page.keyboard.press('KeyD');
    await page.waitForFunction(() => window.__aiv.battle?.playing === true, null, { timeout: 30000 }).catch(() => errors.push('battle-reload: no turn was played after D'));
    await untilOpen();
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    // In the page from its first script on: whether a turn was ever being played.
    const played = page.evaluate(() => new Promise((done) => {
      let seen = false;
      const started = performance.now();
      const look = () => {
        seen = seen || window.__aiv?.battle?.playing === true;
        if (performance.now() - started > 4000) done(seen);
        else requestAnimationFrame(look);
      };
      look();
    }));
    await page.waitForFunction(() => window.__aiv?.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 60000 });
    if (await page.isVisible('#title-screen')) errors.push('battle-reload: the title screen is shown');
    if (await played) errors.push('battle-reload: the last turn was played again after the reload');
    const reloaded = await page.evaluate(() => ({ phase: window.__aiv.battle.view.phase, locked: window.__aiv.battle.locked, monster: window.__aiv.battle.view.monster.name }));
    if (reloaded.phase !== 'fight' || reloaded.locked || reloaded.monster !== ORC.name) errors.push(`battle-reload: ${JSON.stringify(reloaded)}`);
    await shot('battle-reload');
    stance = await page.evaluate(() => window.__aiv.player);
    await fightUntil('KeyA', 'victory', 'battle-reload');
    await page.keyboard.press('Enter');
    await backToWalking(stance, 'battle-reload');
    let stood;

    // 13i. An event is met where its object stands: the panel over the view, no navigation.
    plant(null, { id: 'abandoned_chest' });
    await openTitle();
    await enterWorld();
    await slotShot('event', 'content-event');
    const found = await page.evaluate(() => window.__aiv.contents?.event ?? null);
    if (found?.id !== 'abandoned_chest' || found.object !== 'chest' || found.landmark !== false) errors.push(`the planted event is shown as ${JSON.stringify(found)}`);
    await walkTo('event', 2.6);
    await promptShot('E: look at the abandoned chest', 'prompt-event');
    stood = await page.evaluate(() => window.__aiv.player);
    await openEventPanel('event-panel', 4);
    // Walking, the menu and Esc do nothing while the panel is open.
    await page.keyboard.down('KeyW');
    await page.keyboard.press('KeyM');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    const held = await page.evaluate(() => ({ player: window.__aiv.player, menu: window.__aiv.menuOpen, screen: window.__aiv.screen }));
    if (Math.hypot(held.player.x - stood.x, held.player.z - stood.z) > 0.01 || held.menu || held.screen !== 'event') errors.push(`event-panel: the panel does not hold the player: ${JSON.stringify(held)}`);
    await shot('event-panel');

    // A reload while the event waits: the panel is back without the title screen, the player where they stood.
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__aiv?.screen === 'event' && !window.__aiv.loading && !document.getElementById('event-panel').hidden, null, { timeout: 60000 });
    if (await page.isVisible('#title-screen')) errors.push('event-reload: the title screen is shown');
    const again = await page.evaluate(() => ({ player: window.__aiv.player, view: window.__aiv.event?.view?.id ?? null }));
    if (again.view !== 'abandoned_chest' || Math.hypot(again.player.x - stood.x, again.player.z - stood.z) > 0.05) errors.push(`event-reload: ${JSON.stringify(again)}`);
    await shot('event-reload');

    // 13j. The first choice with a 20 on the die: the roll, Success, what was gained.
    let outcome = await chooseWith(20, 'event-success');
    if (outcome.verdict !== 'Success' || !outcome.roll.includes('d20 20 ') || !outcome.kinds.includes('gold') || !outcome.kinds.includes('xp')) errors.push(`event-success: ${JSON.stringify(outcome)}`);
    await shot('event-success');

    // 13k. Continue: walking on from where the player stood, the chest still there, opened, and nothing to do with it.
    await page.keyboard.press('Enter');
    await page.waitForFunction(inWorld, null, { timeout: 30000 });
    const spent = await page.evaluate(() => ({
      player: window.__aiv.player, event: window.__aiv.contents?.event ?? null, spent: window.__aiv.contents?.spent?.id ?? null,
      prompt: window.__aiv.prompt, kind: window.__aiv.interaction?.kind ?? null, panel: !document.getElementById('event-panel').hidden,
    }));
    if (Math.hypot(spent.player.x - stood.x, spent.player.z - stood.z) > 0.05) errors.push(`event-spent: walking again at ${JSON.stringify(spent.player)}, the event was met at ${JSON.stringify(stood)}`);
    if (spent.event !== null || spent.spent !== 'abandoned_chest' || spent.panel) errors.push(`event-spent: ${JSON.stringify(spent)}`);
    if (spent.kind === 'event' || (spent.prompt ?? '').includes('chest')) errors.push(`event-spent: the spent chest still prompts "${spent.prompt}"`);
    await stillHome('event-spent');
    await slotShot('event', 'event-spent');

    // 13l. The chest again, with a 1 on the die: Failure, and what it cost.
    plant(null, { id: 'abandoned_chest' });
    await openTitle();
    await enterWorld();
    await walkTo('event', 2.6);
    await openEventPanel('event-failure', 4);
    outcome = await chooseWith(1, 'event-failure');
    if (outcome.verdict !== 'Failure' || !outcome.roll.includes('d20 1 ') || !outcome.kinds.includes('damage')) errors.push(`event-failure: ${JSON.stringify(outcome)}`);
    await shot('event-failure');
    await page.click('#event-continue');
    await page.waitForFunction(inWorld, null, { timeout: 30000 });

    // 13m. Tracks that lead into a fight: the monster comes out where the tracks were, still on /.
    plant(null, { id: 'strange_tracks' });
    await openTitle();
    await enterWorld();
    await walkTo('event', 2.6);
    await openEventPanel('event-fight-result', 3);
    outcome = await chooseWith(1, 'event-fight-result');
    if (!outcome.chips.includes('A fight begins!')) errors.push(`event-fight-result: ${JSON.stringify(outcome)}`);
    await shot('event-fight-result');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__aiv.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 30000 });
    const ambush = await page.evaluate(() => ({
      place: window.__aiv.battle.view.monster.place, phase: window.__aiv.battle.view.phase, player: window.__aiv.player, slot: window.__aiv.layout.slots.event,
      panel: !document.getElementById('event-panel').hidden,
    }));
    const reach = Math.hypot(ambush.player.x - ambush.slot.x, ambush.player.z - ambush.slot.z);
    if (ambush.place !== 'event' || ambush.phase !== 'fight' || ambush.panel || !(reach >= 1.5 - 1e-6 && reach <= 2.5 + 1e-6)) errors.push(`event-fight: ${JSON.stringify(ambush)}`);
    await stillHome('event-fight');
    await page.waitForTimeout(500);
    await untilOpen();
    await shot('event-fight');
    stance = await page.evaluate(() => window.__aiv.player);
    await fightUntil('KeyA', 'victory', 'event-fight');
    await page.keyboard.press('Enter');
    await backToWalking(stance, 'event-fight');
    if (await page.evaluate(() => window.__aiv.contents?.event !== null)) errors.push('the event is still in the area after it was answered');
    await worldShot('content-event-gone');

    // Nothing is left here but what the tracks left, so the search spot answers.
    const before = await page.evaluate(() => window.__aiv.contents.seq);
    await walkTo('search', 1.5);
    await promptShot('E: search further', 'prompt-search');
    await page.keyboard.press('KeyE');
    await page.waitForFunction((n) => window.__aiv.contents?.seq === n + 1, before, { timeout: 30000 })
      .catch(() => errors.push('after-search: the contents were not rolled again'));
    await page.waitForTimeout(300);
    await worldShot('after-search');
  } else {
    console.log(`skipped without --serve (nothing can be planted): ${encounters.join(', ')}`);
  }

  // 13n. A discovery is the landmark of its area: the bridge of Rivermeet glows, and E at it opens the panel.
  if (serve) {
    await post('/game/travel', [['location_name', 'Rivermeet Town']]);
    await moveAndEnter('bridge');
    plant(null, { id: 'bridge_runes' });
    await openTitle();
    await enterWorld();
    const runes = await page.evaluate(() => ({
      event: window.__aiv.contents?.event ?? null, point: window.__aiv.layout.slots.landmark,
      mark: window.__aiv.dressing.placements.find((p) => p.landmark === 'special') ?? null,
    }));
    if (runes.event?.id !== 'bridge_runes' || runes.event.landmark !== true || !runes.point || !runes.mark) errors.push(`discovery: ${JSON.stringify(runes).slice(0, 300)}`);
    await walkTo('landmark', 1.5);
    await page.evaluate(() => {
      const mark = window.__aiv.dressing.placements.find((p) => p.landmark === 'special');
      window.__aiv.lookAt(mark.x, mark.z);
    });
    await promptShot('E: look at the carved runes', 'discovery');
    await openEventPanel('discovery-panel', 2);
    await shot('discovery-panel');
    const told = await chooseWith(20, 'discovery-panel');
    if (told.verdict !== 'Success') errors.push(`discovery-panel: ${JSON.stringify(told)}`);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(inWorld, null, { timeout: 30000 });
    const kept = await page.evaluate(() => ({ spent: window.__aiv.contents?.spent ?? null, kind: window.__aiv.interaction?.kind ?? null }));
    if (kept.spent?.id !== 'bridge_runes' || kept.spent.landmark !== true || kept.kind === 'event') errors.push(`discovery-spent: ${JSON.stringify(kept)}`);
    await stillHome('discovery');
    await worldShot('discovery-spent');
    await post('/game/travel', [['location_name', 'Whispering Woods']]);
  } else {
    console.log('skipped without --serve (nothing can be planted): discovery, discovery-panel, discovery-spent');
  }

  // 14. The arena of the first boss, and the boss in it. The fight is not started.
  await moveAndEnter('grove');
  await landmarkShot('boss', 'area-boss');
  await slotShot('boss', 'content-boss');
  const guardian = await page.evaluate(() => window.__aiv.contents?.boss ?? null);
  if (guardian?.id !== 'Shard Guardian') errors.push(`the boss of the grove is shown as ${JSON.stringify(guardian)}`);
  await walkTo('boss', 2.6);
  await promptShot('E: challenge The Shard Guardian', 'prompt-boss');
  if (await page.evaluate(() => window.__aiv.interaction?.auto !== false)) errors.push('the boss would start the fight without a key press');

  // 14a. The boss fight, with a character that outlasts it: the introduction, the plate, the rage, the defeat scene.
  if (serve) {
    const guardianData = bosses['Shard Guardian'];
    editSession((session) => {
      session.character.level = 20;
      session.character.max_hit_points = session.character.current_hit_points = 9999;
      session.defeated_bosses = ['Corrupted Captain'];
    });
    await openTitle();
    await enterWorld();
    await walkTo('boss', 2.6);
    const engaged = [];
    const challenge = (request) => request.method() === 'POST' && request.url().includes('/api/') && engaged.push(request.url());
    page.on('request', challenge);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.screen === 'intro' && !document.getElementById('boss-intro').hidden, null, { timeout: 10000 });
    const intro = await page.evaluate(() => ({
      id: window.__aiv.intro, name: document.getElementById('boss-intro-name').textContent, title: document.getElementById('boss-intro-title').textContent,
      text: document.getElementById('boss-intro-text').textContent, locked: document.pointerLockElement !== null,
    }));
    if (intro.id !== 'Shard Guardian' || intro.name !== guardianData.name || intro.title !== guardianData.title || intro.text !== guardianData.intro || intro.locked) {
      errors.push(`boss-intro: ${JSON.stringify(intro).slice(0, 300)}`);
    }
    // Step back changes nothing; walking and the menu do nothing while the panel is open.
    await page.keyboard.press('KeyM');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__aiv.screen === 'world' && document.getElementById('boss-intro').hidden, null, { timeout: 5000 })
      .catch(() => errors.push('boss-intro: Esc does not close the introduction'));
    if (await page.evaluate(() => window.__aiv.menuOpen)) errors.push('boss-intro: the menu opened behind the introduction');
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.screen === 'intro', null, { timeout: 10000 });
    if (engaged.length) errors.push(`boss-intro: requests were sent before Fight: ${engaged.join(', ')}`);
    await stillHome('boss-intro');
    await page.waitForTimeout(300);
    await shot('boss-intro');

    await page.click('#boss-intro-fight');
    await page.waitForFunction(() => window.__aiv.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await untilOpen();
    const plate = await page.evaluate(() => ({
      classes: document.getElementById('battle-monster').className, text: document.getElementById('battle-monster').textContent,
      taunt: document.getElementById('battle-taunt')?.textContent ?? null, flee: document.querySelector('#battle-actions .btn-flee') !== null,
      view: window.__aiv.battle.view.monster, intro: !document.getElementById('boss-intro').hidden,
    }));
    if (!plate.classes.split(' ').includes('boss') || !plate.text.includes(guardianData.name) || !plate.text.includes(guardianData.title) || !plate.text.includes('Level 5')) {
      errors.push(`boss-fight: the plate shows "${plate.text}" with the classes "${plate.classes}"`);
    }
    if (!plate.taunt || !plate.view.taunt || !plate.taunt.includes(plate.view.taunt)) errors.push(`boss-fight: the taunt shown is ${JSON.stringify(plate.taunt)}, the server says ${JSON.stringify(plate.view.taunt)}`);
    if (plate.flee || plate.intro || plate.view.place !== 'boss') errors.push(`boss-fight: flee offered ${plate.flee}, introduction shown ${plate.intro}, place ${plate.view.place}`);
    engaged.length = 0;
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(200);
    if (engaged.length) errors.push(`boss-fight: F sent ${engaged.join(', ')}`);
    page.off('request', challenge);
    await stillHome('boss-fight');
    await shot('boss-fight');

    // Attacks until the boss flies into its rage: the banner with its line, and the look from then on.
    let banner = null;
    for (let turns = 0; turns < 200 && banner === null; turns++) {
      await untilOpen();
      const now = await page.evaluate(() => ({ result: window.__aiv.battle?.result ?? null, enraged: window.__aiv.battle?.view.monster.enraged ?? false }));
      if (now.result !== null || now.enraged) break;
      await page.keyboard.press('KeyA');
      await page.waitForFunction(() => window.__aiv.battle === null || window.__aiv.battle.locked || window.__aiv.battle.result !== null, null, { timeout: 30000 });
      // Until the turn that came back has been played, or the banner shows in it.
      await page.waitForFunction(() => !document.getElementById('battle-enrage').hidden || window.__aiv.battle === null || window.__aiv.battle.result !== null || !window.__aiv.battle.locked, null, { timeout: 30000 });
      if (await page.isVisible('#battle-enrage')) banner = await page.textContent('#battle-enrage');
    }
    if (banner !== guardianData.enrage_text) errors.push(`boss-enraged: the banner says ${JSON.stringify(banner)}, expected "${guardianData.enrage_text}"`);
    await page.waitForTimeout(350);
    await shot('boss-enraged');
    await untilOpen();
    const raging = await page.evaluate(() => ({
      classes: document.getElementById('battle-monster').className, text: document.getElementById('battle-monster').textContent,
      enraged: window.__aiv.battle?.view.monster.enraged ?? null, result: window.__aiv.battle?.result ?? null,
    }));
    if (raging.result === null && (raging.enraged !== true || !raging.classes.split(' ').includes('enraged') || !raging.text.includes('Enraged'))) errors.push(`boss-enraged: ${JSON.stringify(raging)}`);

    // Attacks until it falls: its last moment, the rewards, the shard and the act it opens.
    const facing = await page.evaluate(() => window.__aiv.player);
    await fightUntil('KeyA', 'victory', 'boss-defeat-scene');
    const scene = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('#battle-result .boss-line')].map((node) => [node.dataset.kind, node.textContent]),
      order: [...document.querySelectorAll('#battle-result .boss-line, #battle-result .rewards')].map((node) => node.dataset.kind ?? 'rewards'),
      text: document.getElementById('battle-result').textContent,
    }));
    const line = (kind) => (scene.lines.find(([k]) => k === kind) ?? [null, null])[1];
    if (line('defeat') !== guardianData.defeat_text) errors.push(`boss-defeat-scene: the defeat text is ${JSON.stringify(line('defeat'))}`);
    if (line('shard') !== 'Shard of Verdance won. Crown shards: 1 of 5.') errors.push(`boss-defeat-scene: the shard line is ${JSON.stringify(line('shard'))}`);
    if (!/^Act 2: .+ is now open\.$/.test(line('act') ?? '')) errors.push(`boss-defeat-scene: the act line is ${JSON.stringify(line('act'))}`);
    if (scene.order.join() !== 'defeat,rewards,shard,act') errors.push(`boss-defeat-scene: the order is ${scene.order.join()}`);
    if (!/\+\d+ XP/.test(scene.text) || !/\+\d+ gold/.test(scene.text)) errors.push(`boss-defeat-scene: no XP and gold in "${scene.text}"`);
    await stillHome('boss-defeat-scene');
    await shot('boss-defeat-scene');
    await page.keyboard.press('Enter');
    await backToWalking(facing, 'boss-defeat-scene');
    if (await page.evaluate(() => window.__aiv.contents?.boss !== null)) errors.push('boss-defeat-scene: the boss still stands in the grove');
  } else {
    console.log('skipped without --serve (the fight cannot be fixed): boss-intro, boss-fight, boss-enraged, boss-defeat-scene');
  }

  // 15. The rest of Act 1.
  if (serve) defeatEveryBoss();
  await travelAndEnter('Abandoned Watchtower', 'loc-abandoned-watchtower');

  // 16. Acts 2 and 3, which a new character reaches only with every boss defeated.
  const later = [
    ['Emberforge Mountains', 'loc-emberforge-mountains'],
    ['Sunken Temple of Dariel', 'loc-sunken-temple'],
    ['Windswept Plains', 'loc-windswept-plains'],
    ['The Crystalline Caves', 'loc-crystalline-caves'],
    ['The Convergence', 'loc-convergence'],
  ];
  if (serve) for (const [locationName, name] of later) await travelAndEnter(locationName, name);
  else console.log(`skipped without --serve (Acts 2 and 3 are locked): ${later.map(([, name]) => name).join(', ')}`);

  // 16b. Inventory, character sheet and rest, in the tavern of Rivermeet. With --serve the character is
  // wounded, level 4 with its points unspent, and carries a second weapon and an armour it may use.
  await post('/game/travel', [['location_name', 'Rivermeet Town']]);
  await moveAndEnter('tavern');
  if (serve) {
    editSession((session) => {
      const c = session.character;
      c.level = 4;
      c.ability_increases = {};
      c.max_hit_points = 40;
      c.current_hit_points = 5;
      c.power_points = 0;
      c.active_effects = [];
      c.inventory = [
        { name: 'Small Healing Potion', type: 'potion', healing_amount: 10 },
        { name: 'Small Healing Potion', type: 'potion', healing_amount: 10 },
        { name: 'Greatsword', type: 'weapon' },
        { name: 'Plate', type: 'armor' },
      ];
      session.area_contents = { location: session.location_name, area_id: session.area_id, seq: (session.area_contents?.seq ?? 0) + 1, monster: null, event: null };
    });
    await openTitle();
    await enterWorld();
  }
  const panelNow = () => page.evaluate(() => ({
    panel: window.__aiv.panel, screen: window.__aiv.screen, prompt: window.__aiv.prompt, interaction: window.__aiv.interaction, menu: window.__aiv.menuOpen,
    inventory: window.__aiv.inventory !== null, sheet: window.__aiv.sheet !== null, player: window.__aiv.player,
    shownInventory: !document.getElementById('inventory-panel').hidden, shownSheet: !document.getElementById('sheet-panel').hidden,
  }));
  const openPanel = async (key, kind, name) => {
    await page.keyboard.press(key);
    await page.waitForFunction((k) => window.__aiv.panel === k, kind, { timeout: 10000 });
    const seen = await panelNow();
    const fine = seen.screen === 'world' && seen.prompt === null && seen.interaction === null && !seen.menu && seen.inventory && seen.sheet
      && seen.shownInventory === (kind === 'inventory') && seen.shownSheet === (kind === 'sheet');
    if (!fine) errors.push(`${name}: ${JSON.stringify(seen)}`);
    if (name) await shot(name);
    return seen;
  };
  const closePanel = async (key, name) => {
    await page.keyboard.press(key);
    await page.waitForFunction(() => window.__aiv.panel === null, null, { timeout: 5000 });
    const seen = await panelNow();
    if (seen.menu || seen.shownInventory || seen.shownSheet || seen.screen !== 'world') errors.push(`${name}: after ${key}: ${JSON.stringify(seen)}`);
  };
  const opened = await openPanel('KeyI', 'inventory', 'inventory-panel');
  // Nobody walks and M opens no menu while a panel is open.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('KeyE');
  const still = await panelNow();
  if (still.panel !== 'inventory' || still.menu || still.player.x !== opened.player.x || still.player.z !== opened.player.z) errors.push(`inventory-panel: W, M or E did something: ${JSON.stringify(still)}`);
  await openPanel('KeyC', 'sheet', 'sheet-panel');
  if (!(await page.textContent('#sheet-attack')) || !(await page.textContent('#sheet-ac'))) errors.push('sheet-panel: the attack line or the armor class is empty');
  if ((await page.locator('#sheet-skills .sheet-skill').count()) !== 18) errors.push('sheet-panel: the sheet does not list 18 skills');
  await closePanel('Escape', 'sheet-panel');
  // The key of the open panel closes it; the menu entries open the panels and the menu closes.
  await openPanel('KeyC', 'sheet', null);
  await closePanel('KeyC', 'sheet toggle');
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#menu', { state: 'visible', timeout: 5000 });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(300);
  if ((await panelNow()).panel !== null) errors.push('I opened a panel while the menu was open');
  await page.click('#menu-inventory');
  await page.waitForFunction(() => window.__aiv.panel === 'inventory' && !window.__aiv.menuOpen, null, { timeout: 10000 });
  await closePanel('KeyI', 'inventory from the menu');
  if (new URL(page.url()).pathname !== '/') errors.push(`the panels left / for ${page.url()}`);

  const sheetSteps = ['potion-drunk', 'weapon-equipped', 'armor-equipped', 'ability-badge', 'ability-spent', 'rest-prompt', 'rest-fade', 'rested'];
  if (serve) {
    const hud = () => page.textContent('#hud-character');
    const hp = () => page.evaluate(() => window.__aiv.state.character.current_hit_points);
    const clickItem = async (itemName) => {
      const row = page.locator('#inventory-panel .inv-item', { hasText: itemName }).first();
      await row.locator('.inv-action').click();
    };
    const message = async (panelId, text, name) => {
      await page.waitForFunction(([id, t]) => document.querySelector(`#${id} .panel-message`)?.textContent === t, [panelId, text], { timeout: 10000 })
        .catch(() => errors.push(`${name}: the panel does not say "${text}"`));
    };
    await openPanel('KeyI', 'inventory', null);
    const before = { hp: await hp(), attack: await page.textContent('#inv-attack'), ac: await page.textContent('#inv-ac') };
    if (before.hp !== 5) errors.push(`potion-drunk: the wounded character has ${before.hp} HP, not 5`);
    await clickItem('Small Healing Potion');
    await message('inventory-panel', 'You drink the Small Healing Potion and recover 10 HP.', 'potion-drunk');
    if ((await hp()) !== 15 || !(await hud()).includes('HP 15/40')) errors.push(`potion-drunk: HP is ${await hp()}, the HUD says "${await hud()}"`);
    await shot('potion-drunk');

    await clickItem('Greatsword');
    await message('inventory-panel', 'Equipped Greatsword.', 'weapon-equipped');
    const armed = await page.evaluate(() => ({ weapon: window.__aiv.sheet.attack.weapon, line: document.getElementById('inv-attack').textContent }));
    if (armed.weapon !== 'Greatsword' || armed.line === before.attack || !armed.line.startsWith('Greatsword:')) errors.push(`weapon-equipped: ${JSON.stringify(armed)}, before "${before.attack}"`);
    await shot('weapon-equipped');

    await clickItem('Plate');
    await message('inventory-panel', 'Equipped Plate.', 'armor-equipped');
    const armoured = await page.evaluate(() => ({ ac: document.getElementById('inv-ac').textContent, sheet: window.__aiv.sheet.armor_class, inventory: window.__aiv.inventory.armor_class }));
    if (armoured.ac === before.ac || armoured.sheet !== armoured.inventory || armoured.ac !== `Armor Class ${armoured.sheet}`) errors.push(`armor-equipped: ${JSON.stringify(armoured)}, before "${before.ac}"`);
    await shot('armor-equipped');
    await closePanel('Escape', 'armor-equipped');

    const badge = await page.evaluate(() => ({ hidden: document.getElementById('hud-asi').hidden, text: document.getElementById('hud-asi').textContent, points: window.__aiv.state.asi_points }));
    if (badge.hidden || badge.text !== '2 ability points to spend (C)' || badge.points !== 2) errors.push(`ability-badge: ${JSON.stringify(badge)}`);
    await shot('ability-badge');

    await openPanel('KeyC', 'sheet', null);
    const score = await page.evaluate(() => window.__aiv.sheet.strength_score);
    if ((await page.locator('.sheet-improve').count()) !== 6) errors.push('ability-spent: not every score has a +1 button');
    await page.click('.sheet-improve[data-ability="strength"]');
    await page.waitForFunction((n) => window.__aiv.sheet.strength_score === n + 1, score, { timeout: 10000 })
      .catch(() => errors.push('ability-spent: Strength did not go up'));
    const spent = await page.evaluate(() => ({ points: window.__aiv.state.asi_points, text: document.getElementById('hud-asi').textContent, said: document.querySelector('#sheet-panel .panel-message').textContent }));
    if (spent.points !== 1 || spent.text !== '1 ability point to spend (C)' || !spent.said.startsWith(`Strength is now ${score + 1}`)) errors.push(`ability-spent: ${JSON.stringify(spent)}`);
    await shot('ability-spent');
    await closePanel('Escape', 'ability-spent');

    // Rest at the inn front: the view goes black, the server restores, the view comes back.
    if (!(await page.evaluate(() => window.__aiv.layout.slots.rest !== null))) errors.push('rest-prompt: the tavern has no rest slot');
    await walkTo('rest', 2.5);
    await promptShot('E: rest', 'rest-prompt');
    // The answer is held back until the screenshot is taken, so that the black view can be looked at.
    let wake;
    const asleep = new Promise((done) => (wake = done));
    await page.route('**/api/rest', async (route) => {
      await asleep;
      await route.continue();
    });
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.resting === true, null, { timeout: 5000 });
    const stood = await page.evaluate(() => window.__aiv.player);
    await page.keyboard.down('KeyW');
    await page.keyboard.press('KeyM');
    await page.keyboard.press('KeyI');
    // In the headless browser the fade was seen to lag behind the clock: wait for the black instead of a fixed time.
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('veil')).opacity) > 0.99, null, { timeout: 15000 })
      .catch(() => errors.push('rest-fade: the view did not go black'));
    const dark = await page.evaluate(() => ({
      resting: window.__aiv.resting, prompt: window.__aiv.prompt, player: window.__aiv.player, menu: window.__aiv.menuOpen, panel: window.__aiv.panel,
      veil: Number(getComputedStyle(document.getElementById('veil')).opacity),
    }));
    if (!dark.resting || dark.prompt !== null || dark.menu || dark.panel !== null || dark.player.x !== stood.x || dark.player.z !== stood.z || dark.veil < 0.95) errors.push(`rest-fade: ${JSON.stringify(dark)}`);
    await shot('rest-fade');
    await page.keyboard.up('KeyW');
    wake();
    await page.waitForFunction(() => window.__aiv.resting === false, null, { timeout: 10000 });
    await page.unroute('**/api/rest');
    // As with the black: the fade back was seen to lag behind the clock in the headless browser.
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('veil')).opacity) <= 0.05, null, { timeout: 15000 }).catch(() => {});
    const rested = await page.evaluate(() => ({
      c: window.__aiv.state.character, notice: document.getElementById('notice').hidden ? null : document.getElementById('notice').textContent,
      veil: Number(getComputedStyle(document.getElementById('veil')).opacity),
    }));
    if (rested.c.current_hit_points !== rested.c.max_hit_points || rested.c.power_points !== rested.c.max_power_points || rested.c.max_power_points < 1) errors.push(`rested: ${JSON.stringify(rested.c)}`);
    if (rested.notice !== 'You rest. Hit points and power points are restored.') errors.push(`rested: #notice shows ${JSON.stringify(rested.notice)}`);
    if (rested.veil > 0.05) errors.push(`rested: the view is still dark (${rested.veil})`);
    if (!(await hud()).includes(`HP ${rested.c.max_hit_points}/${rested.c.max_hit_points}`)) errors.push(`rested: the HUD says "${await hud()}"`);
    await worldShot('rested');
    if (new URL(page.url()).pathname !== '/') errors.push(`resting left / for ${page.url()}`);
  } else {
    console.log(`skipped without --serve (the session cannot be edited): ${sheetSteps.join(', ')}`);
  }

  // 16b. Elara's shop: she stands in her stall in the market, E opens the panel, 1, 2, 3 switch its tabs.
  await moveAndEnter('market');
  if (!(await page.evaluate(() => window.__aiv.layout.slots.shop !== null))) errors.push('elara: the market has no shop slot');
  const shopNow = () => page.evaluate(() => ({
    panel: window.__aiv.panel, screen: window.__aiv.screen, prompt: window.__aiv.prompt, interaction: window.__aiv.interaction, menu: window.__aiv.menuOpen,
    tab: window.__aiv.shop?.tab ?? null, player: window.__aiv.player, shown: !document.getElementById('shop-panel').hidden,
    active: [...document.querySelectorAll('.shop-tab.active')].map((tab) => tab.id), locked: document.pointerLockElement !== null,
  }));
  const openShop = async (name) => {
    await walkTo('shop', 2.5);
    if (name) await promptShot('E: talk to Elara', name);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.panel === 'shop' && window.__aiv.shop !== null, null, { timeout: 10000 });
    const seen = await shopNow();
    if (seen.screen !== 'world' || seen.prompt !== null || seen.interaction !== null || seen.menu || !seen.shown || seen.locked || seen.tab !== 'wares') errors.push(`shop opened: ${JSON.stringify(seen)}`);
    return seen;
  };
  const shopTab = async (key, tab, name) => {
    await page.keyboard.press(key);
    const seen = await shopNow();
    if (seen.tab !== tab || JSON.stringify(seen.active) !== JSON.stringify([`shop-tab-${tab}`]) || !(await page.isVisible(`#shop-${tab}`))) errors.push(`${name}: after ${key}: ${JSON.stringify(seen)}`);
    if (name) await shot(name);
  };
  const closeShop = async (name) => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__aiv.panel === null, null, { timeout: 5000 });
    const seen = await shopNow();
    if (seen.shown || seen.menu || seen.screen !== 'world') errors.push(`${name}: after Esc: ${JSON.stringify(seen)}`);
  };
  const atCounter = await openShop('elara');
  if ((await page.locator('#shop-wares .shop-row').count()) !== 3) errors.push('shop-wares: the panel does not list three wares');
  if (!(await page.textContent('#shop-dialog')) || !(await page.getAttribute('#shop-portrait', 'src'))) errors.push('shop-wares: Elara has no line or no portrait');
  // Nobody walks, and E, I, C and M do nothing while the shop is open.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  for (const key of ['KeyE', 'KeyI', 'KeyC', 'KeyM']) await page.keyboard.press(key);
  await page.waitForTimeout(200);
  const calm = await shopNow();
  if (calm.panel !== 'shop' || calm.menu || calm.player.x !== atCounter.player.x || calm.player.z !== atCounter.player.z) errors.push(`shop-wares: W, E, I, C or M did something: ${JSON.stringify(calm)}`);
  await shopTab('Digit1', 'wares', 'shop-wares');
  await shopTab('Digit2', 'sell', 'shop-sell');
  await shopTab('Digit3', 'quests', 'shop-quests');
  if ((await page.locator('#shop-quests [data-action="accept"]').count()) < 1) errors.push('shop-quests: no quest is on offer');
  await closeShop('shop-quests');
  if (new URL(page.url()).pathname !== '/') errors.push(`the shop left / for ${page.url()}`);

  const shopSteps = ['shop-haggle-success', 'shop-haggle-failure', 'shop-bought', 'shop-sold', 'quest-accepted', 'quest-tracker', 'quest-ready', 'quest-turned-in'];
  if (serve) {
    const questName = JSON.parse(readFileSync(join(repo, 'json/quests.json'), 'utf8')).goblin_menace.name;
    const gold = () => page.evaluate(() => window.__aiv.state.character.gold);
    const hudGold = async () => Number(/Gold (\d+)/.exec(await page.textContent('#hud-character'))?.[1]);
    const said = async (text, name) => {
      await page.waitForFunction((t) => document.querySelector('#shop-panel .panel-message')?.textContent === t, text, { timeout: 10000 })
        .catch(() => errors.push(`${name}: the panel does not say "${text}"`));
    };
    const tracker = () => page.evaluate(() => (document.getElementById('hud-quests').hidden ? null : [...document.querySelectorAll('#hud-quests .quest-line')].map((line) => line.textContent)));
    const haggleOver = async (index, d20, outcome, name) => {
      writeFileSync(join(dataDir, 'd20.txt'), String(d20));
      await page.click(`#shop-wares [data-action="haggle"][data-index="${index}"]`);
      await page.waitForFunction((o) => window.__aiv.shop?.haggle?.outcome === o, outcome, { timeout: 10000 })
        .catch(() => errors.push(`${name}: the haggle did not come out as a ${outcome}`));
      const seen = await page.evaluate((i) => ({
        ware: window.__aiv.shop.view.wares[i], haggle: window.__aiv.shop.haggle, cls: document.getElementById('shop-haggle').className,
        shown: !document.getElementById('shop-haggle').hidden, text: document.getElementById('shop-haggle').textContent,
      }), index);
      if (!seen.shown || seen.cls !== `haggle-${outcome}` || !seen.text.includes(seen.haggle.roll) || !seen.text.includes(seen.haggle.verdict)) errors.push(`${name}: ${JSON.stringify(seen)}`);
      await shot(name);
      return seen.ware;
    };
    editSession((session) => {
      session.character.gold = 200;
      session.character.inventory.push({ name: 'Dagger', type: 'weapon' });
    });
    await openShop(null);
    if ((await gold()) !== 200 || (await hudGold()) !== 200) errors.push(`the shop opened with ${await gold()} gold, the HUD says ${await hudGold()}`);

    // 1. A haggle that works: the gold flash and a lower price.
    const cheap = await haggleOver(1, 19, 'success', 'shop-haggle-success');
    if (!(cheap.haggled && cheap.effective_price < cheap.original_price)) errors.push(`shop-haggle-success: the price did not go down: ${JSON.stringify(cheap)}`);
    // 2. One that does not: the red flash. A second try at the same ware is refused.
    const dear = await haggleOver(0, 2, 'failure', 'shop-haggle-failure');
    if (!(dear.haggled && dear.effective_price >= dear.original_price)) errors.push(`shop-haggle-failure: ${JSON.stringify(dear)}`);
    if (!(await page.isDisabled('#shop-wares [data-action="haggle"][data-index="0"]'))) errors.push('shop-haggle-failure: the Haggle button of a haggled ware is not disabled');
    // The button is disabled by now; a page that has not heard of the haggle yet would still send it.
    await page.evaluate(() => document.querySelector('#shop-wares [data-action="haggle"][data-index="0"]').removeAttribute('disabled'));
    await page.click('#shop-wares [data-action="haggle"][data-index="0"]');
    await said("You've already haggled over this item!", 'shop-haggle-failure');
    // That refusal is the 409 this step asks for: its status line and console message are taken out of the report.
    const refusals = errors.filter((line) => line.includes('/api/shop/haggle'));
    if (!refusals.some((line) => line.startsWith('409 '))) errors.push('shop-haggle-failure: the second haggle was not refused with a 409');
    for (const line of refusals) errors.splice(errors.indexOf(line), 1);
    if (!(await page.evaluate(() => document.querySelector('#shop-panel .panel-message').classList.contains('refused')))) errors.push('shop-haggle-failure: the refusal is not shown as one');

    // 3. Two potions bought, one at the haggled price.
    const greater = await page.evaluate(() => window.__aiv.shop.view.wares[2]);
    await page.click('#shop-wares [data-action="buy"][data-index="1"]');
    await said(`Purchased ${cheap.name} for ${cheap.effective_price} gold!`, 'shop-bought');
    await page.click('#shop-wares [data-action="buy"][data-index="2"]');
    await said(`Purchased ${greater.name} for ${greater.effective_price} gold!`, 'shop-bought');
    const left = 200 - cheap.effective_price - greater.effective_price;
    if ((await gold()) !== left || (await hudGold()) !== left || (await page.textContent('#shop-gold')) !== `${left} gold`) errors.push(`shop-bought: ${await gold()} gold, the HUD says ${await hudGold()}, expected ${left}`);
    await shot('shop-bought');

    // 4. The spare weapon sold.
    await shopTab('Digit2', 'sell', null);
    await page.locator('#shop-sell .shop-row', { hasText: 'Dagger' }).first().locator('[data-action="sell"]').click();
    await page.waitForFunction(() => /^Sold Dagger for \d+ gold!$/.test(document.querySelector('#shop-panel .panel-message')?.textContent ?? ''), null, { timeout: 10000 })
      .catch(() => errors.push('shop-sold: the panel does not say that the dagger was sold'));
    if (!((await gold()) > left && (await hudGold()) === (await gold()))) errors.push(`shop-sold: ${await gold()} gold after the sale, ${left} before`);
    await shot('shop-sold');

    // 5. A quest accepted: the tracker shows it.
    await shopTab('Digit3', 'quests', null);
    await page.click('#shop-quests [data-action="accept"][data-quest="goblin_menace"]');
    await said(`Quest accepted: ${questName}`, 'quest-accepted');
    if (JSON.stringify(await tracker()) !== JSON.stringify([`${questName} 0/5`])) errors.push(`quest-accepted: the tracker shows ${JSON.stringify(await tracker())}`);
    await shot('quest-accepted');
    await closeShop('quest-accepted');

    // 6. Two goblins fall at the docks: the tracker counts, the kill is announced, the quest is ready.
    editSession((session) => {
      session.active_quests.goblin_menace.progress = 3;
    });
    await moveAndEnter('docks');
    const fallGoblin = async (id, name) => {
      plant({ id, race: 'Goblin', class_name: 'Rogue', level: 1, name: 'Snik', weapon: 'Club' }, null);
      await openTitle();
      await enterWorld();
      await walkTo('monster', 2.6);
      const stance = await startFight(name);
      await fightUntil('KeyA', 'victory', name);
      const result = await page.textContent('#battle-result');
      await page.keyboard.press('Enter');
      await backToWalking(stance, name);
      return result;
    };
    const first = await fallGoblin('smoke-quest-goblin-1', 'quest-tracker');
    if (!first.includes(`${questName}: 4/5`)) errors.push(`quest-tracker: the result panel does not show the quest: "${first}"`);
    const told = await page.evaluate(() => (document.getElementById('notice').hidden ? null : document.getElementById('notice').textContent));
    if (told !== `Quest: ${questName}: 4/5`) errors.push(`quest-tracker: #notice shows ${JSON.stringify(told)}`);
    if (JSON.stringify(await tracker()) !== JSON.stringify([`${questName} 4/5`])) errors.push(`quest-tracker: the tracker shows ${JSON.stringify(await tracker())}`);
    if (await page.isVisible('#hud-quest-ready')) errors.push('quest-tracker: the badge shows before the quest is ready');
    await worldShot('quest-tracker');
    await fallGoblin('smoke-quest-goblin-2', 'quest-ready');
    const ready = await page.evaluate(() => ({ hidden: document.getElementById('hud-quest-ready').hidden, text: document.getElementById('hud-quest-ready').textContent }));
    if (ready.hidden || ready.text !== 'Quest ready to turn in') errors.push(`quest-ready: the badge: ${JSON.stringify(ready)}`);
    if (JSON.stringify(await tracker()) !== JSON.stringify([`${questName}: return to Elara`])) errors.push(`quest-ready: the tracker shows ${JSON.stringify(await tracker())}`);

    // 7. Back to Elara, who has a "!" above her: the quest is turned in.
    await moveAndEnter('market');
    await walkTo('shop', 2.5);
    await worldShot('quest-ready');
    const rich = await gold();
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.panel === 'shop' && window.__aiv.shop !== null, null, { timeout: 10000 });
    await shopTab('Digit3', 'quests', null);
    await page.click('#shop-quests [data-action="turn-in"][data-quest="goblin_menace"]');
    await page.waitForFunction((n) => (document.querySelector('#shop-panel .panel-message')?.textContent ?? '').startsWith(`Quest complete: ${n}! +50 gold, +200 XP`), questName, { timeout: 10000 })
      .catch(() => errors.push('quest-turned-in: the panel does not say that the quest is complete'));
    if ((await gold()) !== rich + 50 || (await hudGold()) !== rich + 50) errors.push(`quest-turned-in: ${await gold()} gold, ${rich} before`);
    if ((await tracker()) !== null || (await page.isVisible('#hud-quest-ready'))) errors.push('quest-turned-in: the tracker or the badge still shows');
    await shot('quest-turned-in');
    await closeShop('quest-turned-in');
    if (new URL(page.url()).pathname !== '/') errors.push(`the shop and the quests left / for ${page.url()}`);
  } else {
    console.log(`skipped without --serve (the session cannot be edited): ${shopSteps.join(', ')}`);
  }

  // 16c. Travel into Act 2, Lady Vex's ambush on the road, the journal with three shards, and the ending.
  const journeySteps = ['arrival-act2', 'ambush-intro', 'ambush-fight', 'ambush-arrival', 'journal-3-shards', 'ending-crown', 'ending-text', 'ending-legend', 'ending-title'];
  if (serve) {
    const strong = (session) => {
      session.character.level = 20;
      session.character.max_hit_points = session.character.current_hit_points = 9999;
      session.battle.is_active = false;
      session.pending_event = null;
      session.event_result = null;
      session.area_contents = null;
    };
    const fellWith20 = async (name) => {
      editSession((session) => {
        session.battle.monster.hp = 1;
      });
      writeFileSync(join(dataDir, 'd20.txt'), '20');
      await fightUntil('KeyA', 'victory', name);
    };

    // 1. Act 1 is complete: the map lets the character into Act 2, and nobody waits on the road yet.
    editSession((session) => {
      strong(session);
      session.defeated_bosses = ['Shard Guardian', 'Corrupted Captain'];
      session.location_name = 'Rivermeet Town';
      session.area_id = 'town_square';
      session.act_num = 1;
    });
    await openTitle();
    await enterWorld();
    await openMap(null);
    if (await page.evaluate(() => window.__aiv.travel.acts[1].locked || !window.__aiv.travel.acts[2].locked)) errors.push('arrival-act2: Act 2 is not open or Act 3 is not locked');
    await page.click('#travel-acts button[data-location="Emberforge Mountains"]');
    await arrived('Emberforge Mountains', 'mountain_pass', 2, 'arrival-act2');

    // 2. Two guardians of Act 2 have fallen: Lady Vex strikes on the road to the temple.
    const vex = bosses['Lady Vex'];
    editSession((session) => {
      strong(session);
      session.defeated_bosses = ['Shard Guardian', 'Corrupted Captain', 'Flame Cultist Leader', 'Corrupted High Priest'];
    });
    await openTitle();
    await enterWorld();
    await openMap(null);
    await page.keyboard.press('Digit5');
    await page.waitForFunction(() => window.__aiv.screen === 'intro' && window.__aiv.road === true && !document.getElementById('boss-intro').hidden && window.__aiv.loading === false, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__aiv.travelling === false && Number(getComputedStyle(document.getElementById('veil')).opacity) <= 0.05, null, { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(200);
    const met = await page.evaluate(() => ({
      id: window.__aiv.intro, name: document.getElementById('boss-intro-name').textContent, title: document.getElementById('boss-intro-title').textContent,
      text: document.getElementById('boss-intro-text').textContent, back: !document.getElementById('boss-intro-back').hidden, screen: window.__aiv.screen, menu: window.__aiv.menuOpen,
      gates: window.__aiv.layout.gates.length, contents: window.__aiv.contents, compass: window.__aiv.compass, state: window.__aiv.state, place: document.getElementById('hud-location').textContent,
      errors: window.__aiv.modelErrors,
    }));
    if (met.id !== 'Lady Vex' || met.name !== vex.name || met.title !== vex.title || met.text !== vex.intro) errors.push(`ambush-intro: the introduction shows ${JSON.stringify([met.id, met.name, met.title]).slice(0, 300)}`);
    if (met.back || met.screen !== 'intro' || met.menu) errors.push(`ambush-intro: Step back shown ${met.back}, screen ${met.screen} after Esc, menu ${met.menu}`);
    if (met.gates !== 0 || met.contents !== null || met.compass !== null || met.place !== 'The Road' || met.errors.length) errors.push(`ambush-intro: the road has ${met.gates} gates, contents ${JSON.stringify(met.contents)}, place "${met.place}", model errors ${JSON.stringify(met.errors)}`);
    if (met.state.location.name !== 'Sunken Temple of Dariel' || met.state.pending?.kind !== 'battle') errors.push(`ambush-intro: the state is ${met.state.location.name}, pending ${JSON.stringify(met.state.pending)}`);
    await stillHome('ambush-intro');
    await shot('ambush-intro');

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__aiv.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await untilOpen();
    const onRoad = async (name) => {
      const seen = await page.evaluate(() => ({
        road: window.__aiv.road, monster: window.__aiv.battle.view.monster, player: window.__aiv.player, slot: window.__aiv.layout.slots.monster,
        intro: !document.getElementById('boss-intro').hidden, plate: document.getElementById('battle-monster').textContent, flee: document.querySelector('#battle-actions .btn-flee') !== null,
      }));
      const distance = Math.hypot(seen.player.x - seen.slot.x, seen.player.z - seen.slot.z);
      if (!seen.road || seen.monster.place !== 'road' || seen.monster.boss_id !== 'Lady Vex' || seen.intro || seen.flee) errors.push(`${name}: road ${seen.road}, place ${seen.monster.place}, boss ${seen.monster.boss_id}, introduction ${seen.intro}, flee ${seen.flee}`);
      if (!seen.plate.includes(vex.name)) errors.push(`${name}: the plate shows "${seen.plate}"`);
      if (!(distance >= 1.5 - 1e-6 && distance <= 2.5 + 1e-6)) errors.push(`${name}: the player stands ${distance.toFixed(2)} m from Lady Vex`);
    };
    await onRoad('ambush-fight');
    await shot('ambush-fight');

    // A reload in the middle of it: the road again, the fight open, no introduction.
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__aiv?.screen === 'battle' && window.__aiv.battle !== null && window.__aiv.road === true && !document.getElementById('battle-panel').hidden, null, { timeout: 60000 });
    await untilOpen();
    await onRoad('ambush-reload');

    // She falls: Continue ends the journey where it was going.
    await fellWith20('ambush-arrival');
    await page.keyboard.press('Enter');
    await arrived('Sunken Temple of Dariel', 'coastal_approach', 2, 'ambush-arrival');
    const peace = await page.evaluate(() => fetch('/api/journal').then((r) => r.json()));
    if (peace.journal.stats.bosses !== 5 || peace.state.pending !== null) errors.push(`ambush-arrival: ${peace.journal.stats.bosses} bosses defeated, pending ${JSON.stringify(peace.state.pending)}`);

    // 3. The journal now has three shards in the crown.
    const book = await openJournal();
    const found = book.sockets.filter((socket) => socket.found);
    if (JSON.stringify(found.map((socket) => socket.label)) !== JSON.stringify(['Shard of Verdance', 'Shard of Embers', 'Shard of Tides']) || found.some((socket) => socket.colour === '')) {
      errors.push(`journal-3-shards: the crown shows ${JSON.stringify(book.sockets)}`);
    }
    if (book.sockets.filter((socket) => socket.label === '???').length !== 2 || book.complete) errors.push(`journal-3-shards: ${JSON.stringify(book.sockets.map((socket) => socket.label))}, complete ${book.complete}`);
    if (!book.acts[0].includes('Complete') || !book.acts[1].includes('In progress') || !book.acts[1].includes('Lvl ')) errors.push(`journal-3-shards: the acts read ${JSON.stringify(book.acts).slice(0, 400)}`);
    await shot('journal-3-shards');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__aiv.panel === null, null, { timeout: 5000 });

    // 4. Malachar is the last one standing. He falls, and Continue plays the ending.
    editSession((session) => {
      strong(session);
      session.defeated_bosses = Object.keys(bosses).filter((id) => id !== 'Malachar the Void-touched');
      session.location_name = 'The Convergence';
      session.area_id = 'ritual_chamber';
      session.act_num = 3;
    });
    await openTitle();
    await enterWorld();
    await walkTo('boss', 2.6);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__aiv.screen === 'intro' && window.__aiv.intro === 'Malachar the Void-touched', null, { timeout: 10000 });
    if (!(await page.isVisible('#boss-intro-back'))) errors.push('ending: Step back is missing from the introduction of a boss that is no ambush');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__aiv.screen === 'battle' && window.__aiv.battle !== null && !document.getElementById('battle-panel').hidden, null, { timeout: 30000 });
    await fellWith20('ending-crown');
    const last = await page.evaluate(() => ({
      complete: window.__aiv.battle.view.rewards?.boss?.campaign_complete, link: document.querySelector('#battle-result a') !== null,
      line: document.querySelector('#battle-result .boss-line[data-kind="complete"]')?.textContent ?? null,
    }));
    if (last.complete !== true || last.link || last.line !== 'The Crown of Unity is whole again.') errors.push(`ending-crown: the result panel: ${JSON.stringify(last)}`);
    const before = readFileSync(join(dataDir, 'sessions', readdirSync(join(dataDir, 'sessions'))[0]), 'utf8');
    await page.keyboard.press('Enter');
    await throughEnding('ending', ['ending-crown', null, 'ending-text', null, 'ending-legend']);
    await stillHome('ending-title');
    await shot('ending-title');

    // The same from the journal: Continue on the title screen, J, "Relive the ending".
    await enterWorld();
    const whole = await openJournal();
    if (!whole.complete || whole.sockets.some((socket) => !socket.found)) errors.push(`ending: the journal of a finished campaign shows ${JSON.stringify(whole.sockets.map((socket) => socket.label))}, complete ${whole.complete}`);
    await page.click('#journal-ending');
    await throughEnding('ending-relived', []);
    const after = JSON.parse(readFileSync(join(dataDir, 'sessions', readdirSync(join(dataDir, 'sessions'))[0]), 'utf8'));
    const was = JSON.parse(before);
    // Continue after the victory took the rewards; nothing else of the session has changed since.
    for (const key of ['defeated_bosses', 'location_name', 'area_id', 'act_num', 'monster_kills', 'character']) {
      if (JSON.stringify(after[key]) !== JSON.stringify(was[key])) errors.push(`ending: the session's ${key} changed during the ending`);
    }
  } else {
    console.log(`skipped without --serve (the session cannot be edited): ${journeySteps.join(', ')}`);
  }

  // 17. A model that does not load: a fresh page in the town square, with the request for the well refused.
  // That one failed request and its console message are let through; a box stands in for the well.
  await post('/game/travel', [['location_name', 'Rivermeet Town']]);
  await page.close();
  page = await context.newPage();
  const let_through = [];
  watch(page, (line) => line.includes('/models/env/town/well.glb') && let_through.push(line) <= 2);
  await page.route('**/models/env/town/well.glb', (route) => route.abort());
  await openTitle();
  const square = await enterWorld();
  if (square.area.id !== 'town_square') errors.push(`the fallback step is in ${square.area.id}, not in town_square`);
  await landmarkShot('special', 'model-fallback', ['env/town/well']);
  if (!let_through.some((line) => line.startsWith('request failed'))) errors.push('the request for the well was not refused');
} catch (e) {
  errors.push(String(e));
  await shot('failure').catch(() => {});
}
await browser.close();
if (server) server.kill();
if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log(`ok, ${shots} screenshots in ${out}`);
