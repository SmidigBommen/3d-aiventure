import { describe, expect, it } from 'vitest';
import campaign from '../../../json/campaign.json';
import type { Vec2 } from '../input/movement';
import {
  ARRIVAL_SECONDS, SHARD_COLOURS, actBadge, arrivalTitle, endingSteps, legendLines, shardSockets, travelChoiceForKey, travelChoices,
  type EndingView, type TravelView,
} from './campaign';
import { isFree } from './collision';
import { compassMarks } from './compass';
import { battleStance, fightSlot, interactionAt, type AreaContents } from './contents';
import { ROAD_SPEC, dressArea, dressSpecOf, type DressSpec } from './dressing';
import { campaignDressSpecs, footprintOf, madeUpSpecs, triggerZone } from './dressingkit';
import { boxDistance, buildLayout, type AreaLayout, type Box, type ContentSlots } from './layout';

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

const STARTS = campaign.acts.flatMap((act) => act.locations.map((loc) => `${loc.name}/${loc.starting_area}`)).sort();

describe('the signpost', () => {
  it('stands exactly in the eight starting areas and its standing point keeps the rules', { timeout: 180_000 }, () => {
    const specs = campaignDressSpecs();
    expect(specs.length).toBe(51);
    const found: string[] = [];
    let nearest = Infinity;
    for (const spec of specs) {
      const name = `${spec.location}/${spec.id}`;
      const dressing = dressArea(buildLayout(spec), spec);
      const layout = dressing.layout;
      const slots = layout.slots as ContentSlots;
      const posts = dressing.placements.filter((p) => p.landmark === 'travel');
      expect(posts.length, name).toBe(spec.travel ? 1 : 0);
      expect(slots.travel !== null, name).toBe(posts.length === 1);
      if (posts.length === 0 || !slots.travel) continue;
      found.push(name);
      const post = posts[0];
      expect(post.model, name).toBe('env/town/signpost');
      expect(post.role, name).toBe('landmark');
      const point = slots.travel;
      expect(isFree(point, layout), name).toBe(true);
      const box: Box = post.solid ?? { ...footprintOf(post), height: 0 };
      expect(boxDistance(point, box), name).toBeLessThanOrEqual(2);
      for (const gate of layout.gates) {
        expect(boxDistance(point, { ...triggerZone(gate), height: 0 }), name).toBeGreaterThanOrEqual(2);
        expect(Math.hypot(point.x - gate.spawn.x, point.z - gate.spawn.z), name).toBeGreaterThanOrEqual(1.5);
      }
      expect(Math.hypot(point.x - layout.spawn.x, point.z - layout.spawn.z), name).toBeGreaterThanOrEqual(1.5);
      for (const other of [slots.monster, slots.event, slots.search, slots.boss, slots.landmark, slots.rest]) {
        if (!other) continue;
        nearest = Math.min(nearest, Math.hypot(other.x - point.x, other.z - point.z));
        expect(Math.hypot(other.x - point.x, other.z - point.z), name).toBeGreaterThanOrEqual(1.5);
      }
      for (const origin of [0, 0.1, -layout.floor.halfX]) expect(walks(layout, layout.spawn, point, origin), `${name} from ${origin}`).toBe(true);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.travel, name).toEqual(point);
    }
    expect(found.sort()).toEqual(STARTS);
    expect(nearest).toBeGreaterThanOrEqual(1.5);
  });

  it('follows the spec in areas of no campaign', { timeout: 180_000 }, () => {
    let seen = 0;
    madeUpSpecs(11, 150).forEach((made, index) => {
      const spec: DressSpec = index % 2 === 0 ? { ...made, travel: true } : made;
      const name = `${spec.type}/${spec.id}`;
      const dressing = dressArea(buildLayout(spec), spec);
      const posts = dressing.placements.filter((p) => p.landmark === 'travel');
      const travel = (dressing.layout.slots as ContentSlots).travel;
      expect(posts.length, name).toBe(index % 2 === 0 ? 1 : 0);
      expect(travel !== null, name).toBe(posts.length === 1);
      if (!travel) return;
      seen++;
      expect(isFree(travel, dressing.layout), name).toBe(true);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.travel, name).toEqual(travel);
    });
    expect(seen).toBe(75);
  });

  it('dressSpecOf takes it from is_start', () => {
    const state = { location: { name: 'X', type: 'town' }, exits: [], area: { id: 'a', has_shop: false, can_rest: false, is_boss_area: false, special: null } };
    expect(dressSpecOf({ ...state, area: { ...state.area, is_start: true } }).travel).toBe(true);
    expect(dressSpecOf({ ...state, area: { ...state.area, is_start: false } }).travel).toBe(false);
    expect(dressSpecOf(state).travel).toBe(false);
  });
});

