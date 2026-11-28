import { describe, expect, it } from 'vitest';
import { savedAtText, slotLine, slotRows, titleButtons, type SaveEntry } from './saves';

const save = (id: string): SaveEntry => ({
  id, name: 'Smoke', level: 3, race: 'Human', class_name: 'Fighter', location: 'Rivermeet Town', portrait: '',
  saved_at: '2026-11-28T14:05:09', created_at: '2026-11-27T09:00:00',
});

describe('save rows', () => {
  it('are one per slot, the saves first', () => {
    const rows = slotRows({ saves: [save('b'), save('a')], max_saves: 10, can_save: true });
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows.map((row) => row.save?.id ?? null)).toEqual(['b', 'a', null, null, null, null, null, null, null, null]);
    expect(slotRows({ saves: [], max_saves: 3, can_save: false }).every((row) => row.save === null)).toBe(true);
    expect(slotRows({ saves: [save('a'), save('b'), save('c')], max_saves: 2, can_save: true })).toHaveLength(3);
  });

  it('show when and what was saved', () => {
    expect(savedAtText('2026-11-28T14:05:09')).toBe('2026-11-28 14:05');
    expect(slotLine(save('a'))).toBe('Smoke · Level 3 Human Fighter · Rivermeet Town · 2026-11-28 14:05');
  });
});

describe('the title screen', () => {
  it('offers what there is', () => {
    expect(titleButtons(false, 0)).toEqual(['new']);
    expect(titleButtons(true, 0)).toEqual(['new', 'continue']);
    expect(titleButtons(false, 2)).toEqual(['new', 'load']);
    expect(titleButtons(true, 1)).toEqual(['new', 'continue', 'load']);
  });
});
