// Which sound plays when: the cue of each turn event and when it sounds, the cues of a fight's result,
// the footstep and the ambience of a location type, and the cue of every other action of the game.
// Pure: no AudioContext, no rendering, no browser. audio.ts plays what this file names.

import type { Timeline, TurnEvent } from '../battle/timeline';
import type { BattleRewards } from '../battle/view';

export type SoundCue =
  | 'hit' | 'crit' | 'miss' | 'heal' | 'defend' | 'spell' | 'victory' | 'defeat' | 'levelup' | 'coin' | 'click' | 'save'
  | 'step_stone' | 'step_grass' | 'step_dungeon' | 'gate' | 'prompt' | 'notice' | 'enrage' | 'shard';

/** The twelve effects of menus and fights, then the eight of walking and the world. */
export const SOUND_CUES: readonly SoundCue[] = [
  'hit', 'crit', 'miss', 'heal', 'defend', 'spell', 'victory', 'defeat', 'levelup', 'coin', 'click', 'save',
  'step_stone', 'step_grass', 'step_dungeon', 'gate', 'prompt', 'notice', 'enrage', 'shard',
];

// Kinds and outcomes are read as timeline.ts reads them.
const KINDS = ['attack', 'ability', 'defend', 'item', 'flee', 'stunned', 'condition', 'enrage'];
const OUTCOMES = ['hit', 'crit', 'miss', 'half'];

/** The cue of one turn event. An attack, an ability, a defence and an item each have their own. */
export function turnEventSound(event: TurnEvent): SoundCue {
  const kind = KINDS.includes(event.kind) ? event.kind : 'condition';
  const outcome = OUTCOMES.includes(event.outcome as string) ? event.outcome : null;
  if (kind === 'attack') return outcome === 'miss' ? 'miss' : outcome === 'crit' ? 'crit' : 'hit';
  if (kind === 'ability') {
    if (outcome === 'miss') return 'miss';
    if (outcome === 'crit') return 'crit';
    if (outcome === null && event.fx === 'heal') return 'heal';
    return 'spell';
  }
  if (kind === 'defend') return 'defend';
  if (kind === 'item') return 'heal';
  if (kind === 'flee' || kind === 'stunned') return 'miss';
  if (kind === 'enrage') return 'enrage';
  const change = event.actor === 'monster' ? event.monster : event.player;
  return change > 0 ? 'heal' : change < 0 ? 'hit' : 'spell';
}

/**
 * When each event of a played turn sounds: where its effect, floating text or bar step comes in the
 * timeline, or with its banner when it has none of those. The fall of the loser has no entry.
 */
export function turnSounds(events: TurnEvent[], timeline: Timeline): { t: number; cue: SoundCue; event: number }[] {
  return events.map((event, i) => {
    let impact: number | null = null;
    let banner: number | null = null;
    for (const cue of timeline.cues) {
      if (cue.event !== i) continue;
      if (cue.type === 'fx' || cue.type === 'float' || cue.type === 'hp') impact = impact === null ? cue.t : Math.min(impact, cue.t);
      else if (cue.type === 'banner' && banner === null) banner = cue.t;
    }
    return { t: impact ?? banner ?? 0, cue: turnEventSound(event), event: i };
  });
}

/** The cues of the result panel, in the order they are played. */
export function resultSounds(view: { phase: string; rewards: BattleRewards | null }): SoundCue[] {
  if (view.phase === 'defeat') return ['defeat'];
  if (view.phase !== 'victory') return [];
  const cues: SoundCue[] = ['victory'];
  const shard = view.rewards?.boss?.shard;
  if (typeof shard === 'string' && shard !== '') cues.push('shard');
  if (view.rewards?.leveled_up === true) cues.push('levelup');
  return cues;
}

export type Ground = 'stone' | 'grass' | 'dungeon';

/** What the player walks on, by location type. */
export function groundOf(type: string): Ground {
  return type === 'town' ? 'stone' : type === 'dungeon' ? 'dungeon' : 'grass';
}

export function stepSound(type: string): SoundCue {
  return `step_${groundOf(type)}`;
}

export type AmbienceBed = 'town' | 'wilderness' | 'dungeon';
export interface Ambience { bed: AmbienceBed; tense: boolean }

/** The bed of a location type, with the tense layer during a fight. `null` (no world on screen) is silence. */
export function ambienceFor(type: string | null, fighting: boolean): Ambience | null {
  if (type === null) return null;
  return { bed: type === 'town' || type === 'dungeon' ? type : 'wilderness', tense: fighting };
}

/** The cue of every action that is not a turn event or a result. `null`: deliberately silent. */
export const ACTION_SOUNDS: Record<string, SoundCue | null> = {
  walk: null,
  look: null,
  prompt: 'prompt',
  gate: 'gate',
  notice: 'notice',
  interact_monster: 'click',
  interact_event: 'click',
  interact_boss: 'click',
  interact_search: 'click',
  interact_rest: 'heal',
  interact_shop: 'click',
  interact_travel: 'click',
  interact_locked: 'miss',
  intro_fight: 'click',
  intro_back: 'click',
  event_success: 'coin',
  event_failure: 'miss',
  event_levelup: 'levelup',
  event_continue: 'click',
  panel_open: 'click',
  panel_close: 'click',
  tab: 'click',
  menu_open: 'click',
  menu_close: 'click',
  use_potion: 'heal',
  equip: 'defend',
  unequip: 'click',
  improve: 'levelup',
  buy: 'coin',
  sell: 'coin',
  haggle_success: 'coin',
  haggle_failure: 'miss',
  quest_accept: 'click',
  quest_turn_in: 'coin',
  quest_abandon: 'click',
  refused: 'miss',
  travel_depart: 'gate',
  arrival: null,
  battle_action: null,
  battle_continue: 'click',
  fled: 'gate',
  revive: 'heal',
  start_over: 'click',
  ending: 'victory',
  ending_step: 'click',
  title_button: 'click',
  creation_choice: 'click',
  creation_step: 'click',
  new_game: 'save',
  opening_continue: 'click',
  save: 'save',
  load: 'click',
  delete: 'click',
  confirm_ask: 'click',
  quit: 'click',
  settings_change: 'click',
  mute: null,
};
