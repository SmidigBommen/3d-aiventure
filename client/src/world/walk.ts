// One frame of the player in an area: turning the view and walking. Pure.

import { moveStep, type MoveKeys, type Vec2 } from '../input/movement';
import { gateAt, moveWithCollision } from './collision';
import { WALK_SPEED, type AreaLayout, type Gate } from './layout';

export const MAX_FRAME_TIME = 0.1; // s; a longer frame (a tab coming back) is walked as this much
export const MAX_PITCH = (85 * Math.PI) / 180;
export const MOUSE_SENSITIVITY = 0.0022; // radians per pixel of mouse travel

export interface View {
  yaw: number;
  pitch: number;
}

/** Turns the view; a positive `dYaw` turns left, a positive `dPitch` looks up. Pitch stops at 85 degrees. */
export function turnView(view: View, dYaw: number, dPitch: number): View {
  return { yaw: view.yaw + dYaw, pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, view.pitch + dPitch)) };
}

/** The turn that mouse travel of (dx, dy) pixels asks for: right turns right, up looks up. */
export function mouseTurn(dx: number, dy: number): { dYaw: number; dPitch: number } {
  return { dYaw: -dx * MOUSE_SENSITIVITY, dPitch: -dy * MOUSE_SENSITIVITY };
}

/** The turn that brings a level view at `from` to face the ground point `target`. */
export function turnTowards(view: View, from: Vec2, target: Vec2): { dYaw: number; dPitch: number } {
  const yaw = Math.atan2(-(target.x - from.x), -(target.z - from.z));
  return { dYaw: yaw - view.yaw, dPitch: -view.pitch };
}

/** Walks for `dt` seconds with the held keys. Returns the new position and the gate it stands in, if any. */
export function walkStep(pos: Vec2, yaw: number, keys: MoveKeys, dt: number, layout: AreaLayout): { pos: Vec2; gate: Gate | null } {
  const delta = moveStep(keys, yaw, WALK_SPEED, Math.min(Math.max(dt, 0), MAX_FRAME_TIME));
  const next = moveWithCollision(pos, delta, layout);
  return { pos: next, gate: gateAt(next, layout) };
}

const CODES: Record<string, keyof MoveKeys> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** The movement a key stands for (by `KeyboardEvent.code`), or null. */
export function moveKey(code: string): keyof MoveKeys | null {
  return CODES[code] ?? null;
}

/** Which directions are asked for by the set of keys held down. */
export function heldKeys(codes: Iterable<string>): MoveKeys {
  const keys: MoveKeys = { forward: false, back: false, left: false, right: false };
  for (const code of codes) {
    const key = moveKey(code);
    if (key) keys[key] = true;
  }
  return keys;
}
