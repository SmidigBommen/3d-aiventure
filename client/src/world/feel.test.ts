import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../battle/timeline';
import { FLOAT_LOOKS } from '../battle/fx';
import { dressArea } from './dressing';
import { campaignDressSpecs } from './dressingkit';
import { BOB_HEIGHT, LOW_HP, SHAKE_CRIT, SHAKE_HIT, STILL_SECONDS, STRIDE, bobOffset, gaitStep, shakeOf, startGait, vignette, type Gait } from './feel';
import { WALK_SPEED, buildLayout } from './layout';
import { walkStep } from './walk';

interface Frame { moved: number; dt: number }

/** Feeds frames to the gait; returns the times of the steps and the bob of every frame. */
function run(start: Gait, frames: Frame[], from = 0): { gait: Gait; steps: number[]; bobs: number[]; t: number } {
  const steps: number[] = [];
  const bobs: number[] = [];
  let gait = start;
  let t = from;
  for (const frame of frames) {
    const made = gaitStep(gait, frame.moved, frame.dt);
    gait = made.gait;
    t += frame.dt;
    if (made.step) steps.push(t);
    bobs.push(bobOffset(gait));
  }
  return { gait, steps, bobs, t };
}
const walking = (seconds: number, dt: number, speed = WALK_SPEED): Frame[] => Array.from({ length: Math.round(seconds / dt) }, () => ({ moved: speed * dt, dt }));
const standing = (seconds: number, dt: number): Frame[] => Array.from({ length: Math.round(seconds / dt) }, () => ({ moved: 0, dt }));

describe('the gait', () => {
  it('starts half a stride from the first step', () => {
    expect(startGait()).toEqual({ phase: STRIDE / 2, still: STILL_SECONDS, sway: 0 });
    expect(bobOffset(startGait())).toBe(0);
  });

  for (const fps of [30, 60, 144]) {
    it(`steps at walking pace at ${fps} frames per second`, () => {
      const dt = 1 / fps;
      const { steps, bobs } = run(startGait(), walking(10, dt));
      expect(steps.length).toBeGreaterThanOrEqual(18);
      expect(steps.length).toBeLessThanOrEqual(20);
      expect(steps[0]).toBeLessThanOrEqual(0.26 + dt + 1e-9);
      expect(steps[0]).toBeGreaterThanOrEqual(0.26 - dt);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i] - steps[i - 1]).toBeGreaterThan(1 / 2.2);
        expect(steps[i] - steps[i - 1]).toBeLessThan(1 / 1.6);
      }
      expect(Math.max(...bobs)).toBeLessThanOrEqual(BOB_HEIGHT);
      expect(Math.min(...bobs)).toBeGreaterThanOrEqual(-BOB_HEIGHT);
      const first = bobs.slice(0, Math.round(2 / dt));
      expect(Math.max(...first) - Math.min(...first)).toBeGreaterThanOrEqual(0.04);
      if (fps >= 60) for (let i = 1; i < bobs.length; i++) expect(Math.abs(bobs[i] - bobs[i - 1])).toBeLessThanOrEqual(0.02);
      const slow = run(startGait(), walking(10, dt, WALK_SPEED / 2));
      expect(Math.abs(slow.steps.length - steps.length / 2)).toBeLessThanOrEqual(1);
    });
  }

  it('stops with the walker and starts over after standing', () => {
    const dt = 1 / 60;
    const walked = run(startGait(), walking(3, dt));
    const stood = run(walked.gait, standing(2, dt), walked.t);
    expect(stood.steps).toEqual([]);
    stood.bobs.forEach((bob, i) => {
      if ((i + 1) * dt >= STILL_SECONDS) expect(bob).toBe(0);
      if (i > 0) expect(Math.abs(bob - stood.bobs[i - 1])).toBeLessThanOrEqual(0.02);
    });
    expect(Math.abs(stood.bobs[0] - walked.bobs[walked.bobs.length - 1])).toBeLessThanOrEqual(0.02);
    expect(stood.gait.phase).toBe(STRIDE / 2);
    const again = run(stood.gait, walking(3, dt), stood.t);
    expect(again.steps[0] - stood.t).toBeGreaterThanOrEqual(0.26 - dt);
    expect(again.steps[0] - stood.t).toBeLessThanOrEqual(0.26 + dt + 1e-9);
  });

  it('keeps the stride through a short stop and changes nothing it is given', () => {
    const gait = { phase: 2.0, still: 0, sway: 1 };
    const paused = gaitStep(gait, 0, 0.05);
    expect(gait).toEqual({ phase: 2.0, still: 0, sway: 1 });
    expect(paused.gait.phase).toBe(2.0);
    expect(paused.step).toBe(false);
    const stepped = gaitStep(gait, 0.7, 0.1);
    expect(stepped.step).toBe(true);
    expect(stepped.gait.phase).toBeCloseTo(0.1, 9);
    expect(gaitStep(gait, 0.5, 0.1).step).toBe(false);
  });

  it('steps with a real walk to the first gate of every campaign area', () => {
    const dt = 1 / 60;
    for (const spec of campaignDressSpecs()) {
      const { layout } = dressArea(buildLayout(spec), spec);
      const gate = layout.gates[0];
      if (!gate) continue;
      let pos = { ...layout.spawn };
      let gait = startGait();
      const steps: number[] = [];
      for (let tick = 0; tick < 1200; tick++) {
        const yaw = Math.atan2(-(gate.x - pos.x), -(gate.z - pos.z));
        const step = walkStep(pos, yaw, { forward: true, back: false, left: false, right: false }, dt, layout);
        const made = gaitStep(gait, Math.hypot(step.pos.x - pos.x, step.pos.z - pos.z), dt);
        gait = made.gait;
        pos = step.pos;
        if (made.step) steps.push((tick + 1) * dt);
        if (step.gate) break;
      }
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i] - steps[i - 1]).toBeGreaterThan(1 / 2.2);
        expect(steps[i] - steps[i - 1]).toBeLessThan(1 / 1.6);
      }
    }
  });
});

