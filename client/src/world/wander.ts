// The monster of an area on its feet: it wanders around its slot and stops to face a player who comes near.
// Pure: where it is follows from its slot, the layout, a seed and the time; nothing here is random or drawn.

import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { PLAYER_RADIUS, boxDistance, generator, triggerRect, type AreaLayout } from './layout';

export const NOTICE_RANGE = 8; // m: the monster notices the player at this distance or less
export const LOSE_RANGE = 10; // m: a noticed monster forgets the player beyond this distance
export const WANDER_RADIUS = 4; // m from its slot, at most
export const KEEP_OFF = 3; // m from every gate and spawn point, at least
export const SLOT_ROOM = 2; // m from the event slot and the boss slot, at least
export const WANDER_SPEED = 0.8; // m/s
export const WANDER_PERIOD = 6; // s per target
export const NOTICE_SECONDS = 0.8; // s the notice animation lasts

export interface Wanderer { x: number; z: number; yaw: number; noticed: boolean; noticedFor: number }

const MAX_STEP_SECONDS = 0.1;
const far = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export function startWander(slot: Vec2): Wanderer {
  return { x: slot.x, z: slot.z, yaw: 0, noticed: false, noticedFor: 0 };
}

/** `allowedAt` with every limit tightened by `margin` metres. */
function allowedWithin(p: Vec2, slot: Vec2, layout: AreaLayout, margin: number): boolean {
  if (!(far(p, slot) <= WANDER_RADIUS - margin)) return false;
  for (const gate of layout.gates) {
    if (boxDistance(p, { ...triggerRect(gate), height: 0 }) < KEEP_OFF + margin) return false;
    if (far(p, gate.spawn) < KEEP_OFF + margin) return false;
  }
  if (far(p, layout.spawn) < KEEP_OFF + margin) return false;
  if (!isFree(p, layout)) return false;
  if (margin > 0) {
    if (Math.abs(p.x) > layout.floor.halfX - PLAYER_RADIUS - margin || Math.abs(p.z) > layout.floor.halfZ - PLAYER_RADIUS - margin) return false;
    for (const box of layout.walls) if (boxDistance(p, box) < PLAYER_RADIUS + margin) return false;
    for (const box of layout.props) if (boxDistance(p, box) < PLAYER_RADIUS + margin) return false;
  }
  if (layout.slots) {
    if (far(p, layout.slots.event) < SLOT_ROOM + margin) return false;
    if (layout.slots.boss && far(p, layout.slots.boss) < SLOT_ROOM + margin) return false;
  }
  return true;
}

/** Whether the monster of `slot` may stand at `p`: near its slot, off the gates and the spawn points, on free floor, clear of the event and the boss. */
export function allowedAt(p: Vec2, slot: Vec2, layout: AreaLayout): boolean {
  return allowedWithin(p, slot, layout, 0);
}

// --- where it heads ---------------------------------------------------------------------------------
//
// The targets of one slot are a walk: target k can be reached from target k-1 in a straight line within
// one period, and the triangle of the two and the slot is open floor, so a monster that was held up on
// the way (it noticed the player) still has a straight way home. Every fourth target is the slot. The
// walk repeats after ROUND targets. Kept per layout, so that a frame only looks its target up.

const GRID = 0.25; // m between the points a target is chosen from
const MARGIN = 0.12; // m a target and the way to it stay inside the limits
const ROUND = 512; // targets before the walk starts over; a multiple of HOME_EVERY
const HOME_EVERY = 4;
const REACH = WANDER_SPEED * WANDER_PERIOD - 0.4; // m: the longest way to a target
const STROLL = 1.5; // m: a shorter way is taken only when there is no longer one
const TRIES = 24;

const SPAN = Math.ceil(WANDER_RADIUS / GRID); // grid cells from the slot to the edge of its round
const SIDE = SPAN * 2 + 1;

interface Ground {
  slot: Vec2;
  home: boolean; // the slot itself is a place to stand
  cells: Uint8Array; // per grid cell: 0 not looked at yet, 1 a monster may stand there with MARGIN to spare, 2 it may not
  points: Vec2[]; // the cells one can stand on and walk to from the slot in a straight line
  walks: Map<number, Vec2[]>; // seed -> the targets so far
}
const grounds = new WeakMap<AreaLayout, Ground[]>();

function groundOf(slot: Vec2, layout: AreaLayout): Ground {
  let known = grounds.get(layout);
  if (!known) {
    known = [];
    grounds.set(layout, known);
  }
  let ground = known.find((g) => g.slot.x === slot.x && g.slot.z === slot.z);
  if (ground) return ground;
  ground = { slot: { x: slot.x, z: slot.z }, home: allowedAt(slot, slot, layout), cells: new Uint8Array(SIDE * SIDE), points: [], walks: new Map() };
  if (ground.home) {
    for (let i = -SPAN; i <= SPAN; i++) {
      for (let j = -SPAN; j <= SPAN; j++) {
        if (i === 0 && j === 0) continue;
        const p = { x: slot.x + i * GRID, z: slot.z + j * GRID };
        if (open(ground, layout, p) && clearLine(ground, layout, slot, p)) ground.points.push(p);
      }
    }
  }
  known.push(ground);
  return ground;
}

