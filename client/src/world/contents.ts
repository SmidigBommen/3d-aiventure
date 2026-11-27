// What an area holds (as the server answered it) and what the player can do about it from where
// they stand: which prompt shows, what E does, what blocks the way. Also which model shows each
// creature and event object (MODELS.md has the same tables). Pure: no rendering, no browser.

import type { Vec2 } from '../input/movement';
import { isFree } from './collision';
import { spawnPoint, type AreaLayout, type Box, type ContentSlots } from './layout';

export const PROMPT_RANGE = 3; // m
export const CONTACT_RANGE = 1.2; // m
export const BOSS_SCALE = 1.25;

export interface MonsterContent { id: string; race: string; name: string; level: number }
/** `landmark`: a discovery, met at the area's special landmark instead of at an object of its own. */
export interface EventContent { id: string; title: string; object: string; label: string; landmark: boolean }
export interface BossContent {
  id: string; name: string; level: number; locked: boolean; locked_text: string | null;
  title: string; intro: string | null;
}
export interface AreaContents {
  seq: number;
  monster: MonsterContent | null;
  event: EventContent | null;
  spent: EventContent | null; // the event resolved here since the contents were last rolled
  boss: BossContent | null;
  search_spot: boolean;
}

export type InteractionKind = 'monster' | 'event' | 'boss' | 'search' | 'rest';
export interface Interaction {
  kind: InteractionKind;
  id: string | null; // the content id to engage; null for 'search' and 'rest'
  prompt: string;
  auto: boolean; // true: start without a key press
  locked: boolean; // true: E does nothing
  x: number; // the slot
  z: number;
}

/** Where an event is met: in front of the special landmark for a discovery, else on the event slot. */
export function eventPlace(slots: ContentSlots, event: { landmark: boolean }): Vec2 {
  return event.landmark && slots.landmark ? slots.landmark : slots.event;
}

const GONE = ['traveller', 'townsfolk', 'spirit', 'tracks', 'snare', 'herbs'];

/** What is left of an event object once the event is resolved: it stays (changed), or it has left. */
export function remainsOf(object: string): 'stays' | 'gone' {
  return GONE.includes(object) ? 'gone' : 'stays';
}

/** Where the monster of a fight stands, by the `place` of the battle view. */
export function fightSlot(slots: ContentSlots, place: string): Vec2 {
  if (place === 'boss') return slots.boss ?? slots.monster;
  if (place === 'event') return slots.event;
  if (place === 'landmark') return slots.landmark ?? slots.event;
  return slots.monster;
}

/** What the player standing at `pos` can turn to: the nearest thing within PROMPT_RANGE, or null. */
export function interactionAt(pos: Vec2, layout: AreaLayout, contents: AreaContents | null): Interaction | null {
  const slots = layout.slots;
  if (!contents || !slots) return null;
  const { monster, event, boss } = contents;
  const distance = (slot: Vec2): number => Math.hypot(slot.x - pos.x, slot.z - pos.z);
  // In the order that decides a tie: monster, event, boss, search, rest.
  const candidates: [number, Interaction][] = [];
  if (monster) {
    const d = distance(slots.monster);
    candidates.push([d, {
      kind: 'monster', id: monster.id, prompt: `E: fight ${monster.name} the ${monster.race}`, auto: d <= CONTACT_RANGE, locked: false,
      x: slots.monster.x, z: slots.monster.z,
    }]);
  }
  if (event) {
    const at = eventPlace(slots, event);
    candidates.push([distance(at), {
      kind: 'event', id: event.id, prompt: `E: look at ${event.label}`, auto: false, locked: false, x: at.x, z: at.z,
    }]);
  }
  if (boss && slots.boss) {
    const prompt = boss.locked ? (boss.locked_text ?? '') : `E: challenge ${boss.name}`;
    candidates.push([distance(slots.boss), { kind: 'boss', id: boss.id, prompt, auto: false, locked: boss.locked, x: slots.boss.x, z: slots.boss.z }]);
  }
  if (contents.search_spot && !monster && !event) {
    candidates.push([distance(slots.search), {
      kind: 'search', id: null, prompt: 'E: search further', auto: false, locked: false, x: slots.search.x, z: slots.search.z,
    }]);
  }
  // A slots object of before this field existed has no rest.
  const rest = slots.rest ?? null;
  if (rest) {
    candidates.push([distance(rest), { kind: 'rest', id: null, prompt: 'E: rest', auto: false, locked: false, x: rest.x, z: rest.z }]);
  }
  let best: [number, Interaction] | null = null;
  for (const candidate of candidates) {
    if (candidate[0] <= PROMPT_RANGE && (best === null || candidate[0] < best[0])) best = candidate;
  }
  return best ? best[1] : null;
}

