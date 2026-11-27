// An exploration event as the server answers it (web/events.py) and the lines the event panel
// shows for it. Every number comes from the server. Pure: no rendering, no browser.

export interface EventChoice {
  index: number;
  label: string;
  hotkey: string; // "1".."4"
  skill: string | null; // null: no check, and then dc, modifier and proficient are null too
  dc: number | null;
  modifier: number | null;
  proficient: boolean | null;
}
export interface EventView {
  id: string;
  title: string;
  text: string;
  object: string;
  label: string;
  landmark: boolean;
  choices: EventChoice[];
}
export interface EventCheck { skill: string; roll: number; modifier: number; total: number; dc: number; success: boolean }
export interface EventResult {
  title: string;
  label: string;
  success: boolean;
  check: EventCheck | null;
  text: string;
  gold: number; // negative for a loss
  xp: number;
  heal: number;
  pp: number;
  damage: number;
  item: string | null;
  battle: boolean; // Continue leads into a fight
  leveled_up: boolean;
  new_level: number | null;
}
export interface Chip { kind: string; text: string }

/** The choice (its index) a key (by `KeyboardEvent.code`) asks for, or null: Digit1 to Digit4. */
export function choiceForKey(view: EventView, code: string): number | null {
  const digit = /^Digit([1-4])$/.exec(code);
  if (!digit) return null;
  const index = Number(digit[1]) - 1;
  return view.choices.some((choice) => choice.index === index) ? index : null;
}

const signed = (value: number): string => (value < 0 ? `-${-value}` : `+${value}`);

/** What a choice asks of the character: "Athletics +5 · DC 13 (proficient)", or "No check". */
export function choiceLine(choice: EventChoice): string {
  if (choice.skill === null) return 'No check';
  return `${choice.skill} ${signed(choice.modifier ?? 0)} · DC ${choice.dc}${choice.proficient ? ' (proficient)' : ''}`;
}

/** The roll as it fell: "d20 14 + 5 = 19 vs DC 13". */
export function rollLine(check: EventCheck): string {
  const modifier = check.modifier < 0 ? `- ${-check.modifier}` : `+ ${check.modifier}`;
  return `d20 ${check.roll} ${modifier} = ${check.total} vs DC ${check.dc}`;
}

export function verdict(result: EventResult): 'Success' | 'Failure' | null {
  if (result.check === null) return null;
  return result.success ? 'Success' : 'Failure';
}

/** One chip per thing gained or lost, in the order they are shown. */
export function outcomeChips(result: EventResult): Chip[] {
  const chips: Chip[] = [];
  if (result.gold > 0) chips.push({ kind: 'gold', text: `+${result.gold} gold` });
  if (result.gold < 0) chips.push({ kind: 'loss', text: `-${-result.gold} gold` });
  if (result.xp > 0) chips.push({ kind: 'xp', text: `+${result.xp} XP` });
  if (result.heal > 0) chips.push({ kind: 'heal', text: `+${result.heal} HP` });
  if (result.pp > 0) chips.push({ kind: 'pp', text: `+${result.pp} PP` });
  if (result.item) chips.push({ kind: 'item', text: result.item });
  if (result.damage > 0) chips.push({ kind: 'damage', text: `-${result.damage} HP` });
  if (result.leveled_up) chips.push({ kind: 'level', text: `Level ${result.new_level}!` });
  if (result.battle) chips.push({ kind: 'battle', text: 'A fight begins!' });
  return chips;
}
