// The server's JSON API. The server decides everything; this only carries it.

import type { BattleAction, BattleView } from './battle/view';
import type { CreationView, NewGameBody, Opening, PreviewView } from './creation';
import type { SavesView } from './saves';
import type { EndingView, JournalView, TravelView } from './world/campaign';
import type { AreaContents } from './world/contents';
import type { EventResult, EventView } from './world/event';
import type { InventoryView, ItemActionKind, SheetView } from './world/sheet';
import type { HaggleResult, ShopView, TrackedQuest } from './world/shop';

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
    is_start: boolean; // travel arrives in this area: it has the signpost
  } | null;
  exits: { id: string; name: string; danger: Danger }[];
  pending: { kind: 'battle' | 'event' | 'defeat' } | null;
  contents?: AreaContents | null; // what the area holds; null until the server has rolled it
  asi_points?: number; // ability score points not yet spent
  quests?: TrackedQuest[]; // the active quests, for the tracker
}

export type MoveAnswer = { ok: true; state: WorldState } | { ok: false; error: string; message: string };

export async function fetchState(): Promise<WorldState> {
  const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`/api/state answered ${response.status}`);
  return (await response.json()) as WorldState;
}

/** `dialog`: the line the shopkeeper has for the refusal, when she has one. */
type Refusal = { ok: false; error: string; message: string; dialog?: { context: string; line: string } | null };

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
    return { ok: false, error: String(answer.error), message: String(answer.message), dialog: answer.dialog ?? null };
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

export type EngageAnswer = { ok: true; state: WorldState; battle: BattleView | null; event: EventView | null } | Refusal;

/** Meeting the monster, event or boss with this id. Answers the fight, or the event with its choices. */
export async function postEngage(id: string): Promise<EngageAnswer> {
  const answer = await post<{ state: WorldState; battle?: BattleView | null; event?: EventView | null }>('/api/engage', { id });
  if (!answer.ok) return answer;
  return { ok: true, state: answer.value.state, battle: answer.value.battle ?? null, event: answer.value.event ?? null };
}

// --- events ---

type EventBody = { event: EventView | null; result: EventResult | null; state: WorldState; battle?: BattleView | null };
export type EventAnswer = { ok: true; event: EventView | null; result: EventResult | null; state: WorldState; battle: BattleView | null } | Refusal;

const asEvent = (answer: { ok: true; value: EventBody } | Refusal): EventAnswer =>
  (answer.ok ? { ok: true, event: answer.value.event, result: answer.value.result, state: answer.value.state, battle: answer.value.battle ?? null } : answer);

