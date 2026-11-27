import { describe, expect, it } from 'vitest';
import { actionForKey, type BattleView } from './view';

const view = (over: Partial<BattleView> = {}): BattleView => ({
  phase: 'fight',
  round: 1,
  player_turn: true,
  turn: { seq: 1, events: [] },
  player: { name: 'Tester', level: 1, hp: 10, max_hp: 10, pp: 2, max_pp: 2, ac: 16, effects: [] },
  monster: { name: 'Grak', race: 'Goblin', level: 1, hp: 6, max_hp: 6, ac: 12, is_boss: false, boss_id: null, title: null, enraged: false, effects: [], taunt: null, enrage_text: null, place: 'monster' },
  abilities: [
    { id: 'power_strike', name: 'Power Strike', description: '', cost: 0, summary: [], usable: true, hotkey: '1' },
    { id: 'second_wind', name: 'Second Wind', description: '', cost: 3, summary: [], usable: false, hotkey: '2' },
  ],
  items: ['q', 'w', 'e', 'r', ''].map((hotkey, i) => ({ name: `Potion ${i}`, description: '', index: i * 2 + 1, count: 1, hotkey })),
  can_flee: true,
  flee: { dc: 10, modifier: 1 },
  log: [],
  rewards: null,
  defeat: null,
  ...over,
});

describe('actionForKey', () => {
  it('gives the classic battle hotkeys', () => {
    const v = view();
    expect(actionForKey(v, 'KeyA')).toEqual({ type: 'attack' });
    expect(actionForKey(v, 'KeyD')).toEqual({ type: 'defend' });
    expect(actionForKey(v, 'KeyF')).toEqual({ type: 'flee' });
    expect(actionForKey(v, 'Digit1')).toEqual({ type: 'ability', ability_id: 'power_strike' });
    expect(actionForKey(v, 'Digit2')).toBeNull(); // not usable
    expect(actionForKey(v, 'Digit3')).toBeNull(); // no such ability
    expect(actionForKey(v, 'KeyQ')).toEqual({ type: 'item', item_index: 1 });
    expect(actionForKey(v, 'KeyW')).toEqual({ type: 'item', item_index: 3 });
    expect(actionForKey(v, 'KeyE')).toEqual({ type: 'item', item_index: 5 });
    expect(actionForKey(v, 'KeyR')).toEqual({ type: 'item', item_index: 7 });
    for (const code of ['KeyS', 'Digit6', 'Digit0', 'Enter', 'Space', 'ArrowUp', 'Numpad1', '', 'toString']) expect(actionForKey(v, code)).toBeNull();
  });

  it('has no flee against a boss and no item without a stack', () => {
    const v = view({ can_flee: false, items: [] });
    expect(actionForKey(v, 'KeyF')).toBeNull();
    expect(actionForKey(v, 'KeyQ')).toBeNull();
    expect(actionForKey(v, 'KeyA')).toEqual({ type: 'attack' });
  });

  it('gives nothing outside the player\'s turn of a fight', () => {
    const codes = ['KeyA', 'KeyD', 'KeyF', 'Digit1', 'KeyQ'];
    for (const phase of ['victory', 'defeat', 'fled', 'none'] as const) {
      for (const code of codes) expect(actionForKey(view({ phase }), code)).toBeNull();
    }
    for (const code of codes) expect(actionForKey(view({ player_turn: false }), code)).toBeNull();
  });
});