const contents = (over: Partial<AreaContents>): AreaContents => ({ seq: 1, monster: null, event: null, spent: null, boss: null, search_spot: false, ...over });

describe('the prompt at the signpost', () => {
  const layout = buildLayout({ location: 'X', type: 'town', id: 'a', exits: [] });
  const slots: ContentSlots = {
    monster: { x: 0, z: 0 }, event: { x: 10, z: 0 }, search: { x: 0, z: 10 }, boss: { x: 10, z: 10 }, landmark: null, rest: null, shop: null, travel: { x: -10, z: -10 },
  };
  const at: AreaLayout = { ...layout, slots };
  const offer = { kind: 'travel', id: null, prompt: 'E: travel', auto: false, locked: false, x: -10, z: -10 };

  it('shows within 3 m, whatever the area holds', () => {
    expect(interactionAt({ x: -7, z: -10 }, at, contents({}))).toEqual(offer);
    expect(interactionAt({ x: -6.99, z: -10 }, at, contents({}))).toBeNull();
    const monster = { id: 'm', race: 'Goblin', name: 'Snik', level: 1 };
    expect(interactionAt({ x: -8, z: -10 }, { ...at, slots: { ...slots, monster: { x: -5.5, z: -10 } } }, contents({ monster }))).toEqual(offer);
    const event = { id: 'e', title: 'T', object: 'chest', label: 'a chest', landmark: false };
    expect(interactionAt({ x: -8, z: -10 }, { ...at, slots: { ...slots, event: { x: -5.5, z: -10 } } }, contents({ event }))).toEqual(offer);
  });

  it('loses an exact tie against every other kind', () => {
    const mid = { x: -9, z: -10 };
    const other = { x: -8, z: -10 };
    expect(interactionAt(mid, { ...at, slots: { ...slots, shop: other } }, contents({}))?.kind).toBe('shop');
    expect(interactionAt(mid, { ...at, slots: { ...slots, rest: other } }, contents({}))?.kind).toBe('rest');
    expect(interactionAt(mid, { ...at, slots: { ...slots, search: other } }, contents({ search_spot: true }))?.kind).toBe('search');
  });

  it('is not offered without the slot', () => {
    expect(interactionAt({ x: -10, z: -10 }, { ...at, slots: { ...slots, travel: null } }, contents({}))).toBeNull();
    const { travel: _dropped, ...old } = slots;
    expect(interactionAt({ x: -10, z: -10 }, { ...at, slots: old as ContentSlots }, contents({}))).toBeNull();
  });
});

