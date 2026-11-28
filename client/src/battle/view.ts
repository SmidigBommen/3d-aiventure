// The fight as the server answers it (web/fight.py: battle_view) and which action a key stands
// for. Pure: no rendering, no browser.

import type { TurnEvent } from './timeline';

export interface BattleEffect { stat: string; value: number; duration: number; source: string; label: string; kind: 'buff' | 'debuff' }
export interface BattleAbility { id: string; name: string; description: string; cost: number; summary: string[]; usable: boolean; hotkey: string }
export interface BattleItem { name: string; description: string; index: number; count: number; hotkey: string }
export interface BossRewards {
  name: string;
  defeat_text: string | null;
  shard: string | null;
  shards_collected: number;
  shards_total: number;
  act_unlocked: { number: number; title: string; description: string } | null;
  campaign_complete: boolean;
}
export interface BattleRewards {
  xp: number;
  gold: number;
  loot: string | null;
  loot_type: string | null;
  leveled_up: boolean;
  new_level: number;
  hp_increase: number;
  new_abilities: string[];
  new_max_pp: number | null;
  asi_points: number;
  quest_updates: string[];
  boss: BossRewards | null;
}

export interface BattleView {
  phase: 'fight' | 'victory' | 'defeat' | 'fled' | 'none';
  round: number;
  player_turn: boolean;
  turn: { seq: number; events: TurnEvent[] };
  player: { name: string; level: number; hp: number; max_hp: number; pp: number; max_pp: number; ac: number; effects: BattleEffect[] };
  monster: {
    name: string; race: string; level: number; hp: number; max_hp: number; ac: number;
    is_boss: boolean; boss_id: string | null; title: string | null; enraged: boolean; effects: BattleEffect[];
    taunt: string | null; // what a boss last said; null for any other monster and outside the fight
    enrage_text: string | null; // the line of a boss's rage; null for any other monster
    place: string; // where in the area it stands: 'monster', 'event', 'landmark' or 'boss' (contents.ts: fightSlot)
  };
  abilities: BattleAbility[];
  items: BattleItem[];
  can_flee: boolean;
  flee: { dc: number; modifier: number };
  log: { text: string; cls: string }[];
  rewards: BattleRewards | null;
  defeat: { monster_name: string; gold: number; gold_cost: number } | null;
}

export type BattleAction =
  | { type: 'attack' }
  | { type: 'defend' }
  | { type: 'flee' }
  | { type: 'ability'; ability_id: string }
  | { type: 'item'; item_index: number };

const ITEM_KEYS: Record<string, string> = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r' };

/** The action a key (by `KeyboardEvent.code`) asks for in this fight, or null: A/D/F, 1-5 for abilities, Q/W/E/R for items. */
export function actionForKey(view: BattleView, code: string): BattleAction | null {
  if (view.phase !== 'fight' || !view.player_turn) return null;
  if (code === 'KeyA') return { type: 'attack' };
  if (code === 'KeyD') return { type: 'defend' };
  if (code === 'KeyF') return view.can_flee ? { type: 'flee' } : null;
  const digit = /^Digit([1-5])$/.exec(code);
  if (digit) {
    const ability = view.abilities[Number(digit[1]) - 1];
    return ability && ability.usable ? { type: 'ability', ability_id: ability.id } : null;
  }
  if (Object.prototype.hasOwnProperty.call(ITEM_KEYS, code)) {
    const item = view.items.find((stack) => stack.hotkey === ITEM_KEYS[code]);
    return item ? { type: 'item', item_index: item.index } : null;
  }
  return null;
}
