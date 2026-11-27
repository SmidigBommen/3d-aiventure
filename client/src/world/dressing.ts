// The dressing of an area: which model stands where, and the mood of its location.
// Pure and deterministic like layout.ts: the only randomness is a generator seeded from the area's
// location and id. No rendering and no browser here; areaScene.ts places what this says.

import type { Vec2 } from '../input/movement';
import {
  INWARD, boundaryBlocks, boundaryRuns, boxDistance, gatePoint, generator, hash, rectsOverlap, segmentHitsRect, triggerRect,
  type AreaLayout, type AreaSpec, type Box, type Gate, type LocationType, type Rect, type Side,
} from './layout';
import manifest from './models.json';

export interface DressSpec extends AreaSpec {
  shop: boolean; // the area has a shop
  rest: boolean; // the player can rest here
  boss: boolean; // the campaign places a boss here (defeated or not)
  special: string | null; // the area's `special`, or null
}
export type PlacementRole = 'ground' | 'boundary' | 'gate' | 'prop' | 'landmark';
export type LandmarkKind = 'shop' | 'rest' | 'boss' | 'special';
export interface Placement {
  model: string; // a key of models.json
  role: PlacementRole;
  landmark: LandmarkKind | null; // non-null exactly when role is 'landmark'
  gate: string | null; // the exitId of the gate it belongs to, exactly when role is 'gate'
  x: number; // (x, z): centre of the footprint
  y: number; // height of the model's lowest point
  z: number;
  rotation: number; // radians about the y axis
  scale: [number, number, number]; // along the model's own x, y, z
  tint: string | null; // '#rrggbb' multiplied into the model's colours, or null
  solid: Box | null; // what blocks the player, or null
}
export interface Mood {
  sky: string; // sky colour; in a dungeon the ceiling and background colour
  fog: string;
  fogNear: number; // m
  fogFar: number; // m
  light: string; // the main light
  intensity: number; // of the main light
  ground: string; // tint of the ground
}
export interface Dressing {
  mood: Mood;
  placements: Placement[];
  layout: AreaLayout; // the layout to walk in: the input's floor, gates and spawn, with the placements' solids
}

const MODELS = manifest as unknown as Record<string, { size: number[]; triangles: number }>;

/** Bounding size of a model in file units: width (x), height (y), depth (z). */
export function modelSize(model: string): [number, number, number] {
  const entry = MODELS[model];
  if (!entry) throw new Error(`no model "${model}" in models.json`);
  return [entry.size[0], entry.size[1], entry.size[2]];
}

/** Half extents of the axis-aligned rectangle a placement covers on the ground, and its height. */
export function footprint(model: string, scale: [number, number, number], rotation: number): { halfX: number; halfZ: number; height: number } {
  const [w, h, d] = modelSize(model);
  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  const W = w * scale[0];
  const D = d * scale[2];
  return { halfX: (c * W + s * D) / 2, halfZ: (s * W + c * D) / 2, height: h * scale[1] };
}

// --- moods ---------------------------------------------------------------------------------------

const mood = (sky: string, fog: string, fogNear: number, fogFar: number, light: string, intensity: number, ground: string): Mood =>
  ({ sky, fog, fogNear, fogFar, light, intensity, ground });

const MOODS: Record<string, Mood> = {
  'Rivermeet Town': mood('#2b2438', '#4a3a44', 30, 110, '#ffb27a', 1.6, '#8a8474'),
  'Whispering Woods': mood('#1f2e2a', '#2f4a3c', 10, 55, '#bfe0a8', 1.2, '#4f7a44'),
  'Abandoned Watchtower': mood('#1a1c24', '#23262f', 12, 60, '#ffc890', 1.0, '#6a6672'),
  'Emberforge Mountains': mood('#3a1c14', '#5a2a1a', 14, 70, '#ff8a4a', 1.5, '#7a5a48'),
  'Sunken Temple of Dariel': mood('#0c2630', '#12404a', 8, 45, '#7fd8e0', 0.9, '#4a7078'),
  'Windswept Plains': mood('#4a4a5e', '#8a8a7a', 25, 120, '#fff0c8', 1.8, '#a09a5a'),
  'The Crystalline Caves': mood('#1a1030', '#3a2468', 10, 50, '#c8a0ff', 0.9, '#6a5a9a'),
  'The Convergence': mood('#07050c', '#140a1e', 6, 38, '#9a5ad0', 0.5, '#3a3044'),
};
const DEFAULT_MOODS: Record<LocationType, Mood> = {
  town: mood('#2b2438', '#4a3a44', 30, 110, '#ffb27a', 1.6, '#8a8474'),
  wilderness: mood('#1f2e2a', '#2f4a3c', 10, 55, '#bfe0a8', 1.2, '#4f7a44'),
  dungeon: mood('#1a1c24', '#23262f', 12, 60, '#ffc890', 1.0, '#6a6672'),
};

const kindOf = (type: string): LocationType => (type === 'town' || type === 'dungeon' ? type : 'wilderness');

/** The mood of a location; an unknown name gets the default of its type. */
export function moodFor(location: string, type: string): Mood {
  const found = Object.prototype.hasOwnProperty.call(MOODS, location) ? MOODS[location] : DEFAULT_MOODS[kindOf(type)];
  return { ...found };
}

// --- landmarks -----------------------------------------------------------------------------------

export const SPECIAL_LANDMARKS: Record<string, string> = {
  town_center: 'env/town/well',
  water_access: 'env/dungeon/floor_wood_large',
  mysterious_runes: 'env/wilderness/bridge_a',
  hidden_treasure: 'props/chest',
  magical_forge: 'env/town/blacksmith_forge',
  hidden_passage: 'env/dungeon/wall_gated',
  ancient_treasures: 'props/chest_gold',
  wind_blessing: 'env/dungeon/altar_shrine_candles',
  crystal_forest: 'props/crystal_big',
  precious_gems: 'props/crystal_cluster',
  tactical_advantage: 'env/dungeon/stairs_walled',
  prisoner_rescue: 'env/dungeon/fence_iron_bars',
  magical_research: 'props/cabinet',
};

