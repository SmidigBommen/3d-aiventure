#!/usr/bin/env node
// Browser smoke test.
//   node execution/smoke.mjs --url URL --out DIR     against a server that is already running
//   node execution/smoke.mjs --serve --out DIR       builds nothing, but starts its own server on a
//                                                    free port with an empty data folder (run `pnpm build` first)
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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  server = spawn('uv', ['run', 'uvicorn', 'web.app:app', '--port', String(port)], {
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
function plant(monster, event) {
  editSession((session) => {
    session.character.max_hit_points = session.character.current_hit_points = 9999;
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
    if (contents?.event) boxes.push({ ...layout.slots.event, halfX: 0.5, halfZ: 0.5 });
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

/** Whether a URL is that classic page (the server may add a slash at the end). */
const onPath = (path) => (u) => u.pathname.replace(/\/$/, '') === path;

/** Checks the prompt, in the page's report and on screen, and saves the screenshot. */
async function promptShot(text, name) {
  const seen = await page.evaluate(() => ({ prompt: window.__aiv.prompt, kind: window.__aiv.interaction?.kind ?? null }));
  if (seen.prompt !== text) errors.push(`${name}: the prompt is ${JSON.stringify(seen.prompt)}, expected "${text}"`);
  await page.waitForFunction((t) => !document.getElementById('prompt').hidden && document.getElementById('prompt').textContent === t, text, { timeout: 5000 })
    .catch(() => errors.push(`${name}: #prompt does not show "${text}"`));
  await worldShot(name);
}

/** Wins the battle that is under way with attacks through the classic route, then shows the victory page. */
async function winBattle() {
  for (let round = 0; round < 200; round++) {
    const at = await page.evaluate(async () => {
      const r = await fetch('/battle/attack', { method: 'POST' });
      await r.text();
      return new URL(r.url).pathname.replace(/\/$/, '');
    });
    if (at === '/battle/victory') break;
    if (at !== '/battle') throw new Error(`the fight went to ${at}`);
  }
  await page.goto(`${url}/battle/victory`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#back-link', { timeout: 10000 });
}

/** Back at / after an encounter: the world without the title screen, at the place the encounter was started from. */
async function backInWorld(stood, name) {
  await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
  // Nobody clicks Continue here: the world has to come by itself.
  await page.waitForFunction(() => window.__aiv && window.__aiv.screen === 'world' && !window.__aiv.loading && window.__aiv.player !== null, null, { timeout: 60000 });
  if (await page.isVisible('#title-screen')) errors.push(`${name}: the title screen is shown on the way back`);
  if (await page.evaluate(() => sessionStorage.getItem('aiv.return') !== null)) errors.push(`${name}: the saved place was not deleted`);
  const me = await page.evaluate(() => window.__aiv.player);
  if (Math.hypot(me.x - stood.x, me.z - stood.z) > 0.05) errors.push(`${name}: back at ${JSON.stringify(me)}, the encounter was started at ${JSON.stringify(stood)}`);
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
  await shot('title');
  if (variety < 0.05) errors.push(`the 3D view is blank: only ${(variety * 100).toFixed(1)}% of sampled pixels differ from the background`);

  // 2. The classic interface still answers.
  await page.goto(`${url}/classic`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.home-hero', { timeout: 10000 });
  await shot('classic-home');

  // 3. A character, made through the classic routes in this browser.
  await post('/character/race', [['race', 'Human']]);
  await post('/character/class', [['class_name', 'Fighter']]);
  await post('/character/create', [['name', 'Smoke'], ['weapon', 'Longsword'], ['armor', 'Chain Mail'], ['skills', 'Athletics'], ['skills', 'Perception']]);

  // 4. The title screen now offers to continue.
  await openTitle();
  if (await page.isVisible('#btn-new-game')) errors.push('New game is still offered with a character');
  await shot('title-continue');

  // 5. Into the world, in the town square the character starts in.
  const start = await enterWorld();
  if (start.area.id !== 'town_square') errors.push(`a new character starts in ${start.area.id}, not in town_square`);
  await worldShot('loc-rivermeet-town');

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
  await post('/game/travel', [['location_name', 'Whispering Woods']]);
  if (serve) plant(GOBLIN, null);
  await openTitle();
  const woods = await enterWorld();
  if (woods.location.name !== 'Whispering Woods' || woods.area.id !== 'entrance') errors.push(`travelled to the Whispering Woods but the world shows ${woods.location.name}/${woods.area.id}`);
  await worldShot('loc-whispering-woods');

  // 13. What an area holds: a monster, an event object and the search spot, met and come back from.
  const encounters = ['content-monster', 'prompt-monster', 'classic-battle', 'classic-victory', 'content-monster-gone',
    'content-event', 'prompt-event', 'classic-event', 'content-event-gone', 'prompt-search', 'after-search'];
  if (serve) {
    await slotShot('monster', 'content-monster');
    const met = await page.evaluate(() => window.__aiv.contents?.monster ?? null);
    if (met?.id !== GOBLIN.id || met.name !== GOBLIN.name || met.race !== 'Goblin' || met.level !== 1) errors.push(`the planted goblin is shown as ${JSON.stringify(met)}`);
    await walkTo('monster', 2.6);
    await promptShot('E: fight Grak the Goblin', 'prompt-monster');
    let stood = await page.evaluate(() => window.__aiv.player);
    await Promise.all([page.waitForURL(onPath('/battle'), { timeout: 30000 }), page.keyboard.press('KeyE')]);
    await page.waitForSelector('.battle-scene', { timeout: 10000 });
    await shot('classic-battle');
    await winBattle();
    await shot('classic-victory');
    await page.click('#back-link');
    await backInWorld(stood, 'content-monster-gone');
    if (await page.evaluate(() => window.__aiv.contents?.monster !== null)) errors.push('the monster is still in the area after the fight');
    await worldShot('content-monster-gone');

    plant(null, { id: 'abandoned_chest' });
    await openTitle();
    await enterWorld();
    await slotShot('event', 'content-event');
    const found = await page.evaluate(() => window.__aiv.contents?.event ?? null);
    if (found?.id !== 'abandoned_chest' || found.object !== 'chest') errors.push(`the planted event is shown as ${JSON.stringify(found)}`);
    await walkTo('event', 2.6);
    await promptShot('E: look at the abandoned chest', 'prompt-event');
    stood = await page.evaluate(() => window.__aiv.player);
    await Promise.all([page.waitForURL(onPath('/game/event'), { timeout: 30000 }), page.keyboard.press('KeyE')]);
    await page.waitForSelector('form[action="/game/event/choose"]', { timeout: 10000 });
    await shot('classic-event');
    await page.locator('form[action="/game/event/choose"] button').first().click();
    await page.waitForSelector('form[action="/game/event/continue"]', { timeout: 10000 });
    await page.locator('form[action="/game/event/continue"] button').first().click();
    await page.waitForURL((u) => u.pathname === '/' || onPath('/battle')(u), { timeout: 30000 });
    if (onPath('/battle')(new URL(page.url()))) {
      // The outcome started a fight: it is fought first.
      await winBattle();
      await page.click('#back-link');
    }
    await backInWorld(stood, 'content-event-gone');
    if (await page.evaluate(() => window.__aiv.contents?.event !== null)) errors.push('the event is still in the area after it was answered');
    await worldShot('content-event-gone');

    // Nothing is left here (a fight from the event came from another roll), so the search spot answers.
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

  // 14. The arena of the first boss, and the boss in it. The fight is not started.
  await moveAndEnter('grove');
  await landmarkShot('boss', 'area-boss');
  await slotShot('boss', 'content-boss');
  const guardian = await page.evaluate(() => window.__aiv.contents?.boss ?? null);
  if (guardian?.id !== 'Shard Guardian') errors.push(`the boss of the grove is shown as ${JSON.stringify(guardian)}`);
  await walkTo('boss', 2.6);
  await promptShot('E: challenge The Shard Guardian', 'prompt-boss');
  if (await page.evaluate(() => window.__aiv.interaction?.auto !== false)) errors.push('the boss would start the fight without a key press');

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
