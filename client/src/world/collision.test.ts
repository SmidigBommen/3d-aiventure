import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../input/movement';
import { gateAt, isFree, moveWithCollision } from './collision';
import { WALK_SPEED, buildLayout, type AreaLayout, type Gate } from './layout';
import { NORMALS, campaignAreas, free, gatePointOf, mulberry32 } from './testkit';
import { heldKeys, mouseTurn, turnTowards, turnView, walkStep, MAX_PITCH } from './walk';

const AREAS = campaignAreas();
const STEP = WALK_SPEED / 60;

const gate: Gate = { exitId: 'out', side: 'north', x: 2, z: -10, width: 3, spawn: { x: 2, z: -7.5 } };
const room: AreaLayout = {
  type: 'dungeon',
  floor: { halfX: 10, halfZ: 10 },
  ceiling: 4,
  walls: [{ x: 5, z: 0, halfX: 1, halfZ: 1, height: 4 }],
  props: [{ kind: 'pillar', x: -5, z: 5, halfX: 0.5, halfZ: 0.5, height: 4 }],
  gates: [gate, { exitId: 'east', side: 'east', x: 10, z: 3, width: 3, spawn: { x: 7.5, z: 3 } }],
  spawn: { x: 0, z: 0 },
};

describe('moveWithCollision', () => {
  it('moves freely in the open', () => {
    expect(moveWithCollision({ x: 0, z: 0 }, { x: 0.3, z: -0.2 }, room)).toEqual({ x: 0.3, z: -0.2 });
  });

  it('slides along the floor edge', () => {
    expect(moveWithCollision({ x: 9.5, z: 0 }, { x: 0.3, z: 0.2 }, { ...room, walls: [] })).toEqual({ x: 9.5, z: 0.2 });
    expect(moveWithCollision({ x: 0, z: -9.5 }, { x: 0.2, z: -0.3 }, room)).toEqual({ x: 0.2, z: -9.5 });
  });

  it('slides along a box', () => {
    // West face of the wall is at x = 4, so the player's centre stops at 3.6.
    expect(moveWithCollision({ x: 3.5, z: 0 }, { x: 0.3, z: 0.2 }, room)).toEqual({ x: 3.5, z: 0.2 });
    expect(moveWithCollision({ x: -5, z: 4 }, { x: 0.1, z: 0.3 }, room)).toEqual({ x: -4.9, z: 4 });
  });

  it('prefers the longer axis when both are free on their own', () => {
    const corner: AreaLayout = { ...room, walls: [{ x: 1, z: 1, halfX: 0.5, halfZ: 0.5, height: 2 }], props: [] };
    // Standing diagonally off the box's corner: the diagonal step is blocked, each axis alone is not.
    const pos = { x: 0.1, z: 0.1 };
    expect(isFree(pos, corner)).toBe(true);
    expect(isFree({ x: 0.1 + 0.2, z: 0.1 + 0.15 }, corner)).toBe(false);
    expect(moveWithCollision(pos, { x: 0.2, z: 0.15 }, corner)).toEqual({ x: 0.1 + 0.2, z: 0.1 });
    expect(moveWithCollision(pos, { x: 0.15, z: 0.2 }, corner)).toEqual({ x: 0.1, z: 0.1 + 0.2 });
    expect(moveWithCollision(pos, { x: 0.2, z: 0.2 }, corner)).toEqual({ x: 0.1 + 0.2, z: 0.1 });
  });

  it('stays put in a corner, returning a copy', () => {
    const pos = { x: 9.6, z: 9.6 };
    const result = moveWithCollision(pos, { x: 0.3, z: 0.3 }, room);
    expect(result).toEqual(pos);
    expect(result).not.toBe(pos);
  });

  it('never goes farther than the step, never leaves free ground and does not change its input', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 5000; i++) {
      const pos = { x: (rnd() * 2 - 1) * 9.6, z: (rnd() * 2 - 1) * 9.6 };
      if (!isFree(pos, room)) continue;
      const length = rnd() < 0.8 ? rnd() * 0.5 : rnd() * 30;
      const angle = rnd() * Math.PI * 2;
      const delta = { x: Math.cos(angle) * length, z: Math.sin(angle) * length };
      const before = JSON.stringify([pos, delta, room]);
      const result = moveWithCollision(pos, delta, room);
      expect(JSON.stringify([pos, delta, room])).toBe(before);
      expect(free(result, room, 0)).toBe(true);
      expect(Math.hypot(result.x - pos.x, result.z - pos.z)).toBeLessThanOrEqual(length + 1e-12);
    }
    expect(moveWithCollision({ x: 0, z: 0 }, { x: NaN, z: Infinity }, room)).toEqual({ x: 0, z: 0 });
  });
});

