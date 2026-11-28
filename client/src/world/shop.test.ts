import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { ELARA, ELARA_IDLE, contentSolids, interactionAt, type AreaContents } from './contents';
import { dressArea } from './dressing';
import { campaignDressSpecs, madeUpSpecs } from './dressingkit';
import { boxDistance, buildLayout, type AreaLayout, type Box, type ContentSlots } from './layout';
import {
  SHOP_TABS, haggleFeedback, killAnnouncement, questBadge, readyCount, tabForKey, trackerLines, wareActions, wareLine,
  type HaggleResult, type TrackedQuest, type Ware,
} from './shop';

const ware = (over: Partial<Ware>): Ware => ({
  index: 1, name: 'Healing Potion', description: 'Restores 10 HP', healing: 10, quantity: 5, original_price: 25, effective_price: 25, haggled: false, discount: 0, ...over,
});
const haggle = (over: Partial<HaggleResult>): HaggleResult => ({
  roll: 14, modifier: 3, total: 17, discount: 15, tier: 'good', item_name: 'Healing Potion', original_price: 25, new_price: 21, ...over,
});
const quest = (over: Partial<TrackedQuest>): TrackedQuest => ({
  id: 'goblin_menace', name: 'Goblin Menace', type: 'kill', target_monster: 'Goblin', target_count: 5, progress: 2, status: 'active', ...over,
});

describe('the lines of the shop panel and the quest tracker', () => {
  it('tabs', () => {
    expect(SHOP_TABS).toEqual(['wares', 'sell', 'quests']);
    expect(tabForKey('Digit1')).toBe('wares');
    expect(tabForKey('Numpad1')).toBe('wares');
    expect(tabForKey('Digit2')).toBe('sell');
    expect(tabForKey('Numpad2')).toBe('sell');
    expect(tabForKey('Digit3')).toBe('quests');
    expect(tabForKey('Numpad3')).toBe('quests');
    for (const code of ['Digit0', 'Digit4', 'Numpad4', 'KeyE', '1', 'Digit11', 'F1', '']) expect(tabForKey(code), code).toBeNull();
  });

  it('wareLine', () => {
    expect(wareLine(ware({}))).toBe('25 gold');
    expect(wareLine(ware({ haggled: true, discount: 15, effective_price: 21 }))).toBe('21 gold (was 25, -15%)');
    expect(wareLine(ware({ haggled: true, discount: -25, effective_price: 31 }))).toBe('31 gold (was 25, +25%)');
    expect(wareLine(ware({ haggled: true, discount: 0 }))).toBe('25 gold (no discount)');
  });

  it('wareActions', () => {
    expect(wareActions(ware({}), 25)).toEqual({ buy: true, haggle: true });
    expect(wareActions(ware({}), 24)).toEqual({ buy: false, haggle: true });
    expect(wareActions(ware({ quantity: 0 }), 100)).toEqual({ buy: false, haggle: true });
    expect(wareActions(ware({ haggled: true, effective_price: 21 }), 21)).toEqual({ buy: true, haggle: false });
  });

  it('haggleFeedback', () => {
    expect(haggleFeedback(haggle({}))).toEqual({ outcome: 'success', roll: 'Persuasion: d20 14 + 3 = 17', verdict: '15% off: Healing Potion now costs 21 gold' });
    expect(haggleFeedback(haggle({ modifier: -1, total: 13, discount: 10, new_price: 22 }))).toEqual({
      outcome: 'success', roll: 'Persuasion: d20 14 - 1 = 13', verdict: '10% off: Healing Potion now costs 22 gold',
    });
    expect(haggleFeedback(haggle({ roll: 5, modifier: 0, total: 5, discount: 0, new_price: 25 }))).toEqual({
      outcome: 'failure', roll: 'Persuasion: d20 5 + 0 = 5', verdict: 'No discount on Healing Potion',
    });
    expect(haggleFeedback(haggle({ roll: 1, modifier: 2, total: 3, discount: -25, new_price: 31 }))).toEqual({
      outcome: 'failure', roll: 'Persuasion: d20 1 + 2 = 3', verdict: 'Price raised 25%: Healing Potion now costs 31 gold',
    });
  });

  it('the tracker, the count and the badge', () => {
    const ready = quest({ id: 'orc_raiders', name: 'Orc Raiders', progress: 3, target_count: 3, status: 'ready' });
    expect(trackerLines([])).toEqual([]);
    expect(trackerLines([quest({}), ready])).toEqual([
      { id: 'goblin_menace', text: 'Goblin Menace 2/5', ready: false },
      { id: 'orc_raiders', text: 'Orc Raiders: return to Elara', ready: true },
    ]);
    expect(readyCount([])).toBe(0);
    expect(readyCount([quest({}), ready, ready])).toBe(2);
    expect(questBadge([quest({})])).toBeNull();
    expect(questBadge([quest({}), ready])).toBe('Quest ready to turn in');
    expect(questBadge([ready, ready])).toBe('2 quests ready to turn in');
  });

  it('killAnnouncement', () => {
    expect(killAnnouncement([])).toBeNull();
    expect(killAnnouncement(['Goblin Menace: 4/5'])).toBe('Quest: Goblin Menace: 4/5');
    expect(killAnnouncement(['Goblin Menace: 4/5', 'Proof: found Goblin Ear! (1/4)'])).toBe('Quest: Goblin Menace: 4/5 · Proof: found Goblin Ear! (1/4)');
  });

  it('Elara', () => {
    expect(ELARA).toEqual({ model: 'npcs/woman_dress', scale: 0.37, tint: null, opacity: 1, emissive: null });
    expect(ELARA_IDLE).toBe('HumanArmature|Female_Idle');
  });
});

