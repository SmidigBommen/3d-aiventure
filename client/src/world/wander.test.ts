import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { ROAD_SPEC, dressArea } from './dressing';
import { campaignDressSpecs, madeUpSpecs, triggerZone } from './dressingkit';
import { buildLayout, hash, type AreaLayout } from './layout';
import { distanceToBox } from './testkit';
import {
  KEEP_OFF, LOSE_RANGE, NOTICE_RANGE, NOTICE_SECONDS, SLOT_ROOM, WANDER_PERIOD, WANDER_RADIUS, WANDER_SPEED, allowedAt, startWander, wanderStep, wanderTarget,
} from './wander';

const SLACK = 1e-6;
const far = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const slotOf = (layout: AreaLayout): Vec2 => (layout.slots as NonNullable<AreaLayout['slots']>).monster;

/** What is wrong with the monster standing at `p`, measured by the definitions, not by wander.ts. */
function wrong(p: Vec2, slot: Vec2, layout: AreaLayout): string | null {
  if (far(p, slot) > WANDER_RADIUS + SLACK) return 'too far from its slot';
  for (const gate of layout.gates) {
    if (distanceToBox(p, { ...triggerZone(gate), height: 0 }) < KEEP_OFF - SLACK) return 'near a trigger zone';
    if (far(p, gate.spawn) < KEEP_OFF - SLACK) return 'near a gate spawn';
  }
  if (far(p, layout.spawn) < KEEP_OFF - SLACK) return 'near the spawn';
  if (!isFree(p, layout)) return 'not free';
  if (layout.slots && far(p, layout.slots.event) < SLOT_ROOM - SLACK) return 'near the event';
  if (layout.slots?.boss && far(p, layout.slots.boss) < SLOT_ROOM - SLACK) return 'near the boss';
  return null;
}

interface Run { path: number; reach: number; longest: number; fault: string | null; noticed: number }

/** Ten minutes of wandering in steps of 0.1 s. */
function wander(layout: AreaLayout, seed: number, player: (i: number) => Vec2 | null): Run {
  const slot = slotOf(layout);
  let w = startWander(slot);
  const run: Run = { path: 0, reach: 0, longest: 0, fault: null, noticed: 0 };
  for (let i = 0; i < 6000; i++) {
    const next = wanderStep(w, slot, layout, seed, i * 0.1, 0.1, player(i));
    const step = far(next, w);
    run.path += step;
    run.longest = Math.max(run.longest, step);
    run.reach = Math.max(run.reach, far(next, slot));
    run.fault = run.fault ?? wrong(next, slot, layout);
    if (next.noticed) run.noticed += 1;
    w = next;
  }
  return run;
}

/** A player who walks from the spawn to the slot and back at 5 m/s once a minute, and is away for the second half of it. */
function visitor(layout: AreaLayout): (i: number) => Vec2 | null {
  const slot = slotOf(layout);
  const length = far(layout.spawn, slot);
  return (i) => {
    const t = (i * 0.1) % 60;
    if (t >= 30) return null;
    const gone = t * 5;
    const along = gone <= length ? gone : Math.max(0, 2 * length - gone);
    return { x: layout.spawn.x + ((slot.x - layout.spawn.x) * along) / length, z: layout.spawn.z + ((slot.z - layout.spawn.z) * along) / length };
  };
}

