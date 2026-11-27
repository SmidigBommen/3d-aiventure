import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT, GATE_DEPTH, GATE_SPAWN_DISTANCE, GATE_WIDTH, PLAYER_RADIUS, WALK_SPEED,
  boundaryRuns, buildLayout, spawnPoint, type AreaLayout, type AreaSpec,
} from './layout';
import { NORMALS, boxToZone, boxes, campaignAreas, distanceToBox, gatePointOf, inTriggerZone, mulberry32, walkable } from './testkit';

const AREAS = campaignAreas();

/** Guarantees 2 to 8 of the specification, measured with a margin `m` (0 = as specified). */
function check(spec: AreaSpec, layout: AreaLayout, m: number): void {
  const { halfX, halfZ } = layout.floor;
  const label = `${spec.location}/${spec.id}`;
  for (const half of [halfX, halfZ]) {
    expect(half, label).toBeGreaterThanOrEqual(10);
    expect(half, label).toBeLessThanOrEqual(20);
  }

  expect(layout.gates.map((g) => g.exitId), label).toEqual(spec.exits);
  layout.gates.forEach((gate, i) => {
    expect(gate.width).toBe(GATE_WIDTH);
    const alongX = gate.side === 'north' || gate.side === 'south';
    if (alongX) expect(gate.z, label).toBe(gate.side === 'north' ? -halfZ : halfZ);
    else expect(gate.x, label).toBe(gate.side === 'west' ? -halfX : halfX);
    expect(Math.abs(alongX ? gate.x : gate.z), label).toBeLessThanOrEqual((alongX ? halfX : halfZ) - 2.5 - m);
    for (const other of layout.gates.slice(i + 1)) {
      expect(Math.hypot(gate.x - other.x, gate.z - other.z), label).toBeGreaterThanOrEqual(4 + m);
    }
    const n = NORMALS[gate.side];
    expect(gate.spawn, label).toEqual({ x: gate.x + n.x * GATE_SPAWN_DISTANCE, z: gate.z + n.z * GATE_SPAWN_DISTANCE });
    expect(Math.hypot(gate.x - layout.spawn.x, gate.z - layout.spawn.z), label).toBeGreaterThanOrEqual(3 + m);
  });

  for (const point of [layout.spawn, ...layout.gates.map((g) => g.spawn)]) {
    for (const box of boxes(layout)) expect(distanceToBox(point, box), label).toBeGreaterThanOrEqual(1 + m);
    expect(halfX - Math.abs(point.x), label).toBeGreaterThanOrEqual(1 + m);
    expect(halfZ - Math.abs(point.z), label).toBeGreaterThanOrEqual(1 + m);
    for (const gate of layout.gates) expect(inTriggerZone(point, gate, layout), label).toBe(false);
  }

  // The straight line from the default spawn is kept clear, which is stricter than the specification asks.
  const grow = <T extends { halfX: number; halfZ: number }>(box: T): T => ({ ...box, halfX: box.halfX + m, halfZ: box.halfZ + m });
  const fatter = { ...layout, walls: layout.walls.map(grow), props: layout.props.map(grow) };
  for (const gate of layout.gates) {
    expect(walkable(layout.spawn, gatePointOf(gate), fatter), label).toBe(true);
    expect(walkable(gate.spawn, gatePointOf(gate), fatter), label).toBe(true);
  }

  for (const box of boxes(layout)) {
    expect(box.halfX, label).toBeGreaterThanOrEqual(0.25);
    expect(box.halfZ, label).toBeGreaterThanOrEqual(0.25);
    expect(box.height, label).toBeGreaterThan(0);
    expect(Math.abs(box.x) + box.halfX, label).toBeLessThanOrEqual(halfX);
    expect(Math.abs(box.z) + box.halfZ, label).toBeLessThanOrEqual(halfZ);
    for (const gate of layout.gates) expect(boxToZone(box, gate), label).toBeGreaterThan(m);
  }

  const kinds = (kind: string): number => layout.props.filter((p) => p.kind === kind).length;
  const allowed = { town: ['house', 'crate'], wilderness: ['tree', 'rock'], dungeon: ['pillar', 'brazier', 'rock'] }[layout.type];
  for (const prop of layout.props) expect(allowed, label).toContain(prop.kind);
  if (layout.type === 'town') {
    expect(kinds('house'), label).toBeGreaterThanOrEqual(2);
    expect(layout.ceiling).toBeNull();
  } else if (layout.type === 'wilderness') {
    expect(kinds('tree'), label).toBeGreaterThanOrEqual(3);
    expect(kinds('rock'), label).toBeGreaterThanOrEqual(1);
    expect(layout.ceiling).toBeNull();
  } else {
    expect(layout.ceiling, label).toBeGreaterThanOrEqual(3.5);
    expect(layout.ceiling, label).toBeLessThanOrEqual(6);
    expect(kinds('brazier'), label).toBeGreaterThanOrEqual(2);
  }
}

