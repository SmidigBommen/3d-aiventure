#!/usr/bin/env node
// Frame times of the four reference scenes, measured in a real browser.
//   node execution/frames.mjs                         prints the 95th percentile per scene for this checkout
//   node execution/frames.mjs --repo DIR --write      measures the checkout in DIR (built with `pnpm build`) and
//                                                     writes execution/frame_baseline.json here, with DIR's commit
//   node execution/frames.mjs --runs 3                measures every scene that often and keeps the median
// execution/smoke.mjs imports `referenceScene` and `verdict` from here, so the baseline and the smoke
// test measure with the same code: the differences between requestAnimationFrame callbacks over 5 s at
// 1280x720, standing at the spawn of the starting area of Rivermeet Town (town), the Whispering Woods
// (wilderness) and the Abandoned Watchtower (dungeon), and in a fight with a goblin in the Whispering
// Woods (fight). It uses nothing of the page that commit 4fbc1f5 does not have.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCENES = { town: 'Rivermeet Town', wilderness: 'Whispering Woods', dungeon: 'Abandoned Watchtower', fight: 'Whispering Woods' };
export const FRAME_SECONDS = 5;
export const FRAME_BUDGET_MS = 16.7;
export const BASELINE_FACTOR = 1.2;
export const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'frame_baseline.json');
const FOE = { id: 'frames-goblin', race: 'Goblin', class_name: 'Rogue', level: 1, name: 'Grak', weapon: 'Club' };
const campaign = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'json', 'campaign.json'), 'utf8'));

/** The headless Chromium of ~/.cache/ms-playwright with software WebGL, as the smoke test starts it. */
export async function launchBrowser() {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const sub = readdirSync(join(cache, dir)).find((d) => d.startsWith('chrome'));
  return chromium.launch({
    executablePath: join(cache, dir, sub, 'chrome'),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** The frame times of `seconds` in the page, in ms: the differences between requestAnimationFrame callbacks. */
export async function frameTimes(page, seconds = FRAME_SECONDS) {
  const stamps = await page.evaluate((ms) => new Promise((done) => {
    const seen = [];
    const tick = (now) => {
      seen.push(now);
      if (now - seen[0] >= ms) done(seen);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), seconds * 1000);
  return stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
}

export function percentile(values, share) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

/** A POST with a JSON body from the page, so it carries the page's session cookie. Answers the status. */
const jsonPost = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await r.text(); // read to the end, or the next navigation aborts the request
  return r.status;
}, [path, body]);

/** The areas to step through from one area of a location to another, along the connections. */
export function areaPath(locationName, fromId, toId) {
  const areas = campaign.acts.flatMap((act) => act.locations).find((loc) => loc.name === locationName).areas;
  const from = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length && !from.has(toId)) {
    const at = queue.shift();
    for (const next of areas.find((a) => a.id === at).connections) {
      if (from.has(next)) continue;
      from.set(next, at);
      queue.push(next);
    }
  }
  const steps = [];
  for (let at = toId; from.get(at) != null; at = from.get(at)) steps.unshift(at);
  return steps;
}

/** Walks the character to an area of the location it is in, with POST /api/move. */
export async function walkToArea(page, areaId) {
  const now = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  for (const step of areaPath(now.location.name, now.area.id, areaId)) {
    const status = await jsonPost(page, '/api/move', { area_id: step });
    if (status !== 200) throw new Error(`POST /api/move to ${step} answered ${status}`);
  }
}

/**
 * Brings the character to the starting area of a location: the journey of POST /api/travel, or, when the
 * character is in that location already (a journey the server refuses), the walk back to where one arrives.
 */
export async function journey(page, locationName) {
  const now = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
  if (now.location.name === locationName) {
    const location = campaign.acts.flatMap((act) => act.locations).find((loc) => loc.name === locationName);
    await walkToArea(page, location.starting_area ?? location.areas[0].id);
    return;
  }
  const status = await jsonPost(page, '/api/travel', { location: locationName });
  if (status !== 200) throw new Error(`POST /api/travel to ${locationName} answered ${status}`);
}

const walking = () => window.__aiv.screen === 'world' && window.__aiv.loading === false && window.__aiv.layout !== null && window.__aiv.player !== null;

/**
 * Brings the page to a reference scene and measures it. `plant(monster)` puts that monster (or, for null,
 * nothing) into the area the character stands in; without it (a server whose data is out of reach) the area
 * holds what the server rolled and there is no fight scene. Returns the 95th percentile and the median in ms.
 * The fight is left standing: it is the caller's to end.
 */
export async function referenceScene(page, url, scene, plant = null) {
  if (scene === 'fight' && !plant) return null;
  await journey(page, SCENES[scene]);
  if (plant) plant(scene === 'fight' ? FOE : null);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 10000 });
  await page.click('#btn-continue');
  await page.waitForFunction(walking, null, { timeout: 60000 });
  if (scene === 'fight') {
    const status = await page.evaluate(async (id) => {
      const r = await fetch('/api/engage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      await r.text();
      return r.status;
    }, FOE.id);
    if (status !== 200) throw new Error(`frames: the fight did not start (${status})`);
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__aiv?.screen === 'battle' && window.__aiv.battle !== null && !window.__aiv.battle.locked && !document.getElementById('battle-panel').hidden, null, { timeout: 60000 });
  }
  // The fade of the veil, the description of the area and the glide to the battle stance are over.
  await page.waitForTimeout(2000);
  const times = await frameTimes(page);
  return { p95: percentile(times, 0.95), median: percentile(times, 0.5), frames: times.length };
}

