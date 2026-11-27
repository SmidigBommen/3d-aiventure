// The HTML panels of the inventory and the character sheet. They show the views the server answered;
// the lines come from sheet.ts and every number in them from the views.

import {
  ABILITY_NAMES, attackLine, itemAction, itemLines, itemTitle, signed, xpFraction,
  type InventoryView, type ItemActionKind, type PanelKind, type SheetView,
} from './sheet';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function node(tag: string, cls: string, text = ''): HTMLElement {
  const made = document.createElement(tag);
  if (cls) made.className = cls;
  if (text) made.textContent = text;
  return made;
}

function button(cls: string, text: string, disabled: boolean): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = cls;
  made.textContent = text;
  made.disabled = disabled;
  return made;
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const PANEL_IDS: Record<PanelKind, string> = { inventory: 'inventory-panel', sheet: 'sheet-panel' };

/** The line of the last action, or of its refusal. */
export interface PanelMessage { text: string; refused: boolean }

function showMessage(panel: HTMLElement, message: PanelMessage | null): void {
  const line = panel.querySelector<HTMLElement>('.panel-message');
  if (!line) return;
  line.hidden = message === null;
  line.textContent = message?.text ?? '';
  line.classList.toggle('refused', message?.refused === true);
}

/** Which of the two panels is on screen, if any. */
export function showSheetPanel(kind: PanelKind | null): void {
  el(PANEL_IDS.inventory).hidden = kind !== 'inventory';
  el(PANEL_IDS.sheet).hidden = kind !== 'sheet';
}

/** The inventory panel. `locked`: an action is on its way to the server. */
export function renderInventory(view: InventoryView, sheet: SheetView, message: PanelMessage | null, locked: boolean): void {
  showMessage(el(PANEL_IDS.inventory), message);
  el('inv-attack').textContent = attackLine(sheet.attack);
  el('inv-ac').textContent = `Armor Class ${view.armor_class}`;
  const { weapon, armor } = view;
  el('inv-weapon').textContent = weapon
    ? `${weapon.name}: ${weapon.damage_dice_count}d${weapon.damage_die} ${weapon.damage_type}, ${weapon.category}`
    : 'Nothing in hand';
  el('inv-armor').textContent = armor ? `${armor.name}: base AC ${armor.base_ac}, ${armor.category}` : 'No armor';
  const offWeapon = el<HTMLButtonElement>('inv-unequip-weapon');
  offWeapon.hidden = weapon === null;
  offWeapon.disabled = locked;
  const offArmor = el<HTMLButtonElement>('inv-unequip-armor');
  offArmor.hidden = armor === null;
  offArmor.disabled = locked;

  const rows = view.items.map((item) => {
    const row = node('div', `inv-item inv-${item.type}`);
    row.dataset.index = String(item.index);
    const text = node('div', 'inv-text');
    text.append(node('div', 'inv-name', itemTitle(item)));
    const lines = itemLines(item);
    lines.forEach((line, i) => {
      const compared = item.compare && item.can_equip && i === lines.length - 1 && item.type !== 'potion' && item.type !== 'quest_item';
      text.append(node('div', compared ? `inv-line compare-${item.compare?.cls}` : 'inv-line', line));
    });
    row.append(text);
    const action = itemAction(item);
    if (action) {
      const made = button('btn btn-small inv-action', action.label, locked || !action.enabled);
      made.dataset.action = action.action;
      row.append(made);
    }
    return row;
  });
  el('inv-items').replaceChildren(...(rows.length > 0 ? rows : [node('p', 'inv-empty', 'Your backpack is empty.')]));
}

