import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { interactionAt, type AreaContents } from './contents';
import { dressArea } from './dressing';
import { campaignDressSpecs, footprintOf, madeUpSpecs, triggerZone } from './dressingkit';
import { boxDistance, buildLayout, type AreaLayout, type Box, type ContentSlots } from './layout';
import { asiBadge, attackLine, itemAction, itemLines, itemTitle, panelForKey, signed, xpFraction, type InventoryItem } from './sheet';

const item = (over: Partial<InventoryItem>): InventoryItem => ({ name: 'Thing', description: 'A thing.', type: 'potion', index: 0, count: 1, can_equip: false, ...over });

describe('the lines of the inventory panel and the character sheet', () => {
  it('panelForKey', () => {
    expect(panelForKey('KeyI')).toBe('inventory');
    expect(panelForKey('KeyC')).toBe('sheet');
    expect(panelForKey('KeyM')).toBeNull();
    expect(panelForKey('i')).toBeNull();
  });

  it('signed', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('+0');
    expect(signed(-1)).toBe('-1');
  });

  it('itemTitle', () => {
    expect(itemTitle(item({ name: 'Small Healing Potion', count: 3 }))).toBe('Small Healing Potion ×3');
    expect(itemTitle(item({ name: 'Dagger', count: 1 }))).toBe('Dagger');
  });

  it('itemLines', () => {
    const sword = item({ type: 'weapon', damage_dice_count: 1, damage_die: 8, damage_type: 'slashing', category: 'Martial', properties: ['versatile', 'heavy'], can_equip: true, compare: { cls: 'better', text: '+1.5 avg damage' } });
    expect(itemLines(sword)).toEqual(['1d8 slashing', 'Martial · versatile, heavy', '+1.5 avg damage vs equipped']);
    expect(itemLines({ ...sword, properties: [], can_equip: false })).toEqual(['1d8 slashing', 'Martial']);
    const mail = item({ type: 'armor', base_ac: 16, ac_if_equipped: 16, category: 'Heavy', can_equip: true, compare: { cls: 'same', text: 'Same AC' } });
    expect(itemLines(mail)).toEqual(['Base AC: 16 · AC 16 when worn', 'Heavy', 'Same AC vs equipped']);
    expect(itemLines({ ...mail, compare: undefined })).toEqual(['Base AC: 16 · AC 16 when worn', 'Heavy']);
    expect(itemLines(item({ description: 'Restores 10 HP.' }))).toEqual(['Restores 10 HP.']);
    expect(itemLines(item({ type: 'quest_item', description: 'A pelt.' }))).toEqual(['A pelt.']);
  });

  it('itemAction', () => {
    expect(itemAction(item({ can_use: true }))).toEqual({ action: 'use', label: 'Drink', enabled: true });
    expect(itemAction(item({ can_use: false }))).toEqual({ action: 'use', label: 'Drink', enabled: false });
    expect(itemAction(item({}))).toEqual({ action: 'use', label: 'Drink', enabled: false });
    expect(itemAction(item({ type: 'weapon', can_equip: true }))).toEqual({ action: 'equip-weapon', label: 'Equip', enabled: true });
    expect(itemAction(item({ type: 'weapon' }))).toEqual({ action: 'equip-weapon', label: 'Not proficient', enabled: false });
    expect(itemAction(item({ type: 'armor', can_equip: true }))).toEqual({ action: 'equip-armor', label: 'Equip', enabled: true });
    expect(itemAction(item({ type: 'armor' }))).toEqual({ action: 'equip-armor', label: 'Not proficient', enabled: false });
    expect(itemAction(item({ type: 'quest_item' }))).toBeNull();
  });

  it('attackLine', () => {
    expect(attackLine({ weapon: 'Longsword', bonus: 5, damage_dice: '1d8', damage_modifier: 3, damage_type: 'slashing' })).toBe('Longsword: +5 to hit, 1d8 + 3 slashing');
    expect(attackLine({ weapon: 'Unarmed Strike', bonus: 1, damage_dice: '1d4', damage_modifier: -1, damage_type: 'bludgeoning' })).toBe('Unarmed Strike: +1 to hit, 1d4 - 1 bludgeoning');
    expect(attackLine({ weapon: 'Dagger', bonus: 2, damage_dice: '1d4', damage_modifier: 0, damage_type: 'piercing' })).toBe('Dagger: +2 to hit, 1d4 + 0 piercing');
  });

  it('xpFraction', () => {
    expect(xpFraction(50, 200)).toBe(0.25);
    expect(xpFraction(300, 200)).toBe(1);
    expect(xpFraction(-5, 200)).toBe(0);
    expect(xpFraction(5, 0)).toBe(0);
    expect(xpFraction(5, -1)).toBe(0);
  });

  it('asiBadge', () => {
    expect(asiBadge(0)).toBeNull();
    expect(asiBadge(-1)).toBeNull();
    expect(asiBadge(1)).toBe('1 ability point to spend (C)');
    expect(asiBadge(2)).toBe('2 ability points to spend (C)');
  });
});

// --- the rest slot -------------------------------------------------------------------------------

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

