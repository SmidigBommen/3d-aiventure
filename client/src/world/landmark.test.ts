import { describe, expect, it } from 'vitest';
import campaign from '../../../json/campaign.json';
import events from '../../../json/events.json';
import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { contentSolids, eventPlace, fightSlot, interactionAt, remainsOf, type AreaContents, type EventContent } from './contents';
import { SPECIAL_LANDMARKS, dressArea } from './dressing';
import { campaignDressSpecs, footprintOf, madeUpSpecs, triggerZone } from './dressingkit';
import { boxDistance, buildLayout, type AreaLayout, type Box, type ContentSlots } from './layout';

// --- measuring helpers, written from the specification ---------------------------------------------

/** Whether a walker gets from `from` to `to`: cells 0.25 m apart counted from `origin`, free when 0.4 m from every solid and the edge. */
function walks(layout: AreaLayout, from: Vec2, to: Vec2, origin: number): boolean {
  const { halfX, halfZ } = layout.floor;
  const step = 0.25;
  const cellOf = (p: Vec2): [number, number] => [Math.round((p.x - origin) / step), Math.round((p.z - origin) / step)];
  const free = (i: number, j: number): boolean => {
    const p = { x: origin + i * step, z: origin + j * step };
    if (Math.abs(p.x) > halfX - 0.4 || Math.abs(p.z) > halfZ - 0.4) return false;
    return layout.props.every((box) => boxDistance(p, box) >= 0.4);
  };
  const [gi, gj] = cellOf(to);
  const start = cellOf(from);
  if (!free(...start) || !free(gi, gj)) return false;
  const seen = new Set<string>([start.join()]);
  const queue: [number, number][] = [start];
  for (let head = 0; head < queue.length; head++) {
    const [i, j] = queue[head];
    if (i === gi && j === gj) return true;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (seen.has(`${a},${b}`) || !free(a, b)) continue;
      seen.add(`${a},${b}`);
      queue.push([a, b]);
    }
  }
  return false;
}

const DISCOVERIES = new Set(Object.values(events as Record<string, { special?: string }>).map((e) => e.special).filter(Boolean));

function measure(spec: ReturnType<typeof campaignDressSpecs>[number], name: string): boolean {
  const dressing = dressArea(buildLayout(spec), spec);
  const layout = dressing.layout;
  const slots = layout.slots as ContentSlots;
  const placement = dressing.placements.find((p) => p.landmark === 'special');
  expect(slots.landmark !== null, name).toBe(placement !== undefined);
  if (!placement || !slots.landmark) return false;
  const point = slots.landmark;
  expect(isFree(point, layout), name).toBe(true);
  const box: Box = placement.solid ?? { ...footprintOf(placement), height: 0 };
  expect(boxDistance(point, box), name).toBeLessThanOrEqual(2);
  for (const gate of layout.gates) {
    expect(boxDistance(point, { ...triggerZone(gate), height: 0 }), name).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(point.x - gate.spawn.x, point.z - gate.spawn.z), name).toBeGreaterThanOrEqual(1.5);
  }
  expect(Math.hypot(point.x - layout.spawn.x, point.z - layout.spawn.z), name).toBeGreaterThanOrEqual(1.5);
  for (const origin of [0, 0.1, -layout.floor.halfX]) expect(walks(layout, layout.spawn, point, origin), `${name} from ${origin}`).toBe(true);
  expect(dressArea(buildLayout(spec), spec).layout.slots?.landmark, name).toEqual(point);
  return true;
}