/** The character sheet. `locked`: an action is on its way to the server. */
export function renderSheet(view: SheetView, message: PanelMessage | null, locked: boolean): void {
  showMessage(el(PANEL_IDS.sheet), message);
  el('sheet-name').textContent = view.name;
  el('sheet-kind').textContent = `${view.race} ${view.class_name} · Level ${view.level}`;
  el('sheet-xp-fill').style.width = `${xpFraction(view.xp, view.xp_to_next_level) * 100}%`;
  el('sheet-xp-text').textContent = `XP ${view.xp} / ${view.xp_to_next_level}`;
  el('sheet-vitals').replaceChildren(
    node('span', '', `HP ${view.current_hit_points}/${view.max_hit_points}`),
    node('span', '', `PP ${view.power_points}/${view.max_power_points}`),
    node('span', '', `Gold ${view.gold}`),
    node('span', '', `Proficiency ${signed(view.proficiency_bonus)}`),
  );
  el('sheet-attack').textContent = attackLine(view.attack);
  el('sheet-ac').textContent = `Armor Class ${view.armor_class}`;
  const points = el('sheet-points');
  points.hidden = view.asi_points <= 0;
  points.textContent = view.asi_points === 1 ? '1 ability score point to spend' : `${view.asi_points} ability score points to spend`;

  const numbers = view as unknown as Record<string, number>;
  el('sheet-scores').replaceChildren(...ABILITY_NAMES.map((ability) => {
    const box = node('div', ability === view.primary_ability ? 'sheet-score primary' : 'sheet-score');
    box.dataset.ability = ability;
    box.append(
      node('div', 'score-name', capital(ability).slice(0, 3).toUpperCase()),
      node('div', 'score-value', String(numbers[`${ability}_score`])),
      node('div', 'score-mod', signed(numbers[`${ability}_modifier`])),
    );
    if (ability === view.primary_ability) box.append(node('div', 'score-tag', 'Primary'));
    if (view.improvable.includes(ability)) {
      const plus = button('btn btn-small sheet-improve', '+1', locked);
      plus.dataset.ability = ability;
      box.append(plus);
    }
    return box;
  }));

  el('sheet-saves').replaceChildren(...ABILITY_NAMES.map((ability) => {
    const proficient = view.saving_throws.includes(ability);
    return node('span', proficient ? 'sheet-chip proficient' : 'sheet-chip', `${capital(ability).slice(0, 3)} ${signed(view.save_modifiers[ability] ?? 0)}`);
  }));
  el('sheet-weapons').textContent = view.weapon_proficiencies.join(', ') || 'None';
  el('sheet-armors').textContent = (view.armor_training.join(', ') || 'None')
    + (view.unarmored_defense ? ` · Unarmored defense: ${capital(view.unarmored_defense)}` : '');
  el('sheet-skills').replaceChildren(...view.skills.map((skill) => {
    const row = node('div', skill.proficient ? 'sheet-skill proficient' : 'sheet-skill');
    row.append(node('span', '', `${skill.name} (${skill.ability.slice(0, 3)})`), node('span', '', signed(skill.modifier)));
    return row;
  }));
  el('sheet-abilities').replaceChildren(...view.abilities.map((ability) => {
    const row = node('div', 'sheet-ability');
    const head = node('div', 'sheet-ability-head');
    head.append(node('span', 'ability-name', ability.name), node('span', 'ability-cost', ability.cost > 0 ? `${ability.cost} PP` : 'Free'));
    row.append(head);
    if (ability.description) row.append(node('div', 'ability-text', ability.description));
    for (const line of ability.summary) row.append(node('div', 'ability-stat', line));
    return row;
  }));
}

/** What the buttons do: the same handlers for every click, whichever panel it is in. */
export function bindSheetPanels(handlers: {
  item: (action: ItemActionKind, index: number) => void;
  unequip: (what: 'weapon' | 'armor') => void;
  improve: (ability: string) => void;
  close: () => void;
}): void {
  el('inv-items').addEventListener('click', (event) => {
    const pressed = (event.target as HTMLElement).closest<HTMLButtonElement>('button.inv-action');
    const row = pressed?.closest<HTMLElement>('.inv-item');
    if (pressed && row && !pressed.disabled) handlers.item(pressed.dataset.action as ItemActionKind, Number(row.dataset.index));
  });
  el('inv-unequip-weapon').addEventListener('click', () => handlers.unequip('weapon'));
  el('inv-unequip-armor').addEventListener('click', () => handlers.unequip('armor'));
  el('sheet-scores').addEventListener('click', (event) => {
    const pressed = (event.target as HTMLElement).closest<HTMLButtonElement>('button.sheet-improve');
    if (pressed && !pressed.disabled) handlers.improve(pressed.dataset.ability ?? '');
  });
  for (const id of ['inv-close', 'sheet-close']) el(id).addEventListener('click', () => handlers.close());
}
