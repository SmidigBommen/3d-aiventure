// The compass of the heads-up display: what there is to walk to in the area, and in which direction
// it lies from where the player looks. Pure: no rendering, no browser.

import type { AreaContents } from './contents';
import type { AreaLayout } from './layout';

export type CompassKind = 'gate' | 'shop' | 'rest' | 'boss' | 'travel';
export interface CompassMark {
  kind: CompassKind;
  label: string;
  x: number;
  z: number;
  bearing: number; // radians in (-π, π]: 0 straight ahead, positive to the player's left
  distance: number; // m
}

/** The angle wrapped into (-π, π]. */
function wrap(angle: number): number {
  const turn = Math.PI * 2;
  const a = angle - Math.floor(angle / turn) * turn; // [0, 2π)
  return a > Math.PI ? a - turn : a;
}

/** The marks of the area the player stands in: its gates in their order, then the shop, the rest place, the boss and the signpost. */
export function compassMarks(
  layout: AreaLayout,
  exits: { id: string; name: string }[],
  contents: AreaContents | null,
  player: { x: number; z: number; yaw: number },
): CompassMark[] {
  const mark = (kind: CompassKind, label: string, x: number, z: number): CompassMark => {
    const distance = Math.hypot(x - player.x, z - player.z);
    const bearing = distance === 0 ? 0 : wrap(Math.atan2(-(x - player.x), -(z - player.z)) - player.yaw);
    return { kind, label, x, z, bearing, distance };
  };
  const marks = layout.gates.map((gate) => mark('gate', exits.find((exit) => exit.id === gate.exitId)?.name ?? gate.exitId, gate.x, gate.z));
  const slots = layout.slots;
  if (!slots) return marks;
  if (slots.shop) marks.push(mark('shop', "Elara's shop", slots.shop.x, slots.shop.z));
  if (slots.rest) marks.push(mark('rest', 'Rest', slots.rest.x, slots.rest.z));
  const boss = contents?.boss ?? null;
  if (slots.boss && boss) marks.push(mark('boss', boss.name, slots.boss.x, slots.boss.z));
  if (slots.travel) marks.push(mark('travel', 'Signpost', slots.travel.x, slots.travel.z));
  return marks;
}