describe('constants', () => {
  it('are the ones the server and the tests agree on', () => {
    expect([WALK_SPEED, EYE_HEIGHT, GATE_WIDTH, PLAYER_RADIUS, GATE_DEPTH, GATE_SPAWN_DISTANCE]).toEqual([5, 1.7, 3, 0.4, 1, 2.5]);
  });
});

describe('buildLayout', () => {
  it('covers the 51 campaign areas', () => {
    expect(AREAS.length).toBe(51);
  });

  it('gives every campaign area a layout that keeps the guarantees, with 0.4 m to spare', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      expect(layout.type).toBe(spec.type);
      check(spec, layout, 0.4);
    }
  });

  it('is the same every time, and does not touch its input', () => {
    for (const spec of AREAS) {
      const copy = JSON.parse(JSON.stringify(spec));
      expect(buildLayout(spec)).toEqual(buildLayout(copy));
      expect(spec).toEqual(copy);
    }
  });

  it('differs between areas, also between two areas with the same id', () => {
    const layouts = AREAS.map(buildLayout);
    expect(new Set(layouts.map((l) => `${l.floor.halfX}x${l.floor.halfZ}`)).size).toBeGreaterThanOrEqual(20);
    expect(new Set(layouts.map((l) => l.props.length)).size).toBeGreaterThanOrEqual(7);
    const courtyards = AREAS.filter((a) => a.id === 'courtyard');
    expect(courtyards.length).toBe(2);
    expect(buildLayout(courtyards[0]).floor).not.toEqual(buildLayout(courtyards[1]).floor);
  });

  it('treats an unknown type as wilderness', () => {
    const layout = buildLayout({ location: 'Nowhere', type: 'swamp', id: 'bog', exits: ['a'] });
    expect(layout.type).toBe('wilderness');
    expect(layout.ceiling).toBeNull();
  });

  it('keeps the guarantees for made-up areas of every type with 0 to 4 exits', () => {
    const rnd = mulberry32(7);
    const types = ['town', 'wilderness', 'dungeon', 'other'];
    for (let i = 0; i < 4000; i++) {
      const exits = ['a', 'b', 'c', 'd'].slice(0, i % 5);
      const spec = { location: `L${Math.floor(rnd() * 1e9)}`, type: types[i % 4], id: `area${i}`, exits };
      check(spec, buildLayout(spec), 0.4);
    }
  });
});

describe('boundaryRuns', () => {
  it('covers each edge except the gate openings', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      const runs = boundaryRuns(layout);
      for (const side of ['north', 'south', 'east', 'west'] as const) {
        const half = side === 'north' || side === 'south' ? layout.floor.halfX : layout.floor.halfZ;
        const covered = runs.filter((r) => r.side === side).reduce((sum, r) => sum + (r.to - r.from), 0);
        const open = layout.gates.filter((g) => g.side === side).length * GATE_WIDTH;
        expect(covered + open).toBeCloseTo(2 * half, 9);
        for (const run of runs.filter((r) => r.side === side)) {
          expect(run.to).toBeGreaterThan(run.from);
          for (const gate of layout.gates.filter((g) => g.side === side)) {
            const c = side === 'north' || side === 'south' ? gate.x : gate.z;
            expect(run.to <= c - GATE_WIDTH / 2 || run.from >= c + GATE_WIDTH / 2).toBe(true);
          }
        }
      }
    }
  });
});

describe('spawnPoint', () => {
  it('puts the player inside the gate that leads back, facing into the area', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      for (const gate of layout.gates) {
        const s = spawnPoint(layout, gate.exitId);
        expect({ x: s.x, z: s.z }).toEqual(gate.spawn);
        expect(-Math.sin(s.yaw)).toBeCloseTo(NORMALS[gate.side].x, 9);
        expect(-Math.cos(s.yaw)).toBeCloseTo(NORMALS[gate.side].z, 9);
      }
    }
  });

  it('uses the default spawn facing the first gate otherwise', () => {
    for (const spec of AREAS) {
      const layout = buildLayout(spec);
      const g = layout.gates[0];
      const yaw = Math.atan2(-(g.x - layout.spawn.x), -(g.z - layout.spawn.z));
      for (const from of [null, 'no-such-area']) {
        expect(spawnPoint(layout, from)).toEqual({ x: layout.spawn.x, z: layout.spawn.z, yaw });
      }
    }
    const empty = buildLayout({ location: 'X', type: 'town', id: 'y', exits: [] });
    expect(spawnPoint(empty, null).yaw).toBe(0);
  });
});
