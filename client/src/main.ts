import * as THREE from 'three';
import { fetchState, postEngage, postEnter, postMove, postSearch, type WorldState } from './api';
import type { Vec2 } from './input/movement';
import { buildTitleScene } from './titleScene';
import { hideNotice, hideTitle, showHud, showLoading, showMenu, showNotice, showPrompt, showTitle, veil } from './ui';
import { buildAreaScene, type AreaScene } from './world/areaScene';
import { isFree } from './world/collision';
import { buildContentScene, contentModels, type ContentScene } from './world/contentScene';
import { contentSolids, interactionAt, type AreaContents, type Interaction } from './world/contents';
import { dressArea, dressSpecOf, type Dressing } from './world/dressing';
import { EYE_HEIGHT, buildLayout, spawnPoint, type AreaLayout, type Gate } from './world/layout';
import { loadFigures, loadModels, modelErrors, type Figure } from './world/modelLoader';
import { heldKeys, mouseTurn, moveKey, turnTowards, turnView, walkStep, type View } from './world/walk';

type Screen = 'title' | 'world' | 'pending';

// What the smoke test and the production check read. `ready` turns true after the first rendered
// frame. `lookAt` turns the view through the function a mouse move feeds; `interact` runs what the
// E key runs. `loading` is true from the moment an area is entered until its models are in and its
// scene is built; `layout` is the dressing's layout (with the slots): the player collides with it
// and with what the contents block. `contents` is what the server says the area holds,
// `interaction` what the player can turn to from where they stand, `prompt` the line shown for it.
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
      readonly loading: boolean;
      readonly modelErrors: string[];
      readonly dressing: Dressing | null;
      readonly triangles: number;
      readonly contents: AreaContents | null;
      readonly interaction: Interaction | null;
      readonly prompt: string | null;
      lookAt: (x: number, z: number) => void;
      interact: () => void;
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
let walkLayout: AreaLayout | null = null; // `layout` with what the contents block added
let dressing: Dressing | null = null;
let area: AreaScene | null = null;
let things: ContentScene | null = null; // what the area holds, drawn
let busy = false; // an engage, a search or an arrival is on its way to the server
let loading = false;
let entry = 0; // goes up with every area entered or left, so that a slower, older load does not take over
let triangles = 0;
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

// What the page reports of the area: nothing while one is loading, also on the way from gate to gate,
// when the area left behind is still under the veil.
const shown = (): boolean => inWorld() && !loading;
const contentsOf = (s: WorldState | null): AreaContents | null => s?.contents ?? null;
const interactionNow = (): Interaction | null => (shown() && layout ? interactionAt(player, layout, contentsOf(state)) : null);
const promptNow = (): string | null => (menuOpen || busy || crossing ? null : (interactionNow()?.prompt ?? null));

window.__aiv = {
  ready: false,
  frames: 0,
  get screen() { return screen; },
  get state() { return state; },
  get player() { return shown() ? { x: player.x, z: player.z, yaw: view.yaw } : null; },
  get layout() { return shown() ? layout : null; },
  get menuOpen() { return menuOpen; },
  get loading() { return loading; },
  get modelErrors() { return modelErrors(); },
  get dressing() { return shown() ? dressing : null; },
  get triangles() { return triangles; },
  get contents() { return shown() ? contentsOf(state) : null; },
  get interaction() { return interactionNow(); },
  get prompt() { return promptNow(); },
  lookAt(x, z) {
    if (!shown()) return;
    const t = turnTowards(view, player, { x, z });
    turn(t.dYaw, t.dPitch);
  },
  interact() {
    void interact();
  },
};

// --- screens -----------------------------------------------------------------------------------

function setLoading(on: boolean): void {
  loading = on;
  showLoading(on);
}

