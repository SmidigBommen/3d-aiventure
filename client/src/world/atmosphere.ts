// What is in the air of a location and what glows there, and how a flame flickers and a glow pulses.
// Pure: the renderer (areaScene.ts) draws what this file says. Nothing here is random.

import { generator } from './layout';

export type Drift = 'dust' | 'leaves' | 'embers' | 'motes' | 'ash';
export type GlowKind = 'water' | 'crystal' | 'void';
export interface Air { drift: Drift; colour: string; count: number; glow: GlowKind | null }

export const MAX_PARTICLES = 200;
export const MAX_GLOWS = 6;

const air = (drift: Drift, colour: string, count: number, glow: GlowKind | null = null): Air => ({ drift, colour, count, glow });

const AIR: Record<string, Air> = {
  'Rivermeet Town': air('dust', '#d8c8a8', 120, 'water'),
  'Whispering Woods': air('leaves', '#9ac46a', 160),
  'Abandoned Watchtower': air('dust', '#a8a4b0', 100),
  'Emberforge Mountains': air('embers', '#ff8a3a', 140),
  'Sunken Temple of Dariel': air('motes', '#7fd8e0', 140, 'water'),
  'Windswept Plains': air('leaves', '#d8c870', 180),
  'The Crystalline Caves': air('motes', '#c8a0ff', 140, 'crystal'),
  'The Convergence': air('ash', '#9a5ad0', 160, 'void'),
};
const DEFAULT_AIR: Record<'town' | 'wilderness' | 'dungeon', Air> = {
  town: air('dust', '#d8c8a8', 120),
  wilderness: air('leaves', '#9ac46a', 160),
  dungeon: air('dust', '#a8a4b0', 100),
};

/** The air of a location, by its name; an unknown one gets the default of its type. */
export function airFor(location: string, type: string): Air {
  const found = Object.prototype.hasOwnProperty.call(AIR, location) ? AIR[location] : DEFAULT_AIR[type === 'town' || type === 'dungeon' ? type : 'wilderness'];
  return { ...found };
}

/** The models that glow, per kind. Keys of models.json. The stone arch is the gateway of every area. */
export const GLOW_MODELS: Record<GlowKind, string[]> = {
  water: ['env/town/well', 'env/town/bucket_water', 'env/wilderness/water_lily', 'env/wilderness/water_plant'],
  crystal: ['props/crystal_big', 'props/crystal_cluster'],
  void: ['env/dungeon/arch_stone', 'props/shrine', 'env/dungeon/altar_shrine_candles'],
};
export const GLOW_COLOURS: Record<GlowKind, string> = { water: '#4fc8e0', crystal: '#b48cff', void: '#8a3ad0' };

const TURN = Math.PI * 2;
// Three waves per flame: a slow sway, a flutter and a shimmer. Their heights add up to 0.22 around 0.925.
const FLICKER_WAVES: [number, number][] = [[0.12, 1.7], [0.06, 4.3], [0.04, 9.1]];
const FLICKER_MIDDLE = 0.925;

/** The factor a flame's light strength is multiplied by at time `t` (seconds). Each seed has its own curve. */
export function flicker(t: number, seed: number): number {
  const rnd = generator(Math.floor(seed) * 2654435761);
  let value = FLICKER_MIDDLE;
  for (const [height, rate] of FLICKER_WAVES) {
    const phase = rnd() * TURN;
    const own = rate * (0.9 + 0.2 * rnd()); // no two flames keep time
    value += height * Math.sin(TURN * own * t + phase);
  }
  return Math.min(1.15, Math.max(0.7, value));
}

/** The factor of a glow at time `t`: a slow breath between 0.6 and 1. */
export function glowPulse(t: number, seed: number): number {
  const rnd = generator(Math.floor(seed) * 2246822519 + 7);
  const phase = rnd() * TURN;
  const rate = 0.35 + 0.15 * rnd();
  return Math.min(1, Math.max(0.6, 0.8 + 0.2 * Math.sin(TURN * rate * t + phase)));
}
