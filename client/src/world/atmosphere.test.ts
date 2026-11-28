import { describe, expect, it } from 'vitest';
import campaign from '../../../json/campaign.json';
import { GLOW_COLOURS, GLOW_MODELS, MAX_GLOWS, MAX_PARTICLES, airFor, flicker, glowPulse } from './atmosphere';
import { LOADING_CARD_SECONDS, loadingCard, type TravelView } from './campaign';
import { MANIFEST } from './dressingkit';

describe('the air', () => {
  it('is set for every location of the campaign and for the three types', () => {
    const table: Record<string, [string, string, number, string | null]> = {
      'Rivermeet Town': ['dust', '#d8c8a8', 120, 'water'], 'Whispering Woods': ['leaves', '#9ac46a', 160, null],
      'Abandoned Watchtower': ['dust', '#a8a4b0', 100, null], 'Emberforge Mountains': ['embers', '#ff8a3a', 140, null],
      'Sunken Temple of Dariel': ['motes', '#7fd8e0', 140, 'water'], 'Windswept Plains': ['leaves', '#d8c870', 180, null],
      'The Crystalline Caves': ['motes', '#c8a0ff', 140, 'crystal'], 'The Convergence': ['ash', '#9a5ad0', 160, 'void'],
    };
    const locations: { name: string; type: string }[] = [];
    for (const act of campaign.acts) for (const location of act.locations) locations.push({ name: location.name, type: location.type });
    expect(locations.map((l) => l.name).sort()).toEqual(Object.keys(table).sort());
    for (const location of locations) {
      const [drift, colour, count, glow] = table[location.name];
      expect(airFor(location.name, location.type)).toEqual({ drift, colour, count, glow });
      expect(count).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(airFor('Nowhere', 'town')).toEqual({ drift: 'dust', colour: '#d8c8a8', count: 120, glow: null });
    expect(airFor('Nowhere', 'swamp')).toEqual({ drift: 'leaves', colour: '#9ac46a', count: 160, glow: null });
    expect(airFor('Nowhere', 'dungeon')).toEqual({ drift: 'dust', colour: '#a8a4b0', count: 100, glow: null });
    expect(airFor('toString', 'town').drift).toBe('dust');
    expect(airFor('Rivermeet Town', 'town')).not.toBe(airFor('Rivermeet Town', 'town'));
  });

  it('glows with models that exist', () => {
    expect(MAX_PARTICLES).toBe(200);
    expect(MAX_GLOWS).toBe(6);
    expect(GLOW_COLOURS).toEqual({ water: '#4fc8e0', crystal: '#b48cff', void: '#8a3ad0' });
    for (const models of Object.values(GLOW_MODELS)) for (const model of models) expect(Object.keys(MANIFEST)).toContain(model);
  });
});

describe('flicker and glow', () => {
  it('flickers within its range, never still for long, never jumping', () => {
    const curves: string[] = [];
    for (let seed = 0; seed < 10; seed++) {
      const samples = Array.from({ length: 3601 }, (_, i) => flicker(i / 60, seed));
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.7);
      expect(Math.max(...samples)).toBeLessThanOrEqual(1.15);
      for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThanOrEqual(0.12);
      let least = Infinity;
      for (let start = 0; start + 120 < samples.length; start++) {
        const window = samples.slice(start, start + 121);
        least = Math.min(least, Math.max(...window) - Math.min(...window));
      }
      expect(least).toBeGreaterThanOrEqual(0.2); // the limit is 0.15
      expect(flicker(1.234, seed)).toBe(flicker(1.234, seed));
      curves.push(samples.slice(0, 60).join());
    }
    expect(new Set(curves).size).toBe(10);
  });

  it('pulses slowly between 0.6 and 1', () => {
    for (let seed = 0; seed < 10; seed++) {
      const samples = Array.from({ length: 3601 }, (_, i) => glowPulse(i / 60, seed));
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...samples)).toBeLessThanOrEqual(1);
      expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
      for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThanOrEqual(0.02);
    }
  });
});

describe('the loading card', () => {
  const view: TravelView = {
    current: 'Rivermeet Town',
    acts: [{ number: 1, title: 'One', locked: false, locked_reason: null, locations: [
      { name: 'Rivermeet Town', description: 'A town.', type: 'town', level_range: null, has_boss: false, cleared: false, current: true },
      { name: 'Whispering Woods', description: 'Old trees.', type: 'wilderness', level_range: '1-3', has_boss: true, cleared: false, current: false },
    ] }],
  };
  it('names the location one arrives in', () => {
    expect(LOADING_CARD_SECONDS).toBe(1.5);
    expect(loadingCard(view, null, 'Whispering Woods')).toEqual({ title: 'Whispering Woods', text: 'Old trees.' });
    expect(loadingCard(view, 'Rivermeet Town', 'Whispering Woods')).toEqual({ title: 'Whispering Woods', text: 'Old trees.' });
    expect(loadingCard(view, 'Whispering Woods', 'Whispering Woods')).toBeNull();
    expect(loadingCard(view, 'Rivermeet Town', 'The Road')).toBeNull();
    expect(loadingCard(null, null, 'Whispering Woods')).toBeNull();
  });
});
