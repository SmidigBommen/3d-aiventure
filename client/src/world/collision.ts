// Where the player can stand and what happens when a step runs into something. Pure.

import type { Vec2 } from '../input/movement';
import { GATE_DEPTH, PLAYER_RADIUS, boxDistance, type AreaLayout, type Gate } from './layout';

/** A position is free when the player's circle is inside the floor and touches no wall or prop. */
export function isFree(pos: Vec2, layout: AreaLayout): boolean {
  if (!(Math.abs(pos.x) <= layout.floor.halfX - PLAYER_RADIUS)) return false;
  if (!(Math.abs(pos.z) <= layout.floor.halfZ - PLAYER_RADIUS)) return false;
  for (const box of layout.walls) if (boxDistance(pos, box) < PLAYER_RADIUS) return false;
  for (const box of layout.props) if (boxDistance(pos, box) < PLAYER_RADIUS) return false;
  return true;
}

/**
 * The position after trying to move by `delta`. A blocked move slides along the obstacle on the
 * axis that is still free; with both axes free on their own, the longer one wins. A fully
 * blocked move stays in place.
 */
export function moveWithCollision(pos: Vec2, delta: Vec2, layout: AreaLayout): Vec2 {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return { x: pos.x, z: pos.z };
  const full = { x: pos.x + delta.x, z: pos.z + delta.z };
  if (isFree(full, layout)) return full;
  const alongX = { x: pos.x + delta.x, z: pos.z };
  const alongZ = { x: pos.x, z: pos.z + delta.z };
  const freeX = isFree(alongX, layout);
  const freeZ = isFree(alongZ, layout);
  if (freeX && freeZ) return Math.abs(delta.x) >= Math.abs(delta.z) ? alongX : alongZ;
  if (freeX) return alongX;
  if (freeZ) return alongZ;
  return { x: pos.x, z: pos.z };
}

// A point exactly on the border of a trigger zone counts as inside, also when the sums that
// produced it were rounded.
const EDGE_TOLERANCE = 1e-9;

/** The gate whose trigger zone contains `pos`: within GATE_DEPTH of the gate's edge, in front of the opening. */
export function gateAt(pos: Vec2, layout: AreaLayout): Gate | null {
  const { halfX, halfZ } = layout.floor;
  if (Math.abs(pos.x) > halfX + EDGE_TOLERANCE || Math.abs(pos.z) > halfZ + EDGE_TOLERANCE) return null;
  for (const gate of layout.gates) {
    const alongX = gate.side === 'north' || gate.side === 'south';
    const fromEdge =
      gate.side === 'north' ? pos.z + halfZ : gate.side === 'south' ? halfZ - pos.z : gate.side === 'west' ? pos.x + halfX : halfX - pos.x;
    const offset = alongX ? pos.x - gate.x : pos.z - gate.z;
    if (fromEdge <= GATE_DEPTH + EDGE_TOLERANCE && Math.abs(offset) <= gate.width / 2 + EDGE_TOLERANCE) return gate;
  }
  return null;
}