describe('shake, vignette and float looks', () => {
  const ev = (over: Partial<TurnEvent>): TurnEvent => ({ actor: 'player', kind: 'attack', name: 'x', outcome: 'hit', fx: 'slashing', ranged: false, player: 0, monster: 0, ...over });
  it('shakes for a crit and for a blow on the player', () => {
    expect(SHAKE_HIT).toEqual({ amplitude: 0.05, seconds: 0.25 });
    expect(SHAKE_CRIT).toEqual({ amplitude: 0.12, seconds: 0.4 });
    expect(shakeOf(ev({ outcome: 'crit', monster: -9 }))).toBe(SHAKE_CRIT);
    expect(shakeOf(ev({ actor: 'monster', outcome: 'crit', player: -9 }))).toBe(SHAKE_CRIT);
    expect(shakeOf(ev({ actor: 'monster', player: -1 }))).toBe(SHAKE_HIT);
    expect(shakeOf(ev({ kind: 'condition', outcome: null, player: -1 }))).toBe(SHAKE_HIT);
    expect(shakeOf(ev({ monster: -5 }))).toBeNull();
    expect(shakeOf(ev({ kind: 'item', outcome: null, player: 5 }))).toBeNull();
  });

  it('reddens the edge below 30 %', () => {
    expect(LOW_HP).toBe(0.3);
    expect(vignette(31, 100)).toBe(0);
    expect(vignette(30, 100)).toBeCloseTo(0.35, 12);
    expect(vignette(15, 100)).toBeCloseTo(0.675, 12);
    expect(vignette(0, 100)).toBe(1);
    expect(vignette(-4, 100)).toBe(1);
    expect(vignette(5, 0)).toBe(0);
    for (let hp = 1; hp <= 120; hp++) expect(vignette(hp, 100)).toBeLessThanOrEqual(vignette(hp - 1, 100));
  });

  it('has a look per float style', () => {
    expect(FLOAT_LOOKS).toEqual({
      damage: { color: '#ff5a4f', size: 1.7 }, crit: { color: '#ffd35a', size: 2.6 }, heal: { color: '#5fe08a', size: 2.0 }, miss: { color: '#a9a6b3', size: 1.3 },
    });
  });
});