function leaveWorld(): void {
  entry += 1;
  setLoading(false);
  things?.dispose();
  things = null;
  area?.dispose();
  area = null;
  layout = null;
  walkLayout = null;
  dressing = null;
  busy = false;
  showPrompt(null);
  hideNotice();
  held.clear();
  setMenu(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/** Puts what the area holds on its slots, in place of what stood there, and lets it block the way. */
function placeContents(contents: AreaContents | null, figures: Map<string, Figure | null>): void {
  if (!layout || !area) return;
  if (things) {
    area.scene.remove(things.group);
    things.dispose();
  }
  things = buildContentScene(layout, contents, figures);
  area.scene.add(things.group);
  const solids = layout.slots ? contentSolids(layout.slots, contents) : [];
  walkLayout = { ...layout, props: [...layout.props, ...solids.map((box) => ({ ...box, kind: 'model' as const }))] };
}

/** Takes `next` as the state of the area that stands and redraws what it holds. */
async function showContents(next: WorldState): Promise<void> {
  if (!layout) return;
  const mine = entry;
  state = next;
  showHud(next, false);
  const figures = await loadFigures(contentModels(layout, contentsOf(next)));
  if (mine !== entry || state !== next) return;
  placeContents(contentsOf(next), figures);
}

/**
 * Loads the models of the area in `next`, builds its scene and puts the player in it: at `at` when given
 * (the place an encounter was started from), else at the gate from `cameFrom` or the default spawn.
 * Until then nobody walks.
 */
async function enterArea(next: WorldState, cameFrom: string | null, at: { x: number; z: number; yaw: number } | null = null): Promise<void> {
  if (!next.location || !next.area) return;
  const mine = ++entry;
  setLoading(true);
  if (screen === 'title') hideTitle();
  const spec = dressSpecOf({ location: next.location, area: next.area, exits: next.exits });
  const dressed = dressArea(buildLayout(spec), spec);
  // A model that fails to load comes back as null and is drawn as a box.
  const [models, figures] = await Promise.all([
    loadModels(dressed.placements.map((p) => p.model)),
    loadFigures(contentModels(dressed.layout, contentsOf(next))),
  ]);
  if (mine !== entry) return;
  things?.dispose();
  things = null;
  area?.dispose();
  area = buildAreaScene(dressed, next.exits, models);
  layout = dressed.layout;
  dressing = dressed;
  state = next;
  placeContents(contentsOf(next), figures);
  const start = at && walkLayout && isFree(at, walkLayout) ? at : spawnPoint(dressed.layout, cameFrom);
  player = { x: start.x, z: start.z };
  view = { yaw: start.yaw, pitch: 0 };
  screen = 'world';
  showHud(next, true);
  setLoading(false);
}

/** Shows what the server says: the title panel, the pending link, or (when already walking) the world. */
function apply(next: WorldState | null, keepWalking: boolean): void {
  state = next;
  if (next && next.has_character && !next.pending && next.location && next.area && keepWalking) {
    void enterArea(next, null);
    return;
  }
  leaveWorld();
  screen = next?.pending ? 'pending' : 'title';
  showTitle(next);
}

// Where the player stood when an encounter was started, kept for the way back from the classic pages.
const RETURN_KEY = 'aiv.return';
interface ReturnPoint {
  location: string;
  area: string;
  x: number;
  z: number;
  yaw: number;
}

function savedReturn(): ReturnPoint | null {
  try {
    const point = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as ReturnPoint | null;
    const fine = point !== null && typeof point.location === 'string' && typeof point.area === 'string'
      && [point.x, point.z, point.yaw].every((v) => typeof v === 'number' && Number.isFinite(v));
    return fine ? point : null;
  } catch {
    return null;
  }
}

function forgetReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* no storage */
  }
}

// The gate signs and the name plates are drawn with the heading font; give it a moment to arrive.
const cinzel = document.fonts.load('600 96px Cinzel').catch(() => []);
const fontReady = (): Promise<unknown> => Promise.race([cinzel, new Promise((done) => setTimeout(done, 1500))]);

/**
 * Asks the server what is true and shows it. A player who was walking keeps walking; one who comes
 * back from an encounter started here is put where they stood, without the title screen.
 */
