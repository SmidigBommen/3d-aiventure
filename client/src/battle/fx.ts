// What each effect key of a turn event looks like: a colour and the shape its particles move in.
// The renderer draws them; nothing here renders. Pure.

import type { FloatStyle } from './timeline';

export type FxPattern =
  | 'slash' | 'spikes' | 'thud' | 'flame' | 'shards' | 'bolt' | 'drip' | 'burst' | 'ring' | 'implode' | 'spiral' | 'wave' | 'rise' | 'fall' | 'dome'
  | 'orbit';
export interface FxLook { color: string; pattern: FxPattern }

const fx = (color: string, pattern: FxPattern): FxLook => ({ color, pattern });

/** One look per key of FX_KEYS (timeline.ts); no two share both colour and shape. */
export const FX_LOOKS: Record<string, FxLook> = {
  slashing: fx('#e8e8f0', 'slash'),
  piercing: fx('#d9d2b8', 'spikes'),
  bludgeoning: fx('#c9a66b', 'thud'),
  fire: fx('#ff7a1a', 'flame'),
  cold: fx('#8fd8ff', 'shards'),
  lightning: fx('#fff27a', 'bolt'),
  poison: fx('#7bd23c', 'drip'),
  acid: fx('#c8ff3a', 'burst'),
  radiant: fx('#ffe9a0', 'ring'),
  necrotic: fx('#7a3fb0', 'implode'),
  force: fx('#b48bff', 'burst'),
  psychic: fx('#ff6ad5', 'spiral'),
  thunder: fx('#9fb4ff', 'wave'),
  heal: fx('#5fe08a', 'rise'),
  buff: fx('#ffd35a', 'spiral'),
  debuff: fx('#a05ad0', 'fall'),
  shield: fx('#6fb8ff', 'dome'),
  stun: fx('#ffe14a', 'orbit'),
  rage: fx('#ff2a2a', 'flame'),
  bleed: fx('#c81e1e', 'drip'),
  burn: fx('#ff9a3a', 'rise'),
  regen: fx('#4fd0a0', 'spiral'),
  impact: fx('#ffffff', 'thud'),
};

export function fxLook(key: string): FxLook {
  return Object.prototype.hasOwnProperty.call(FX_LOOKS, key) ? FX_LOOKS[key] : FX_LOOKS.impact;
}

/** How a floating text looks, by its style: colour and size in rem. */
export const FLOAT_LOOKS: Record<FloatStyle, { color: string; size: number }> = {
  damage: { color: '#ff5a4f', size: 1.7 },
  crit: { color: '#ffd35a', size: 2.6 },
  heal: { color: '#5fe08a', size: 2.0 },
  miss: { color: '#a9a6b3', size: 1.3 },
};

/** Where on the screen an effect on the player shows, by its shape. */
export type FlashPlace = 'edge' | 'top' | 'bottom' | 'streak';
export function flashPlace(pattern: FxPattern): FlashPlace {
  if (pattern === 'slash' || pattern === 'spikes' || pattern === 'bolt') return 'streak';
  if (pattern === 'rise' || pattern === 'spiral' || pattern === 'dome' || pattern === 'flame') return 'bottom';
  if (pattern === 'fall' || pattern === 'drip' || pattern === 'orbit') return 'top';
  return 'edge';
}
