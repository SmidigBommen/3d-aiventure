import { describe, expect, it } from 'vitest';
import bosses from '../../../json/bosses.json';
import campaign from '../../../json/campaign.json';
import eventObjects from '../../../json/event_objects.json';
import events from '../../../json/events.json';
import type { Vec2 } from '../input/movement';
import {
  BOSS_SCALE, CONTACT_RANGE, CREATURES, EVENT_OBJECTS, PROMPT_RANGE, SEARCH_MARKERS, contentSolids, creatureLook, interactionAt, objectLook,
  type AreaContents,
} from './contents';
import { dressArea } from './dressing';
import { MANIFEST, campaignDressSpecs, madeUpSpecs, triggerZone } from './dressingkit';
import { buildLayout, type AreaLayout, type Box, type ContentSlots } from './layout';
import { distanceToBox, gatePointOf } from './testkit';

// --- measuring helpers, written from the specification ---------------------------------------------

/** The cells (0.1 m grid) a walker reaches from `from`, with `extra` boxes standing in the layout. */
function flood(layout: AreaLayout, from: Vec2, extra: Box[] = []): Vec2[] {
  const { halfX, halfZ } = layout.floor;
  const boxes = [...layout.walls, ...layout.props, ...extra];
  const nx = Math.floor(halfX / 0.1);
  const nz = Math.floor(halfZ / 0.1);
  const width = nx * 2 + 1;
  const at = (i: number, j: number): Vec2 => ({ x: i * 0.1, z: j * 0.1 });
  const free = (i: number, j: number): boolean => {
    const p = at(i, j);
    if (Math.abs(p.x) > halfX - 0.4 + 1e-6 || Math.abs(p.z) > halfZ - 0.4 + 1e-6) return false;
    return boxes.every((b) => distanceToBox(p, b) >= 0.4 - 1e-6);
  };
  let start: [number, number] | null = null;
  let best = Infinity;
  for (let j = -nz; j <= nz; j++) {
    for (let i = -nx; i <= nx; i++) {
      const d = Math.hypot(i * 0.1 - from.x, j * 0.1 - from.z);
      if (d < best && d < 3 && free(i, j)) {
        best = d;
        start = [i, j];
      }
    }
  }
  if (!start) return [];
  const seen = new Uint8Array(width * (nz * 2 + 1));
  const key = (i: number, j: number): number => (j + nz) * width + (i + nx);
  const queue: [number, number][] = [start];
  seen[key(...start)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const [i, j] = queue[head];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (Math.abs(a) > nx || Math.abs(b) > nz || seen[key(a, b)] || !free(a, b)) continue;
      seen[key(a, b)] = 1;
      queue.push([a, b]);
    }
  }
  return queue.map(([i, j]) => at(i, j));
}
const visits = (cells: Vec2[], p: Vec2, r: number): boolean => cells.some((c) => Math.hypot(c.x - p.x, c.z - p.z) <= r);
const between = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const listed = (slots: ContentSlots): Vec2[] => [slots.monster, slots.event, slots.search, ...(slots.boss ? [slots.boss] : [])];

const CAMPAIGN = campaignDressSpecs().map((spec) => ({ spec, name: `${spec.location}/${spec.id}`, dressing: dressArea(buildLayout(spec), spec) }));
const FULL: AreaContents = {
  seq: 1, monster: null, search_spot: true,
  event: { id: 'e', title: 'T', object: 'chest', label: 'the chest' },
  boss: { id: 'b', name: 'B', level: 5, locked: false, locked_text: null },
};