/** One kind of thing to put down: a model at a target height, and how much of its footprint blocks. */
interface Item {
  model: string;
  height: number; // m after scaling (capped by a dungeon's ceiling)
  solid?: number; // share of the footprint that blocks (trunk of a tree: 0.22); 0 or missing: nothing, when lower than 0.5 m
  turn?: 'any' | 'quarter'; // free rotation, or steps of 90 degrees (default)
  vary?: boolean; // size differs by up to 15% from one to the next
  tint?: string | null;
  full?: boolean; // in a dungeon: from floor to ceiling
  wall?: boolean; // stands with its back to the boundary
  stretch?: [number, number, number]; // relative scale per axis, for a model that is laid out longer
}

const SHOP: Item = { model: 'env/town/market_stand', height: 2.6, solid: 0.95 };
const INN: Item = { model: 'env/town/tavern', height: 6.2, solid: 1, wall: true };
const CAMPFIRE: Item = { model: 'env/wilderness/campfire', height: 0.42, solid: 0.6, turn: 'any' };
const SPECIALS: Record<string, Item> = {
  town_center: { model: SPECIAL_LANDMARKS.town_center, height: 3, solid: 0.9 },
  water_access: { model: SPECIAL_LANDMARKS.water_access, height: 0.15, stretch: [1.45, 1, 1] },
  mysterious_runes: { model: SPECIAL_LANDMARKS.mysterious_runes, height: 3.4, solid: 1 },
  hidden_treasure: { model: SPECIAL_LANDMARKS.hidden_treasure, height: 1, solid: 0.9 },
  magical_forge: { model: SPECIAL_LANDMARKS.magical_forge, height: 4.2, solid: 1 },
  hidden_passage: { model: SPECIAL_LANDMARKS.hidden_passage, height: 3.2, solid: 1, wall: true },
  ancient_treasures: { model: SPECIAL_LANDMARKS.ancient_treasures, height: 1, solid: 0.9 },
  wind_blessing: { model: SPECIAL_LANDMARKS.wind_blessing, height: 2.1, solid: 0.9 },
  crystal_forest: { model: SPECIAL_LANDMARKS.crystal_forest, height: 2.8, solid: 0.7, turn: 'any' },
  precious_gems: { model: SPECIAL_LANDMARKS.precious_gems, height: 1.4, solid: 0.8, turn: 'any' },
  tactical_advantage: { model: SPECIAL_LANDMARKS.tactical_advantage, height: 3.2, solid: 1, wall: true },
  prisoner_rescue: { model: SPECIAL_LANDMARKS.prisoner_rescue, height: 2.2, solid: 1 },
  magical_research: { model: SPECIAL_LANDMARKS.magical_research, height: 2, solid: 1, wall: true },
};

// --- themes: what a location is dressed with -----------------------------------------------------------

/** The run of models along the edge of the floor. */
interface Edge {
  models: string[];
  long: 0 | 2; // the model's axis that runs along the edge: x or z
  length: number; // m, wanted length of one piece (pieces are stretched to fill a run exactly)
  height: number; // m; a dungeon wall reaches the ceiling instead
  thickness: number; // m
  tint: string | null;
}
interface Theme {
  tiles: { model: string; other: string | null; tint: string | null } | null; // paving over the whole floor
  path: { model: string; tint: string | null } | null; // laid from the default spawn to every gate
  scatter: Item[]; // ground cover without collision
  scatterPer: number; // m2 of floor per piece of scatter
  edge: Edge;
  backdrop: Item[]; // stands outside the floor (houses, the tree line, hills)
  wallDecor: Item[]; // hangs on a dungeon's walls
  gate: { model: string; tint: string | null };
  props: Item[]; // the first six are placed first, so they must be different models
  propsPer: number; // m2 of floor per prop
  arena: { centre: Item; ring: Item[] };
}

const TREE = { solid: 0.22, turn: 'any', vary: true } as const;
const ARCH = 'env/dungeon/arch_stone';
const ARCH_OPENING = 3; // file units between the arch's legs

const TOWN: Theme = {
  tiles: { model: 'env/dungeon/floor_tile_large', other: 'env/dungeon/floor_dirt_large', tint: '#d8c8a8' },
  path: null,
  scatter: [{ model: 'env/wilderness/tall_grass', height: 0.5, turn: 'any', vary: true }, { model: 'env/town/sack', height: 0.3, turn: 'any' }, { model: 'env/town/bucket_water', height: 0.35 }],
  scatterPer: 60,
  edge: { models: ['env/town/fence_stone'], long: 2, length: 4, height: 1.3, thickness: 0.7, tint: null },
  backdrop: [
    { model: 'env/town/house_a', height: 6.5 }, { model: 'env/town/house_b', height: 8 }, { model: 'env/town/house_a', height: 6 },
    { model: 'env/town/blacksmith', height: 6 }, { model: 'env/wilderness/tree_a', height: 7, turn: 'any' }, { model: 'env/town/house_b', height: 7.5 },
    { model: 'env/town/church', height: 11 },
  ],
  wallDecor: [],
  gate: { model: ARCH, tint: null },
  props: [
    { model: 'env/town/barrel_large', height: 1.4, solid: 0.9 },
    { model: 'env/town/lantern_post', height: 2.6, solid: 0.3 },
    { model: 'env/town/crates_stacked', height: 1.5, solid: 0.9 },
    { model: 'env/town/cart', height: 1.5, solid: 0.85, turn: 'any' },
    { model: 'env/town/bench', height: 0.45, solid: 0.9 },
    { model: 'env/wilderness/tree_a', height: 6, ...TREE },
    { model: 'env/town/crate_big', height: 0.8, solid: 0.95 },
    { model: 'env/town/barrel', height: 0.9, solid: 0.9 },
    { model: 'env/town/wheelbarrow', height: 0.6, solid: 0.8, turn: 'any' },
    { model: 'env/town/weapon_rack', height: 1.4, solid: 0.8 },
    { model: 'env/town/tent', height: 2.5, solid: 0.85 },
    { model: 'env/town/signpost', height: 2, solid: 0.5 },
    { model: 'env/town/keg', height: 1.4, solid: 0.9 },
  ],
  propsPer: 55,
  arena: {
    centre: { model: 'props/statue_stag', height: 3, solid: 0.9 },
    ring: [{ model: 'env/dungeon/column', height: 1.4, solid: 0.9 }, { model: 'env/town/lantern_standing', height: 0.8, solid: 0.8 }],
  },
};

