// The floor plan of one campaign area: size, gates, solid walls and props, spawn points.
// Pure and deterministic: the same area always gives the same plan. The only randomness is a
// generator seeded from the area's location and id. No rendering and no browser here.
// Axes as in input/movement.ts: x to the right, z towards the viewer.

import type { Vec2 } from '../input/movement';

export const WALK_SPEED = 5; // m/s
export const EYE_HEIGHT = 1.7; // m
export const PLAYER_RADIUS = 0.4; // m, the player is a circle on the ground plane
export const GATE_WIDTH = 3; // m
export const GATE_DEPTH = 1; // m, how far the trigger zone reaches into the floor
export const GATE_SPAWN_DISTANCE = 2.5; // m from the gate's centre into the floor

export type LocationType = 'town' | 'wilderness' | 'dungeon';
export type Side = 'north' | 'south' | 'east' | 'west';
export type PropKind = 'house' | 'crate' | 'tree' | 'rock' | 'pillar' | 'brazier' | 'model'; // 'model': a solid of the dressing

export interface AreaSpec {
  location: string; // location name, e.g. "Rivermeet Town"
  type: string; // location type; anything but 'town' or 'dungeon' is treated as 'wilderness'
  id: string; // area id
  exits: string[]; // connected area ids, in the order of `connections`
}
/** Axis-aligned, centre and half extents. */
export interface Box {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  height: number;
}
export interface Prop extends Box {
  kind: PropKind;
}
export interface Gate {
  exitId: string;
  side: Side;
  x: number;
  z: number;
  width: number;
  spawn: Vec2;
}
/** Where what an area holds stands: the monster, the event object, the search spot, the boss, and where one stands at the special landmark and at the rest landmark. */
export interface ContentSlots {
  monster: Vec2;
  event: Vec2;
  search: Vec2;
  boss: Vec2 | null; // non-null exactly when the DressSpec has boss: true
  landmark: Vec2 | null; // a standing point in front of the special landmark; non-null exactly when the dressing has one
  rest: Vec2 | null; // a standing point at the rest landmark (inn front or campfire); non-null exactly when the dressing has one
  shop: Vec2 | null; // where Elara stands, inside the solid box of the market stall; non-null exactly when the dressing has one
}
export interface AreaLayout {
  type: LocationType;
  floor: { halfX: number; halfZ: number }; // the floor is the rectangle |x| <= halfX, |z| <= halfZ
  ceiling: number | null; // height in metres for a dungeon, null otherwise
  walls: Box[]; // solid walls inside the floor (may be empty)
  props: Prop[]; // solid props
  gates: Gate[]; // one per exit, in the order of AreaSpec.exits
  spawn: Vec2; // default spawn
  slots: ContentSlots | null; // null from buildLayout; the dressing chooses them (dressArea(...).layout)
}

/** Unit vector pointing from a side's edge into the floor. */
export const INWARD: Record<Side, Vec2> = {
  north: { x: 0, z: 1 },
  south: { x: 0, z: -1 },
  west: { x: 1, z: 0 },
  east: { x: -1, z: 0 },
};

/** Distance from a point to a box on the ground plane; 0 inside it. */
export function boxDistance(p: Vec2, box: Box): number {
  return Math.hypot(Math.max(Math.abs(p.x - box.x) - box.halfX, 0), Math.max(Math.abs(p.z - box.z) - box.halfZ, 0));
}

/** The point just inside a gate (0.5 m from the edge) that a walker heads for. */
export function gatePoint(gate: Gate): Vec2 {
  const n = INWARD[gate.side];
  return { x: gate.x + n.x * 0.5, z: gate.z + n.z * 0.5 };
}

/** A stretch of the floor's boundary without a gate in it: `from`..`to` along the edge of `side`. */
export interface BoundaryRun {
  side: Side;
  from: number;
  to: number;
}

/** The boundary of the floor cut open at the gates, for whoever draws the outer wall. */
export function boundaryRuns(layout: AreaLayout): BoundaryRun[] {
  const runs: BoundaryRun[] = [];
  for (const side of ['north', 'east', 'south', 'west'] as Side[]) {
    const alongX = side === 'north' || side === 'south';
    const half = alongX ? layout.floor.halfX : layout.floor.halfZ;
    const openings = layout.gates
      .filter((g) => g.side === side)
      .map((g) => ({ from: (alongX ? g.x : g.z) - g.width / 2, to: (alongX ? g.x : g.z) + g.width / 2 }))
      .sort((a, b) => a.from - b.from);
    let at = -half;
    for (const o of openings) {
      if (o.from > at) runs.push({ side, from: at, to: Math.min(o.from, half) });
      at = Math.max(at, o.to);
    }
    if (at < half) runs.push({ side, from: at, to: half });
  }
  return runs;
}

