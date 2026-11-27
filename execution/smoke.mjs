#!/usr/bin/env node
// Browser smoke test.
//   node execution/smoke.mjs --url URL --out DIR     against a server that is already running
//   node execution/smoke.mjs --serve --out DIR       builds nothing, but starts its own server on a
//                                                    free port with an empty data folder (run `pnpm build` first)
// Loads the 3D client and the classic interface from a running server in headless Chromium,
// saves a screenshot of each step to DIR, and exits 1 on a page error, console error,
// failed request, HTTP status >= 400, or a 3D view that renders nothing.
// Needs playwright-core (pnpm install) and a Chromium in ~/.cache/ms-playwright.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

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
if (serve) {
  const port = await new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  url = `http://127.0.0.1:${port}`;
  server = spawn('uv', ['run', 'uvicorn', 'web.app:app', '--port', String(port)], {
    env: { ...process.env, AIVENTURE_DATA: mkdtempSync(join(tmpdir(), 'aiv-smoke-')) },
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`page error: ${e}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));

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

/** Waits for the 3D view to draw something, then saves the screenshot. */
async function worldShot(name) {
  await page.waitForFunction(() => window.__aiv.frames > 5, null, { timeout: 30000 });
  let variety = 0;
  for (let i = 0; i < 10 && variety < 0.05; i++) {
    await page.waitForTimeout(300);
    variety = await canvasVariety();
  }
  await shot(name);
  if (variety < 0.05) errors.push(`${name}: the 3D view is blank: only ${(variety * 100).toFixed(1)}% of sampled pixels differ from the background`);
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

/** Clicks Continue and waits for the world; checks that the HUD names the area the server reported. */
async function enterWorld() {
  await page.click('#btn-continue');
  await page.waitForFunction(() => window.__aiv.screen === 'world' && window.__aiv.layout && window.__aiv.player, null, { timeout: 10000 });
  const { area, location } = await page.evaluate(() => window.__aiv.state);
  const shown = await page.textContent('#hud-area');
  if (shown !== area.name) errors.push(`the HUD shows "${shown}", the server says "${area.name}"`);
  return { area, location };
}

/** Travels through the classic route, then enters the world there. */
async function travelAndEnter(locationName, name) {
  await post('/game/travel', [['location_name', locationName]]);
  await openTitle();
  const { location } = await enterWorld();
  if (location.name !== locationName) errors.push(`travelled to ${locationName} but the world shows ${location.name}`);
  await worldShot(name);
}

try {
  // 1. The 3D client loads and draws; without a character it offers a new game.
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForSelector('#btn-new-game', { state: 'visible', timeout: 10000 });
  if (await page.isVisible('#btn-continue')) errors.push('Continue is offered without a character');
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

  // 5. Into the world, in the town the character starts in.
  await enterWorld();
  await worldShot('world-town');

  // 6. Walk through the first gate with the W key held down.
  const gate = await page.evaluate(() => {
    const g = window.__aiv.layout.gates[0];
    window.__aiv.lookAt(g.x, g.z);
    return g;
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction((id) => window.__aiv.state.area.id === id && window.__aiv.screen === 'world', gate.exitId, { timeout: 30000 });
  await page.keyboard.up('KeyW');
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

  // 10 and 11. The other two kinds of place.
  await travelAndEnter('Whispering Woods', 'world-wilderness');
  await travelAndEnter('Abandoned Watchtower', 'world-dungeon');
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