/** What of the contents blocks walking: the event object (also what stays of a spent one) and the boss. A landmark blocks by itself. */
export function contentSolids(slots: ContentSlots, contents: AreaContents | null): Box[] {
  const solids: Box[] = [];
  if (!contents) return solids;
  const object = (): Box => ({ x: slots.event.x, z: slots.event.z, halfX: 0.5, halfZ: 0.5, height: 1 });
  const { event, spent } = contents;
  if (event && !event.landmark) solids.push(object());
  if (spent && !spent.landmark && remainsOf(spent.object) === 'stays') solids.push(object());
  if (contents.boss && slots.boss) solids.push({ x: slots.boss.x, z: slots.boss.z, halfX: 0.7, halfZ: 0.7, height: 2 });
  return solids;
}

// --- looks ---------------------------------------------------------------------------------------

export interface CreatureLook { model: string; scale: number; tint: string | null; opacity: number; emissive: string | null }

const look = (model: string, scale: number, tint: string | null = null, opacity = 1, emissive: string | null = null): CreatureLook =>
  ({ model: `creatures/${model}`, scale, tint, opacity, emissive });

/** Keyed by monster race and by boss id; the values of MODELS.md table 1. A boss is drawn at its scale times BOSS_SCALE. */
export const CREATURES: Record<string, CreatureLook> = {
  Goblin: look('goblin', 0.4),
  Orc: look('orc', 0.62),
  Troll: look('yeti', 0.98, '#5f7f4a'),
  'Blighted Dryad': look('tree_spirit', 0.7, '#6b4a6e'),
  'Fire Salamander': look('dragon', 0.6, '#ff5a1f'),
  'Sea Serpent': look('snake', 0.94, '#2f7fa8'),
  'Shadow Knight': look('knight', 0.56, '#2a2a3a'),
  'Shadow Wraith': look('ghost_skull', 0.59, '#3a2a55', 0.8),
  'Wind Specter': look('ghost', 0.59, '#bfe8ff', 0.6),
  'Stone Golem': look('giant', 0.67, '#8a8a86'),
  'Crystal Golem': look('giant', 0.67, '#6fd6ff', 1, '#1a4a66'),
  'Void Fiend': look('demon', 0.75, '#4b1f7a'),
  'Shard Guardian': look('robot', 0.67, '#7fd0e0'),
  'Corrupted Captain': look('skeleton_warrior', 0.77, '#9fb0c8'),
  'Lady Vex': look('witch', 0.43, '#6a2a8a'),
  'Lady Vex (Final Battle)': look('blue_demon', 1.06, '#8a2be2'),
  'Flame Cultist Leader': look('dino', 0.73, '#c8452a'),
  'Corrupted High Priest': look('cleric', 0.6, '#5a5a6a'),
  'Ancient Wind Rider': look('king', 1.06, '#7fe0d0', 0.7),
  'Primordial Earth Elemental': look('giant', 1.29, '#6b5a45'),
  'Malachar the Void-touched': look('wizard', 0.65, '#2a1f4a'),
};

const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