describe('gateAt', () => {
  it('finds the gate in front of its opening and nowhere else', () => {
    expect(gateAt({ x: 2, z: -9.5 }, room)).toBe(gate);
    expect(gateAt({ x: 3.5, z: -9.5 }, room)).toBe(gate);
    expect(gateAt({ x: 0.5, z: -9 }, room)).toBe(gate);
    expect(gateAt({ x: 3.6, z: -9.5 }, room)).toBeNull();
    expect(gateAt({ x: 2, z: -8.9 }, room)).toBeNull();
    expect(gateAt({ x: 2, z: 9.5 }, room)).toBeNull();
    expect(gateAt({ x: 9.5, z: 3 }, room)?.exitId).toBe('east');
    expect(gateAt(room.spawn, room)).toBeNull();
    expect(gateAt(gate.spawn, room)).toBeNull();
  });

  it('holds for every gate of the campaign', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      expect(gateAt(layout.spawn, layout)).toBeNull();
      for (const g of layout.gates) {
        const point = gatePointOf(g);
        const along = g.side === 'north' || g.side === 'south' ? { x: 1, z: 0 } : { x: 0, z: 1 };
        for (const offset of [0, -g.width / 2, g.width / 2, 0.7, -1.3]) {
          expect(gateAt({ x: point.x + along.x * offset, z: point.z + along.z * offset }, layout)).toBe(g);
        }
        expect(gateAt(g.spawn, layout)).toBeNull();
      }
    }
  });
});

describe('walking the campaign areas', () => {
  it('a random walk never ends up inside something', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      for (const start of [layout.spawn, ...layout.gates.map((g) => g.spawn)]) {
        for (let seed = 1; seed <= 5; seed++) {
          const rnd = mulberry32(seed * 1000 + spec.id.length);
          let pos: Vec2 = { x: start.x, z: start.z };
          let steps = 0;
          while (steps < 600) {
            const angle = rnd() * Math.PI * 2;
            const run = 1 + Math.floor(rnd() * 60);
            for (let i = 0; i < run && steps < 600; i++, steps++) {
              pos = moveWithCollision(pos, { x: Math.cos(angle) * STEP, z: Math.sin(angle) * STEP }, layout);
              if (!free(pos, layout, 0)) throw new Error(`${spec.location}/${spec.id}: stuck in something at ${pos.x}, ${pos.z}`);
            }
          }
        }
      }
    }
  });

  it('walking straight at a gate from any spawn point reaches that gate, well within 30 s', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      for (const target of layout.gates) {
        const goal = gatePointOf(target);
        let pos: Vec2 = { ...layout.spawn };
        let reached: Gate | null = null;
        let steps = 0;
        while (!reached && steps < 1800) {
          const dx = goal.x - pos.x;
          const dz = goal.z - pos.z;
          const left = Math.hypot(dx, dz);
          const d = left <= STEP ? { x: dx, z: dz } : { x: (dx / left) * STEP, z: (dz / left) * STEP };
          pos = moveWithCollision(pos, d, layout);
          reached = gateAt(pos, layout);
          steps += 1;
        }
        expect(reached, `${spec.location}/${spec.id} -> ${target.exitId}`).toBe(target);
        expect(steps).toBeLessThan(600);
      }
    }
  });
});

describe('walkStep', () => {
  const open: AreaLayout = { ...room, walls: [], props: [] };
  const forward = heldKeys(['KeyW']);

  it('walks 5 m/s where the view points and clamps a long frame to 0.1 s', () => {
    expect(walkStep({ x: 0, z: 0 }, 0, forward, 0.05, open).pos).toEqual({ x: 0, z: -0.25 });
    expect(walkStep({ x: 0, z: 0 }, 0, forward, 3, open).pos).toEqual({ x: 0, z: -0.5 });
    expect(walkStep({ x: 0, z: 0 }, 0, heldKeys([]), 0.05, open)).toEqual({ pos: { x: 0, z: 0 }, gate: null });
  });

  it('reports the gate the player walked into', () => {
    expect(walkStep({ x: 2, z: -8.9 }, 0, forward, 0.05, open).gate).toBe(gate);
  });

  it('reads WASD and the arrow keys', () => {
    expect(heldKeys(['ArrowUp', 'KeyA'])).toEqual({ forward: true, back: false, left: true, right: false });
    expect(heldKeys(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'KeyS', 'KeyD', 'KeyM'])).toEqual({ forward: false, back: true, left: true, right: true });
  });
});

describe('turning the view', () => {
  it('limits pitch to 85 degrees and leaves yaw free', () => {
    expect(turnView({ yaw: 0, pitch: 0 }, 10, 5)).toEqual({ yaw: 10, pitch: MAX_PITCH });
    expect(turnView({ yaw: 1, pitch: 0 }, -3, -5)).toEqual({ yaw: -2, pitch: -MAX_PITCH });
  });

  it('turns right and up for mouse travel right and up', () => {
    const turn = mouseTurn(10, -10);
    expect(turn.dYaw).toBeLessThan(0);
    expect(turn.dPitch).toBeGreaterThan(0);
  });

  it('faces a ground point', () => {
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      const n = NORMALS[side];
      const view = { yaw: 2.5, pitch: 0.4 };
      const turn = turnTowards(view, { x: 1, z: 2 }, { x: 1 + n.x * 4, z: 2 + n.z * 4 });
      const after = turnView(view, turn.dYaw, turn.dPitch);
      expect(-Math.sin(after.yaw)).toBeCloseTo(n.x, 9);
      expect(-Math.cos(after.yaw)).toBeCloseTo(n.z, 9);
      expect(after.pitch).toBeCloseTo(0, 12);
    }
  });
});