const WOODS: Theme = {
  tiles: null,
  path: { model: 'env/dungeon/floor_dirt_large', tint: '#b89a70' },
  scatter: [
    { model: 'env/wilderness/tall_grass', height: 0.7, turn: 'any', vary: true }, { model: 'env/wilderness/tall_grass', height: 0.55, turn: 'any', vary: true },
    { model: 'env/wilderness/mushroom', height: 0.3, turn: 'any', vary: true }, { model: 'env/wilderness/tall_grass', height: 0.8, turn: 'any', vary: true },
    { model: 'env/wilderness/rock_a', height: 0.3, turn: 'any', vary: true },
  ],
  scatterPer: 14,
  edge: { models: ['env/wilderness/bush'], long: 0, length: 2.6, height: 1.6, thickness: 2, tint: '#9ab08a' },
  backdrop: [
    { model: 'env/wilderness/trees_group_a', height: 6.5, turn: 'any', vary: true }, { model: 'env/wilderness/tree_a', height: 8, turn: 'any', vary: true },
    { model: 'env/wilderness/trees_group_b', height: 7.5, turn: 'any', vary: true }, { model: 'env/wilderness/tree_b', height: 8.5, turn: 'any', vary: true },
  ],
  wallDecor: [],
  gate: { model: ARCH, tint: '#9aa88a' },
  props: [
    { model: 'env/wilderness/tree_a', height: 7, ...TREE },
    { model: 'env/wilderness/tree_b', height: 7.5, ...TREE },
    { model: 'env/wilderness/rock_c', height: 1.1, solid: 0.8, turn: 'any', vary: true },
    { model: 'env/wilderness/logs', height: 0.85, solid: 0.9, turn: 'any' },
    { model: 'env/wilderness/tree_stump_moss', height: 0.6, solid: 0.7, turn: 'any' },
    { model: 'env/wilderness/tree_c', height: 6.5, ...TREE },
    { model: 'env/wilderness/tree_a', height: 6, ...TREE },
    { model: 'env/wilderness/tree_b', height: 6.5, ...TREE },
    { model: 'env/wilderness/rock_b', height: 0.8, solid: 0.8, turn: 'any', vary: true },
    { model: 'env/wilderness/tree_a', height: 8, ...TREE },
  ],
  propsPer: 42,
  arena: {
    centre: { model: 'props/statue_stag', height: 3.2, solid: 0.9, tint: '#a8c098' },
    ring: [{ model: 'env/dungeon/pillar_grave', height: 2.4, solid: 0.9, tint: '#9aa88a' }, { model: 'env/wilderness/rock_c', height: 1.2, solid: 0.8, turn: 'any' }],
  },
};

const MOUNTAINS: Theme = {
  ...WOODS,
  path: { model: 'env/dungeon/floor_dirt_large', tint: '#a07860' },
  scatter: [
    { model: 'env/wilderness/rock_a', height: 0.3, turn: 'any', vary: true, tint: '#b08a78' }, { model: 'env/wilderness/tall_grass', height: 0.45, turn: 'any', vary: true, tint: '#c8a070' },
    { model: 'env/wilderness/rock_b', height: 0.35, turn: 'any', vary: true, tint: '#b08a78' },
  ],
  scatterPer: 22,
  edge: { models: ['env/wilderness/rock_b', 'env/wilderness/rock_d', 'env/wilderness/rock_c'], long: 0, length: 3.2, height: 1.9, thickness: 2.4, tint: '#b08a78' },
  backdrop: [
    { model: 'env/wilderness/hill', height: 6, vary: true, tint: '#8a6a58' }, { model: 'env/wilderness/rock_c', height: 4, turn: 'any', vary: true, tint: '#b08a78' },
    { model: 'env/wilderness/tree_dead_large', height: 7, turn: 'any', vary: true }, { model: 'env/wilderness/hill', height: 8, vary: true, tint: '#7a5a4a' },
  ],
  gate: { model: ARCH, tint: '#c8a090' },
  props: [
    { model: 'env/wilderness/rock_c', height: 2.2, solid: 0.75, turn: 'any', vary: true, tint: '#b08a78' },
    { model: 'env/wilderness/tree_dead_large', height: 6, ...TREE },
    { model: 'env/wilderness/stone_pile', height: 1.4, solid: 0.85, turn: 'any' },
    { model: 'env/wilderness/rock_d', height: 1.6, solid: 0.8, turn: 'any', vary: true, tint: '#b08a78' },
    { model: 'env/town/wheelbarrow', height: 0.6, solid: 0.8, turn: 'any' },
    { model: 'env/wilderness/tree_dead_medium', height: 5, ...TREE },
    { model: 'env/town/crate_big', height: 0.8, solid: 0.95 },
    { model: 'env/wilderness/rock_b', height: 1.2, solid: 0.8, turn: 'any', vary: true, tint: '#b08a78' },
    { model: 'env/town/barrel', height: 0.9, solid: 0.9 },
    { model: 'env/wilderness/logs', height: 0.85, solid: 0.9, turn: 'any' },
    { model: 'env/town/lantern_standing', height: 0.7, solid: 0.8 },
    { model: 'env/town/cart', height: 1.5, solid: 0.85, turn: 'any' },
  ],
  propsPer: 48,
  arena: {
    centre: { model: 'props/shrine', height: 2.8, solid: 0.9, tint: '#ffb090' },
    ring: [{ model: 'env/dungeon/pillar_grave', height: 2.6, solid: 0.9, tint: '#c8a090' }, { model: 'env/town/lantern_standing', height: 0.9, solid: 0.8 }],
  },
};