export function creatureLook(key: string): CreatureLook {
  return has(CREATURES, key) ? CREATURES[key] : CREATURES.Goblin;
}

// --- clips ---------------------------------------------------------------------------------------

export interface CreatureClips { idle: string | null; attack: string | null; hurt: string | null; death: string | null }

const clips = (idle: string | null, attack: string | null, hurt: string | null, death: string | null): CreatureClips => ({ idle, attack, hurt, death });
const QUATERNIUS = clips('Idle', 'Punch', 'HitReact', 'Death');
const GIANT = 'EnemyArmature|EnemyArmature|EnemyArmature|';

/** The clip names of each creature model, as in MODELS.md table 1. null: the file has no such clip. */
export const CREATURE_CLIPS: Record<string, CreatureClips> = {
  'creatures/goblin': clips('Idle', 'SwordSlash', 'RecieveHit', 'Death'),
  'creatures/knight': clips('Idle', 'SwordSlash', 'RecieveHit', 'Death'),
  'creatures/witch': clips('Idle', 'Punch', 'RecieveHit', 'Death'),
  'creatures/orc': QUATERNIUS,
  'creatures/yeti': QUATERNIUS,
  'creatures/demon': QUATERNIUS,
  'creatures/blue_demon': QUATERNIUS,
  'creatures/dino': QUATERNIUS,
  'creatures/dragon': clips('Flying_Idle', 'Punch', 'HitReact', 'Death'),
  'creatures/ghost_skull': clips('Flying_Idle', 'Punch', 'HitReact', 'Death'),
  'creatures/ghost': clips('Flying_Idle', 'Headbutt', 'HitReact', 'Death'),
  'creatures/tree_spirit': clips('Idle', 'Bite_Front', 'HitRecieve', null),
  'creatures/snake': clips('SnakeArmature|Snake_Idle', 'SnakeArmature|Snake_Attack', null, null),
  'creatures/giant': clips(`${GIANT}Idle`, `${GIANT}Attack`, `${GIANT}HitRecieve`, `${GIANT}Death`),
  'creatures/robot': clips('RobotArmature|Robot_Idle', 'RobotArmature|Robot_Punch', null, 'RobotArmature|Robot_Death'),
  'creatures/skeleton_warrior': clips('Idle', '1H_Melee_Attack_Chop', 'Hit_A', 'Death_A'),
  'creatures/cleric': clips('Idle', 'Staff_Attack', 'RecieveHit', 'Death'),
  'creatures/king': clips('CharacterArmature|Idle', 'CharacterArmature|Sword_Slash', 'CharacterArmature|HitRecieve', 'CharacterArmature|Death'),
  'creatures/wizard': clips('Idle', 'Spell1', 'RecieveHit', 'Death'),
};

export type ClipSlot = 'idle' | 'attack' | 'hurt' | 'death';
export type Motion = 'none' | 'lunge' | 'shake' | 'sink';

/** What a creature without a clip does instead: the model itself is moved. */
const FALLBACK_MOTION: Record<ClipSlot, Motion> = { idle: 'none', attack: 'lunge', hurt: 'shake', death: 'sink' };

/** How a model shows a slot: its clip, or the fallback motion when it has none (or is not in the table). */
export function creatureMotion(model: string, slot: ClipSlot): { clip: string } | { motion: Motion } {
  const clip = has(CREATURE_CLIPS, model) ? CREATURE_CLIPS[model][slot] : null;
  return clip ? { clip } : { motion: FALLBACK_MOTION[slot] };
}

// --- battle stance -------------------------------------------------------------------------------

export const BATTLE_DISTANCE = 2.5; // m between the player and what they fight
const NEAREST_STANCE = 1.5; // m

/**
 * Where the player stands in a fight against what is on `slot`, coming from `from`: BATTLE_DISTANCE
 * from the slot on the side they came from, facing it. When that point is taken, the nearest free
 * one around the slot: first by side (within a quarter turn of where they came from), then by distance.
 */
