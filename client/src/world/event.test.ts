import { describe, expect, it } from 'vitest';
import { choiceForKey, choiceLine, outcomeChips, rollLine, verdict, type EventChoice, type EventResult, type EventView } from './event';

const choice = (index: number, over: Partial<EventChoice> = {}): EventChoice =>
  ({ index, label: `Choice ${index}`, hotkey: String(index + 1), skill: null, dc: null, modifier: null, proficient: null, ...over });
const view = (count: number): EventView =>
  ({ id: 'e', title: 'T', text: '...', object: 'chest', label: 'the chest', landmark: false, choices: Array.from({ length: count }, (_, i) => choice(i)) });
const result = (over: Partial<EventResult> = {}): EventResult => ({
  title: 'T', label: 'L', success: true, check: null, text: 'It happens.', gold: 0, xp: 0, heal: 0, pp: 0, damage: 0, item: null,
  battle: false, leveled_up: false, new_level: null, ...over,
});

describe('choiceForKey', () => {
  it('takes Digit1 to Digit4 for the choices there are', () => {
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4'].map((code) => choiceForKey(view(4), code))).toEqual([0, 1, 2, 3]);
    expect(choiceForKey(view(2), 'Digit3')).toBeNull();
    for (const code of ['Digit0', 'Digit5', 'Numpad1', 'KeyA', 'Enter', '']) expect(choiceForKey(view(4), code)).toBeNull();
  });
});

describe('choiceLine', () => {
  it('names the skill, the signed modifier and the DC', () => {
    expect(choiceLine(choice(0))).toBe('No check');
    expect(choiceLine(choice(0, { skill: 'Athletics', modifier: 5, dc: 13, proficient: true }))).toBe('Athletics +5 · DC 13 (proficient)');
    expect(choiceLine(choice(0, { skill: 'Sleight of Hand', modifier: 0, dc: 12, proficient: false }))).toBe('Sleight of Hand +0 · DC 12');
    expect(choiceLine(choice(0, { skill: 'Arcana', modifier: -1, dc: 10, proficient: false }))).toBe('Arcana -1 · DC 10');
  });
});

describe('rollLine and verdict', () => {
  it('show the roll as it fell', () => {
    expect(rollLine({ skill: 'Athletics', roll: 14, modifier: 5, total: 19, dc: 13, success: true })).toBe('d20 14 + 5 = 19 vs DC 13');
    expect(rollLine({ skill: 'Arcana', roll: 3, modifier: -1, total: 2, dc: 12, success: false })).toBe('d20 3 - 1 = 2 vs DC 12');
    expect(rollLine({ skill: 'Arcana', roll: 20, modifier: 0, total: 20, dc: 12, success: true })).toBe('d20 20 + 0 = 20 vs DC 12');
  });
  it('give a verdict only when there was a check', () => {
    const check = { skill: 'Athletics', roll: 14, modifier: 5, total: 19, dc: 13, success: true };
    expect(verdict(result())).toBeNull();
    expect(verdict(result({ check, success: true }))).toBe('Success');
    expect(verdict(result({ check: { ...check, success: false }, success: false }))).toBe('Failure');
  });
});

describe('outcomeChips', () => {
  it('is empty when nothing was gained or lost', () => {
    expect(outcomeChips(result())).toEqual([]);
  });
  it('lists what applies, in order', () => {
    expect(outcomeChips(result({ gold: 12, xp: 30, heal: 4, pp: 1, item: 'Small Healing Potion', damage: 3, leveled_up: true, new_level: 2, battle: true }))).toEqual([
      { kind: 'gold', text: '+12 gold' },
      { kind: 'xp', text: '+30 XP' },
      { kind: 'heal', text: '+4 HP' },
      { kind: 'pp', text: '+1 PP' },
      { kind: 'item', text: 'Small Healing Potion' },
      { kind: 'damage', text: '-3 HP' },
      { kind: 'level', text: 'Level 2!' },
      { kind: 'battle', text: 'A fight begins!' },
    ]);
    expect(outcomeChips(result({ gold: -7 }))).toEqual([{ kind: 'loss', text: '-7 gold' }]);
  });
});