describe('the road of the ambush', () => {
  it('has no gates, a monster slot away from the spawn and a battle stance', () => {
    const road = dressArea(buildLayout(ROAD_SPEC), ROAD_SPEC);
    const layout = road.layout;
    const slots = layout.slots as ContentSlots;
    expect(layout.gates).toEqual([]);
    expect(slots).not.toBeNull();
    expect(isFree(slots.monster, layout)).toBe(true);
    expect(Math.hypot(slots.monster.x - layout.spawn.x, slots.monster.z - layout.spawn.z)).toBeGreaterThanOrEqual(2.5);
    expect(road.placements.some((p) => p.role === 'landmark')).toBe(false);
    expect(dressArea(buildLayout(ROAD_SPEC), ROAD_SPEC)).toEqual(road);
    const slot = fightSlot(slots, 'road');
    expect(slot).toEqual(slots.monster);
    const stance = battleStance(layout.spawn, slot, layout);
    const away = Math.hypot(stance.x - slot.x, stance.z - slot.z);
    expect(isFree(stance, layout)).toBe(true);
    expect(away).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(away).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe('the compass', () => {
  it('marks the gates, then the shop, the rest place, the boss and the signpost', { timeout: 180_000 }, () => {
    const areas = campaign.acts.flatMap((act) => act.locations.flatMap((loc) => loc.areas.map((area) => ({ loc, area: area as { id: string; name: string; connections: string[]; boss?: string } }))));
    const specs = campaignDressSpecs();
    const kinds = new Set<string>();
    specs.forEach((spec, index) => {
      const { loc, area } = areas[index];
      const name = `${spec.location}/${spec.id}`;
      const layout = dressArea(buildLayout(spec), spec).layout;
      const slots = layout.slots as ContentSlots;
      const exits = area.connections.map((id) => ({ id, name: loc.areas.find((a) => a.id === id)?.name ?? id }));
      const boss = area.boss ? { id: area.boss, name: `The ${area.boss}`, level: 5, locked: false, locked_text: null, title: '', intro: null } : null;
      const player = { x: 1.5, z: -2, yaw: 0.7 };
      const marks = compassMarks(layout, exits, contents({ boss }), player);
      const expected: [string, string, Vec2][] = layout.gates.map((gate) => ['gate', exits.find((e) => e.id === gate.exitId)?.name ?? '', gate]);
      if (slots.shop) expected.push(['shop', "Elara's shop", slots.shop]);
      if (slots.rest) expected.push(['rest', 'Rest', slots.rest]);
      if (slots.boss && boss) expected.push(['boss', boss.name, slots.boss]);
      if (slots.travel) expected.push(['travel', 'Signpost', slots.travel]);
      expect(marks.map((m) => [m.kind, m.label, m.x, m.z]), name).toEqual(expected.map(([kind, label, p]) => [kind, label, p.x, p.z]));
      for (const mark of marks) {
        kinds.add(mark.kind);
        expect(mark.distance, name).toBeCloseTo(Math.hypot(mark.x - player.x, mark.z - player.z), 9);
        expect(mark.bearing, name).toBeGreaterThan(-Math.PI);
        expect(mark.bearing, name).toBeLessThanOrEqual(Math.PI);
      }
      expect(compassMarks(layout, exits, null, player).some((m) => m.kind === 'boss'), name).toBe(false);
      expect(compassMarks(layout, exits, contents({}), player).some((m) => m.kind === 'boss'), name).toBe(false);
      expect(compassMarks(layout, [], null, player).slice(0, layout.gates.length).map((m) => m.label), name).toEqual(layout.gates.map((g) => g.exitId));
    });
    expect([...kinds].sort()).toEqual(['boss', 'gate', 'rest', 'shop', 'travel']);
  });

  it('gives bearings from where the player looks', () => {
    const base = buildLayout({ location: 'X', type: 'town', id: 'a', exits: [] });
    const slot = (p: Vec2): AreaLayout => ({
      ...base, slots: { monster: { x: 0, z: 0 }, event: { x: 0, z: 0 }, search: { x: 0, z: 0 }, boss: null, landmark: null, rest: null, shop: null, travel: p },
    });
    const bearing = (p: Vec2, yaw: number): number => compassMarks(slot(p), [], null, { x: 0, z: 0, yaw })[0].bearing;
    expect(bearing({ x: 0, z: -5 }, 0)).toBeCloseTo(0, 9);
    expect(bearing({ x: -5, z: 0 }, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(bearing({ x: 5, z: 0 }, 0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(bearing({ x: 0, z: 5 }, 0)).toBeCloseTo(Math.PI, 9);
    expect(bearing({ x: 0, z: 0 }, 1.3)).toBe(0);
    for (const a of [0.3, 1, 2.5, -2, 4, 7]) {
      for (const p of [{ x: 0, z: -5 }, { x: -5, z: 0 }, { x: 5, z: 0 }, { x: 3, z: 4 }]) {
        const turned = bearing(p, a);
        const wanted = bearing(p, 0) - a;
        expect(Math.cos(turned - wanted)).toBeCloseTo(1, 9);
        expect(turned).toBeGreaterThan(-Math.PI);
        expect(turned).toBeLessThanOrEqual(Math.PI);
      }
    }
    // Straight behind is π, never -π.
    expect(bearing({ x: 0, z: -5 }, Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(compassMarks({ ...base, slots: null }, [], null, { x: 0, z: 0, yaw: 0 })).toEqual([]);
  });
});

describe('the lines of the map, the journal and the ending', () => {
  const location = (name: string, current = false) => ({ name, description: '', type: 'town', level_range: '1-3', has_boss: false, cleared: false, current });
  const reason = (n: number): string => `Defeat the guardians of Act ${n - 1} to open the way.`;
  const start: TravelView = {
    current: 'Rivermeet Town',
    acts: [
      { number: 1, title: 'One', locked: false, locked_reason: null, locations: [location('Rivermeet Town', true), location('Whispering Woods'), location('Abandoned Watchtower')] },
      { number: 2, title: 'Two', locked: true, locked_reason: reason(2), locations: ['Emberforge Mountains', 'Sunken Temple of Dariel', 'Windswept Plains', 'The Crystalline Caves'].map((n) => location(n)) },
      { number: 3, title: 'Three', locked: true, locked_reason: reason(3), locations: [location('The Convergence')] },
    ],
  };

  it('travelChoices and travelChoiceForKey', () => {
    const choices = travelChoices(start);
    expect(choices.map((c) => c.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(choices[0]).toEqual({ location: 'Rivermeet Town', act: 1, hotkey: '1', enabled: false, reason: 'You are here.' });
    expect(choices[1]).toEqual({ location: 'Whispering Woods', act: 1, hotkey: '2', enabled: true, reason: null });
    expect(choices.slice(3, 7).every((c) => !c.enabled && c.reason === reason(2) && c.act === 2)).toBe(true);
    expect(choices[7]).toEqual({ location: 'The Convergence', act: 3, hotkey: '8', enabled: false, reason: reason(3) });
    expect(travelChoiceForKey(start, 'Digit2')?.location).toBe('Whispering Woods');
    expect(travelChoiceForKey(start, 'Numpad8')?.location).toBe('The Convergence');
    expect(travelChoiceForKey(start, 'Digit1')?.enabled).toBe(false);
    for (const code of ['KeyA', 'Digit9', 'Digit0', '2', 'Digit', 'Digit12']) expect(travelChoiceForKey(start, code)).toBeNull();
  });

  it('arrivalTitle, actBadge, ARRIVAL_SECONDS', () => {
    expect(arrivalTitle({ location: { name: 'Whispering Woods', act: { number: 1, title: 'The Missing Shard' } } })).toEqual({ title: 'Whispering Woods', subtitle: 'Act 1: The Missing Shard' });
    expect(actBadge({ locked: false, complete: true, current: true })).toBe('Complete');
    expect(actBadge({ locked: false, complete: false, current: true })).toBe('In progress');
    expect(actBadge({ locked: true, complete: false, current: false })).toBe('Locked');
    expect(actBadge({ locked: false, complete: false, current: false })).toBe('Locked');
    expect(ARRIVAL_SECONDS).toBe(2.5);
  });

  it('shardSockets and SHARD_COLOURS', () => {
    expect(SHARD_COLOURS).toEqual({ 'Shard of Verdance': '#4caf50', 'Shard of Embers': '#e2572b', 'Shard of Tides': '#2f8fd8', 'Shard of Gales': '#bfe3f2', 'Shard of Stone': '#b08a4f' });
    expect(shardSockets([{ name: 'Shard of Tides', found: true }, { name: 'Shard of Stone', found: false }, { name: 'Shard of Night', found: true }, { name: 'toString', found: true }])).toEqual([
      { name: 'Shard of Tides', found: true, label: 'Shard of Tides', colour: '#2f8fd8' },
      { name: 'Shard of Stone', found: false, label: '???', colour: null },
      { name: 'Shard of Night', found: true, label: 'Shard of Night', colour: '#d4af37' },
      { name: 'toString', found: true, label: 'toString', colour: '#d4af37' },
    ]);
  });

  it('endingSteps and legendLines', () => {
    const view: EndingView = {
      title: 'The Crown Restored', campaign_title: 'The Shattered Crown', paragraphs: ['One.', 'Two.', 'Three.'],
      character: { name: 'A', race: 'Human', class_name: 'Fighter', level: 15, gold: 1234 }, stats: { kills: 80, bosses: 9, events: 12, quests: 0 }, shards: [],
    };
    expect(endingSteps(view)).toEqual([
      { kind: 'title', text: 'The Crown Restored' }, { kind: 'text', text: 'One.' }, { kind: 'text', text: 'Two.' }, { kind: 'text', text: 'Three.' },
      { kind: 'legend', text: 'Your Legend' },
    ]);
    expect(legendLines(view)).toEqual([
      ['Level reached', '15'], ['Monsters slain', '80'], ['Bosses felled', '9'], ['Events braved', '12'], ['Quests completed', '0'], ['Gold in purse', '1234'],
    ]);
  });
});