export function battleStance(from: Vec2, slot: Vec2, layout: AreaLayout): { x: number; z: number; yaw: number } {
  const facing = (p: Vec2): { x: number; z: number; yaw: number } => ({ x: p.x, z: p.z, yaw: Math.atan2(-(slot.x - p.x), -(slot.z - p.z)) });
  let dx = from.x - slot.x;
  let dz = from.z - slot.z;
  if (Math.hypot(dx, dz) < 1e-6) {
    const spawn = spawnPoint(layout, null);
    dx = spawn.x - slot.x;
    dz = spawn.z - slot.z;
  }
  let length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    dx = 0;
    dz = 1;
    length = 1;
  }
  const at = (turn: number, distance: number): Vec2 => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { x: slot.x + ((dx * cos - dz * sin) / length) * distance, z: slot.z + ((dx * sin + dz * cos) / length) * distance };
  };
  const straight = { x: slot.x + (dx / length) * BATTLE_DISTANCE, z: slot.z + (dz / length) * BATTLE_DISTANCE };
  if (isFree(straight, layout)) return facing(straight);
  const STEP = Math.PI / 36;
  for (const [first, last] of [[1, 18], [19, 36]]) {
    for (let distance = BATTLE_DISTANCE; distance >= NEAREST_STANCE - 1e-9; distance -= 0.1) {
      const d = Math.max(distance, NEAREST_STANCE);
      for (let k = first; k <= last; k++) {
        for (const turn of [k * STEP, -k * STEP]) {
          const p = at(turn, d);
          if (isFree(p, layout)) return facing(p);
        }
      }
    }
  }
  return facing(from);
}

export interface ObjectLook { model: string; height: number; tint: string | null } // height in metres after scaling

const thing = (model: string, height: number, tint: string | null = null): ObjectLook => ({ model, height, tint });

/** Keyed by the object kind the server answers for an event (json/event_objects.json). */
export const EVENT_OBJECTS: Record<string, ObjectLook> = {
  chest: thing('props/chest', 0.8),
  treasure: thing('props/chest_gold', 0.9),
  shrine: thing('props/shrine', 1.8),
  altar: thing('env/dungeon/altar_table', 0.8),
  traveller: thing('npcs/hooded_adventurer', 1.7),
  townsfolk: thing('npcs/farmer', 1.7),
  spirit: thing('creatures/ghost', 1.8, '#bfe8ff'),
  trap: thing('env/dungeon/floor_spike_trap', 0.5),
  rubble: thing('env/dungeon/rubble_large', 0.7),
  tracks: thing('props/bone', 0.3),
  snare: thing('env/dungeon/barrier', 0.45),
  herbs: thing('env/wilderness/water_plant', 0.7, '#cfe8d8'),
  bridge: thing('env/wilderness/bridge_small', 0.6),
  runestone: thing('props/gravemarker_a', 1.3, '#9fc8d8'),
  forge: thing('props/anvil', 0.8),
  crystal: thing('props/crystal_big', 1.6),
  doorway: thing('env/dungeon/wall_doorway', 2),
  lookout: thing('env/dungeon/wall_window_closed', 2),
  bars: thing('env/dungeon/fence_iron_bars', 1.2),
  book: thing('props/spellbook_open', 0.4),
};

export function objectLook(kind: string): ObjectLook {
  return has(EVENT_OBJECTS, kind) ? EVENT_OBJECTS[kind] : EVENT_OBJECTS.chest;
}

export type SearchMarkerKind = 'town' | 'wilderness' | 'dungeon';

/** The marker of the search spot per location type: low, and nothing to walk into. */
export const SEARCH_MARKERS: Record<SearchMarkerKind, ObjectLook> = {
  wilderness: thing('env/town/signpost', 1.1),
  dungeon: thing('env/dungeon/rubble_half', 0.5),
  town: thing('env/town/crate_open', 0.7),
};
