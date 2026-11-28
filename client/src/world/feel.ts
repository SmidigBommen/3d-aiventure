// How walking and fighting feel: the stride that gives footsteps and head bob, the shake of a blow,
// the red edge of the view at low hit points. Pure: no rendering, no browser.

import type { TurnEvent } from '../battle/timeline';

export const STRIDE = 2.6; // m walked per footstep
export const BOB_HEIGHT = 0.05; // m, the most the eye moves up or down
export const STILL_SECONDS = 0.2; // s of standing after which the stride starts over

const MOVING = 1e-4; // m in a frame; less is standing
const SWAY_SECONDS = 0.2; // s the bob takes to come in and to ease out
const TINY = 1e-9;

/** `phase`: metres into the stride. `still`: seconds stood. `sway`: how much of the bob shows, 0..1. */
export interface Gait { phase: number; still: number; sway: number }

/** Standing, half a stride from the first footstep. */
export function startGait(): Gait {
  return { phase: STRIDE / 2, still: STILL_SECONDS, sway: 0 };
}

/** One frame: `moved` metres actually walked (after collision) in `dt` seconds. `step`: a foot came down. */
export function gaitStep(gait: Gait, moved: number, dt: number): { gait: Gait; step: boolean } {
  const time = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (moved > MOVING) {
    let phase = gait.phase + moved;
    const step = phase >= STRIDE;
    if (step) phase -= STRIDE;
    return { gait: { phase, still: 0, sway: Math.min(1, gait.sway + time / SWAY_SECONDS) }, step };
  }
  const still = gait.still + time;
  const rested = still >= STILL_SECONDS - TINY;
  let sway = Math.max(0, gait.sway - time / SWAY_SECONDS);
  if (rested || sway < TINY) sway = 0;
  return { gait: { phase: rested ? STRIDE / 2 : gait.phase, still, sway }, step: false };
}

/** Metres added to the eye height: one wave per stride, lowest as the foot comes down. */
export function bobOffset(gait: Gait): number {
  if (!(gait.sway > 0)) return 0;
  return BOB_HEIGHT * Math.min(1, gait.sway) * Math.sin((gait.phase / STRIDE) * Math.PI * 2);
}

export interface Shake { amplitude: number; seconds: number }
export const SHAKE_HIT: Shake = { amplitude: 0.05, seconds: 0.25 };
export const SHAKE_CRIT: Shake = { amplitude: 0.12, seconds: 0.4 };

/** The camera shake of a turn event: a critical hit on either side, or anything that costs the player hit points. */
export function shakeOf(event: TurnEvent): Shake | null {
  if (event.outcome === 'crit') return SHAKE_CRIT;
  return event.player < 0 ? SHAKE_HIT : null;
}

export const LOW_HP = 0.3;

/** The opacity of the red edge: nothing above 30 % of the hit points, 0.35 at 30 %, rising to 1 at none. */
export function vignette(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) return 0;
  if (hp <= 0) return 1;
  const r = hp / maxHp;
  if (!(r <= LOW_HP)) return 0;
  return 0.35 + 0.65 * (1 - r / LOW_HP);
}