/** The pending event, or the outcome of the one just resolved. */
export async function fetchEvent(): Promise<EventAnswer> {
  try {
    const response = await fetch('/api/event', { credentials: 'same-origin', cache: 'no-store' });
    const answer = await response.json();
    if (response.ok) return asEvent({ ok: true, value: answer as EventBody });
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

/** The player's choice. The answer carries the outcome. */
export async function postEventChoose(choice: number): Promise<EventAnswer> {
  return asEvent(await post<EventBody>('/api/event/choose', { choice }));
}

/** The outcome has been read. The answer carries the fight when the outcome led into one. */
export async function postEventContinue(): Promise<EventAnswer> {
  return asEvent(await post<EventBody>('/api/event/continue'));
}

// --- inventory, character sheet and rest ---

type CharacterBody = { inventory: InventoryView; sheet: SheetView; state: WorldState; message: string | null };
export type CharacterAnswer = ({ ok: true } & CharacterBody) | Refusal;

const asCharacter = (answer: { ok: true; value: CharacterBody } | Refusal): CharacterAnswer =>
  (answer.ok ? { ok: true, inventory: answer.value.inventory, sheet: answer.value.sheet, state: answer.value.state, message: answer.value.message ?? null } : answer);

/** The inventory and the character sheet as they stand. */
export async function fetchCharacter(): Promise<CharacterAnswer> {
  try {
    const response = await fetch('/api/character', { credentials: 'same-origin', cache: 'no-store' });
    const answer = await response.json();
    if (response.ok) return asCharacter({ ok: true, value: answer as CharacterBody });
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

/** Drinking a potion, or equipping a weapon or armor, from the backpack. */
export async function postInventory(action: ItemActionKind, itemIndex: number): Promise<CharacterAnswer> {
  return asCharacter(await post<CharacterBody>(`/api/inventory/${action}`, { item_index: itemIndex }));
}

export async function postUnequip(what: 'weapon' | 'armor'): Promise<CharacterAnswer> {
  return asCharacter(await post<CharacterBody>(`/api/inventory/unequip-${what}`));
}

/** Spending one ability score point. */
export async function postImprove(ability: string): Promise<CharacterAnswer> {
  return asCharacter(await post<CharacterBody>('/api/character/improve', { ability }));
}

/** Resting where the area allows it. */
export async function postRest(): Promise<CharacterAnswer> {
  return asCharacter(await post<CharacterBody>('/api/rest'));
}

// --- Elara's shop and the quests ---

type ShopBody = { shop: ShopView; state: WorldState; message: string | null; haggle: HaggleResult | null };
export type ShopAnswer = ({ ok: true } & ShopBody) | Refusal;
/** The actions of the shop panel: the first three take the index of a ware or backpack entry, the others a quest id. */
export type ShopActionKind = 'buy' | 'sell' | 'haggle' | 'accept' | 'turn-in' | 'abandon';

const asShop = (answer: { ok: true; value: ShopBody } | Refusal): ShopAnswer =>
  (answer.ok ? { ok: true, shop: answer.value.shop, state: answer.value.state, message: answer.value.message ?? null, haggle: answer.value.haggle ?? null } : answer);

/** The shop as it stands. */
export async function fetchShop(): Promise<ShopAnswer> {
  try {
    const response = await fetch('/api/shop', { credentials: 'same-origin', cache: 'no-store' });
    const answer = await response.json();
    if (response.ok) return asShop({ ok: true, value: answer as ShopBody });
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

/** Buying, selling or haggling over the entry with this index. */
export async function postShopItem(action: 'buy' | 'sell' | 'haggle', itemIndex: number): Promise<ShopAnswer> {
  return asShop(await post<ShopBody>(`/api/shop/${action}`, { item_index: itemIndex }));
}

/** Accepting, turning in or abandoning the quest with this id. */
export async function postShopQuest(action: 'accept' | 'turn-in' | 'abandon', questId: string): Promise<ShopAnswer> {
  return asShop(await post<ShopBody>(`/api/shop/quest/${action}`, { quest_id: questId }));
}

// --- travel, the journal and the ending ---

async function get<T>(path: string): Promise<{ ok: true; value: T } | Refusal> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    const answer = await response.json();
    if (response.ok) return { ok: true, value: answer as T };
    return { ok: false, error: String(answer.error), message: String(answer.message) };
  } catch {
    return { ok: false, error: 'network', message: 'The server did not answer.' };
  }
}

/** The boss that strikes on the road, as the introduction shows it. */
export interface Ambush { id: string; name: string; title: string; intro: string | null }
type TravelBody = { travel: TravelView; state: WorldState; battle?: BattleView | null; ambush?: Ambush | null };
export type TravelAnswer = { ok: true; travel: TravelView; state: WorldState; battle: BattleView | null; ambush: Ambush | null } | Refusal;

const asTravel = (answer: { ok: true; value: TravelBody } | Refusal): TravelAnswer =>
  (answer.ok ? { ok: true, travel: answer.value.travel, state: answer.value.state, battle: answer.value.battle ?? null, ambush: answer.value.ambush ?? null } : answer);

/** The map: every act and location, what is locked and where the character is. */
export async function fetchTravel(): Promise<TravelAnswer> {
  return asTravel(await get<TravelBody>('/api/travel'));
}

/** The journey to a location. The answer carries the ambush and its fight when one is sprung on the road. */
export async function postTravel(location: string): Promise<TravelAnswer> {
  return asTravel(await post<TravelBody>('/api/travel', { location }));
}

export type JournalAnswer = { ok: true; journal: JournalView; state: WorldState } | Refusal;

export async function fetchJournal(): Promise<JournalAnswer> {
  const answer = await get<{ journal: JournalView; state: WorldState }>('/api/journal');
  return answer.ok ? { ok: true, journal: answer.value.journal, state: answer.value.state } : answer;
}

export type EndingAnswer = { ok: true; ending: EndingView; state: WorldState } | Refusal;

/** The epilogue; refused until the campaign is complete. */
export async function fetchEnding(): Promise<EndingAnswer> {
  const answer = await get<{ ending: EndingView; state: WorldState }>('/api/ending');
  return answer.ok ? { ok: true, ending: answer.value.ending, state: answer.value.state } : answer;
}

// --- character creation and the save slots ---

export type CreationAnswer = { ok: true; creation: CreationView } | Refusal;

/** Everything the creation steps show. */
export async function fetchCreation(): Promise<CreationAnswer> {
  const answer = await get<CreationView>('/api/creation');
  return answer.ok ? { ok: true, creation: answer.value } : answer;
}

export type PreviewAnswer = { ok: true; preview: PreviewView } | Refusal;

/** What a character of this race and class will be. */
export async function fetchPreview(race: string, className: string): Promise<PreviewAnswer> {
  const answer = await get<PreviewView>(`/api/creation/preview?race=${encodeURIComponent(race)}&class_name=${encodeURIComponent(className)}`);
  return answer.ok ? { ok: true, preview: answer.value } : answer;
}

export type NewGameAnswer = { ok: true; state: WorldState; opening: Opening } | Refusal;

/** Creates the character and starts a new game with it. */
export async function postNewGame(body: NewGameBody): Promise<NewGameAnswer> {
  const answer = await post<{ state: WorldState; opening: Opening }>('/api/new-game', body);
  return answer.ok ? { ok: true, state: answer.value.state, opening: answer.value.opening } : answer;
}

export type SavesAnswer = { ok: true; saves: SavesView } | Refusal;

export async function fetchSaves(): Promise<SavesAnswer> {
  const answer = await get<SavesView>('/api/saves');
  return answer.ok ? { ok: true, saves: answer.value } : answer;
}

/** `state` comes with a load: the game that was saved, now this session's. */
export type SaveActionAnswer = { ok: true; saves: SavesView; message: string; state: WorldState | null } | Refusal;
type SaveBody = { saves: SavesView; message: string; state?: WorldState };

/** Saving into a new slot (`id` null) or over a save, loading a save, deleting one. */
export async function postSave(action: 'save' | 'load' | 'delete', id: string | null): Promise<SaveActionAnswer> {
  const path = id === null ? '/api/saves' : `/api/saves/${encodeURIComponent(id)}${action === 'save' ? '' : `/${action}`}`;
  const answer = await post<SaveBody>(path);
  return answer.ok ? { ok: true, saves: answer.value.saves, message: answer.value.message, state: answer.value.state ?? null } : answer;
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
