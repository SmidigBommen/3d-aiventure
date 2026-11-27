// Measuring helpers for the tests next to the world modules. Written against the definitions in
// the specification, not against the modules' own helpers, so a mistake in one shows in the other.

import campaign from '../../../json/campaign.json';
import type { Vec2 } from '../input/movement';
import type { AreaLayout, AreaSpec, Box, Gate } from './layout';

export const NORMALS = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, west: { x: 1, z: 0 }, east: { x: -1, z: 0 } };

export function campaignAreas(): AreaSpec[] {
  return campaign.acts.flatMap((act) =>
    act.locations.flatMap((loc) => loc.areas.map((area) => ({ location: loc.name, type: loc.type, id: area.id, exits: area.connections }))),
  );
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanceToBox(p: Vec2, b: Box): number {
  return Math.hypot(Math.max(Math.abs(p.x - b.x) - b.halfX, 0), Math.max(Math.abs(p.z - b.z) - b.halfZ, 0));
}

export function boxes(layout: AreaLayout): Box[] {
  return [...layout.walls, ...layout.props];
}

/** `slack` tightens (negative) or loosens (positive) the check. */
export function free(p: Vec2, layout: AreaLayout, slack = 1e-6): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  if (Math.abs(p.x) > layout.floor.halfX - 0.4 + slack) return false;
  if (Math.abs(p.z) > layout.floor.halfZ - 0.4 + slack) return false;
  return boxes(layout).every((b) => distanceToBox(p, b) >= 0.4 - slack);
}

export function walkable(a: Vec2, b: Vec2, layout: AreaLayout, slack = 1e-6): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const points = [a, b];
  for (let d = 0.1; d < length; d += 0.1) points.push({ x: a.x + ((b.x - a.x) * d) / length, z: a.z + ((b.z - a.z) * d) / length });
  return points.every((p) => free(p, layout, slack));
}

export function gatePointOf(gate: Gate): Vec2 {
  const n = NORMALS[gate.side];
  return { x: gate.x + n.x * 0.5, z: gate.z + n.z * 0.5 };
}

export function inTriggerZone(p: Vec2, gate: Gate, layout: AreaLayout): boolean {
  const { halfX, halfZ } = layout.floor;
  if (Math.abs(p.x) > halfX || Math.abs(p.z) > halfZ) return false;
  const fromEdge = { north: p.z + halfZ, south: halfZ - p.z, west: p.x + halfX, east: halfX - p.x }[gate.side];
  const along = gate.side === 'north' || gate.side === 'south' ? p.x - gate.x : p.z - gate.z;
  return fromEdge <= 1 && Math.abs(along) <= gate.width / 2;
}

/** Smallest distance between a box and a gate's trigger zone; 0 when they touch or overlap. */
export function boxToZone(box: Box, gate: Gate): number {
  const n = NORMALS[gate.side];
  const alongX = n.x === 0;
  const zone = { x: gate.x + n.x * 0.5, z: gate.z + n.z * 0.5, halfX: alongX ? gate.width / 2 : 0.5, halfZ: alongX ? 0.5 : gate.width / 2 };
  return Math.hypot(
    Math.max(Math.abs(box.x - zone.x) - box.halfX - zone.halfX, 0),
    Math.max(Math.abs(box.z - zone.z) - box.halfZ - zone.halfZ, 0),
  );
}