async function refresh(): Promise<void> {
  const wasWalking = screen === 'world';
  busy = false;
  const sameArea = (next: WorldState): boolean =>
    wasWalking && next.area?.id === state?.area?.id && next.location?.name === state?.location?.name && !next.pending;
  try {
    let next = await fetchState();
    const walkable = next.has_character && !next.pending && next.location !== null && next.area !== null;
    const saved = savedReturn();
    const matches = saved !== null && saved.location === next.location?.name && saved.area === next.area?.id;
    // Kept only while the encounter it belongs to is still going on.
    if (!(matches && next.pending)) forgetReturn();
    const back = walkable && matches ? saved : null;
    if (walkable && (wasWalking || back)) {
      // Arriving: the server rolls what the area holds when it has not yet.
      const arrived = await postEnter();
      if (arrived.ok) next = arrived.state;
    }
    if (sameArea(next) && layout) {
      await showContents(next);
    } else if (back && !wasWalking && !next.pending) {
      state = next;
      await fontReady();
      await enterArea(next, null, back);
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
    await enterArea(answer.state, from);
  } else {
    // Refused: show what the server says is true now, from the default spawn or the pending link.
    await fetchState().then((next) => apply(next, true), () => apply(null, false));
  }
  veil(false);
  crossing = false;
}

// --- what the area holds ------------------------------------------------------------------------

/** Meets the monster, event or boss with this id: the encounter goes on where the server says. */
async function engage(id: string): Promise<void> {
  if (busy || !state?.location || !state.area) return;
  busy = true;
  held.clear();
  const point: ReturnPoint = { location: state.location.name, area: state.area.id, x: player.x, z: player.z, yaw: view.yaw };
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
  } catch {
    /* no storage: the way back starts at the title screen */
  }
  const answer = await postEngage(id);
  if (answer.ok) {
    window.location.assign(answer.url);
    return;
  }
  forgetReturn();
  await refresh();
}

/** Searches the area further: the server rolls again and the new contents take their slots. */
async function search(): Promise<void> {
  if (busy) return;
  busy = true;
  const mine = entry;
  const answer = await postSearch();
  if (mine !== entry) return;
  if (!answer.ok) {
    await refresh();
    return;
  }
  await showContents(answer.state);
  const found = contentsOf(answer.state);
  if (found && !found.monster && !found.event) showNotice('You find nothing.');
  busy = false;
}

/** What E does: whatever the prompt says. */
async function interact(): Promise<void> {
  if (!shown() || menuOpen || crossing || busy) return;
  const hit = interactionNow();
  if (!hit || hit.locked) return;
  if (hit.kind === 'search') await search();
  else if (hit.id !== null) await engage(hit.id);
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
  if (event.code === 'KeyE') {
    if (!event.repeat) void interact();
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

document.getElementById('btn-continue')?.addEventListener('click', async () => {
  if (!state || !state.has_character || state.pending || busy) return;
  busy = true;
  // Arriving: the server rolls what the area holds when it has not yet.
  const [arrived] = await Promise.all([postEnter(), fontReady()]);
  busy = false;
  if (screen !== 'title' || loading) return;
  if (!arrived.ok) {
    await refresh();
  } else if (arrived.state.pending || !arrived.state.area) {
    apply(arrived.state, false);
  } else {
    void enterArea(arrived.state, null);
  }
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
    if (!menuOpen && !crossing && !loading && !busy) {
      const step = walkStep(player, view.yaw, heldKeys(held), dt, walkLayout ?? layout);
      player = step.pos;
      if (step.gate) {
        void crossGate(step.gate);
      } else {
        // A monster that is walked into starts the fight by itself.
        const hit = interactionNow();
        if (hit?.auto && hit.id !== null) void engage(hit.id);
      }
    }
    showPrompt(promptNow());
    eye.position.set(player.x, EYE_HEIGHT, player.z);
    eye.rotation.set(view.pitch, view.yaw, 0);
    area.update(player.x, player.z, time);
    things?.update(player.x, player.z, time, dt);
    renderer.render(area.scene, eye);
  } else {
    title.update(time);
    renderer.render(title.scene, title.camera);
  }
  triangles = renderer.info.render.triangles;
  window.__aiv.frames += 1;
  window.__aiv.ready = true;
});

// The state is asked for on load, and again when the page comes back from the browser's
// back/forward cache (after a visit to a classic page). On the way back from an encounter the
// title panel stays away while the answer is on its way.
if (savedReturn()) hideTitle();
void refresh();
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void refresh();
});
