import { describe, expect, it } from 'vitest';
import { buildTimeline, type Outcome, type TurnEvent } from '../battle/timeline';
import type { BattleRewards } from '../battle/view';
import type { InteractionKind } from '../world/contents';
import { ACTION_SOUNDS, SOUND_CUES, ambienceFor, groundOf, resultSounds, stepSound, turnEventSound, turnSounds } from './cues';

const ev = (over: Partial<TurnEvent>): TurnEvent => ({ actor: 'player', kind: 'attack', name: 'x', outcome: 'hit', fx: 'slashing', ranged: false, player: 0, monster: 0, ...over });

describe('turnEventSound', () => {
  it('follows the table', () => {
    expect(turnEventSound(ev({ outcome: 'miss' }))).toBe('miss');
    expect(turnEventSound(ev({ outcome: 'crit' }))).toBe('crit');
    for (const outcome of ['hit', 'half', null, 'odd'] as Outcome[]) expect(turnEventSound(ev({ outcome }))).toBe('hit');
    expect(turnEventSound(ev({ kind: 'ability', outcome: 'miss' }))).toBe('miss');
    expect(turnEventSound(ev({ kind: 'ability', outcome: 'crit' }))).toBe('crit');
    expect(turnEventSound(ev({ kind: 'ability', outcome: 'half' }))).toBe('spell');
    expect(turnEventSound(ev({ kind: 'ability', outcome: 'hit', fx: 'heal' }))).toBe('spell');
    expect(turnEventSound(ev({ kind: 'ability', outcome: null, fx: 'heal' }))).toBe('heal');
    expect(turnEventSound(ev({ kind: 'ability', outcome: null, fx: 'buff' }))).toBe('spell');
    expect(turnEventSound(ev({ kind: 'defend' }))).toBe('defend');
    expect(turnEventSound(ev({ kind: 'item', outcome: 'crit' }))).toBe('heal');
    expect(turnEventSound(ev({ kind: 'flee' }))).toBe('miss');
    expect(turnEventSound(ev({ kind: 'stunned' }))).toBe('miss');
    expect(turnEventSound(ev({ kind: 'enrage', actor: 'monster' }))).toBe('enrage');
  });

  it('reads a condition by what it does to its bearer, and an unknown kind as a condition', () => {
    for (const kind of ['condition', 'weather']) {
      expect(turnEventSound(ev({ kind, player: 3 }))).toBe('heal');
      expect(turnEventSound(ev({ kind, player: -3 }))).toBe('hit');
      expect(turnEventSound(ev({ kind, player: 0, monster: -5 }))).toBe('spell');
      expect(turnEventSound(ev({ kind, actor: 'monster', monster: 2, player: -9 }))).toBe('heal');
      expect(turnEventSound(ev({ kind, actor: 'monster', monster: -2 }))).toBe('hit');
    }
  });

  it('always names a cue', () => {
    for (const kind of ['attack', 'ability', 'defend', 'item', 'flee', 'stunned', 'condition', 'enrage', 'other']) {
      for (const outcome of ['hit', 'crit', 'miss', 'half', null, 'other'] as Outcome[]) {
        for (const actor of ['player', 'monster'] as const) {
          for (const change of [-1, 0, 1]) expect(SOUND_CUES).toContain(turnEventSound(ev({ kind, outcome, actor, [actor]: change })));
        }
      }
    }
  });
});

