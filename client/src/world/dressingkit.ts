// Measuring helpers for dressing.test.ts, written against the definitions in the specification
// (footprint, overlap, trigger zone, exit strip, spawn square, walker), not against dressing.ts.

import campaign from '../../../json/campaign.json';
import type { Vec2 } from '../input/movement';
import type { DressSpec, Placement } from './dressing';
import type { AreaLayout, Gate } from './layout';
import models from './models.json';
import { NORMALS, gatePointOf, mulberry32 } from './testkit';
import { walkStep } from './walk';

export const MANIFEST = models as unknown as Record<string, { size: number[]; triangles: number }>;
export const SPECIALS = ['town_center', 'water_access', 'mysterious_runes', 'hidden_treasure', 'magical_forge', 'hidden_passage', 'ancient_treasures',
  'wind_blessing', 'crystal_forest', 'precious_gems', 'tactical_advantage', 'prisoner_rescue', 'magical_research'];

/** One DressSpec per campaign area, with the features read the way the server reads them. */
export function campaignDressSpecs(): DressSpec[] {
  return campaign.acts.flatMap((act) =>
    act.locations.flatMap((loc) =>
      loc.areas.map((area) => {
        const a = area as { id: string; connections: string[]; special?: string; boss?: string };
        const s = (a.special ?? '').toLowerCase();
        return {
          location: loc.name, type: loc.type, id: a.id, exits: a.connections,
          shop: s.includes('shop'), rest: s.includes('rest') || s.includes('inn') || s.includes('tavern'), boss: Boolean(a.boss), special: a.special ?? null,
        };
      }),
    ),
  );
}

/** Specs that are in no campaign: every type, 0 to 4 exits, features switched on at random. */
export function madeUpSpecs(seed: number, count: number): DressSpec[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    location: `place-${Math.floor(rnd() * 1e9).toString(36)}`,
    type: ['town', 'wilderness', 'dungeon'][i % 3],
    id: `area${i}`,
    exits: ['a', 'b', 'c', 'd'].slice(0, i % 5),
    shop: rnd() < 0.3,
    rest: rnd() < 0.3,
    boss: rnd() < 0.3,
    special: rnd() < 0.3 ? SPECIALS[Math.floor(rnd() * SPECIALS.length)] : null,
  }));
}

export interface Rectangle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export function scaledSize(p: Placement): { W: number; H: number; D: number } {
  const [w, h, d] = MANIFEST[p.model].size;
  return { W: w * p.scale[0], H: h * p.scale[1], D: d * p.scale[2] };
}

export function footprintOf(p: Placement): Rectangle {
  const { W, D } = scaledSize(p);
  const c = Math.abs(Math.cos(p.rotation));
  const s = Math.abs(Math.sin(p.rotation));
  return { x: p.x, z: p.z, halfX: (c * W + s * D) / 2, halfZ: (s * W + c * D) / 2 };
}

/** Area of the intersection divided by the area of the smaller rectangle. */
export function overlap(a: Rectangle, b: Rectangle): number {
  const w = Math.min(a.x + a.halfX, b.x + b.halfX) - Math.max(a.x - a.halfX, b.x - b.halfX);
  const d = Math.min(a.z + a.halfZ, b.z + b.halfZ) - Math.max(a.z - a.halfZ, b.z - b.halfZ);
  if (w <= 0 || d <= 0) return 0;
  return (w * d) / Math.min(a.halfX * a.halfZ * 4, b.halfX * b.halfZ * 4);
}

/** Smallest distance between two rectangles; 0 when they touch or overlap. */
export function rectDistance(a: Rectangle, b: Rectangle): number {
  return Math.hypot(Math.max(Math.abs(a.x - b.x) - a.halfX - b.halfX, 0), Math.max(Math.abs(a.z - b.z) - a.halfZ - b.halfZ, 0));
}

/** The rectangle `gate.width` wide that reaches `depth` m from the gate's edge into the floor, or out of it for a negative depth. */
export function gateRect(gate: Gate, depth: number): Rectangle {
  const n = NORMALS[gate.side];
  const alongX = n.x === 0;
  return {
    x: gate.x + (n.x * depth) / 2,
    z: gate.z + (n.z * depth) / 2,
    halfX: alongX ? gate.width / 2 : Math.abs(depth) / 2,
    halfZ: alongX ? Math.abs(depth) / 2 : gate.width / 2,
  };
}
export const triggerZone = (gate: Gate): Rectangle => gateRect(gate, 1);
export const exitStrip = (gate: Gate): Rectangle => gateRect(gate, -3);
export const spawnSquare = (p: Vec2): Rectangle => ({ x: p.x, z: p.z, halfX: 1, halfZ: 1 });

/** Holds W towards the gate from `start`; true when that gate, and no other first, is reached within 30 s. */
export function walkerWins(layout: AreaLayout, start: Vec2, target: Gate): boolean {
  const goal = gatePointOf(target);
  let pos = { x: start.x, z: start.z };
  for (let tick = 0; tick < 1800; tick++) {
    const yaw = Math.atan2(-(goal.x - pos.x), -(goal.z - pos.z));
    const step = walkStep(pos, yaw, { forward: true, back: false, left: false, right: false }, 1 / 60, layout);
    pos = step.pos;
    if (step.gate) return step.gate === target;
  }
  return false;
}

/** `model@X,Z` of every prop and landmark, positions rounded to half metres. */
export function signature(placements: Placement[]): Set<string> {
  return new Set(
    placements.filter((p) => p.role === 'prop' || p.role === 'landmark').map((p) => `${p.model}@${Math.round(p.x * 2) / 2},${Math.round(p.z * 2) / 2}`),
  );
}
