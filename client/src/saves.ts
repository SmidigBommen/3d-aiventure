// The save slots as the panel shows them, and which buttons the title screen offers. Pure.

export interface SaveEntry {
  id: string;
  name: string;
  level: number;
  race: string;
  class_name: string;
  location: string;
  portrait: string;
  saved_at: string;
  created_at: string;
}

export interface SavesView {
  saves: SaveEntry[];
  max_saves: number;
  can_save: boolean;
}

export interface SlotRow {
  index: number;
  save: SaveEntry | null;
}

/** One row per slot: the saves in the view's order, then the empty slots. */
export function slotRows(view: SavesView): SlotRow[] {
  const count = Math.max(view.max_saves, view.saves.length);
  return Array.from({ length: count }, (_, index) => ({ index, save: view.saves[index] ?? null }));
}

/** '2026-11-28T14:05:09' as '2026-11-28 14:05'. */
export function savedAtText(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function slotLine(save: SaveEntry): string {
  return `${save.name} · Level ${save.level} ${save.race} ${save.class_name} · ${save.location} · ${savedAtText(save.saved_at)}`;
}

export type TitleButton = 'new' | 'continue' | 'load';

/** The buttons of the title screen, in their order. */
export function titleButtons(hasCharacter: boolean, saveCount: number): TitleButton[] {
  const buttons: TitleButton[] = ['new'];
  if (hasCharacter) buttons.push('continue');
  if (saveCount > 0) buttons.push('load');
  return buttons;
}
