import { describe, expect, it } from 'vitest';
import { FX_LOOKS, flashPlace, fxLook } from './fx';
import { FX_KEYS, MAX_TURN_SECONDS, MIN_TURN_SECONDS, buildTimeline, type Cue, type TurnEvent } from './timeline';

const event = (over: Partial<TurnEvent>): TurnEvent =>
  ({ actor: 'player', kind: 'attack', name: 'Longsword', outcome: 'hit', fx: 'slashing', ranged: false, player: 0, monster: 0, ...over });
const of = <T extends Cue['type']>(cues: Cue[], type: T): Extract<Cue, { type: T }>[] => cues.filter((c) => c.type === type) as Extract<Cue, { type: T }>[];
const brief = (cues: Cue[]): string[] =>
  cues.filter((c) => c.type !== 'banner').map((c) =>
    c.type === 'anim' ? `anim ${c.side} ${c.anim}` : c.type === 'fx' ? `fx ${c.side} ${c.fx} ${c.source}`
      : c.type === 'float' ? `float ${c.side} ${c.text} ${c.style}` : c.type === 'hp' ? `hp ${c.side} ${c.before}>${c.after}` : '');

describe('buildTimeline', () => {
  it('plays nothing for a turn without events', () => {
    expect(buildTimeline([], { player: 10, monster: 7 })).toEqual({ cues: [], start: { player: 10, monster: 7 }, total: 0, inputAt: 0 });
  });

  it('turns a hit into strike, effect, hurt, bar step and number', () => {
    const line = buildTimeline([event({ monster: -6 })], { player: 20, monster: 4 });
    expect(line.start).toEqual({ player: 20, monster: 10 });
    expect(brief(line.cues)).toEqual(['anim player strike', 'fx monster slashing null', 'anim monster hurt', 'hp monster 10>4', 'float monster -6 damage']);
    expect(line.total).toBeCloseTo(0.25 + 0.76, 9);
    expect(line.inputAt).toBe(line.total);
    const [strike] = of(line.cues, 'anim');
    expect(of(line.cues, 'fx')[0].t).toBeGreaterThan(strike.t);
  });

  it('shows a miss, a crit, a resisted spell and a ranged source', () => {
    expect(brief(buildTimeline([event({ outcome: 'miss' })], { player: 1, monster: 1 }).cues))
      .toEqual(['anim player strike', 'anim monster dodge', 'float monster Miss miss']);
    expect(brief(buildTimeline([event({ outcome: 'crit', monster: -9 })], { player: 1, monster: 1 }).cues))
      .toEqual(['anim player strike', 'fx monster slashing null', 'anim monster hurt', 'float monster Critical! crit', 'hp monster 10>1', 'float monster -9 crit']);
    expect(brief(buildTimeline([event({ actor: 'monster', kind: 'ability', outcome: 'half', fx: 'fire', ranged: true, player: -3 })], { player: 1, monster: 1 }).cues))
      .toEqual(['anim monster cast', 'fx player fire monster', 'anim player hurt', 'float player Resisted miss', 'hp player 4>1', 'float player -3 damage']);
  });

  it('shows what is done to oneself on oneself', () => {
    const cues = (over: Partial<TurnEvent>): string[] => brief(buildTimeline([event({ outcome: null, ...over })], { player: 9, monster: 9 }).cues);
    expect(cues({ kind: 'ability', fx: 'heal', player: 5 })).toEqual(['anim player cast', 'fx player heal null', 'hp player 4>9', 'float player +5 heal']);
    expect(cues({ kind: 'defend', fx: 'shield' })).toEqual(['fx player shield null']);
    expect(cues({ kind: 'item', fx: 'heal' })).toEqual(['anim player cast', 'fx player heal null']);
    expect(cues({ kind: 'flee', outcome: 'miss' })).toEqual(['anim player dodge', 'float player No escape miss']);
    expect(cues({ kind: 'stunned', fx: 'stun', actor: 'monster' })).toEqual(['fx monster stun null', 'float monster Stunned miss']);
    expect(cues({ kind: 'condition', fx: 'poison', actor: 'monster', monster: -2 }))
      .toEqual(['fx monster poison null', 'anim monster hurt', 'hp monster 11>9', 'float monster -2 damage']);
    expect(cues({ kind: 'enrage', fx: 'rage', actor: 'monster' })).toEqual(['anim monster cast', 'fx monster rage null']);
    expect(cues({ kind: 'never heard of', fx: 'glitter', outcome: 'odd' as never })).toEqual(['fx player impact null']);
  });

  it('keeps the events in order, the bars in a chain and a long turn under six seconds', () => {
    const events = Array.from({ length: 14 }, (_, i) => event({ actor: i % 2 ? 'monster' : 'player', monster: i % 2 ? 0 : -3, player: i % 2 ? -2 : 1, name: `step ${i}` }));
    const line = buildTimeline(events, { player: 30, monster: 5 }, 'victory');
    expect(line.total).toBe(MAX_TURN_SECONDS);
    const banners = of(line.cues, 'banner');
    expect(banners.map((b) => b.event)).toEqual(events.map((_, i) => i));
    banners.forEach((b, i) => i > 0 && expect(b.t).toBeGreaterThan(banners[i - 1].t));
    for (const [i, cue] of line.cues.entries()) {
      expect(cue.t >= 0 && cue.d >= 0 && cue.t + cue.d <= line.total + 1e-9).toBe(true);
      if (i > 0) expect(cue.t).toBeGreaterThanOrEqual(line.cues[i - 1].t);
      if (cue.event >= 0) {
        expect(cue.t).toBeGreaterThanOrEqual(banners[cue.event].t);
        if (cue.event + 1 < banners.length) expect(cue.t).toBeLessThan(banners[cue.event + 1].t);
      }
    }
    for (const side of ['player', 'monster'] as const) {
      let at = line.start[side];
      for (const step of of(line.cues, 'hp').filter((c) => c.side === side)) {
        expect(step.before).toBe(at);
        at = step.after;
      }
      expect(at).toBe(side === 'player' ? 30 : 5);
    }
    const last = line.cues[line.cues.length - 1];
    expect(last).toMatchObject({ type: 'anim', anim: 'death', side: 'monster', event: -1 });
    expect(of(line.cues, 'anim').filter((c) => c.anim === 'death')).toHaveLength(1);
  });

  it('lets the loser fall last, and stays within the shortest and longest turn', () => {
    const lost = buildTimeline([event({ actor: 'monster', player: -4 })], { player: 0, monster: 8 }, 'defeat');
    expect(lost.cues[lost.cues.length - 1]).toMatchObject({ anim: 'death', side: 'player' });
    expect(lost.total).toBeCloseTo(0.25 + 0.76 + 0.9, 9);
    const short = buildTimeline([event({ kind: 'defend', outcome: null })], { player: 1, monster: 1 });
    expect(short.total).toBeGreaterThanOrEqual(MIN_TURN_SECONDS);
  });
});

describe('effect looks', () => {
  it('give every effect key its own colour and shape', () => {
    expect(FX_KEYS).toHaveLength(23);
    expect(Object.keys(FX_LOOKS).sort()).toEqual([...FX_KEYS].sort());
    const seen = new Set(Object.values(FX_LOOKS).map((look) => `${look.color} ${look.pattern}`));
    expect(seen.size).toBe(FX_KEYS.length);
    expect(new Set(Object.values(FX_LOOKS).map((look) => look.color)).size).toBe(FX_KEYS.length);
    expect(fxLook('toString')).toBe(FX_LOOKS.impact);
    for (const look of Object.values(FX_LOOKS)) expect(['edge', 'top', 'bottom', 'streak']).toContain(flashPlace(look.pattern));
  });
});
