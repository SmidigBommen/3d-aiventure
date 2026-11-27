// How the events of one turn (engine/turn_events.py) become what is shown, and when: a list of
// cues on a clock that starts with the playback. Pure: no rendering, no browser.

export type Side = 'player' | 'monster';
export type Outcome = 'hit' | 'crit' | 'miss' | 'half' | null;
export interface TurnEvent { actor: Side; kind: string; name: string; outcome: Outcome; fx: string; ranged: boolean; player: number; monster: number }
export type Anim = 'strike' | 'cast' | 'hurt' | 'dodge' | 'death';
export type FloatStyle = 'damage' | 'crit' | 'heal' | 'miss';
export type Finale = 'victory' | 'defeat' | null;
interface CueBase { t: number; d: number; event: number; side: Side }
export type Cue =
  | (CueBase & { type: 'banner'; text: string })
  | (CueBase & { type: 'anim'; anim: Anim })
  | (CueBase & { type: 'fx'; fx: string; source: Side | null })
  | (CueBase & { type: 'float'; text: string; style: FloatStyle })
  | (CueBase & { type: 'hp'; before: number; after: number });
export interface Hp { player: number; monster: number }
export interface Timeline { cues: Cue[]; start: Hp; total: number; inputAt: number }

export const FX_KEYS: readonly string[] = [
  'slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning', 'poison', 'acid', 'radiant', 'necrotic', 'force', 'psychic', 'thunder',
  'heal', 'buff', 'debuff', 'shield', 'stun', 'rage', 'bleed', 'burn', 'regen', 'impact',
];
export const MIN_TURN_SECONDS = 0.4;
export const MAX_TURN_SECONDS = 6;

const LEAD_IN = 0.25; // s before the first event
const FINALE = 0.9; // s for the loser to fall
const IMPACT = 0.3; // s into an event's slot: the blow lands, the effect shows, the bar steps
const ACT = 0.4; // s an actor's own move takes
const SHOW = 0.45; // s an effect, a reaction or a floating text takes

/** Seconds per event, by kind; a targeted ability takes longer than one on oneself. */
const SLOTS: Record<string, number> = {
  attack: 0.76, ability: 0.76, defend: 0.56, item: 0.7, flee: 0.56, stunned: 0.64, condition: 0.62, enrage: 0.7,
};
const TARGETED_ABILITY = 0.86;
const OUTCOMES = ['hit', 'crit', 'miss', 'half'];

const other = (side: Side): Side => (side === 'player' ? 'monster' : 'player');

export function buildTimeline(events: TurnEvent[], after: Hp, finale: Finale = null): Timeline {
  const start: Hp = { player: after.player, monster: after.monster };
  for (const event of events) {
    start.player -= event.player;
    start.monster -= event.monster;
  }
  if (events.length === 0 && !finale) return { cues: [], start, total: 0, inputAt: 0 };

  const cues: Cue[] = [];
  const hp: Hp = { ...start };
  let clock = LEAD_IN;
  events.forEach((event, i) => {
    const kind = Object.prototype.hasOwnProperty.call(SLOTS, event.kind) ? event.kind : 'condition';
    const fx = FX_KEYS.includes(event.fx) ? event.fx : 'impact';
    const outcome: Outcome = OUTCOMES.includes(event.outcome as string) ? event.outcome : null;
    const actor: Side = event.actor === 'monster' ? 'monster' : 'player';
    const target = other(actor);
    const targeted = kind === 'attack' || (kind === 'ability' && outcome !== null);
    const slot = kind === 'ability' && targeted ? TARGETED_ABILITY : SLOTS[kind];
    const t0 = clock;
    const hit = t0 + IMPACT;
    const show = Math.min(SHOW, slot - IMPACT);
    const base = { event: i };
    const anim = (side: Side, name: Anim, t: number, d: number): void => void cues.push({ ...base, type: 'anim', t, d, side, anim: name });
    const effect = (side: Side, source: Side | null): void => void cues.push({ ...base, type: 'fx', t: hit, d: show, side, fx, source });
    const word = (side: Side, text: string, style: FloatStyle): void => void cues.push({ ...base, type: 'float', t: hit, d: show, side, text, style });

    cues.push({ ...base, type: 'banner', t: t0, d: slot, side: actor, text: event.name });
    if (targeted) {
      anim(actor, event.ranged ? 'cast' : 'strike', t0, ACT);
      if (outcome === 'miss') {
        anim(target, 'dodge', hit, show);
        word(target, 'Miss', 'miss');
      } else {
        effect(target, event.ranged ? actor : null);
        if (event[target] < 0) anim(target, 'hurt', hit, show);
        if (outcome === 'half') word(target, 'Resisted', 'miss');
        if (outcome === 'crit') word(target, 'Critical!', 'crit');
      }
    } else if (kind === 'ability' || kind === 'item' || kind === 'enrage') {
      anim(actor, 'cast', t0, ACT);
      effect(actor, null);
    } else if (kind === 'defend') {
      effect(actor, null);
    } else if (kind === 'flee') {
      anim(actor, 'dodge', t0, ACT);
      word(actor, 'No escape', 'miss');
    } else if (kind === 'stunned') {
      effect(actor, null);
      word(actor, 'Stunned', 'miss');
    } else {
      effect(actor, null);
      if (event[actor] < 0) anim(actor, 'hurt', hit, show);
    }
    for (const side of ['player', 'monster'] as const) {
      const change = event[side];
      if (!change) continue;
      cues.push({ ...base, type: 'hp', t: hit, d: show, side, before: hp[side], after: hp[side] + change });
      hp[side] += change;
      word(side, change > 0 ? `+${change}` : `${change}`, change > 0 ? 'heal' : outcome === 'crit' ? 'crit' : 'damage');
    }
    clock += slot;
  });
  if (finale) {
    cues.push({ type: 'anim', anim: 'death', t: clock, d: FINALE, event: -1, side: finale === 'victory' ? 'monster' : 'player' });
    clock += FINALE;
  }

  // A long turn is played faster, so that it never takes more than MAX_TURN_SECONDS.
  const total = Math.min(clock, MAX_TURN_SECONDS);
  const scale = total / clock;
  for (const cue of cues) {
    cue.t *= scale;
    cue.d = Math.max(0, Math.min(cue.d * scale, total - cue.t));
  }
  // Stable: cues at the same moment keep the order they were made in.
  cues.sort((a, b) => a.t - b.t);
  return { cues, start, total, inputAt: total };
}