const PLAINS: Theme = {
  ...WOODS,
  path: { model: 'env/dungeon/floor_dirt_large', tint: '#c8b888' },
  scatter: [
    { model: 'env/wilderness/tall_grass', height: 0.9, turn: 'any', vary: true, tint: '#e0d890' }, { model: 'env/wilderness/tall_grass', height: 0.7, turn: 'any', vary: true, tint: '#e0d890' },
    { model: 'env/wilderness/tall_grass', height: 0.6, turn: 'any', vary: true, tint: '#c8d088' }, { model: 'env/wilderness/rock_a', height: 0.25, turn: 'any', vary: true },
  ],
  scatterPer: 11,
  edge: { models: ['env/town/fence_wood'], long: 2, length: 2.4, height: 1.2, thickness: 0.22, tint: null },
  backdrop: [
    { model: 'env/wilderness/hill', height: 3.5, vary: true, tint: '#d8d080' }, { model: 'env/wilderness/rock_d', height: 2.4, turn: 'any', vary: true },
    { model: 'env/wilderness/hill', height: 5, vary: true, tint: '#c8c070' }, { model: 'env/wilderness/tree_dead_medium', height: 6, turn: 'any', vary: true },
  ],
  gate: { model: ARCH, tint: '#d8d0b8' },
  props: [
    { model: 'env/wilderness/rock_d', height: 1, solid: 0.8, turn: 'any', vary: true },
    { model: 'env/town/tent', height: 2.5, solid: 0.85, turn: 'any', tint: '#d8c8a0' },
    { model: 'env/wilderness/tree_dead_medium', height: 5, ...TREE },
    { model: 'props/gravemarker_a', height: 0.9, solid: 0.8 },
    { model: 'env/wilderness/stone_pile', height: 1.2, solid: 0.85, turn: 'any' },
    { model: 'env/wilderness/logs', height: 0.85, solid: 0.9, turn: 'any' },
    { model: 'env/wilderness/rock_a', height: 0.5, solid: 0.8, turn: 'any', vary: true },
    { model: 'props/gravemarker_b', height: 0.9, solid: 0.8 },
    { model: 'env/wilderness/tree_a', height: 6, ...TREE, tint: '#e0d890' },
    { model: 'env/wilderness/rock_d', height: 1.4, solid: 0.8, turn: 'any', vary: true },
  ],
  propsPer: 60,
  arena: {
    centre: { model: 'props/statue_horse', height: 3.6, solid: 0.9 },
    ring: [{ model: 'props/gravemarker_a', height: 1.2, solid: 0.8 }, { model: 'env/wilderness/rock_c', height: 1.3, solid: 0.8, turn: 'any' }],
  },
};

const WATCHTOWER: Theme = {
  tiles: { model: 'env/dungeon/floor_tile_large', other: 'env/dungeon/floor_dirt_large', tint: null },
  path: null,
  scatter: [{ model: 'props/bone', height: 0.11, turn: 'any' }, { model: 'env/town/sack', height: 0.3, turn: 'any' }, { model: 'props/skull', height: 0.27, turn: 'any' }],
  scatterPer: 70,
  edge: { models: ['env/dungeon/wall', 'env/dungeon/wall', 'env/dungeon/wall', 'env/dungeon/wall_window_closed', 'env/dungeon/wall', 'env/dungeon/wall_broken'], long: 0, length: 4, height: 4, thickness: 0.7, tint: null },
  backdrop: [],
  wallDecor: [{ model: 'env/dungeon/banner_red', height: 2.3 }, { model: 'env/dungeon/torch_mounted', height: 0.8 }, { model: 'props/sword_shield_wall', height: 1.2 }, { model: 'env/dungeon/torch_mounted', height: 0.8 }],
  gate: { model: ARCH, tint: null },
  props: [
    { model: 'env/dungeon/pillar', height: 4, solid: 0.95, full: true },
    { model: 'env/town/barrel_large', height: 1.4, solid: 0.9 },
    { model: 'env/town/crates_stacked', height: 1.5, solid: 0.9 },
    { model: 'env/dungeon/rubble_half', height: 1.6, solid: 0.7 },
    { model: 'env/town/weapon_rack', height: 1.4, solid: 0.8 },
    { model: 'env/dungeon/column', height: 1.1, solid: 0.9 },
    { model: 'env/dungeon/pillar', height: 4, solid: 0.95, full: true },
    { model: 'env/dungeon/barrier', height: 0.8, solid: 0.95 },
    { model: 'env/town/lantern_standing', height: 0.7, solid: 0.8 },
    { model: 'env/town/keg', height: 1.4, solid: 0.9 },
    { model: 'env/town/table', height: 0.75, solid: 0.9 },
    { model: 'env/town/crate_big', height: 0.8, solid: 0.95 },
  ],
  propsPer: 55,
  arena: {
    centre: { model: 'props/statue_horse', height: 3.2, solid: 0.9 },
    ring: [{ model: 'env/dungeon/column', height: 1.4, solid: 0.9 }, { model: 'env/town/lantern_standing', height: 0.8, solid: 0.8 }],
  },
};

const TEMPLE: Theme = {
  ...WATCHTOWER,
  tiles: { model: 'env/dungeon/floor_tile_large', other: 'env/dungeon/floor_tile_big_grate', tint: '#a8d0d0' },
  scatter: [{ model: 'env/wilderness/water_lily', height: 0.08, turn: 'any' }, { model: 'env/wilderness/water_plant', height: 0.5, turn: 'any' }, { model: 'env/wilderness/water_lily', height: 0.1, turn: 'any' }],
  scatterPer: 30,
  edge: { ...WATCHTOWER.edge, models: ['env/dungeon/wall', 'env/dungeon/wall', 'env/dungeon/wall_cracked', 'env/dungeon/wall', 'env/dungeon/wall_broken'], tint: '#a8d8d8' },
  wallDecor: [{ model: 'env/dungeon/banner_shield_blue', height: 2.3 }, { model: 'env/dungeon/torch_mounted', height: 0.8 }],
  gate: { model: ARCH, tint: '#a8d8d8' },
  props: [
    { model: 'env/dungeon/pillar', height: 4, solid: 0.95, full: true, tint: '#a8d8d8' },
    { model: 'env/dungeon/column', height: 1.4, solid: 0.9 },
    { model: 'env/dungeon/rubble_half', height: 1.4, solid: 0.7, tint: '#a8d8d8' },
    { model: 'env/dungeon/coffin', height: 0.96, solid: 0.9 },
    { model: 'props/plaque_candles', height: 0.85, solid: 0.9 },
    { model: 'props/shrine', height: 1.75, solid: 0.9 },
    { model: 'env/dungeon/pillar_decorated', height: 4, solid: 0.8, full: true },
    { model: 'env/dungeon/rubble_large', height: 1.8, solid: 0.7, tint: '#a8d8d8' },
    { model: 'env/dungeon/pillar', height: 4, solid: 0.95, full: true, tint: '#a8d8d8' },
    { model: 'props/statue_horse', height: 3.2, solid: 0.9, tint: '#a8d8d8' },
  ],
  arena: {
    centre: { model: 'props/shrine', height: 2.6, solid: 0.9 },
    ring: [{ model: 'env/dungeon/pillar_grave', height: 2.6, solid: 0.9, tint: '#a8d8d8' }, { model: 'env/dungeon/column', height: 1.5, solid: 0.9 }],
  },
};