describe('a wandering monster', () => {
  it('has its limits', () => {
    expect([NOTICE_RANGE, LOSE_RANGE, WANDER_RADIUS, KEEP_OFF, SLOT_ROOM, WANDER_SPEED, WANDER_PERIOD, NOTICE_SECONDS]).toEqual([8, 10, 4, 3, 2, 0.8, 6, 0.8]);
    expect(startWander({ x: 2, z: -3 })).toEqual({ x: 2, z: -3, yaw: 0, noticed: false, noticedFor: 0 });
  });

  it('stays where it may be and does wander, in every area of the campaign', { timeout: 120000 }, () => {
    const least = { path: Infinity, reach: Infinity, targets: Infinity, visited: Infinity };
    for (const spec of campaignDressSpecs()) {
      const { layout } = dressArea(buildLayout(spec), spec);
      const slot = slotOf(layout);
      const where = `${spec.location}/${spec.id}`;
      expect(allowedAt(slot, slot, layout), where).toBe(true);
      for (const seed of [1, 2, hash(where) + 1]) {
        const plain = wander(layout, seed, () => null);
        expect(plain.fault, where).toBeNull();
        expect(plain.longest, where).toBeLessThanOrEqual(WANDER_SPEED * 0.1 + SLACK);
        const visited = wander(layout, seed, visitor(layout));
        expect(visited.fault, where).toBeNull();
        expect(visited.longest, where).toBeLessThanOrEqual(WANDER_SPEED * 0.1 + SLACK);
        expect(visited.noticed, where).toBeGreaterThan(0);

        const targets = new Set<string>();
        for (let k = 0; k < 100; k++) {
          const target = wanderTarget(slot, layout, seed, k * WANDER_PERIOD);
          expect(allowedAt(target, slot, layout), where).toBe(true);
          expect(wanderTarget(slot, layout, seed, k * WANDER_PERIOD + 5.99)).toEqual(target);
          expect(wanderTarget(slot, layout, seed, k * WANDER_PERIOD)).toEqual(target);
          targets.add(`${target.x},${target.z}`);
        }
        least.path = Math.min(least.path, plain.path);
        least.reach = Math.min(least.reach, plain.reach);
        least.targets = Math.min(least.targets, targets.size);
        least.visited = Math.min(least.visited, visited.path);
      }
    }
    // The limits are 15 m, 0.5 m and 10 targets; these are what the worst area gives, with room to spare.
    expect(least.path).toBeGreaterThanOrEqual(60);
    expect(least.reach).toBeGreaterThanOrEqual(1.5);
    expect(least.targets).toBeGreaterThanOrEqual(30);
    expect(least.visited).toBeGreaterThanOrEqual(20); // it walks on once the visitor has left
  });

  it('gives the same walk from a layout built anew', () => {
    const spec = campaignDressSpecs()[7];
    const a = dressArea(buildLayout(spec), spec).layout;
    const b = dressArea(buildLayout(spec), spec).layout;
    // Asked out of order on purpose.
    for (const k of [40, 3, 17, 99, 0, 600, 100000]) expect(wanderTarget(slotOf(a), a, 5, k * 6)).toEqual(wanderTarget(slotOf(b), b, 5, k * 6));
    expect(wanderTarget(slotOf(a), a, 5, 30)).not.toEqual(wanderTarget(slotOf(a), a, 6, 30));
  });

  it('stays safe in areas no campaign has, and on the road', { timeout: 60000 }, () => {
    for (const spec of [...madeUpSpecs(11, 30), ROAD_SPEC]) {
      const { layout } = dressArea(buildLayout(spec), spec);
      const run = wander(layout, 3, visitor(layout));
      expect(run.fault, `${spec.location}/${spec.id}`).toBeNull();
    }
  });

  it('stays on a slot where it may not be', () => {
    const spec = campaignDressSpecs()[0];
    const { layout } = dressArea(buildLayout(spec), spec);
    const slot = { x: layout.spawn.x + 1, z: layout.spawn.z };
    expect(allowedAt(slot, slot, layout)).toBe(false);
    expect(wanderTarget(slot, layout, 1, 50)).toEqual(slot);
    expect(wanderStep(startWander(slot), slot, layout, 1, 50, 0.1, null)).toEqual(startWander(slot));
  });

  it('notices a player who comes near and forgets one who leaves', () => {
    const spec = campaignDressSpecs()[1];
    const { layout } = dressArea(buildLayout(spec), spec);
    const slot = slotOf(layout);
    const start = startWander(slot);
    const at = (d: number): Vec2 => ({ x: slot.x + d * 0.6, z: slot.z + d * 0.8 });
    const seen = wanderStep(start, slot, layout, 1, 6.5, 0.1, at(8));
    expect(seen).toMatchObject({ x: slot.x, z: slot.z, noticed: true, noticedFor: 0 });
    expect(seen.yaw).toBeCloseTo(Math.atan2(-0.6, -0.8), 9);
    expect(start).toEqual(startWander(slot));
    const still = wanderStep(seen, slot, layout, 1, 6.6, 0.1, at(9.9));
    expect(still).toMatchObject({ x: slot.x, z: slot.z, noticed: true, noticedFor: 0.1 });
    expect(wanderStep(still, slot, layout, 1, 6.7, 5, at(9.9)).noticedFor).toBeCloseTo(0.2, 9);
    expect(wanderStep(still, slot, layout, 1, 6.7, 0.1, at(10.1))).toMatchObject({ noticed: false, noticedFor: 0 });
    expect(wanderStep(still, slot, layout, 1, 6.7, 0.1, null)).toMatchObject({ noticed: false, noticedFor: 0 });
    expect(wanderStep(start, slot, layout, 1, 6.5, 0.1, at(9))).toMatchObject({ noticed: false, noticedFor: 0 });
    expect(wanderStep(start, slot, layout, 1, 6.5, 0.1, { x: slot.x, z: slot.z })).toMatchObject({ noticed: true, yaw: 0 });
  });

  it('walks towards its target, facing it, no faster for a long frame', () => {
    const spec = campaignDressSpecs()[1];
    const { layout } = dressArea(buildLayout(spec), spec);
    const slot = slotOf(layout);
    const target = wanderTarget(slot, layout, 1, 6.5);
    expect(target).not.toEqual(slot);
    const a = wanderStep(startWander(slot), slot, layout, 1, 6.5, 0.1, null);
    const b = wanderStep(startWander(slot), slot, layout, 1, 6.5, 5, null);
    expect(b).toEqual(a);
    expect(far(a, slot)).toBeCloseTo(0.08, 9);
    expect(a.yaw).toBeCloseTo(Math.atan2(-(target.x - slot.x), -(target.z - slot.z)), 9);
    expect(wanderStep(startWander(slot), slot, layout, 1, 6.5, -1, null)).toEqual(startWander(slot));
    // Never past the target.
    const near = { ...startWander(slot), x: target.x - 0.01, z: target.z };
    expect(wanderStep(near, slot, layout, 1, 6.5, 0.1, null)).toMatchObject({ x: target.x, z: target.z });
  });
});