describe('the slots of the campaign areas', () => {
  it('exist in the dressed layout only, the boss slot exactly in the boss areas, the same every time', () => {
    expect(CAMPAIGN.length).toBe(51);
    // Eight areas hold a boss; the ninth boss (Lady Vex) is met on the road.
    expect(CAMPAIGN.filter((a) => a.dressing.layout.slots?.boss).length).toBe(8);
    for (const { spec, name, dressing } of CAMPAIGN) {
      expect(buildLayout(spec).slots, name).toBeNull();
      const slots = dressing.layout.slots as ContentSlots;
      expect(slots, name).not.toBeNull();
      expect(slots.boss !== null, name).toBe(spec.boss);
      for (const p of listed(slots)) expect(Number.isFinite(p.x) && Number.isFinite(p.z), name).toBe(true);
      expect(dressArea(buildLayout(spec), spec).layout.slots, name).toEqual(slots);
    }
  });

  it('S1-S3, S6: away from spawns and gates, inside the edge, clear of the solids, apart, the boss in its arena', () => {
    for (const { name, dressing } of CAMPAIGN) {
      const layout = dressing.layout;
      const slots = layout.slots as ContentSlots;
      const all = listed(slots);
      for (const p of all) {
        for (const s of [layout.spawn, ...layout.gates.map((g) => g.spawn)]) expect(between(p, s), name).toBeGreaterThanOrEqual(5.2);
        for (const g of layout.gates) expect(distanceToBox(p, { ...triggerZone(g), height: 0 }), name).toBeGreaterThanOrEqual(5.2);
        expect(Math.abs(p.x), name).toBeLessThanOrEqual(layout.floor.halfX - 1.5);
        expect(Math.abs(p.z), name).toBeLessThanOrEqual(layout.floor.halfZ - 1.5);
        for (const b of [...layout.walls, ...layout.props]) expect(distanceToBox(p, b), name).toBeGreaterThanOrEqual(1.1);
      }
      all.forEach((a, i) => all.slice(i + 1).forEach((b) => expect(between(a, b), name).toBeGreaterThanOrEqual(4.2)));
      if (slots.boss) {
        const arena = dressing.placements.find((p) => p.landmark === 'boss');
        expect(arena, name).toBeDefined();
        expect(between(slots.boss, arena as Vec2), name).toBeLessThanOrEqual(4.3);
      }
    }
  });

  it('S4, S5: every slot is reached from every spawn, and what blocks closes no way', { timeout: 120_000 }, () => {
    for (const { name, dressing } of CAMPAIGN) {
      const layout = dressing.layout;
      const slots = layout.slots as ContentSlots;
      const solids = contentSolids(slots, FULL);
      expect(solids.length, name).toBe(slots.boss ? 2 : 1);
      for (const spawn of [layout.spawn, ...layout.gates.map((g) => g.spawn)]) {
        const plain = flood(layout, spawn);
        for (const p of listed(slots)) expect(visits(plain, p, 0.3), name).toBe(true);
        const blocked = flood(layout, spawn, solids);
        for (const p of listed(slots)) expect(visits(blocked, p, 2), name).toBe(true);
        for (const g of layout.gates) {
          const zone = triggerZone(g);
          expect(blocked.some((c) => Math.abs(c.x - zone.x) <= zone.halfX && Math.abs(c.z - zone.z) <= zone.halfZ), name).toBe(true);
        }
      }
    }
  });

  it('what starts a fight on contact or blocks stands off the straight lines to the gates', () => {
    const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
      const length2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length2));
      return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.z - (a.z + (b.z - a.z) * t));
    };
    for (const { name, dressing } of CAMPAIGN) {
      const layout = dressing.layout;
      const slots = layout.slots as ContentSlots;
      for (const gate of layout.gates) {
        const goal = gatePointOf(gate);
        for (const from of [layout.spawn, gate.spawn]) {
          expect(toSegment(slots.monster, from, goal), name).toBeGreaterThanOrEqual(CONTACT_RANGE + 0.5);
          expect(toSegment(slots.event, from, goal), name).toBeGreaterThanOrEqual(1.5);
          if (slots.boss) expect(toSegment(slots.boss, from, goal), name).toBeGreaterThanOrEqual(1.7);
        }
      }
    }
  });

  it('areas of no campaign get slots too', { timeout: 60_000 }, () => {
    for (const spec of madeUpSpecs(7, 150)) {
      const { layout } = dressArea(buildLayout(spec), spec);
      const slots = layout.slots as ContentSlots;
      expect(slots).not.toBeNull();
      expect(slots.boss !== null).toBe(spec.boss);
      for (const p of listed(slots)) expect(Math.abs(p.x) <= layout.floor.halfX && Math.abs(p.z) <= layout.floor.halfZ).toBe(true);
    }
  });
});

