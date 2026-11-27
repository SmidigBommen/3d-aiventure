// The server's JSON API. The server decides everything; this only carries it.

import type { BattleAction, BattleView } from './battle/view';
import type { AreaContents } from './world/contents';

export type Danger = 'safe' | 'low' | 'med' | 'high';

export interface WorldState {
  has_character: boolean;
  character: {
    name: string;
    race: string;
    class_name: string;
    level: number;
    current_hit_points: number;
    max_hit_points: number;
    power_points: number;
    max_power_points: number;
    xp: number;
    xp_to_next_level: number;
    gold: number;
  } | null;
  location: { name: string; type: string; act: { number: number; title: string } } | null;
  area: {
    id: string;
    name: string;
    description: string;
    danger: Danger;
    has_shop: boolean;
    can_rest: boolean;
    has_boss: boolean; // an undefeated boss waits here
    is_boss_area: boolean; // the campaign places a boss here, defeated or not
    special: string | null; // the area's `special` from the campaign data
  } | null;
  exits: { id: string; name: string; danger: Danger }[];
  pending: { kind: 'battle' | 'event' | 'defeat'; url: string } | null;
  contents?: AreaContents | null; // what the area holds; null until the server has rolled it
}

export type MoveAnswer = { ok: true; state: WorldState } | { ok: false; error: string; message: string };

export async function fetchState(): Promise<WorldState> {
  const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`/api/state answered ${response.status}`);
  return (await response.json()) as WorldState;
}

type Refusal = { ok: false; error: string; message: string };

async function post<T>(path: string, body?: unknown): Promise<{ ok: true; value: T } | Refusal> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer = await response.json();
    if (response.ok) return { ok: true, value: answer as T };
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

const asState = (answer: { ok: true; value: WorldState } | Refusal): MoveAnswer => (answer.ok ? { ok: true, state: answer.value } : answer);

export async function postMove(areaId: string): Promise<MoveAnswer> {
  return asState(await post<WorldState>('/api/move', { area_id: areaId }));
}

/** Arriving in the current area: the server rolls what it holds when it has not yet. */
export async function postEnter(): Promise<MoveAnswer> {
  return asState(await post<WorldState>('/api/enter'));
}

/** Searching the area further: a new roll. */
export async function postSearch(): Promise<MoveAnswer> {
  return asState(await post<WorldState>('/api/search'));
}

export type EngageAnswer = { ok: true; url: string; state: WorldState; battle: BattleView | null } | Refusal;

/** Meeting the monster, event or boss with this id. Answers the fight, or the page on which an event goes on. */
export async function postEngage(id: string): Promise<EngageAnswer> {
  const answer = await post<{ url: string; state: WorldState; battle?: BattleView | null }>('/api/engage', { id });
  return answer.ok ? { ok: true, url: answer.value.url, state: answer.value.state, battle: answer.value.battle ?? null } : answer;
}

// --- the fight ---

export type BattleAnswer = { ok: true; battle: BattleView; state: WorldState } | Refusal;
type BattleBody = { battle: BattleView; state: WorldState };

const asBattle = (answer: { ok: true; value: BattleBody } | Refusal): BattleAnswer =>
  (answer.ok ? { ok: true, battle: answer.value.battle, state: answer.value.state } : answer);

/** The fight as it stands. */
export async function fetchBattle(): Promise<BattleAnswer> {
  try {
    const response = await fetch('/api/battle', { credentials: 'same-origin', cache: 'no-store' });
    const answer = await response.json();
    if (response.ok) return { ok: true, battle: answer.battle as BattleView, state: answer.state as WorldState };
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

/** One action of the player's turn. The answer carries the turn that followed. */
export async function postBattle(action: BattleAction): Promise<BattleAnswer> {
  const body = action.type === 'ability' ? { ability_id: action.ability_id } : action.type === 'item' ? { item_index: action.item_index } : undefined;
  return asBattle(await post<BattleBody>(`/api/battle/${action.type}`, body));
}

/** After a victory: on with the walk. */
export async function postBattleContinue(): Promise<BattleAnswer> {
  return asBattle(await post<BattleBody>('/api/battle/continue'));
}

/** After a defeat: up again in the location's starting area. */
export async function postBattleRevive(): Promise<BattleAnswer> {
  return asBattle(await post<BattleBody>('/api/battle/revive'));
}
