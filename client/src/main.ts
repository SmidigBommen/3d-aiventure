import * as THREE from 'three';
import { fetchState, postMove, type WorldState } from './api';
import type { Vec2 } from './input/movement';
import { buildTitleScene } from './titleScene';
import { showHud, showMenu, showTitle, veil } from './ui';
import { buildAreaScene, type AreaScene } from './world/areaScene';
import { EYE_HEIGHT, buildLayout, spawnPoint, type AreaLayout, type Gate } from './world/layout';
import { heldKeys, mouseTurn, moveKey, turnTowards, turnView, walkStep, type View } from './world/walk';

type Screen = 'title' | 'world' | 'pending';

// What the smoke test and the production check read. `ready` turns true after the first rendered
// frame. `lookAt` is the one action: it turns the view through the function a mouse move feeds.
declare global {
  interface Window {
    __aiv: {
      ready: boolean;
      frames: number;
      readonly screen: Screen;
      readonly state: WorldState | null;
      readonly player: { x: number; z: number; yaw: number } | null;
      readonly layout: AreaLayout | null;
      readonly menuOpen: boolean;
      lookAt: (x: number, z: number) => void;
    };
  }
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const title = buildTitleScene();
const eye = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
eye.rotation.order = 'YXZ';

let screen: Screen = 'title';
let state: WorldState | null = null;
let layout: AreaLayout | null = null;
let area: AreaScene | null = null;
let player: Vec2 = { x: 0, z: 0 };
let view: View = { yaw: 0, pitch: 0 };
let menuOpen = false;
let crossing = false; // a move to the next area is on its way to the server
let lockLostAt = -Infinity;
const held = new Set<string>();

const inWorld = (): boolean => screen === 'world' && layout !== null;
const turn = (dYaw: number, dPitch: number): void => {
  view = turnView(view, dYaw, dPitch);
};

window.__aiv = {
  ready: false,
  frames: 0,
  get screen() { return screen; },
  get state() { return state; },
  get player() { return inWorld() ? { x: player.x, z: player.z, yaw: view.yaw } : null; },
  get layout() { return inWorld() ? layout : null; },
  get menuOpen() { return menuOpen; },
  lookAt(x, z) {
    if (!inWorld()) return;
    const t = turnTowards(view, player, { x, z });
    turn(t.dYaw, t.dPitch);
  },
};

// --- screens -----------------------------------------------------------------------------------

function leaveWorld(): void {
  area?.dispose();
  area = null;
  layout = null;
  held.clear();
  setMenu(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/** Builds the scene of the area in `next` and puts the player in it. */
function enterArea(next: WorldState, cameFrom: string | null): void {
  if (!next.location || !next.area) return;
  const built = buildLayout({ location: next.location.name, type: next.location.type, id: next.area.id, exits: next.exits.map((e) => e.id) });
  const start = spawnPoint(built, cameFrom);
  area?.dispose();
  area = buildAreaScene(built, next.exits);
  layout = built;
  state = next;
  player = { x: start.x, z: start.z };
  view = { yaw: start.yaw, pitch: 0 };
  screen = 'world';
  showHud(next, true);
}

/** Shows what the server says: the title panel, the pending link, or (when already walking) the world. */
function apply(next: WorldState | null, keepWalking: boolean): void {
  state = next;
  if (next && next.has_character && !next.pending && next.location && next.area && keepWalking) {
    enterArea(next, null);
    return;
  }
  leaveWorld();
  screen = next?.pending ? 'pending' : 'title';
  showTitle(next);
}

async function refresh(): Promise<void> {
  const wasWalking = screen === 'world';
  const sameArea = (next: WorldState): boolean =>
    wasWalking && next.area?.id === state?.area?.id && next.location?.name === state?.location?.name && !next.pending;
  try {
    const next = await fetchState();
    if (sameArea(next) && layout) {
      state = next;
      showHud(next, false);
    } else {
      apply(next, wasWalking);
    }
  } catch {
    apply(null, false);
  }
}

async function crossGate(gate: Gate): Promise<void> {
  const from = state?.area?.id ?? null;
  crossing = true;
  veil(true);
  const answer = await postMove(gate.exitId);
  if (answer.ok && !answer.state.pending && answer.state.area) {
    enterArea(answer.state, from);
  } else {
    // Refused: show what the server says is true now, from the default spawn or the pending link.
    await fetchState().then((next) => apply(next, true), () => apply(null, false));
  }
  veil(false);
  crossing = false;
}

// --- menu and input ----------------------------------------------------------------------------

function requestLock(): void {
  // A refused lock (no gesture, or too soon after Esc) is not an error worth reporting.
  try {
    const asked = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    asked?.catch?.(() => {});
  } catch {
    /* refused */
  }
}

function setMenu(open: boolean): void {
  menuOpen = open;
  showMenu(open);
  if (open) {
    held.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
}

canvas.addEventListener('click', () => {
  if (inWorld() && !menuOpen) requestLock();
});
document.addEventListener('pointerlockerror', () => {});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) return;
  lockLostAt = performance.now();
  if (inWorld() && !menuOpen) setMenu(true);
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || !inWorld() || menuOpen) return;
  const t = mouseTurn(event.movementX, event.movementY);
  turn(t.dYaw, t.dPitch);
});

window.addEventListener('keydown', (event) => {
  if (!inWorld() || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'KeyM' || event.code === 'Escape') {
    if (event.repeat) return;
    // Esc with the mouse captured releases it, which already opened the menu.
    if (event.code === 'Escape' && performance.now() - lockLostAt < 300) return;
    setMenu(!menuOpen);
    return;
  }
  if (moveKey(event.code)) {
    event.preventDefault();
    if (!menuOpen) held.add(event.code);
  }
});
window.addEventListener('keyup', (event) => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

document.getElementById('menu-back')?.addEventListener('click', () => {
  setMenu(false);
  requestLock();
});

const cinzel = document.fonts.load('600 96px Cinzel').catch(() => []);
document.getElementById('btn-continue')?.addEventListener('click', async () => {
  if (!state || !state.has_character || state.pending) return;
  // The gate signs are drawn with the heading font; give it a moment to arrive.
  await Promise.race([cinzel, new Promise((done) => setTimeout(done, 1500))]);
  if (state && screen === 'title') enterArea(state, null);
});

// --- frame loop --------------------------------------------------------------------------------

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  for (const camera of [title.camera, eye]) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const time = clock.elapsedTime;
  if (inWorld() && layout && area) {
    if (!menuOpen && !crossing) {
      const step = walkStep(player, view.yaw, heldKeys(held), dt, layout);
      player = step.pos;
      if (step.gate) void crossGate(step.gate);
    }
    eye.position.set(player.x, EYE_HEIGHT, player.z);
    eye.rotation.set(view.pitch, view.yaw, 0);
    area.update(player.x, player.z, time);
    renderer.render(area.scene, eye);
  } else {
    title.update(time);
    renderer.render(title.scene, title.camera);
  }
  window.__aiv.frames += 1;
  window.__aiv.ready = true;
});

// The state is asked for on load, and again when the page comes back from the browser's
// back/forward cache (after a visit to a classic page).
void refresh();
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void refresh();
});
