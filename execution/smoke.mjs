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

/** Marks every boss as defeated in the one session file of the data folder this test owns. */
function defeatEveryBoss() {
  const folder = join(dataDir, 'sessions');
  const files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected one session file in ${folder}, found ${files.length}`);
  const session = JSON.parse(readFileSync(join(folder, files[0]), 'utf8'));
  session.defeated_bosses = Object.keys(bosses);
  writeFileSync(join(folder, files[0]), JSON.stringify(session));
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

  // 12. The rest of Act 1, and the arena of its first boss.
  if (serve) defeatEveryBoss();
  await travelAndEnter('Whispering Woods', 'loc-whispering-woods');
  await moveAndEnter('grove');
  await landmarkShot('boss', 'area-boss');
  await travelAndEnter('Abandoned Watchtower', 'loc-abandoned-watchtower');

  // 13. Acts 2 and 3, which a new character reaches only with every boss defeated.
  const later = [
    ['Emberforge Mountains', 'loc-emberforge-mountains'],
    ['Sunken Temple of Dariel', 'loc-sunken-temple'],
    ['Windswept Plains', 'loc-windswept-plains'],
    ['The Crystalline Caves', 'loc-crystalline-caves'],
    ['The Convergence', 'loc-convergence'],
  ];
  if (serve) for (const [locationName, name] of later) await travelAndEnter(locationName, name);
  else console.log(`skipped without --serve (Acts 2 and 3 are locked): ${later.map(([, name]) => name).join(', ')}`);

  // 14. A model that does not load: a fresh page in the town square, with the request for the well refused.
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