export function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether a scene keeps its budget: 16.7 ms, or 1.2 times what the baseline commit takes in the same browser. */
export function verdict(scene, p95, baseline) {
  const base = baseline?.p95_ms?.[scene] ?? null;
  const ok = p95 <= FRAME_BUDGET_MS || (base !== null && p95 <= BASELINE_FACTOR * base);
  const against = base === null ? 'no baseline' : `baseline ${base.toFixed(1)} ms (${baseline.commit}), limit ${Math.max(FRAME_BUDGET_MS, BASELINE_FACTOR * base).toFixed(1)} ms`;
  return { ok, line: `frame time ${scene}: p95 ${p95.toFixed(1)} ms, ${against}: ${ok ? 'ok' : 'TOO SLOW'}` };
}

// --- as a command: measure a checkout, and write the baseline ------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes('--help')) {
    console.log('usage: node execution/frames.mjs [--repo DIR] [--runs N] [--scenes town,fight] [--write [--commit ID]]\n'
      + '  --commit ID  the commit to name in the baseline (default: HEAD of the checkout measured)\n'
      + '  --scenes A,B only these of town, wilderness, dungeon, fight (default: all four)\n'
      + '  --repo DIR   the checkout to measure (default: this one); it must be built (pnpm build)\n'
      + '  --runs N     measure every scene N times and keep the median (default 3)\n'
      + '  --write      write execution/frame_baseline.json from what was measured');
    return;
  }
  const here = join(dirname(fileURLToPath(import.meta.url)), '..');
  const repo = resolve(arg('--repo') ?? here);
  const runs = Number(arg('--runs') ?? 3);
  const port = await new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'aiv-frames-'));
  const server = spawn('uv', ['run', 'python', join(repo, 'execution/smoke_server.py'), '--port', String(port)], {
    cwd: repo, env: { ...process.env, AIVENTURE_DATA: dataDir }, stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`${url}/health`).then((r) => r.ok, () => false);
  }
  const browser = up ? await launchBrowser() : null;
  try {
    if (!browser) throw new Error('the server did not answer on /health within 60 s');
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const made = await jsonPost(page, '/api/new-game', { race: 'Human', class_name: 'Fighter', name: 'Frames', weapon: 'Longsword', armor: 'Chain Mail', skills: ['Athletics', 'Perception'] });
    if (made !== 200) throw new Error(`frames: POST /api/new-game answered ${made}`);
    const edit = (change) => {
      const folder = join(dataDir, 'sessions');
      const file = join(folder, readdirSync(folder).find((f) => f.endsWith('.json')));
      const session = JSON.parse(readFileSync(file, 'utf8'));
      change(session);
      writeFileSync(file, JSON.stringify(session));
    };
    const plant = (monster) => edit((session) => {
      session.area_contents = { location: session.location_name, area_id: session.area_id, seq: (session.area_contents?.seq ?? 0) + 1, monster, event: null };
    });
    // The fight of one measurement is called off before the next one.
    const endFight = () => edit((session) => {
      if (session.battle) session.battle.is_active = false;
      session.engaged_monster = null;
    });
    const measured = {};
    const wanted = arg('--scenes')?.split(',') ?? Object.keys(SCENES);
    for (const scene of Object.keys(SCENES).filter((name) => wanted.includes(name))) {
      const seen = [];
      for (let run = 0; run < runs; run++) {
        endFight();
        seen.push((await referenceScene(page, url, scene, plant)).p95);
      }
      measured[scene] = Number(percentile(seen, 0.5).toFixed(2));
      console.log(`${scene}: p95 ${measured[scene]} ms (runs: ${seen.map((v) => v.toFixed(1)).join(', ')})`);
    }
    if (args.includes('--write')) {
      const commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
      writeFileSync(BASELINE_FILE, `${JSON.stringify({ commit: arg('--commit') ?? commit, p95_ms: measured }, null, 2)}\n`);
      console.log(`wrote ${BASELINE_FILE}`);
    } else {
      const baseline = readBaseline();
      for (const scene of Object.keys(measured)) console.log(verdict(scene, measured[scene], baseline).line);
    }
  } finally {
    await browser?.close();
    server.kill();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
