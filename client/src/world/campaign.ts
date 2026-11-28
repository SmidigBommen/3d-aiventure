// Travel, the journal and the ending as the server answers them, and the lines their panels show.
// Pure: no rendering, no browser. Nothing here decides progression; it only words what the server said.

export interface TravelLocation { name: string; description: string; type: string; level_range: string | null; has_boss: boolean; cleared: boolean; current: boolean }
export interface TravelAct { number: number; title: string; locked: boolean; locked_reason: string | null; locations: TravelLocation[] }
export interface TravelView { current: string | null; acts: TravelAct[] }
/** One location as the map panel offers it. `reason`: why it cannot be chosen, when it cannot. */
export interface TravelChoice { location: string; act: number; hotkey: string; enabled: boolean; reason: string | null }
export interface JournalBoss { name: string; title: string; where: string; level: number; defeated: boolean }
export interface JournalAct { number: number; title: string; description: string; main_quest: string; locked: boolean; complete: boolean; current: boolean; bosses: JournalBoss[] }
export interface JournalView {
  campaign: { title: string; description: string };
  acts: JournalAct[];
  shards: { name: string; found: boolean }[];
  campaign_complete: boolean;
  stats: { kills: number; bosses: number; events: number; quests: number };
  active_quests: { name: string; progress: number; target: number; ready: boolean }[];
}
export interface EndingView {
  title: string;
  campaign_title: string;
  paragraphs: string[];
  character: { name: string; race: string; class_name: string; level: number; gold: number };
  stats: { kills: number; bosses: number; events: number; quests: number };
  shards: string[];
}
export interface EndingStep { kind: 'title' | 'text' | 'legend'; text: string }

/** How long the name of the place stays on screen after a journey. */
export const ARRIVAL_SECONDS = 2.5;

export const SHARD_COLOURS: Record<string, string> = {
  'Shard of Verdance': '#4caf50',
  'Shard of Embers': '#e2572b',
  'Shard of Tides': '#2f8fd8',
  'Shard of Gales': '#bfe3f2',
  'Shard of Stone': '#b08a4f',
};
const UNKNOWN_SHARD = '#d4af37';

/** Every location of the map in order, with its hotkey (its position, from 1) and whether it can be chosen. */
export function travelChoices(view: TravelView): TravelChoice[] {
  const choices: TravelChoice[] = [];
  for (const act of view.acts) {
    for (const location of act.locations) {
      const reason = act.locked ? act.locked_reason : location.current ? 'You are here.' : null;
      choices.push({ location: location.name, act: act.number, hotkey: String(choices.length + 1), enabled: !act.locked && !location.current, reason });
    }
  }
  return choices;
}

/** The choice a digit key stands for, enabled or not; null for any other key. */
export function travelChoiceForKey(view: TravelView, code: string): TravelChoice | null {
  return travelChoices(view).find((choice) => code === `Digit${choice.hotkey}` || code === `Numpad${choice.hotkey}`) ?? null;
}

/** What is shown on arriving: the name of the place and the act it belongs to. */
export function arrivalTitle(state: { location: { name: string; act: { number: number; title: string } } }): { title: string; subtitle: string } {
  return { title: state.location.name, subtitle: `Act ${state.location.act.number}: ${state.location.act.title}` };
}

/** The five sockets of the crown: a found shard with its name and colour, an empty one unnamed. */
export function shardSockets(shards: { name: string; found: boolean }[]): { name: string; found: boolean; label: string; colour: string | null }[] {
  return shards.map((shard) => ({
    name: shard.name,
    found: shard.found,
    label: shard.found ? shard.name : '???',
    colour: shard.found ? (Object.prototype.hasOwnProperty.call(SHARD_COLOURS, shard.name) ? SHARD_COLOURS[shard.name] : UNKNOWN_SHARD) : null,
  }));
}

export function actBadge(act: { locked: boolean; complete: boolean; current: boolean }): 'Complete' | 'In progress' | 'Locked' {
  if (act.complete) return 'Complete';
  return act.current ? 'In progress' : 'Locked';
}

/** The epilogue, one step per screen: the title, each paragraph, then the legend. */
export function endingSteps(view: EndingView): EndingStep[] {
  return [
    { kind: 'title', text: view.title },
    ...view.paragraphs.map((text): EndingStep => ({ kind: 'text', text })),
    { kind: 'legend', text: 'Your Legend' },
  ];
}

/** How long the card of a location stays on screen at least, while its first area loads. */
export const LOADING_CARD_SECONDS = 1.5;

/** What the loading panel shows on the way into another location: its name and description. null: the plain text. */
export function loadingCard(view: TravelView | null, from: string | null, to: string): { title: string; text: string } | null {
  if (!view || from === to) return null;
  for (const act of view.acts) {
    const found = act.locations.find((location) => location.name === to);
    if (found) return { title: found.name, text: found.description };
  }
  return null;
}

/** The rows of "Your Legend": label and value. */
export function legendLines(view: EndingView): [string, string][] {
  return [
    ['Level reached', String(view.character.level)],
    ['Monsters slain', String(view.stats.kills)],
    ['Bosses felled', String(view.stats.bosses)],
    ['Events braved', String(view.stats.events)],
    ['Quests completed', String(view.stats.quests)],
    ['Gold in purse', String(view.character.gold)],
  ];
}
