// What sets a boss fight apart on screen: the look of the boss (also in its rage), when the rage
// is announced in a played turn, and the lines of the defeat scene. Pure: no rendering, no browser.

import { BOSS_SCALE, creatureLook, type CreatureLook } from '../world/contents';
import type { Timeline, TurnEvent } from './timeline';
import type { BossRewards } from './view';

/** A boss in its rage: larger, glowing red, and pulsing by `pulse` (a share of its size) every `period` seconds. */
export const ENRAGE_LOOK = { scale: 1.15, emissive: '#ff3b2f', pulse: 0.05, period: 0.6 };
export const ENRAGE_BANNER_SECONDS = 2.5;

export type BossLook = CreatureLook & { pulse: number; period: number };

export function bossLook(bossId: string, enraged: boolean): BossLook {
  const look = creatureLook(bossId);
  return {
    model: look.model,
    tint: look.tint,
    opacity: look.opacity,
    scale: look.scale * BOSS_SCALE * (enraged ? ENRAGE_LOOK.scale : 1),
    emissive: enraged ? ENRAGE_LOOK.emissive : look.emissive,
    pulse: enraged ? ENRAGE_LOOK.pulse : 0,
    period: ENRAGE_LOOK.period,
  };
}

/** When the rage is announced in a played turn: the banner cue of its first `enrage` event, or null. */
export function enrageCue(events: TurnEvent[], timeline: Timeline): { t: number; d: number } | null {
  for (const cue of timeline.cues) {
    if (cue.type === 'banner' && events[cue.event]?.kind === 'enrage') return { t: cue.t, d: cue.d };
  }
  return null;
}

export interface VictoryLine { kind: 'defeat' | 'shard' | 'act' | 'complete'; text: string }

/** The lines of the defeat scene, in the order they are shown. */
export function victoryLines(boss: BossRewards): VictoryLine[] {
  const lines: VictoryLine[] = [];
  if (boss.defeat_text) lines.push({ kind: 'defeat', text: boss.defeat_text });
  if (boss.shard) lines.push({ kind: 'shard', text: `${boss.shard} won. Crown shards: ${boss.shards_collected} of ${boss.shards_total}.` });
  if (boss.act_unlocked) lines.push({ kind: 'act', text: `Act ${boss.act_unlocked.number}: ${boss.act_unlocked.title} is now open.` });
  if (boss.campaign_complete) lines.push({ kind: 'complete', text: 'The Crown of Unity is whole again.' });
  return lines;
}
