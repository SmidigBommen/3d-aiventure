import { describe, expect, it } from 'vitest';
import bosses from '../../../json/bosses.json';
import { CREATURES } from '../world/contents';
import { ENRAGE_LOOK, bossLook, enrageCue, victoryLines } from './boss';
import { buildTimeline, type TurnEvent } from './timeline';
import type { BossRewards } from './view';

const event = (over: Partial<TurnEvent>): TurnEvent => ({ actor: 'player', kind: 'attack', name: 'Longsword', outcome: 'hit', fx: 'slashing', ranged: false, player: 0, monster: -5, ...over });
const ENRAGE = event({ actor: 'monster', kind: 'enrage', name: 'Enraged', outcome: null, fx: 'rage', monster: 0 });

describe('bossLook', () => {
  const expected: [string, string, number, string, number][] = [
    ['Shard Guardian', 'robot', 0.67, '#7fd0e0', 1],
    ['Corrupted Captain', 'skeleton_warrior', 0.77, '#9fb0c8', 1],
    ['Lady Vex', 'witch', 0.43, '#6a2a8a', 1],
    ['Lady Vex (Final Battle)', 'blue_demon', 1.06, '#8a2be2', 1],
    ['Flame Cultist Leader', 'dino', 0.73, '#c8452a', 1],
    ['Corrupted High Priest', 'cleric', 0.6, '#5a5a6a', 1],
    ['Ancient Wind Rider', 'king', 1.06, '#7fe0d0', 0.7],
    ['Primordial Earth Elemental', 'giant', 1.29, '#6b5a45', 1],
    ['Malachar the Void-touched', 'wizard', 0.65, '#2a1f4a', 1],
  ];
  it('covers every boss of the game', () => {
    expect(expected.map((row) => row[0]).sort()).toEqual(Object.keys(bosses).sort());
  });
  it.each(expected)('%s', (id, model, scale, tint, opacity) => {
    expect(CREATURES[id]).toMatchObject({ model: `creatures/${model}`, scale, tint, opacity });
    const calm = bossLook(id, false);
    expect(calm).toMatchObject({ model: `creatures/${model}`, tint, opacity, pulse: 0, period: 0.6, emissive: CREATURES[id].emissive });
    expect(calm.scale).toBeCloseTo(scale * 1.25, 10);
    const enraged = bossLook(id, true);
    expect(enraged).toMatchObject({ model: `creatures/${model}`, tint, opacity, emissive: '#ff3b2f', pulse: 0.05, period: 0.6 });
    expect(enraged.scale).toBeCloseTo(scale * 1.25 * 1.15, 10);
  });
  it('has the numbers of the rage', () => {
    expect(ENRAGE_LOOK).toEqual({ scale: 1.15, emissive: '#ff3b2f', pulse: 0.05, period: 0.6 });
  });
});

describe('enrageCue', () => {
  it('is the banner of the first enrage event', () => {
    const events = [event({}), ENRAGE, event({ actor: 'monster', monster: 0, player: -3 })];
    const timeline = buildTimeline(events, { player: 20, monster: 30 });
    const banner = timeline.cues.filter((cue) => cue.type === 'banner')[1];
    expect(banner).toMatchObject({ event: 1, text: 'Enraged' });
    expect(enrageCue(events, timeline)).toEqual({ t: banner.t, d: banner.d });
  });
  it('is null in a turn without one', () => {
    const events = [event({})];
    expect(enrageCue(events, buildTimeline(events, { player: 20, monster: 30 }))).toBeNull();
    expect(enrageCue([], buildTimeline([], { player: 20, monster: 30 }))).toBeNull();
    // The loser's fall belongs to no event
    expect(enrageCue(events, buildTimeline(events, { player: 20, monster: 0 }, 'victory'))).toBeNull();
  });
});

describe('victoryLines', () => {
  const rewards = (over: Partial<BossRewards>): BossRewards =>
    ({ name: 'The Shard Guardian', defeat_text: null, shard: null, shards_collected: 0, shards_total: 5, act_unlocked: null, campaign_complete: false, ...over });
  it('lists what applies, in order', () => {
    expect(victoryLines(rewards({}))).toEqual([]);
    expect(victoryLines(rewards({
      defeat_text: 'She falls.', shard: 'Shard of Verdance', shards_collected: 1,
      act_unlocked: { number: 2, title: 'The Elemental Trials', description: '...' }, campaign_complete: true,
    }))).toEqual([
      { kind: 'defeat', text: 'She falls.' },
      { kind: 'shard', text: 'Shard of Verdance won. Crown shards: 1 of 5.' },
      { kind: 'act', text: 'Act 2: The Elemental Trials is now open.' },
      { kind: 'complete', text: 'The Crown of Unity is whole again.' },
    ]);
  });
});
