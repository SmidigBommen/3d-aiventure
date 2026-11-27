import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_HEIGHT, SPECIAL_LANDMARKS, dressArea, dressSpecOf, moodFor, type DressSpec, type Dressing, type Placement } from './dressing';
import { buildLayout, type AreaLayout, type Box } from './layout';
import {
  MANIFEST, campaignDressSpecs, exitStrip, footprintOf, madeUpSpecs, overlap, rectDistance, scaledSize, signature, spawnSquare, triggerZone, walkerWins,
  type Rectangle,
} from './dressingkit';
import { distanceToBox } from './testkit';

const EPS = 1e-6;
const HEX = /^#[0-9a-f]{6}$/;
const LOCATIONS = ['Rivermeet Town', 'Whispering Woods', 'Abandoned Watchtower', 'Emberforge Mountains', 'Sunken Temple of Dariel', 'Windswept Plains',
  'The Crystalline Caves', 'The Convergence'];

interface Dressed {
  spec: DressSpec;
  layout: AreaLayout;
  dressing: Dressing;
}
const dress = (spec: DressSpec): Dressed => {
  const layout = buildLayout(spec);
  return { spec, layout, dressing: dressArea(layout, spec) };
};
const name = (d: Dressed): string => `${d.spec.location}/${d.spec.id}`;

const CAMPAIGN = campaignDressSpecs().map(dress);
// Seed 7 is the one the acceptance tests use; the others are there so that nothing hangs on one seed.
const MADE_UP = [7, 1, 2, 3, 4, 5].flatMap((seed) => madeUpSpecs(seed, 200)).map(dress);
const ALL = [...CAMPAIGN, ...MADE_UP];

const standing = (d: Dressed): Placement[] => d.dressing.placements.filter((p) => p.role === 'prop' || p.role === 'landmark');
const of = (d: Dressed, landmark: string): Placement[] => d.dressing.placements.filter((p) => p.landmark === landmark);
const boxKey = (b: Box): string => [b.x, b.z, b.halfX, b.halfZ, b.height].map((v) => v.toFixed(6)).join(' ');

afterEach(() => vi.restoreAllMocks());

