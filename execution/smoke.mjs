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

try {
  // 1. The 3D client loads and draws.
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__aiv && window.__aiv.ready && window.__aiv.frames > 5, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const variety = await canvasVariety();
  await shot('title');
  if (variety < 0.05) errors.push(`the 3D view is blank: only ${(variety * 100).toFixed(1)}% of sampled pixels differ from the background`);

  // 2. The classic interface still answers.
  await page.goto(`${url}/classic`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.home-hero', { timeout: 10000 });
  await shot('classic-home');
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