describe('interactionAt', () => {
  const slots: ContentSlots = { monster: { x: 0, z: 0 }, event: { x: 10, z: 0 }, search: { x: 0, z: 10 }, boss: { x: 10, z: 10 } };
  const layout: AreaLayout = { type: 'wilderness', floor: { halfX: 20, halfZ: 20 }, ceiling: null, walls: [], props: [], gates: [], spawn: { x: 5, z: 5 }, slots };
  const monster = { id: 'm-1', race: 'Goblin', name: 'Grak', level: 2 };
  const event = { id: 'mossy_shrine', title: 'The Mossy Shrine', object: 'shrine', label: 'the old shrine' };
  const boss = { id: 'Shard Guardian', name: 'The Shard Guardian', level: 5, locked: false, locked_text: null };
  const contents = (over: Partial<AreaContents>): AreaContents => ({ seq: 1, monster: null, event: null, boss: null, search_spot: true, ...over });

  it('is null without contents, without slots, or with nothing in range', () => {
    expect(interactionAt({ x: 0, z: 0 }, layout, null)).toBeNull();
    expect(interactionAt({ x: 0, z: 0 }, { ...layout, slots: null }, contents({ monster }))).toBeNull();
    expect(interactionAt({ x: 5, z: 5 }, layout, contents({ monster, event, boss }))).toBeNull();
    expect(interactionAt({ x: 0, z: 0 }, layout, contents({}))).toBeNull();
  });

  it('prompts within 3 m and no further', () => {
    expect(PROMPT_RANGE).toBe(3);
    expect(interactionAt({ x: 3, z: 0 }, layout, contents({ monster }))?.prompt).toBe('E: fight Grak the Goblin');
    expect(interactionAt({ x: 3.01, z: 0 }, layout, contents({ monster }))).toBeNull();
  });

  it('describes each kind', () => {
    expect(interactionAt({ x: 2, z: 0 }, layout, contents({ monster }))).toEqual(
      { kind: 'monster', id: 'm-1', prompt: 'E: fight Grak the Goblin', auto: false, locked: false, x: 0, z: 0 });
    expect(interactionAt({ x: 10, z: 0.2 }, layout, contents({ event }))).toEqual(
      { kind: 'event', id: 'mossy_shrine', prompt: 'E: look at the old shrine', auto: false, locked: false, x: 10, z: 0 });
    expect(interactionAt({ x: 10, z: 10 }, layout, contents({ boss }))).toEqual(
      { kind: 'boss', id: 'Shard Guardian', prompt: 'E: challenge The Shard Guardian', auto: false, locked: false, x: 10, z: 10 });
    expect(interactionAt({ x: 0, z: 9 }, layout, contents({}))).toEqual(
      { kind: 'search', id: null, prompt: 'E: search further', auto: false, locked: false, x: 0, z: 10 });
  });

  it('starts a fight on contact with a monster only', () => {
    expect(CONTACT_RANGE).toBe(1.2);
    expect(interactionAt({ x: 1.2, z: 0 }, layout, contents({ monster }))?.auto).toBe(true);
    expect(interactionAt({ x: 1.21, z: 0 }, layout, contents({ monster }))?.auto).toBe(false);
    expect(interactionAt({ x: 10, z: 10 }, layout, contents({ boss }))?.auto).toBe(false);
  });

  it('shows the locked text of a locked boss', () => {
    const hit = interactionAt({ x: 10, z: 9 }, layout, contents({ boss: { ...boss, locked: true, locked_text: 'Barred.' } }));
    expect(hit).toMatchObject({ kind: 'boss', prompt: 'Barred.', locked: true, auto: false });
  });

  it('has no search while a monster or event is present, or without a search spot', () => {
    expect(interactionAt({ x: 0, z: 10 }, layout, contents({ monster }))).toBeNull();
    expect(interactionAt({ x: 0, z: 10 }, layout, contents({ event }))).toBeNull();
    expect(interactionAt({ x: 0, z: 10 }, layout, contents({ search_spot: false }))).toBeNull();
    expect(interactionAt({ x: 0, z: 10 }, layout, contents({ boss }))?.kind).toBe('search');
  });

  it('takes the nearest; a tie goes monster, event, boss, search', () => {
    const close: AreaLayout = { ...layout, slots: { monster: { x: -1, z: 0 }, event: { x: 1, z: 0 }, search: { x: 0, z: -1 }, boss: { x: 0, z: 1 } } };
    expect(interactionAt({ x: 0, z: 0 }, close, contents({ monster, event, boss }))?.kind).toBe('monster');
    expect(interactionAt({ x: 0, z: 0 }, close, contents({ event, boss }))?.kind).toBe('event');
    expect(interactionAt({ x: 0, z: 0 }, close, contents({ boss }))?.kind).toBe('boss');
    expect(interactionAt({ x: 0.5, z: 0 }, close, contents({ monster, event, boss }))?.kind).toBe('event');
    expect(interactionAt({ x: 0, z: 0.5 }, close, contents({ monster, event, boss }))?.kind).toBe('boss');
  });
});