describe('the model manifest', () => {
  // The files themselves, by name only: nothing is loaded.
  const keys = Object.keys(import.meta.glob('../../public/models/**/*.glb')).map((path) => path.replace(/^.*\/public\/models\//, '').replace(/\.glb$/, ''));

  it('has one entry per .glb file, with a size and a triangle count', () => {
    expect(Object.keys(MANIFEST).sort()).toEqual([...keys].sort());
    expect(keys.length).toBe(176);
    for (const [key, entry] of Object.entries(MANIFEST)) {
      expect(entry.size.length, key).toBe(3);
      for (const v of entry.size) expect(v, key).toBeGreaterThan(0);
      expect(Number.isInteger(entry.triangles) && entry.triangles > 0, key).toBe(true);
    }
  });

  it('measures the reference models as the validation tool does', () => {
    const reference: [string, number[], number][] = [
      ['env/dungeon/wall', [4, 4, 1], 494],
      ['env/dungeon/floor_tile_large', [4, 0.15, 4], 188],
      ['env/town/market_stand', [0.95, 1.05, 1.19], 1548],
      ['env/town/tavern', [1.17, 1.4, 1.33], 2992],
      ['env/wilderness/tree_a', [0.57, 1.2, 0.55], 50],
      ['env/wilderness/campfire', [0.41, 0.11, 0.36], 602],
      ['props/chest', [1.7, 1.3, 1.45], 728],
      ['creatures/goblin', [1.55, 2.98, 1.62], 2462], // a skinned model: the rest pose
    ];
    for (const [key, size, triangles] of reference) {
      size.forEach((v, i) => expect(Math.abs(MANIFEST[key].size[i] - v), key).toBeLessThanOrEqual(0.02));
      expect(MANIFEST[key].triangles, key).toBe(triangles);
    }
  });
});

describe('dressArea', () => {
  it('returns placements of the agreed shape', () => {
    const wrong: string[] = [];
    for (const d of ALL) {
      expect(d.dressing.placements.length, name(d)).toBeGreaterThan(0);
      for (const p of d.dressing.placements) {
        const ok =
          MANIFEST[p.model] !== undefined &&
          ['ground', 'boundary', 'gate', 'prop', 'landmark'].includes(p.role) &&
          (p.landmark !== null) === (p.role === 'landmark') &&
          (p.gate !== null) === (p.role === 'gate') &&
          [p.x, p.y, p.z, p.rotation, ...p.scale].every(Number.isFinite) &&
          p.scale.length === 3 && p.scale.every((v) => v > 0) &&
          (p.tint === null || HEX.test(p.tint));
        if (!ok) wrong.push(`${name(d)} ${JSON.stringify(p)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('gives the same dressing for the same area, without Math.random, and leaves its arguments alone', () => {
    for (const d of [...CAMPAIGN, ...MADE_UP.slice(0, 60)]) {
      const layoutBefore = JSON.stringify(d.layout);
      const specBefore = JSON.stringify(d.spec);
      vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('Math.random was called');
      });
      const again = dressArea(buildLayout(d.spec), { ...d.spec, exits: [...d.spec.exits] });
      vi.restoreAllMocks();
      expect(again, name(d)).toEqual(d.dressing);
      expect(JSON.stringify(d.layout)).toBe(layoutBefore);
      expect(JSON.stringify(d.spec)).toBe(specBefore);
    }
  });

  it('keeps the floor, the gates and the spawn, and blocks with exactly the solid boxes', () => {
    for (const d of ALL) {
      const out = d.dressing.layout;
      expect(out.type).toBe(d.layout.type);
      expect(out.floor).toEqual(d.layout.floor);
      expect(out.ceiling).toBe(d.layout.ceiling);
      expect(out.gates).toEqual(d.layout.gates);
      expect(out.spawn).toEqual(d.layout.spawn);
      const solids = d.dressing.placements.filter((p) => p.solid).map((p) => boxKey(p.solid as Box)).sort();
      expect([...out.walls, ...out.props].map(boxKey).sort(), name(d)).toEqual(solids);
    }
  });

  it('follows the rules of each role', () => {
    const wrong: string[] = [];
    for (const d of ALL) {
      const { halfX, halfZ } = d.layout.floor;
      for (const p of d.dressing.placements) {
        const must = (ok: boolean, rule: string): void => {
          if (!ok) wrong.push(`${name(d)} ${p.role} ${p.model}: ${rule}`);
        };
        const f = footprintOf(p);
        const { H } = scaledSize(p);
        if (p.role === 'ground') {
          must(p.solid === null, 'no solid');
          must(H <= 1 + EPS, 'at most 1 m high');
          must(Math.abs(p.x) <= halfX + EPS && Math.abs(p.z) <= halfZ + EPS, 'centre inside the floor');
        } else if (p.role === 'boundary') {
          must(p.solid === null, 'no solid');
          must(Math.abs(p.x) >= halfX - 0.5 - EPS || Math.abs(p.z) >= halfZ - 0.5 - EPS, 'centre at the edge or outside');
        } else if (p.role === 'gate') {
          must(p.solid === null, 'no solid');
          const gate = d.layout.gates.find((g) => g.exitId === p.gate);
          must(gate !== undefined && Math.hypot(p.x - gate.x, p.z - gate.z) <= 4 + EPS, 'within 4 m of its gate');
        } else {
          must(p.y === 0, 'stands on the floor');
          must(Math.abs(p.x) + f.halfX <= halfX + EPS && Math.abs(p.z) + f.halfZ <= halfZ + EPS, 'footprint inside the floor');
          must(Math.max(...p.scale) / Math.min(...p.scale) <= 1.5 + EPS, 'scale components within 1.5 of each other');
          must(H < 0.5 || p.solid !== null, 'solid when 0.5 m or higher');
        }
        if (p.solid) {
          must(p.solid.x === p.x && p.solid.z === p.z, 'solid centred on the placement');
          must(p.solid.halfX >= f.halfX * 0.2 - EPS && p.solid.halfX <= f.halfX + EPS, 'solid halfX within 20% to 100% of the footprint');
          must(p.solid.halfZ >= f.halfZ * 0.2 - EPS && p.solid.halfZ <= f.halfZ + EPS, 'solid halfZ within 20% to 100% of the footprint');
          must(p.solid.height > 0 && p.solid.height <= H + EPS, 'solid no higher than the model');
        }
        if (d.layout.ceiling !== null && p.role !== 'ground' && p.role !== 'boundary') must(p.y + H <= d.layout.ceiling + EPS, 'under the ceiling');
      }
    }
    expect(wrong).toEqual([]);
  });

  it('dresses every part of an area', () => {
    for (const d of ALL) {
      const count = (role: string): number => d.dressing.placements.filter((p) => p.role === role).length;
      expect(count('ground'), name(d)).toBeGreaterThanOrEqual(8);
      expect(count('boundary'), name(d)).toBeGreaterThanOrEqual(4);
      for (const gate of d.layout.gates) expect(d.dressing.placements.some((p) => p.role === 'gate' && p.gate === gate.exitId), name(d)).toBe(true);
      expect(standing(d).length, name(d)).toBeGreaterThanOrEqual(6);
      expect(new Set(standing(d).map((p) => p.model)).size, name(d)).toBeGreaterThanOrEqual(3);
      const prefix = `env/${d.layout.type}/`;
      expect(d.dressing.placements.some((p) => p.role === 'boundary' && p.model.startsWith(prefix)), name(d)).toBe(true);
    }
  });

  it('puts nothing in the way of gates, spawn points and other props', () => {
    const wrong: string[] = [];
    let closest = Infinity;
    for (const d of ALL) {
      const { halfX, halfZ } = d.layout.floor;
      const spawns = [d.layout.spawn, ...d.layout.gates.map((g) => g.spawn)];
      const zones = d.layout.gates.map(triggerZone);
      const strips = d.layout.gates.map(exitStrip);
      const props = standing(d).map((p) => ({ p, f: footprintOf(p) }));
      const most = (f: Rectangle, others: Rectangle[]): number => Math.max(0, ...others.map((o) => overlap(f, o)));
      const must = (ok: boolean, p: Placement, rule: string): void => {
        if (!ok) wrong.push(`${name(d)} ${p.role} ${p.model}: ${rule}`);
      };
      props.forEach(({ p, f }, i) => {
        must(most(f, zones) <= 0.1, p, 'off the trigger zones');
        must(most(f, spawns.map(spawnSquare)) <= 0.1, p, 'off the spawn squares');
        must(most(f, props.filter((_, j) => j !== i).map((o) => o.f)) <= 0.1, p, 'off the other props');
      });
      for (const p of d.dressing.placements) {
        if (p.role === 'prop' || p.role === 'landmark' || p.role === 'boundary') must(most(footprintOf(p), strips) <= 0.1, p, 'off the exit strips');
        if (!p.solid) continue;
        const solid = p.solid;
        for (const s of spawns) closest = Math.min(closest, distanceToBox(s, solid));
        must(spawns.every((s) => distanceToBox(s, solid) >= 1 - EPS), p, 'solid 1 m from the spawn points');
        must(Math.abs(solid.x) + solid.halfX <= halfX + EPS && Math.abs(solid.z) + solid.halfZ <= halfZ + EPS, p, 'solid inside the floor');
        must(zones.every((zone) => rectDistance(solid, zone) > 0.2), p, 'solid off the trigger zones');
      }
    }
    expect(wrong).toEqual([]);
    expect(closest).toBeGreaterThanOrEqual(1.4); // the margin the dressing keeps, not just the 1 m it must
  });

  it('lets a walker holding W reach every gate from the default spawn and from the gate\'s own spawn', () => {
    for (const d of ALL) {
      for (const gate of d.dressing.layout.gates) {
        expect(walkerWins(d.dressing.layout, d.dressing.layout.spawn, gate), `${name(d)}: spawn to ${gate.exitId}`).toBe(true);
        expect(walkerWins(d.dressing.layout, gate.spawn, gate), `${name(d)}: ${gate.exitId} from its own spawn`).toBe(true);
      }
    }
  });

  it('builds a landmark for each feature of the area, and none without the feature', () => {
    for (const d of ALL) {
      for (const p of d.dressing.placements) if (p.landmark) expect(p.role).toBe('landmark');
      const shop = of(d, 'shop');
      expect(shop.length > 0, name(d)).toBe(d.spec.shop);
      if (d.spec.shop) expect(shop.some((p) => p.model === 'env/town/market_stand' && scaledSize(p).H >= 2), name(d)).toBe(true);

      const rest = of(d, 'rest');
      expect(rest.length > 0, name(d)).toBe(d.spec.rest);
      for (const p of rest) {
        if (d.layout.type === 'town') {
          expect(p.model, name(d)).toBe('env/town/tavern');
          expect(scaledSize(p).H, name(d)).toBeGreaterThanOrEqual(4);
        } else {
          expect(p.model, name(d)).toBe('env/wilderness/campfire');
          expect(Math.min(footprintOf(p).halfX, footprintOf(p).halfZ) * 2, name(d)).toBeGreaterThanOrEqual(0.8);
        }
      }

      const boss = of(d, 'boss');
      if (d.spec.boss) {
        expect(boss.length, name(d)).toBeGreaterThanOrEqual(5);
        expect(boss.some((p) => scaledSize(p).H >= 2), name(d)).toBe(true);
      } else {
        expect(boss.length, name(d)).toBe(0);
      }

      const special = of(d, 'special');
      const model = d.spec.special !== null && Object.hasOwn(SPECIAL_LANDMARKS, d.spec.special) ? SPECIAL_LANDMARKS[d.spec.special] : null;
      expect(special.length > 0, name(d)).toBe(model !== null);
      if (model) expect(special.some((p) => p.model === model), name(d)).toBe(true);
    }
  });

  it('has the table of special landmarks, and the campaign uses all of it', () => {
    expect(SPECIAL_LANDMARKS).toEqual({
      town_center: 'env/town/well',
      water_access: 'env/dungeon/floor_wood_large',
      mysterious_runes: 'env/wilderness/bridge_a',
      hidden_treasure: 'props/chest',
      magical_forge: 'env/town/blacksmith_forge',
      hidden_passage: 'env/dungeon/wall_gated',
      ancient_treasures: 'props/chest_gold',
      wind_blessing: 'env/dungeon/altar_shrine_candles',
      crystal_forest: 'props/crystal_big',
      precious_gems: 'props/crystal_cluster',
      tactical_advantage: 'env/dungeon/stairs_walled',
      prisoner_rescue: 'env/dungeon/fence_iron_bars',
      magical_research: 'props/cabinet',
    });
    const by = (id: string): Dressed => CAMPAIGN.find((d) => d.spec.id === id) as Dressed;
    expect(of(by('market'), 'shop').length).toBe(1);
    expect(of(by('tavern'), 'rest')[0].model).toBe('env/town/tavern');
    expect(of(by('inn_rooms'), 'rest')[0].model).toBe('env/town/tavern');
    expect(of(by('meditation_grove'), 'rest')[0].model).toBe('env/wilderness/campfire');
    expect(CAMPAIGN.filter((d) => d.spec.shop).length).toBe(1);
    expect(CAMPAIGN.filter((d) => d.spec.rest).length).toBe(3);
    expect(CAMPAIGN.filter((d) => of(d, 'boss').length >= 5).length).toBe(CAMPAIGN.filter((d) => d.spec.boss).length);
    expect(CAMPAIGN.filter((d) => of(d, 'special').length > 0).length).toBe(13);
  });

  it('stays within the budget of triangles and models', () => {
    let most = 0;
    for (const d of ALL) {
      const triangles = d.dressing.placements.reduce((sum, p) => sum + MANIFEST[p.model].triangles, 0);
      most = Math.max(most, triangles);
      expect(triangles, name(d)).toBeLessThanOrEqual(110000);
      expect(new Set(d.dressing.placements.map((p) => p.model)).size, name(d)).toBeLessThanOrEqual(36);
    }
    expect(most).toBeGreaterThan(10000);
  });

  it('dresses the areas of one location differently', () => {
    for (const a of CAMPAIGN) {
      for (const b of CAMPAIGN) {
        if (a === b || a.spec.location !== b.spec.location) continue;
        const A = signature(a.dressing.placements);
        const B = signature(b.dressing.placements);
        const shared = [...A].filter((s) => B.has(s)).length;
        expect(1 - shared / Math.max(A.size, B.size), `${name(a)} and ${name(b)}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it('leaves room for the sign between a dungeon\'s gateway and its ceiling, down to the lowest ceiling', () => {
    const ceilings = new Set<number>();
    for (const d of ALL) {
      if (d.layout.ceiling === null) continue;
      ceilings.add(d.layout.ceiling);
      for (const p of d.dressing.placements.filter((q) => q.role === 'gate')) {
        const top = p.y + scaledSize(p).H;
        expect(top + SIGN_HEIGHT + 0.02, name(d)).toBeLessThanOrEqual(d.layout.ceiling - 0.02);
        expect(top, name(d)).toBeGreaterThanOrEqual(2.5);
      }
    }
    expect(Math.min(...ceilings)).toBe(3.5);
  });

  it('opens every gateway as wide as its gate', () => {
    // The arch's legs stand 3 file units apart (measured in the file); its scale along the gate must make that the gate's width.
    for (const d of CAMPAIGN) {
      for (const gate of d.layout.gates) {
        const arch = d.dressing.placements.find((p) => p.role === 'gate' && p.gate === gate.exitId) as Placement;
        expect(arch.model).toBe('env/dungeon/arch_stone');
        expect(3 * arch.scale[0]).toBeCloseTo(gate.width, 6);
        const f = footprintOf(arch);
        const alongX = gate.side === 'north' || gate.side === 'south';
        expect((alongX ? f.halfX : f.halfZ) * 2, `${name(d)} ${gate.side}`).toBeCloseTo(4.22 * arch.scale[0], 2);
        expect(alongX ? arch.x : arch.z).toBe(alongX ? gate.x : gate.z);
      }
    }
  });
});

describe('moodFor', () => {
  const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a: string, b: string): number => channels(a).reduce((sum, v, i) => sum + Math.abs(v - channels(b)[i]), 0);
  const luminance = (hex: string): number => channels(hex).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

  it('gives a valid mood for every location and for an unknown one of each type', () => {
    const moods = [...LOCATIONS.map((l) => moodFor(l, 'wilderness')), ...['town', 'wilderness', 'dungeon', 'swamp'].map((t) => moodFor('Nowhere', t))];
    for (const m of moods) {
      for (const colour of [m.sky, m.fog, m.light, m.ground]) expect(colour).toMatch(HEX);
      expect(m.fogNear).toBeGreaterThanOrEqual(2);
      expect(m.fogFar).toBeGreaterThan(m.fogNear);
      expect(m.fogFar).toBeGreaterThanOrEqual(25);
      expect(m.intensity).toBeGreaterThanOrEqual(0.2);
      expect(m.intensity).toBeLessThanOrEqual(4);
    }
    expect(moodFor('The Convergence', 'dungeon')).toEqual(moodFor('The Convergence', 'dungeon'));
    expect(moodFor('toString', 'town')).toEqual(moodFor('Nowhere', 'town'));
  });

  it('tells the eight locations apart, with The Convergence the darkest', () => {
    for (const a of LOCATIONS) {
      for (const b of LOCATIONS) {
        if (a === b) continue;
        const [m, n] = [moodFor(a, ''), moodFor(b, '')];
        expect(distance(m.sky, n.sky) + distance(m.fog, n.fog) + distance(m.light, n.light) + distance(m.ground, n.ground), `${a} and ${b}`).toBeGreaterThanOrEqual(120);
      }
    }
    const last = moodFor('The Convergence', 'dungeon');
    for (const other of LOCATIONS.slice(0, -1).map((l) => moodFor(l, ''))) {
      expect(last.intensity).toBeLessThan(other.intensity);
      expect(luminance(last.sky)).toBeLessThan(luminance(other.sky));
    }
  });

  it('is the mood of the dressing', () => {
    for (const d of ALL) expect(d.dressing.mood).toEqual(moodFor(d.spec.location, d.spec.type));
  });
});

describe('dressSpecOf', () => {
  it('reads the features from the answer of the server', () => {
    expect(dressSpecOf({
      location: { name: 'Rivermeet Town', type: 'town' },
      area: { id: 'market', has_shop: true, can_rest: false, is_boss_area: false, special: 'shop_location' },
      exits: [{ id: 'town_square' }, { id: 'docks' }],
    })).toEqual({ location: 'Rivermeet Town', type: 'town', id: 'market', exits: ['town_square', 'docks'], shop: true, rest: false, boss: false, special: 'shop_location' });
  });
});