/** A piece of the outer wall on the ground plane: centre and half extents, lying outside the floor. */
export interface BoundaryBlock {
  side: Side;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

/**
 * The outer wall as blocks of the given thickness standing just outside the floor edge. Every gate
 * keeps its full width open. The north and south blocks reach past the floor's corners to close
 * them, and only there: an end next to a gate stops at the gate.
 */
export function boundaryBlocks(layout: AreaLayout, thickness: number): BoundaryBlock[] {
  const { halfX, halfZ } = layout.floor;
  return boundaryRuns(layout).map((run) => {
    if (run.side === 'north' || run.side === 'south') {
      const from = run.from <= -halfX ? run.from - thickness : run.from;
      const to = run.to >= halfX ? run.to + thickness : run.to;
      const z = run.side === 'north' ? -halfZ - thickness / 2 : halfZ + thickness / 2;
      return { side: run.side, x: (from + to) / 2, z, halfX: (to - from) / 2, halfZ: thickness / 2 };
    }
    const x = run.side === 'west' ? -halfX - thickness / 2 : halfX + thickness / 2;
    return { side: run.side, x, z: (run.from + run.to) / 2, halfX: thickness / 2, halfZ: (run.to - run.from) / 2 };
  });
}

// ---------------------------------------------------------------------------------------------

/** FNV-1a, so that every area gets its own seed. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small generator with values in [0, 1). */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Coordinates are kept on a 0.5 m (floor, gates, spawn) or 0.25 m (props) grid, so sums and
// differences of them are exact and a comparison on a boundary never depends on rounding.
const snap = (value: number, grid: number): number => Math.round(value / grid) * grid + 0;

const GATE_CORNER_MARGIN = 4; // m between a gate's centre and the corner of the floor
const CLEARANCE = 1; // m kept free around spawn paths, trigger zones and between boxes
const SPAWN_CLEARANCE = 1.5; // m kept free around every spawn point

export interface Rect {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return Math.abs(a.x - b.x) < a.halfX + b.halfX + gap && Math.abs(a.z - b.z) < a.halfZ + b.halfZ + gap;
}

/** Whether the segment a-b touches the rectangle grown by `gap` on every side (slab test). */
export function segmentHitsRect(a: Vec2, b: Vec2, r: Rect, gap: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, r.x, r.halfX + gap],
    [a.z, b.z - a.z, r.z, r.halfZ + gap],
  ];
  for (const [start, d, centre, half] of axes) {
    if (d === 0) {
      if (Math.abs(start - centre) >= half) return false;
      continue;
    }
    let near = (centre - half - start) / d;
    let far = (centre + half - start) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 >= t1) return false;
  }
  return true;
}

/** The rectangle of floor in which standing means walking through the gate. */
export function triggerRect(gate: Gate): Rect {
  const n = INWARD[gate.side];
  const alongX = n.x === 0;
  return {
    x: gate.x + n.x * (GATE_DEPTH / 2),
    z: gate.z + n.z * (GATE_DEPTH / 2),
    halfX: alongX ? gate.width / 2 : GATE_DEPTH / 2,
    halfZ: alongX ? GATE_DEPTH / 2 : gate.width / 2,
  };
}

function placeGates(exits: string[], halfX: number, halfZ: number, rnd: () => number): Gate[] {
  // One side per exit while there are sides left, in an order that differs per area.
  const sides: Side[] = ['north', 'east', 'south', 'west'];
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }
  const onSide = new Map<Side, number[]>();
  exits.forEach((_, i) => {
    const side = sides[i % 4];
    onSide.set(side, [...(onSide.get(side) ?? []), i]);
  });

  const gates: Gate[] = new Array(exits.length);
  for (const [side, indexes] of onSide) {
    const alongX = side === 'north' || side === 'south';
    const reach = (alongX ? halfX : halfZ) - GATE_CORNER_MARGIN;
    indexes.forEach((exitIndex, j) => {
      const along =
        indexes.length === 1
          ? snap((rnd() * 2 - 1) * reach, 0.5)
          : -reach + snap((j * 2 * reach) / (indexes.length - 1), 0.5);
      const n = INWARD[side];
      const x = alongX ? along : side === 'west' ? -halfX : halfX;
      const z = alongX ? (side === 'north' ? -halfZ : halfZ) : along;
      gates[exitIndex] = {
        exitId: exits[exitIndex],
        side,
        x,
        z,
        width: GATE_WIDTH,
        spawn: { x: x + n.x * GATE_SPAWN_DISTANCE, z: z + n.z * GATE_SPAWN_DISTANCE },
      };
    });
  }
  return gates;
}