/** Whether the grid cell nearest to `p` is one to stand on. */
function open(ground: Ground, layout: AreaLayout, p: Vec2): boolean {
  const i = Math.round((p.x - ground.slot.x) / GRID);
  const j = Math.round((p.z - ground.slot.z) / GRID);
  if (!(Math.abs(i) <= SPAN && Math.abs(j) <= SPAN)) return false;
  const cell = (i + SPAN) * SIDE + j + SPAN;
  if (ground.cells[cell] === 0) {
    ground.cells[cell] = allowedWithin({ x: ground.slot.x + i * GRID, z: ground.slot.z + j * GRID }, ground.slot, layout, MARGIN) ? 1 : 2;
  }
  return ground.cells[cell] === 1;
}

function clearLine(ground: Ground, layout: AreaLayout, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(far(a, b) / (GRID / 2)));
  for (let s = 1; s < steps; s++) {
    if (!open(ground, layout, { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps })) return false;
  }
  return true;
}

/** Whether the triangle of `a`, `b` and the slot is open: every line from the slot to a point between `a` and `b`. */
function clearFan(ground: Ground, layout: AreaLayout, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(far(a, b) / GRID));
  for (let s = 0; s <= steps; s++) {
    const p = { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps };
    if (!open(ground, layout, p) || !clearLine(ground, layout, ground.slot, p)) return false;
  }
  return true;
}

function nextTarget(ground: Ground, layout: AreaLayout, seed: number, k: number, from: Vec2): Vec2 {
  if (k % HOME_EVERY === 0 || ground.points.length === 0) return ground.slot;
  const rnd = generator(Math.imul(seed | 0, 0x9e3779b1) + Math.imul(k, 0x85ebca6b));
  let short: Vec2 | null = null;
  for (let tries = 0; tries < TRIES; tries++) {
    const p = ground.points[Math.floor(rnd() * ground.points.length)];
    const way = far(from, p);
    if (way < 2 * GRID || way > REACH || !clearFan(ground, layout, from, p)) continue;
    if (way >= STROLL) return p;
    short = short ?? p;
  }
  return short ?? ground.slot;
}

/** The point the monster heads for at time `t`: one per WANDER_PERIOD, always a place where it may stand. */
export function wanderTarget(slot: Vec2, layout: AreaLayout, seed: number, t: number): Vec2 {
  const ground = groundOf(slot, layout);
  if (!ground.home) return { x: slot.x, z: slot.z };
  const period = Number.isFinite(t) && t > 0 ? Math.floor(t / WANDER_PERIOD) : 0;
  const k = period % ROUND;
  const key = Number.isFinite(seed) ? seed : 0;
  let walk = ground.walks.get(key);
  if (!walk) {
    walk = [ground.slot];
    ground.walks.set(key, walk);
  }
  while (walk.length <= k) walk.push(nextTarget(ground, layout, key, walk.length, walk[walk.length - 1]));
  return { x: walk[k].x, z: walk[k].z };
}

/** The monster after a step of `dt` seconds that starts at time `t`. `player`: where the player stands, or null when nobody is there to notice. */
export function wanderStep(w: Wanderer, slot: Vec2, layout: AreaLayout, seed: number, t: number, dt: number, player: Vec2 | null): Wanderer {
  const time = dt > 0 ? Math.min(dt, MAX_STEP_SECONDS) : 0;
  if (player) {
    const d = far(w, player);
    const noticed = w.noticed ? d <= LOSE_RANGE : d <= NOTICE_RANGE;
    if (noticed) {
      const apart = d > 0;
      return {
        x: w.x, z: w.z,
        yaw: apart ? Math.atan2(-(player.x - w.x), -(player.z - w.z)) : w.yaw,
        noticed: true,
        noticedFor: w.noticed ? w.noticedFor + time : 0,
      };
    }
  }
  const target = wanderTarget(slot, layout, seed, t);
  const dx = target.x - w.x;
  const dz = target.z - w.z;
  const left = Math.hypot(dx, dz);
  const reach = WANDER_SPEED * time;
  const still: Wanderer = { x: w.x, z: w.z, yaw: w.yaw, noticed: false, noticedFor: 0 };
  if (!(left > 1e-9) || !(reach > 0)) return still;
  const next = left <= reach ? { x: target.x, z: target.z } : { x: w.x + (dx / left) * reach, z: w.z + (dz / left) * reach };
  if (!allowedAt(next, slot, layout)) return still;
  return { x: next.x, z: next.z, yaw: Math.atan2(-dx, -dz), noticed: false, noticedFor: 0 };
}