const CAVES: Theme = {
  ...WATCHTOWER,
  tiles: { model: 'env/dungeon/floor_dirt_large', other: null, tint: '#b8a8e0' },
  scatter: [{ model: 'env/wilderness/mushroom', height: 0.35, turn: 'any', vary: true, tint: '#c8a0ff' }, { model: 'env/wilderness/rock_a', height: 0.25, turn: 'any', vary: true, tint: '#a898d0' }],
  scatterPer: 30,
  edge: { ...WATCHTOWER.edge, models: ['env/dungeon/wall', 'env/dungeon/wall_cracked', 'env/dungeon/wall', 'env/dungeon/wall'], tint: '#9a88c8' },
  wallDecor: [{ model: 'env/dungeon/torch_mounted', height: 0.8 }],
  gate: { model: ARCH, tint: '#b8a8e0' },
  props: [
    { model: 'props/crystal_big', height: 1.7, solid: 0.7, turn: 'any', vary: true },
    { model: 'env/wilderness/rock_c', height: 1.8, solid: 0.8, turn: 'any', vary: true, tint: '#a898d0' },
    { model: 'props/crystal_cluster', height: 0.9, solid: 0.8, turn: 'any', vary: true },
    { model: 'env/dungeon/pillar_grave', height: 3, solid: 0.9, tint: '#a898d0' },
    { model: 'env/wilderness/stone_pile', height: 1.4, solid: 0.85, turn: 'any', tint: '#a898d0' },
    { model: 'env/wilderness/rock_d', height: 1.3, solid: 0.8, turn: 'any', vary: true, tint: '#a898d0' },
    { model: 'props/crystal_big', height: 2.2, solid: 0.7, turn: 'any', vary: true, tint: '#ffb0e0' },
    { model: 'env/wilderness/rock_b', height: 1, solid: 0.8, turn: 'any', vary: true, tint: '#a898d0' },
  ],
  propsPer: 50,
  arena: {
    centre: { model: 'env/wilderness/stone_pile', height: 2.6, solid: 0.85, tint: '#a898d0' },
    ring: [{ model: 'env/wilderness/rock_d', height: 1.5, solid: 0.8, turn: 'any', tint: '#a898d0' }, { model: 'env/dungeon/pillar_grave', height: 2.8, solid: 0.9, tint: '#a898d0' }],
  },
};

const CONVERGENCE: Theme = {
  ...WATCHTOWER,
  tiles: { model: 'env/dungeon/floor_tile_large', other: 'env/dungeon/floor_tile_big_grate', tint: '#a890c0' },
  scatter: [{ model: 'props/bone', height: 0.11, turn: 'any' }, { model: 'props/skull', height: 0.27, turn: 'any' }, { model: 'env/dungeon/candle_triple', height: 0.35, turn: 'any' }],
  scatterPer: 40,
  edge: { ...WATCHTOWER.edge, models: ['env/dungeon/wall', 'env/dungeon/wall', 'env/dungeon/wall_window_closed', 'env/dungeon/wall', 'env/dungeon/wall_cracked'], tint: '#9078a8' },
  wallDecor: [{ model: 'env/dungeon/banner_red', height: 2.3, tint: '#c080ff' }, { model: 'env/dungeon/torch_mounted', height: 0.8 }, { model: 'props/sword_shield_wall_gold', height: 1.2 }],
  gate: { model: ARCH, tint: '#9078a8' },
  props: [
    { model: 'env/dungeon/pillar_decorated', height: 4, solid: 0.8, full: true },
    { model: 'env/dungeon/coffin', height: 0.96, solid: 0.9 },
    { model: 'props/grave_a', height: 1.55, solid: 0.9 },
    { model: 'env/dungeon/pillar', height: 4, solid: 0.95, full: true, tint: '#9078a8' },
    { model: 'props/ribcage', height: 0.6, solid: 0.8, turn: 'any' },
    { model: 'props/tombstone', height: 1.16, solid: 0.9 },
    { model: 'props/shelves', height: 1.95, solid: 1 },
    { model: 'env/town/weapon_rack', height: 1.4, solid: 0.8 },
    { model: 'env/town/lantern_standing', height: 0.7, solid: 0.8 },
    { model: 'env/dungeon/barrier', height: 0.8, solid: 0.95 },
    { model: 'props/statue_horse', height: 3.2, solid: 0.9, tint: '#9078a8' },
  ],
  arena: {
    centre: { model: 'props/shrine', height: 2.8, solid: 0.9, tint: '#c080ff' },
    ring: [{ model: 'env/dungeon/pillar_grave', height: 2.8, solid: 0.9, tint: '#9078a8' }, { model: 'env/dungeon/pillar_grave', height: 2.2, solid: 0.9, tint: '#9078a8' }],
  },
};

const THEMES: Record<string, Theme> = {
  'Rivermeet Town': TOWN,
  'Whispering Woods': WOODS,
  'Abandoned Watchtower': WATCHTOWER,
  'Emberforge Mountains': MOUNTAINS,
  'Sunken Temple of Dariel': TEMPLE,
  'Windswept Plains': PLAINS,
  'The Crystalline Caves': CAVES,
  'The Convergence': CONVERGENCE,
};
const DEFAULT_THEMES: Record<LocationType, Theme> = { town: TOWN, wilderness: WOODS, dungeon: WATCHTOWER };

// --- placing -----------------------------------------------------------------------------------------

const EDGE_MARGIN = 0.05; // m a prop's footprint keeps from the floor's edge
const SOLID_GAP = 1; // m between two solids, between a solid and a path or a trigger zone: room to walk
const FOOTPRINT_GAP = 0.1; // m between two footprints (a canopy does not grow into the next)
const ZONE_GAP = 0.3; // m between a footprint and a trigger zone
const SPAWN_GAP = 1.5; // m between a footprint and a spawn point
const GATE_HEIGHT = 3.3; // m, the gateway; its opening is then 2.7 m high in the middle
const GROUND_TOP = 0.06; // m above the floor plane: where the top of a paving tile lies
const ARRIVAL = 5; // m kept open in front of a gate's spawn point
const GRID = 0.25;

const snap = (value: number): number => Math.round(value / GRID) * GRID + 0;

interface Candidate {
  placement: Placement;
  rect: Rect;
}