describe('turnSounds', () => {
  it('has one entry per event at the moment its effect shows', () => {
    const events = [
      ev({ monster: -5 }), ev({ actor: 'monster', outcome: 'miss' }), ev({ kind: 'defend', outcome: null }), ev({ kind: 'flee', outcome: null }),
      ev({ kind: 'enrage', actor: 'monster', outcome: null, fx: 'rage' }), ev({ kind: 'condition', outcome: null, player: -2, fx: 'poison' }),
    ];
    const timeline = buildTimeline(events, { player: 10, monster: 10 }, 'victory');
    const sounds = turnSounds(events, timeline);
    expect(sounds.map((s) => s.event)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sounds.map((s) => s.cue)).toEqual(events.map(turnEventSound));
    sounds.forEach((sound, i) => {
      const own = timeline.cues.filter((cue) => cue.event === i);
      const impacts = own.filter((cue) => cue.type === 'fx' || cue.type === 'float' || cue.type === 'hp').map((cue) => cue.t);
      expect(impacts.length).toBeGreaterThan(0);
      expect(sound.t).toBe(Math.min(...impacts));
      if (i > 0) expect(sound.t).toBeGreaterThanOrEqual(sounds[i - 1].t);
    });
  });

  it('keeps time with a turn that is played faster, and is empty for no events', () => {
    const events = Array.from({ length: 14 }, () => ev({ monster: -1 }));
    const timeline = buildTimeline(events, { player: 10, monster: 10 });
    const sounds = turnSounds(events, timeline);
    expect(sounds).toHaveLength(14);
    expect(sounds[13].t).toBeLessThan(6);
    expect(turnSounds([], buildTimeline([], { player: 1, monster: 1 }))).toEqual([]);
    expect(turnSounds([], buildTimeline([], { player: 1, monster: 0 }, 'victory'))).toEqual([]);
  });

  it('falls back on the banner', () => {
    const events = [ev({})];
    const timeline = buildTimeline(events, { player: 1, monster: 1 });
    const bannerOnly = { ...timeline, cues: timeline.cues.filter((cue) => cue.type === 'banner' || cue.type === 'anim') };
    expect(turnSounds(events, bannerOnly)[0].t).toBe(timeline.cues.find((cue) => cue.type === 'banner')?.t);
  });
});

describe('resultSounds', () => {
  const rewards = (leveled: boolean, shard: string | null | undefined): BattleRewards => ({
    xp: 1, gold: 1, loot: null, loot_type: null, leveled_up: leveled, new_level: 2, hp_increase: 0, new_abilities: [], new_max_pp: null, asi_points: 0, quest_updates: [],
    boss: shard === undefined ? null : { name: 'b', defeat_text: null, shard, shards_collected: 1, shards_total: 5, act_unlocked: null, campaign_complete: false },
  });
  it('lists victory, shard and level-up in that order', () => {
    expect(resultSounds({ phase: 'victory', rewards: null })).toEqual(['victory']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(false, undefined) })).toEqual(['victory']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(false, '') })).toEqual(['victory']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(false, null) })).toEqual(['victory']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(false, 'Shard of Tides') })).toEqual(['victory', 'shard']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(true, undefined) })).toEqual(['victory', 'levelup']);
    expect(resultSounds({ phase: 'victory', rewards: rewards(true, 'Shard of Tides') })).toEqual(['victory', 'shard', 'levelup']);
    expect(resultSounds({ phase: 'defeat', rewards: rewards(true, 'x') })).toEqual(['defeat']);
    for (const phase of ['fight', 'fled', 'none']) expect(resultSounds({ phase, rewards: rewards(true, 'x') })).toEqual([]);
  });
});

describe('the tables', () => {
  it('names twenty cues', () => {
    expect(SOUND_CUES).toHaveLength(20);
    expect(new Set(SOUND_CUES).size).toBe(20);
    expect(SOUND_CUES.slice(0, 12)).toEqual(['hit', 'crit', 'miss', 'heal', 'defend', 'spell', 'victory', 'defeat', 'levelup', 'coin', 'click', 'save']);
  });

  it('gives every action a cue or lists it as silent', () => {
    expect(Object.keys(ACTION_SOUNDS)).toHaveLength(57);
    for (const cue of Object.values(ACTION_SOUNDS)) if (cue !== null) expect(SOUND_CUES).toContain(cue);
    for (const kind of ['monster', 'event', 'boss', 'search', 'rest', 'shop', 'travel'] as InteractionKind[]) expect(ACTION_SOUNDS).toHaveProperty(`interact_${kind}`);
    expect(Object.entries(ACTION_SOUNDS).filter(([, cue]) => cue === null).map(([key]) => key)).toEqual(['walk', 'look', 'arrival', 'battle_action', 'mute']);
  });

  it('knows the ground and the ambience of a location type', () => {
    expect([groundOf('town'), groundOf('wilderness'), groundOf('dungeon'), groundOf('swamp')]).toEqual(['stone', 'grass', 'dungeon', 'grass']);
    expect([stepSound('town'), stepSound('dungeon'), stepSound('other')]).toEqual(['step_stone', 'step_dungeon', 'step_grass']);
    expect(ambienceFor(null, true)).toBeNull();
    expect(ambienceFor('town', false)).toEqual({ bed: 'town', tense: false });
    expect(ambienceFor('dungeon', true)).toEqual({ bed: 'dungeon', tense: true });
    expect(ambienceFor('swamp', false)).toEqual({ bed: 'wilderness', tense: false });
  });
});