describe('the standing point at the rest landmark', () => {
  it('exists exactly in the three rest areas of the campaign and keeps its rules', { timeout: 120_000 }, () => {
    const specs = campaignDressSpecs();
    expect(specs.length).toBe(51);
    const found: string[] = [];
    for (const spec of specs) {
      const name = `${spec.location}/${spec.id}`;
      expect(buildLayout(spec).slots, name).toBeNull();
      const dressing = dressArea(buildLayout(spec), spec);
      const layout = dressing.layout;
      const slots = layout.slots as ContentSlots;
      const placement = dressing.placements.find((p) => p.landmark === 'rest');
      expect(slots.rest !== null, name).toBe(placement !== undefined);
      expect(placement !== undefined, name).toBe(spec.rest);
      if (!placement || !slots.rest) continue;
      found.push(name);
      const point = slots.rest;
      expect(isFree(point, layout), name).toBe(true);
      const box: Box = placement.solid ?? { ...footprintOf(placement), height: 0 };
      expect(boxDistance(point, box), name).toBeLessThanOrEqual(2);
      for (const gate of layout.gates) {
        expect(boxDistance(point, { ...triggerZone(gate), height: 0 }), name).toBeGreaterThanOrEqual(2);
        expect(Math.hypot(point.x - gate.spawn.x, point.z - gate.spawn.z), name).toBeGreaterThanOrEqual(1.5);
      }
      expect(Math.hypot(point.x - layout.spawn.x, point.z - layout.spawn.z), name).toBeGreaterThanOrEqual(1.5);
      for (const other of [slots.monster, slots.event, slots.search, slots.boss, slots.landmark]) {
        if (other) expect(Math.hypot(other.x - point.x, other.z - point.z), name).toBeGreaterThanOrEqual(1.5);
      }
      for (const origin of [0, 0.1, -layout.floor.halfX]) expect(walks(layout, layout.spawn, point, origin), `${name} from ${origin}`).toBe(true);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.rest, name).toEqual(point);
    }
    expect(found.sort()).toEqual(['Rivermeet Town/inn_rooms', 'Rivermeet Town/tavern', 'The Crystalline Caves/meditation_grove']);
  });

  it('is free and the same every time in areas of no campaign', { timeout: 120_000 }, () => {
    let seen = 0;
    for (const spec of madeUpSpecs(11, 150)) {
      const name = `${spec.type}/${spec.id}`;
      const dressing = dressArea(buildLayout(spec), spec);
      const rest = (dressing.layout.slots as ContentSlots).rest;
      expect(rest !== null, name).toBe(dressing.placements.some((p) => p.landmark === 'rest'));
      if (!rest) continue;
      seen++;
      expect(isFree(rest, dressing.layout), name).toBe(true);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.rest, name).toEqual(rest);
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('the rest prompt', () => {
  const slots: ContentSlots = { monster: { x: 0, z: 0 }, event: { x: 10, z: 0 }, search: { x: 0, z: 10 }, boss: { x: 10, z: 10 }, landmark: null, rest: { x: -10, z: -10 }, shop: null };
  const layout: AreaLayout = { type: 'town', floor: { halfX: 20, halfZ: 20 }, ceiling: null, walls: [], props: [], gates: [], spawn: { x: 5, z: 5 }, slots };
  const contents = (over: Partial<AreaContents>): AreaContents => ({ seq: 1, monster: null, event: null, spent: null, boss: null, search_spot: false, ...over });
  const rest = { kind: 'rest', id: null, prompt: 'E: rest', auto: false, locked: false, x: -10, z: -10 };

  it('shows within 3 m of the slot, whatever else is in the area', () => {
    expect(interactionAt({ x: -10, z: -7 }, layout, contents({}))).toEqual(rest);
    expect(interactionAt({ x: -10, z: -6.99 }, layout, contents({}))).toBeNull();
    expect(interactionAt({ x: -10, z: -9 }, layout, contents({ monster: { id: 'm', race: 'Goblin', name: 'Grak', level: 1 } }))).toEqual(rest);
    expect(interactionAt({ x: -10, z: -9 }, layout, null)).toBeNull();
  });

  it('is absent without the slot', () => {
    expect(interactionAt({ x: -10, z: -10 }, { ...layout, slots: { ...slots, rest: null } }, contents({}))).toBeNull();
    const old = { monster: slots.monster, event: slots.event, search: slots.search, boss: slots.boss, landmark: null } as unknown as ContentSlots;
    expect(interactionAt({ x: -10, z: -10 }, { ...layout, slots: old }, contents({}))).toBeNull();
    expect(interactionAt({ x: 0, z: 9 }, { ...layout, slots: old }, contents({ search_spot: true }))?.kind).toBe('search');
  });

  it('loses a tie to the search spot and to anything nearer', () => {
    const near: AreaLayout = { ...layout, slots: { ...slots, search: { x: -10, z: -6 }, monster: { x: -10, z: -9 } } };
    expect(interactionAt({ x: -10, z: -8 }, near, contents({ search_spot: true }))?.kind).toBe('search');
    expect(interactionAt({ x: -10, z: -9.2 }, near, contents({ monster: { id: 'm', race: 'Goblin', name: 'Grak', level: 1 } }))?.kind).toBe('monster');
    expect(interactionAt({ x: -10, z: -10 }, near, contents({ monster: { id: 'm', race: 'Goblin', name: 'Grak', level: 1 } }))?.kind).toBe('rest');
  });
});