export function dressArea(layout: AreaLayout, area: DressSpec): Dressing {
  const theme = Object.prototype.hasOwnProperty.call(THEMES, area.location) ? THEMES[area.location] : DEFAULT_THEMES[layout.type];
  const rnd = generator(hash(`dressing/${area.location}/${area.id}`));
  const between = (low: number, high: number): number => low + rnd() * (high - low);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const { halfX, halfZ } = layout.floor;
  const ceiling = layout.ceiling;
  const cap = ceiling === null ? Infinity : ceiling - 0.05;

  const placements: Placement[] = [];
  const standing: Candidate[] = []; // the props and landmarks placed so far
  const spawns: Vec2[] = [layout.spawn, ...layout.gates.map((g) => g.spawn)];
  // What solids keep off: the straight lines a walker takes to a gate, and the first steps into the
  // area from a gate, so that whoever comes in sees the place and not the back of a tent.
  const paths: [Vec2, Vec2][] = layout.gates.flatMap((g): [Vec2, Vec2][] => [
    [layout.spawn, gatePoint(g)],
    [g.spawn, gatePoint(g)],
    [g.spawn, { x: g.spawn.x + INWARD[g.side].x * ARRIVAL, z: g.spawn.z + INWARD[g.side].z * ARRIVAL }],
  ]);
  const zones = layout.gates.map(triggerRect);

  const scaleOf = (item: Item, factor: number): [number, number, number] => {
    const h = modelSize(item.model)[1];
    if (item.full && ceiling !== null) {
      const y = (ceiling - 0.02) / h;
      const across = Math.max(0.8, y / 1.45);
      return [across, y, across];
    }
    const s = Math.min(item.height * factor, cap) / h;
    const [sx, sy, sz] = item.stretch ?? [1, 1, 1];
    return [s * sx, s * sy, s * sz];
  };
  const turnOf = (item: Item): number => (item.turn === 'any' ? snapAngle(rnd() * Math.PI * 2) : Math.floor(rnd() * 4) * (Math.PI / 2));

  /** A prop or landmark of `item` centred on (x, z); what blocks is a share of its footprint. */
  const candidate = (item: Item, landmark: LandmarkKind | null, x: number, z: number, rotation: number, scale: [number, number, number]): Candidate => {
    const f = footprint(item.model, scale, rotation);
    const share = Math.min(1, Math.max(item.solid ?? 0, f.height >= 0.5 ? 0.2 : 0));
    const solid: Box | null = share > 0
      ? { x, z, halfX: Math.min(f.halfX, Math.max(f.halfX * share, 0.3)), halfZ: Math.min(f.halfZ, Math.max(f.halfZ * share, 0.3)), height: f.height }
      : null;
    return {
      placement: { model: item.model, role: landmark ? 'landmark' : 'prop', landmark, gate: null, x, y: 0, z, rotation, scale, tint: item.tint ?? null, solid },
      rect: { x, z, halfX: f.halfX, halfZ: f.halfZ },
    };
  };

  /** Whether a prop or landmark may stand there: inside the floor, off the gates, spawns and paths, clear of the others. */
  const fits = ({ placement, rect }: Candidate): boolean => {
    if (Math.abs(rect.x) + rect.halfX > halfX - EDGE_MARGIN || Math.abs(rect.z) + rect.halfZ > halfZ - EDGE_MARGIN) return false;
    if (spawns.some((s) => boxDistance(s, { ...rect, height: 0 }) < SPAWN_GAP)) return false;
    if (zones.some((zone) => rectsOverlap(zone, rect, ZONE_GAP))) return false;
    const solid = placement.solid;
    if (solid) {
      if (zones.some((zone) => rectsOverlap(zone, solid, SOLID_GAP))) return false;
      if (paths.some(([a, b]) => segmentHitsRect(a, b, solid, SOLID_GAP))) return false;
    }
    return !standing.some((other) => {
      if (rectsOverlap(other.rect, rect, FOOTPRINT_GAP)) return true;
      return solid !== null && other.placement.solid !== null && rectsOverlap(other.placement.solid, solid, SOLID_GAP);
    });
  };
  const put = (c: Candidate): void => {
    standing.push(c);
    placements.push(c.placement);
  };

  /** A candidate somewhere on the floor, or with its back to the boundary for an item that wants a wall. */
  const somewhere = (item: Item, landmark: LandmarkKind | null, factor: number): Candidate | null => {
    const scale = scaleOf(item, factor);
    if (item.wall) {
      const side = pick(['north', 'east', 'south', 'west'] as Side[]);
      const n = INWARD[side];
      const rotation = Math.atan2(n.x, n.z); // the model's +z looks into the floor
      const f = footprint(item.model, scale, rotation);
      const alongX = n.x === 0;
      const reach = (alongX ? halfX - f.halfX : halfZ - f.halfZ) - EDGE_MARGIN;
      if (reach < 0) return null;
      const along = snap(between(-reach, reach));
      const depth = (alongX ? halfZ - f.halfZ : halfX - f.halfX) - EDGE_MARGIN - 0.01;
      return candidate(item, landmark, alongX ? along : -n.x * depth, alongX ? -n.z * depth : along, rotation, scale);
    }
    const rotation = turnOf(item);
    const f = footprint(item.model, scale, rotation);
    const reachX = halfX - f.halfX - EDGE_MARGIN;
    const reachZ = halfZ - f.halfZ - EDGE_MARGIN;
    if (reachX < 0 || reachZ < 0) return null;
    return candidate(item, landmark, snap(between(-reachX, reachX) * 0.999), snap(between(-reachZ, reachZ) * 0.999), rotation, scale);
  };

  /** Every free spot on a 0.5 m grid, in a fixed order: the last resort for something that has to stand. */
  const sweep = (item: Item, landmark: LandmarkKind | null, factor: number): Candidate | null => {
    const scale = scaleOf(item, factor);
    for (const rotation of [0, Math.PI / 2]) {
      const f = footprint(item.model, scale, rotation);
      const reachX = Math.floor((halfX - f.halfX - EDGE_MARGIN) * 2) / 2;
      const reachZ = Math.floor((halfZ - f.halfZ - EDGE_MARGIN) * 2) / 2;
      for (let z = -reachZ; z <= reachZ; z += 0.5) {
        for (let x = -reachX; x <= reachX; x += 0.5) {
          const c = candidate(item, landmark, x, z, rotation, scale);
          if (fits(c)) return c;
        }
      }
    }
    return null;
  };

  /** Places one `item`. A required one gets many tries, then the sweep, then both again at the smallest size. */
  const place = (item: Item, landmark: LandmarkKind | null, required: boolean, smallest = 1): boolean => {
    const tries = required ? 200 : 25;
    for (let t = 0; t < tries; t++) {
      const c = somewhere(item, landmark, item.vary ? between(0.85, 1.15) : 1);
      if (c && fits(c)) {
        put(c);
        return true;
      }
    }
    if (!required) return false;
    for (const factor of smallest < 1 ? [1, smallest] : [1]) {
      const c = sweep({ ...item, wall: false }, landmark, factor);
      if (c) {
        put(c);
        return true;
      }
    }
    return false;
  };

  // --- landmarks: the big ones first, while there is room ---

  if (area.boss) {
    // An arena: a tall centrepiece ringed by stones. Any four of the ring that fit will do.
    const arena = (cx: number, cz: number, radius: number, count: number, turn: number): Candidate[] | null => {
      const centre = candidate(theme.arena.centre, 'boss', cx, cz, 0, scaleOf(theme.arena.centre, 1));
      if (!fits(centre)) return null;
      const before = standing.length;
      standing.push(centre);
      const ring: Candidate[] = [];
      for (let i = 0; i < count; i++) {
        const item = theme.arena.ring[i % theme.arena.ring.length];
        const angle = turn + (i * Math.PI * 2) / count;
        const c = candidate(item, 'boss', cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, 0, scaleOf(item, 1));
        if (fits(c)) {
          ring.push(c);
          standing.push(c);
        }
      }
      standing.length = before;
      return ring.length >= 4 ? [centre, ...ring] : null;
    };
    let built: Candidate[] | null = null;
    for (let t = 0; t < 300 && !built; t++) {
      const radius = t < 100 ? 4.5 : t < 200 ? 3.75 : 3;
      built = arena(snap(between(-(halfX - radius - 1.5), halfX - radius - 1.5)), snap(between(-(halfZ - radius - 1.5), halfZ - radius - 1.5)), radius, t < 100 ? 8 : 6, snapAngle(rnd() * Math.PI));
    }
    for (let z = -(halfZ - 4); z <= halfZ - 4 && !built; z += 0.5) {
      for (let x = -(halfX - 4); x <= halfX - 4 && !built; x += 0.5) built = arena(x, z, 2.5, 8, 0) ?? arena(x, z, 2.5, 8, Math.PI / 8);
    }
    built?.forEach(put);
  }
  if (area.rest) place(layout.type === 'town' ? INN : CAMPFIRE, 'rest', true, layout.type === 'town' ? 0.68 : 1);
  if (area.shop) place(SHOP, 'shop', true, 0.8);
  const special = area.special !== null && Object.prototype.hasOwnProperty.call(SPECIALS, area.special) ? SPECIALS[area.special] : null;
  if (special) place(special, 'special', true, 0.7);

  // --- props: one of each of the first six kinds, then whatever the generator picks ---

  const wanted = Math.min(26, Math.max(9, Math.round((halfX * halfZ * 4) / theme.propsPer)));
  for (let i = 0; i < wanted; i++) {
    const item = i < 6 ? theme.props[i % theme.props.length] : pick(theme.props);
    place(item, null, i < 6, 0.6);
  }

  // --- ground ---

  if (theme.tiles) {
    // Paving over the whole floor, stretched so that whole tiles fill it. Their tops lie just above the floor plane.
    // (A tile model's top is its highest bump, so the flat of it is a little lower.)
    const [w, h, d] = modelSize(theme.tiles.model);
    const nx = Math.max(3, Math.round((halfX * 2) / w));
    const nz = Math.max(3, Math.round((halfZ * 2) / d));
    const sizeX = (halfX * 2) / nx;
    const sizeZ = (halfZ * 2) / nz;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const other = theme.tiles.other !== null && rnd() < 0.08 ? theme.tiles.other : null;
        const model = other ?? theme.tiles.model;
        const [mw, mh, md] = other ? modelSize(other) : [w, h, d];
        const sy = Math.min(1, 0.9 / mh);
        placements.push({
          model, role: 'ground', landmark: null, gate: null,
          x: -halfX + (ix + 0.5) * sizeX, y: GROUND_TOP - mh * sy, z: -halfZ + (iz + 0.5) * sizeZ,
          rotation: 0, scale: [sizeX / mw, sy, sizeZ / md], tint: theme.tiles.tint, solid: null,
        });
      }
    }
  }
  if (theme.path) {
    // A trodden path from the default spawn to every gate: dirt slabs laid along the line.
    const [w, h, d] = modelSize(theme.path.model);
    const size = 3;
    let laid = 0;
    for (const gate of layout.gates) {
      const to = gatePoint(gate);
      const length = Math.hypot(to.x - layout.spawn.x, to.z - layout.spawn.z);
      const rotation = snapAngle(Math.atan2(to.x - layout.spawn.x, to.z - layout.spawn.z));
      for (let at = 0; at <= length; at += 2.5) {
        const t = length === 0 ? 0 : at / length;
        // Each slab a hair higher than the one before, so that overlapping slabs do not flicker.
        placements.push({
          model: theme.path.model, role: 'ground', landmark: null, gate: null,
          x: layout.spawn.x + (to.x - layout.spawn.x) * t, y: GROUND_TOP - (h * size) / w + (laid % 40) * 0.001, z: layout.spawn.z + (to.z - layout.spawn.z) * t,
          rotation, scale: [size / w, size / w, size / d], tint: theme.path.tint, solid: null,
        });
        laid += 1;
      }
    }
  }
  const scatter = Math.min(110, Math.max(theme.tiles ? 4 : 12, Math.round((halfX * halfZ * 4) / theme.scatterPer)));
  for (let i = 0; i < scatter; i++) {
    const item = theme.scatter[i % theme.scatter.length];
    const s = Math.min(item.height * (item.vary ? between(0.8, 1.2) : 1), 0.95) / modelSize(item.model)[1];
    placements.push({
      model: item.model, role: 'ground', landmark: null, gate: null,
      x: snap(between(-(halfX - 0.75), halfX - 0.75)), y: theme.tiles ? GROUND_TOP : 0, z: snap(between(-(halfZ - 0.75), halfZ - 0.75)),
      rotation: turnOf(item), scale: [s, s, s], tint: item.tint ?? null, solid: null,
    });
  }

  // --- boundary ---

  const edge = theme.edge;
  const edgeHeight = ceiling ?? edge.height;
  boundaryBlocks(layout, edge.thickness).forEach((block) => {
    const alongX = block.side === 'north' || block.side === 'south';
    const length = (alongX ? block.halfX : block.halfZ) * 2;
    const pieces = Math.max(1, Math.round(length / edge.length));
    const piece = length / pieces;
    for (let i = 0; i < pieces; i++) {
      const model = pick(edge.models);
      const size = modelSize(model);
      const scale: [number, number, number] = [0, edgeHeight / size[1], 0];
      scale[edge.long] = piece / size[edge.long];
      scale[edge.long === 0 ? 2 : 0] = edge.thickness / size[edge.long === 0 ? 2 : 0];
      const offset = -length / 2 + (i + 0.5) * piece;
      placements.push({
        model, role: 'boundary', landmark: null, gate: null,
        x: alongX ? block.x + offset : block.x, y: 0, z: alongX ? block.z : block.z + offset,
        rotation: (edge.long === 0) === alongX ? 0 : Math.PI / 2, scale, tint: edge.tint, solid: null,
      });
    }
  });

  // What stands outside: houses behind the town wall, the tree line, hills. The roads out of the gates stay open.
  const roads: Rect[] = layout.gates.map((gate) => {
    const n = INWARD[gate.side];
    const alongX = n.x === 0;
    return { x: gate.x - n.x * 20, z: gate.z - n.z * 20, halfX: alongX ? gate.width / 2 + 1.5 : 20, halfZ: alongX ? 20 : gate.width / 2 + 1.5 };
  });
  if (theme.backdrop.length > 0) {
    const outside: Rect[] = [];
    for (const row of layout.type === 'town' ? [0] : [0, 1]) {
      for (const side of ['north', 'east', 'south', 'west'] as Side[]) {
        const n = INWARD[side];
        const alongX = n.x === 0;
        const half = (alongX ? halfX : halfZ) + 6 + row * 7;
        for (let along = -half + between(0, 3); along <= half; along += between(1.5, 4)) {
          const item = pick(theme.backdrop);
          const scale = scaleOf(item, item.vary ? between(0.85, 1.2) : 1);
          const rotation = item.turn === 'any' ? snapAngle(rnd() * Math.PI * 2) : Math.atan2(n.x, n.z);
          const f = footprint(item.model, scale, rotation);
          const depth = alongX ? f.halfZ : f.halfX;
          const width = alongX ? f.halfX : f.halfZ;
          along += width;
          const out = (alongX ? halfZ : halfX) + edge.thickness + depth + (row === 0 ? between(0.3, 1.5) : between(8, 12));
          const rect: Rect = { x: alongX ? along : -n.x * out, z: alongX ? -n.z * out : along, halfX: f.halfX, halfZ: f.halfZ };
          along += width;
          if (roads.some((road) => rectsOverlap(road, rect, 0)) || outside.some((other) => rectsOverlap(other, rect, -0.6))) continue;
          outside.push(rect);
          placements.push({ model: item.model, role: 'boundary', landmark: null, gate: null, x: rect.x, y: 0, z: rect.z, rotation, scale, tint: item.tint ?? null, solid: null });
        }
      }
    }
  }
  if (theme.wallDecor.length > 0 && ceiling !== null) {
    // Banners and torches on the inside of the walls, between the gates.
    let hung = 0;
    for (const run of boundaryRuns(layout)) {
      const n = INWARD[run.side];
      const alongX = n.x === 0;
      for (let along = run.from + 3; along <= run.to - 3; along += 6.5) {
        const item = theme.wallDecor[hung % theme.wallDecor.length];
        hung += 1;
        const scale = scaleOf(item, 1);
        const rotation = Math.atan2(n.x, n.z);
        const f = footprint(item.model, scale, rotation);
        const inset = (alongX ? f.halfZ : f.halfX) + 0.02;
        placements.push({
          model: item.model, role: 'boundary', landmark: null, gate: null,
          x: alongX ? along : -n.x * (halfX - inset), y: Math.max(0.2, Math.min(ceiling - f.height - 0.3, 1.6)), z: alongX ? -n.z * (halfZ - inset) : along,
          rotation, scale, tint: item.tint ?? null, solid: null,
        });
      }
    }
  }

  // --- gates: a stone arch whose opening is as wide as the gate, its inner face on the floor's edge ---

  for (const gate of layout.gates) {
    const [, h, d] = modelSize(theme.gate.model);
    const n = INWARD[gate.side];
    const height = ceiling === null ? GATE_HEIGHT : Math.min(GATE_HEIGHT, ceiling - 0.05);
    const back = d / 2 - 0.05;
    placements.push({
      model: theme.gate.model, role: 'gate', landmark: null, gate: gate.exitId,
      x: gate.x - n.x * back, y: 0, z: gate.z - n.z * back,
      rotation: n.x === 0 ? 0 : Math.PI / 2, scale: [gate.width / ARCH_OPENING, height / h, 1], tint: theme.gate.tint, solid: null,
    });
  }

  const solids = placements.filter((p) => p.solid !== null).map((p) => ({ ...(p.solid as Box), kind: 'model' as const }));
  return {
    mood: moodFor(area.location, area.type),
    placements,
    layout: {
      type: layout.type,
      floor: { halfX, halfZ },
      ceiling,
      walls: [],
      props: solids,
      gates: layout.gates.map((g: Gate) => ({ ...g, spawn: { ...g.spawn } })),
      spawn: { ...layout.spawn },
    },
  };
}

/** Angles in steps of 1/64 turn: enough variety, and short numbers. */
function snapAngle(angle: number): number {
  return (Math.round((angle / (Math.PI * 2)) * 64) * Math.PI * 2) / 64;
}

/** What to dress an area with, from the answer of the server. */
export function dressSpecOf(state: {
  location: { name: string; type: string };
  area: { id: string; has_shop: boolean; can_rest: boolean; is_boss_area: boolean; special: string | null };
  exits: { id: string }[];
}): DressSpec {
  return {
    location: state.location.name,
    type: state.location.type,
    id: state.area.id,
    exits: state.exits.map((e) => e.id),
    shop: state.area.has_shop,
    rest: state.area.can_rest,
    boss: state.area.is_boss_area,
    special: state.area.special,
  };
}