describe('contentSolids', () => {
  const slots: ContentSlots = { monster: { x: 0, z: 0 }, event: { x: 10, z: 1 }, search: { x: 0, z: 10 }, boss: { x: 9, z: 10 } };
  it('blocks at the event object and the boss, nowhere else', () => {
    expect(contentSolids(slots, null)).toEqual([]);
    expect(contentSolids(slots, { ...FULL, event: null, boss: null, monster: { id: 'm', race: 'Orc', name: 'Ug', level: 1 } })).toEqual([]);
    expect(contentSolids(slots, FULL)).toEqual([
      { x: 10, z: 1, halfX: 0.5, halfZ: 0.5, height: 1 },
      { x: 9, z: 10, halfX: 0.7, halfZ: 0.7, height: 2 },
    ]);
    expect(contentSolids({ ...slots, boss: null }, FULL)).toEqual([{ x: 10, z: 1, halfX: 0.5, halfZ: 0.5, height: 1 }]);
  });
});

describe('the tables', () => {
  it('have a creature for every campaign race and every boss', () => {
    const races = new Set(campaign.acts.flatMap((act) => act.locations.flatMap((loc) => loc.areas.flatMap((a) => (a as { monster_types?: string[] }).monster_types ?? []))));
    for (const key of [...races, ...Object.keys(bosses)]) {
      expect(Object.keys(CREATURES), key).toContain(key);
      const look = CREATURES[key];
      expect(Object.keys(MANIFEST), key).toContain(look.model);
      expect(look.scale).toBeGreaterThan(0);
      expect(look.opacity > 0 && look.opacity <= 1).toBe(true);
    }
    expect(Object.keys(CREATURES).length).toBe(21);
    expect(CREATURES['Wind Specter']).toEqual({ model: 'creatures/ghost', scale: 0.59, tint: '#bfe8ff', opacity: 0.6, emissive: null });
    expect(CREATURES['Crystal Golem'].emissive).toBe('#1a4a66');
    expect(creatureLook('no such thing')).toBe(CREATURES.Goblin);
    expect(creatureLook('toString')).toBe(CREATURES.Goblin);
    expect(BOSS_SCALE).toBe(1.25);
  });

  it('have an object for every kind, and a kind for every event', () => {
    const kinds = ['chest', 'treasure', 'shrine', 'altar', 'traveller', 'townsfolk', 'spirit', 'trap', 'rubble', 'tracks', 'snare', 'herbs', 'bridge',
      'runestone', 'forge', 'crystal', 'doorway', 'lookout', 'bars', 'book'];
    expect(Object.keys(EVENT_OBJECTS).sort()).toEqual([...kinds].sort());
    for (const look of [...Object.values(EVENT_OBJECTS), ...Object.values(SEARCH_MARKERS)]) {
      expect(Object.keys(MANIFEST)).toContain(look.model);
      expect(look.height >= 0.3 && look.height <= 2.5).toBe(true);
    }
    expect(objectLook('no such thing')).toBe(EVENT_OBJECTS.chest);
    const table = eventObjects as Record<string, { object: string; label: string }>;
    expect(Object.keys(table).sort()).toEqual(Object.keys(events).sort());
    for (const entry of Object.values(table)) expect(kinds).toContain(entry.object);
  });
});