describe('the standing point at the special landmark', () => {
  it('exists exactly where the landmark stands, in all eleven areas of a discovery, and keeps its rules', { timeout: 120_000 }, () => {
    const specs = campaignDressSpecs();
    expect(specs.length).toBe(51);
    expect(DISCOVERIES.size).toBe(11);
    let discoveries = 0;
    for (const spec of specs) {
      const has = measure(spec, `${spec.location}/${spec.id}`);
      if (spec.special !== null && DISCOVERIES.has(spec.special)) {
        expect(has, `${spec.location}/${spec.id}`).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(SPECIAL_LANDMARKS, spec.special)).toBe(true);
        discoveries++;
      }
    }
    expect(discoveries).toBe(11);
    expect(campaign.acts.length).toBe(3);
  });

  it('keeps its rules in areas of no campaign', { timeout: 120_000 }, () => {
    let seen = 0;
    for (const spec of madeUpSpecs(11, 150)) if (measure(spec, `${spec.type}/${spec.id}/${spec.special}`)) seen++;
    expect(seen).toBeGreaterThan(20);
  });

  it('leaves the player room beside what stands on the other slots', () => {
    for (const spec of campaignDressSpecs()) {
      const slots = dressArea(buildLayout(spec), spec).layout.slots as ContentSlots;
      if (!slots.landmark) continue;
      for (const other of [slots.monster, slots.event, slots.search, ...(slots.boss ? [slots.boss] : [])]) {
        expect(Math.hypot(other.x - slots.landmark.x, other.z - slots.landmark.z), `${spec.location}/${spec.id}`).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});

describe('discoveries and what is left of an event', () => {
  const slots: ContentSlots = { monster: { x: 0, z: 0 }, event: { x: 10, z: 0 }, search: { x: 0, z: 10 }, boss: { x: 10, z: 10 }, landmark: { x: -10, z: 0 }, rest: null, shop: null, travel: null };
  const layout: AreaLayout = { type: 'town', floor: { halfX: 20, halfZ: 20 }, ceiling: null, walls: [], props: [], gates: [], spawn: { x: 5, z: 5 }, slots };
  const chest: EventContent = { id: 'abandoned_chest', title: 'An Abandoned Chest', object: 'chest', label: 'the abandoned chest', landmark: false };
  const runes: EventContent = { id: 'bridge_runes', title: 'Runes', object: 'runestone', label: 'the carved runes', landmark: true };
  const contents = (over: Partial<AreaContents>): AreaContents => ({ seq: 1, monster: null, event: null, spent: null, boss: null, search_spot: false, ...over });

  it('eventPlace: the landmark point for a discovery that has one, else the event slot', () => {
    expect(eventPlace(slots, runes)).toEqual({ x: -10, z: 0 });
    expect(eventPlace(slots, chest)).toEqual({ x: 10, z: 0 });
    expect(eventPlace({ ...slots, landmark: null }, runes)).toEqual({ x: 10, z: 0 });
  });

  it('interactionAt: a discovery prompts at the landmark and not at the event slot', () => {
    expect(interactionAt({ x: -10, z: 3 }, layout, contents({ event: runes }))).toEqual(
      { kind: 'event', id: 'bridge_runes', prompt: 'E: look at the carved runes', auto: false, locked: false, x: -10, z: 0 });
    expect(interactionAt({ x: -10, z: 3.01 }, layout, contents({ event: runes }))).toBeNull();
    expect(interactionAt({ x: 10, z: 0 }, layout, contents({ event: runes }))).toBeNull();
    expect(interactionAt({ x: 10, z: 1 }, layout, contents({ event: chest }))?.x).toBe(10);
  });

  it('interactionAt: what is spent prompts nothing and does not hide the search', () => {
    expect(interactionAt({ x: 10, z: 0 }, layout, contents({ spent: chest }))).toBeNull();
    expect(interactionAt({ x: -10, z: 0 }, layout, contents({ spent: runes }))).toBeNull();
    expect(interactionAt({ x: 0, z: 10 }, layout, contents({ spent: chest, search_spot: true }))?.kind).toBe('search');
  });

  it('remainsOf: who can walk off and what is used up is gone, the rest stays', () => {
    for (const object of ['traveller', 'townsfolk', 'spirit', 'tracks', 'snare', 'herbs']) expect(remainsOf(object)).toBe('gone');
    for (const object of ['chest', 'treasure', 'shrine', 'altar', 'trap', 'rubble', 'bridge', 'runestone', 'forge', 'crystal', 'doorway', 'lookout', 'bars', 'book', 'anything']) {
      expect(remainsOf(object)).toBe('stays');
    }
  });

  it('contentSolids: the object of an event or of a spent one that stays; a landmark blocks by itself', () => {
    const box = { x: 10, z: 0, halfX: 0.5, halfZ: 0.5, height: 1 };
    expect(contentSolids(slots, contents({ event: chest }))).toEqual([box]);
    expect(contentSolids(slots, contents({ event: runes }))).toEqual([]);
    expect(contentSolids(slots, contents({ spent: chest }))).toEqual([box]);
    expect(contentSolids(slots, contents({ spent: runes }))).toEqual([]);
    expect(contentSolids(slots, contents({ spent: { ...chest, object: 'tracks' } }))).toEqual([]);
    // An answer of before this field existed
    expect(contentSolids(slots, { seq: 1, monster: null, event: null, boss: null, search_spot: false } as unknown as AreaContents)).toEqual([]);
  });

  it('fightSlot: where the monster of a fight stands', () => {
    expect(fightSlot(slots, 'boss')).toEqual(slots.boss);
    expect(fightSlot({ ...slots, boss: null }, 'boss')).toEqual(slots.monster);
    expect(fightSlot(slots, 'event')).toEqual(slots.event);
    expect(fightSlot(slots, 'landmark')).toEqual(slots.landmark);
    expect(fightSlot({ ...slots, landmark: null }, 'landmark')).toEqual(slots.event);
    expect(fightSlot(slots, 'monster')).toEqual(slots.monster);
    expect(fightSlot(slots, 'elsewhere')).toEqual(slots.monster);
  });
});
