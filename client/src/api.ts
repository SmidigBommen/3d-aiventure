// The server's JSON API. The server decides everything; this only carries it.

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
  area: { id: string; name: string; description: string; danger: Danger; has_shop: boolean; can_rest: boolean; has_boss: boolean } | null;
  exits: { id: string; name: string; danger: Danger }[];
  pending: { kind: 'battle' | 'event' | 'defeat'; url: string } | null;
}

export type MoveAnswer = { ok: true; state: WorldState } | { ok: false; error: string; message: string };

export async function fetchState(): Promise<WorldState> {
  const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`/api/state answered ${response.status}`);
  return (await response.json()) as WorldState;
}

export async function postMove(areaId: string): Promise<MoveAnswer> {
  try {
    const response = await fetch('/api/move', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area_id: areaId }),
    });
    const body = await response.json();
    if (response.ok) return { ok: true, state: body as WorldState };
    return { ok: false, error: String(body.error), message: String(body.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}