export function buildLayout(area: AreaSpec): AreaLayout {
  const type: LocationType = area.type === 'town' || area.type === 'dungeon' ? area.type : 'wilderness';
  const rnd = generator(hash(`${area.location}/${area.id}`));
  const between = (low: number, high: number): number => low + rnd() * (high - low);
  const count = (low: number, high: number): number => low + Math.floor(rnd() * (high - low + 1));

  const halfX = snap(between(11, 19), 0.5);
  const halfZ = snap(between(11, 19), 0.5);
  const spawn: Vec2 = { x: snap(between(-1.5, 1.5), 0.5), z: snap(between(-1.5, 1.5), 0.5) };
  const gates = placeGates(area.exits, halfX, halfZ, rnd);
  const ceiling = type === 'dungeon' ? 3.5 + count(0, 5) * 0.5 : null;

  // What has to stay open: the spawn points, the straight line from the default spawn to each
  // gate, the way from each gate's spawn to the gate, and the trigger zones.
  const spawns = [spawn, ...gates.map((g) => g.spawn)];
  const paths: [Vec2, Vec2][] = gates.flatMap((g) => [
    [spawn, gatePoint(g)],
    [g.spawn, gatePoint(g)],
  ]) as [Vec2, Vec2][];
  const zones = gates.map(triggerRect);

  const walls: Box[] = [];
  const props: Prop[] = [];
  const fits = (box: Box): boolean => {
    if (Math.abs(box.x) + box.halfX > halfX || Math.abs(box.z) + box.halfZ > halfZ) return false;
    if (spawns.some((s) => boxDistance(s, box) < SPAWN_CLEARANCE)) return false;
    if (paths.some(([a, b]) => segmentHitsRect(a, b, box, CLEARANCE))) return false;
    if (zones.some((zone) => rectsOverlap(zone, box, CLEARANCE))) return false;
    return ![...walls, ...props].some((other) => rectsOverlap(other, box, CLEARANCE));
  };

  type Candidate = (shrink: number) => Box;
  /** Tries to place `wanted` boxes; the first `required` of them get many more tries, at smaller sizes. */
  const place = (wanted: number, required: number, candidate: Candidate, add: (box: Box) => void): void => {
    for (let i = 0; i < wanted; i++) {
      const tries = i < required ? 600 : 40;
      for (let t = 0; t < tries; t++) {
        const box = candidate(t < 40 ? 1 : 0);
        if (fits(box)) {
          add(box);
          break;
        }
      }
    }
  };
  const anywhere = (halfBoxX: number, halfBoxZ: number, height: number): Box => ({
    x: snap(between(-(halfX - halfBoxX), halfX - halfBoxX), 0.25),
    z: snap(between(-(halfZ - halfBoxZ), halfZ - halfBoxZ), 0.25),
    halfX: halfBoxX,
    halfZ: halfBoxZ,
    height,
  });
  const prop = (kind: PropKind) => (box: Box) => props.push({ ...box, kind });

  if (type === 'town') {
    // Houses stand with their back to the town wall.
    place(count(2, 5), 2, (full) => {
        const w = full ? snap(between(1.5, 3), 0.25) : 1.25;
        const d = full ? snap(between(1.5, 2.5), 0.25) : 1.25;
        const box = anywhere(w, d, snap(between(4, 6), 0.25));
        const side = count(0, 3);
        if (side === 0) box.z = -(halfZ - d);
        else if (side === 1) box.z = halfZ - d;
        else if (side === 2) box.x = -(halfX - w);
        else box.x = halfX - w;
        return box;
      }, prop('house'));
    place(count(1, 5), 0, () => {
        const half = snap(between(0.4, 0.6), 0.05);
        return anywhere(half, half, half * 2);
      }, prop('crate'));
  } else if (type === 'wilderness') {
    place(count(5, 12), 3, () => {
        const half = snap(between(0.35, 0.5), 0.05);
        return anywhere(half, half, snap(between(4, 7), 0.25));
      }, prop('tree'));
    place(count(1, 4), 1, (full) => {
        const size = full ? 1 : 0.5;
        return anywhere(snap(between(0.5, 1.2) * size, 0.05), snap(between(0.5, 1.2) * size, 0.05), snap(between(0.6, 1.6), 0.1));
      }, prop('rock'));
  } else {
    const height = ceiling as number;
    place(count(2, 4), 2, () => anywhere(0.3, 0.3, 1.1), prop('brazier'));
    place(count(0, 2), 0, () => {
        const long = snap(between(1.5, 3), 0.25);
        return rnd() < 0.5 ? anywhere(long, 0.3, height) : anywhere(0.3, long, height);
      }, (box) => walls.push(box));
    place(count(2, 6), 0, () => {
        const half = snap(between(0.5, 0.7), 0.05);
        return anywhere(half, half, height);
      }, prop('pillar'));
    place(count(0, 2), 0, () => anywhere(snap(between(0.4, 0.9), 0.05), snap(between(0.4, 0.9), 0.05), snap(between(0.5, 1.2), 0.1)),
      prop('rock'));
  }

  return { type, floor: { halfX, halfZ }, ceiling, walls, props, gates, spawn, slots: null };
}

/** Yaw whose forward vector (-sin yaw, -cos yaw) points along (dx, dz). */
function yawAlong(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Where the player appears: just inside the gate that leads back to `cameFrom`, else the default spawn. */
export function spawnPoint(layout: AreaLayout, cameFrom: string | null): { x: number; z: number; yaw: number } {
  const back = cameFrom === null ? undefined : layout.gates.find((g) => g.exitId === cameFrom);
  if (back) {
    const n = INWARD[back.side];
    return { x: back.spawn.x, z: back.spawn.z, yaw: yawAlong(n.x, n.z) };
  }
  const first = layout.gates[0];
  const yaw = first ? yawAlong(first.x - layout.spawn.x, first.z - layout.spawn.z) : 0;
  return { x: layout.spawn.x, z: layout.spawn.z, yaw };
}