// --- Elara's place -------------------------------------------------------------------------------

/** The least distance from `target` to a free cell a walker reaches from `from`: cells 0.25 m apart counted from `origin`. */
function nearestReached(layout: AreaLayout, from: Vec2, target: Vec2, origin: number): number {
  const step = 0.25;
  const at = (i: number, j: number): Vec2 => ({ x: origin + i * step, z: origin + j * step });
  const start: [number, number] = [Math.round((from.x - origin) / step), Math.round((from.z - origin) / step)];
  if (!isFree(at(...start), layout)) return Infinity;
  const seen = new Set<string>([start.join()]);
  const queue: [number, number][] = [start];
  let best = Infinity;
  for (let head = 0; head < queue.length; head++) {
    const [i, j] = queue[head];
    const p = at(i, j);
    best = Math.min(best, Math.hypot(p.x - target.x, p.z - target.z));
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (seen.has(`${a},${b}`) || !isFree(at(a, b), layout)) continue;
      seen.add(`${a},${b}`);
      queue.push([a, b]);
    }
  }
  return best;
}

describe("Elara's place", () => {
  it('is inside the stall in the market and nowhere else in the campaign', { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const spec of campaignDressSpecs()) {
      const name = `${spec.location}/${spec.id}`;
      expect(buildLayout(spec).slots, name).toBeNull();
      const dressing = dressArea(buildLayout(spec), spec);
      const slots = dressing.layout.slots as ContentSlots;
      const stall = dressing.placements.find((p) => p.landmark === 'shop');
      expect(slots.shop !== null, name).toBe(stall !== undefined);
      if (!stall || !slots.shop) continue;
      found.push(name);
      expect(boxDistance(slots.shop, stall.solid as Box), name).toBe(0);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.shop, name).toEqual(slots.shop);
      // One can walk up to her: well within the 2.5 m the smoke test asks for and the 3 m of the prompt.
      for (const origin of [0, 0.1, -dressing.layout.floor.halfX]) {
        expect(nearestReached(dressing.layout, dressing.layout.spawn, slots.shop, origin), `${name} from ${origin}`).toBeLessThanOrEqual(2.2);
      }
      // She adds no obstacle.
      const contents: AreaContents = { seq: 1, monster: null, event: null, spent: null, boss: null, search_spot: true };
      expect(contentSolids(slots, contents)).toEqual([]);
    }
    expect(found).toEqual(['Rivermeet Town/market']);
  });

  it('follows the stall in areas of no campaign', { timeout: 120_000 }, () => {
    let seen = 0;
    for (const spec of madeUpSpecs(11, 150)) {
      const name = `${spec.type}/${spec.id}`;
      const dressing = dressArea(buildLayout(spec), spec);
      const shop = (dressing.layout.slots as ContentSlots).shop;
      const stall = dressing.placements.find((p) => p.landmark === 'shop');
      expect(shop !== null, name).toBe(stall !== undefined);
      if (!stall || !shop) continue;
      seen++;
      expect(boxDistance(shop, stall.solid as Box), name).toBe(0);
      expect(dressArea(buildLayout(spec), spec).layout.slots?.shop, name).toEqual(shop);
      expect(nearestReached(dressing.layout, dressing.layout.spawn, shop, 0), name).toBeLessThanOrEqual(2.5);
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('the shop prompt', () => {
  const slots: ContentSlots = { monster: { x: 0, z: 0 }, event: { x: 10, z: 0 }, search: { x: 0, z: 10 }, boss: { x: 10, z: 10 }, landmark: null, rest: { x: -10, z: 10 }, shop: { x: -10, z: -10 }, travel: null };
  const layout: AreaLayout = { ...buildLayout({ location: 'Nowhere', id: 'a', type: 'town', exits: [] }), slots };
  const contents = (over: Partial<AreaContents>): AreaContents => ({ seq: 1, monster: null, event: null, spent: null, boss: null, search_spot: false, ...over });
  const shop = { kind: 'shop', id: null, prompt: 'E: talk to Elara', auto: false, locked: false, x: -10, z: -10 };
  const goblin = { id: 'm', race: 'Goblin', name: 'Grak', level: 1 };

  it('shows within 3 m of Elara', () => {
    expect(interactionAt({ x: -10, z: -7 }, layout, contents({}))).toEqual(shop);
    expect(interactionAt({ x: -10, z: -6.99 }, layout, contents({}))).toBeNull();
    expect(interactionAt({ x: -10, z: -10 }, layout, contents({ monster: goblin }))).toEqual(shop);
  });

  it('needs a shop slot and contents', () => {
    expect(interactionAt({ x: -10, z: -10 }, { ...layout, slots: { ...slots, shop: null } }, contents({}))).toBeNull();
    const { shop: _dropped, ...old } = slots;
    expect(interactionAt({ x: -10, z: -10 }, { ...layout, slots: old as ContentSlots }, contents({}))).toBeNull();
    expect(interactionAt({ x: -10, z: -10 }, layout, null)).toBeNull();
  });

  it('loses a tie to every other kind and wins when nearest', () => {
    const at = { x: 0, z: 0 };
    const mid = { x: 1, z: 0 };
    const together: AreaLayout = { ...layout, slots: { monster: { x: 2, z: 0 }, event: { x: 2, z: 0 }, search: { x: 2, z: 0 }, boss: { x: 2, z: 0 }, landmark: null, rest: { x: 2, z: 0 }, shop: at, travel: null } };
    const boss = { id: 'b', name: 'Boss', level: 3, locked: false, locked_text: null, title: '', intro: null };
    const event = { id: 'e', title: 'T', object: 'chest', label: 'a chest', landmark: false };
    expect(interactionAt(mid, together, contents({}))?.kind).toBe('rest');
    expect(interactionAt(mid, { ...together, slots: { ...together.slots as ContentSlots, rest: null } }, contents({ search_spot: true }))?.kind).toBe('search');
    expect(interactionAt(mid, together, contents({ boss }))?.kind).toBe('boss');
    expect(interactionAt(mid, together, contents({ event }))?.kind).toBe('event');
    expect(interactionAt(mid, together, contents({ monster: goblin }))?.kind).toBe('monster');
    expect(interactionAt({ x: 0.9, z: 0 }, together, contents({ monster: goblin, event, boss }))?.kind).toBe('shop');
  });
});
