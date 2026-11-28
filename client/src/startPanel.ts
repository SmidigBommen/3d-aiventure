// The HTML of character creation, the opening, the save slots and the settings. They show what the server
// answered and what the player chose; the steps and lines come from creation.ts, saves.ts and settings.ts.

import {
  CREATION_STEPS, acFor, classOf, openingLines, stepComplete,
  type Choices, type ClassEntry, type CreationStep, type CreationView, type Opening, type PreviewView,
} from './creation';
import { slotLine, slotRows, type SavesView } from './saves';
import { FOV_RANGE, KEY_LIST, SENSITIVITY_RANGE, clampSettings, type Settings } from './settings';
import { VOLUME_RANGE, type SoundSettings } from './sound/volume';
import type { PanelMessage } from './world/sheetPanel';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function node(tag: string, cls: string, text = '', children: Node[] = []): HTMLElement {
  const made = document.createElement(tag);
  if (cls) made.className = cls;
  if (text) made.textContent = text;
  made.append(...children);
  return made;
}

function button(cls: string, text: string, disabled = false): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = cls;
  made.textContent = text;
  made.disabled = disabled;
  return made;
}

function showMessage(panel: HTMLElement, message: PanelMessage | null): void {
  const line = panel.querySelector<HTMLElement>('.panel-message');
  if (!line) return;
  line.hidden = message === null;
  line.textContent = message?.text ?? '';
  line.classList.toggle('refused', message?.refused === true);
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const short = (ability: string): string => ability.slice(0, 3).toUpperCase();
const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value));
const list = (words: string[]): string => (words.length ? words.join(', ') : 'None');

// --- character creation --------------------------------------------------------------------------

const STEP_TITLES: Record<CreationStep, string> = {
  race: 'Choose your race',
  class: 'Choose your class',
  skills: 'Choose your skills',
  name: 'Name your hero',
  weapon: 'Choose your weapon',
  armour: 'Choose your armour',
  portrait: 'Choose your portrait',
  summary: 'Your hero',
};
const NEXT_LABEL = 'Next';
const BEGIN_LABEL = 'Begin the adventure';

export interface CreationHandlers {
  /** A card of the step was clicked: the value it carries ('' for no armour). */
  choose: (value: string) => void;
  name: (text: string) => void;
  back: () => void;
  next: () => void;
}

export function bindCreationPanel(handlers: CreationHandlers): void {
  el('creation-body').addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (card && !(card as HTMLButtonElement).disabled) handlers.choose(card.dataset.value ?? '');
  });
  el('creation-body').addEventListener('input', (event) => {
    const field = event.target as HTMLInputElement;
    if (field.id === 'creation-name') handlers.name(field.value);
  });
  el('creation-back').addEventListener('click', () => handlers.back());
  el('creation-next').addEventListener('click', () => handlers.next());
}

export function showCreationPanel(on: boolean): void {
  el('creation-panel').hidden = !on;
}

/** A card that chooses `value`. */
function card(value: string, chosen: boolean, title: string, lines: (string | Node)[], cls = ''): HTMLElement {
  const made = button(`create-card${chosen ? ' chosen' : ''}${cls ? ` ${cls}` : ''}`, '');
  made.dataset.value = value;
  made.append(node('span', 'create-card-title', title));
  for (const line of lines) made.append(typeof line === 'string' ? node('span', 'create-card-line', line) : line);
  return made;
}

function classCard(entry: ClassEntry, chosen: boolean): HTMLElement {
  const bonuses = Object.entries(entry.ability_bonuses).map(([ability, bonus]) => `${signed(bonus)} ${short(ability)}`);
  const abilities = node('span', 'create-abilities', '', entry.abilities.map((ability) =>
    node('span', 'create-ability', '', [
      node('strong', '', ability.name),
      node('span', 'create-ability-meta', ` · level ${ability.unlock_level} · ${ability.cost === 0 ? 'free' : `${ability.cost} PP`}`),
      node('span', 'create-ability-text', ability.description),
    ])));
  return card(entry.name, chosen, entry.name, [
    node('span', 'create-card-line playstyle', entry.playstyle),
    `Hit die d${entry.hit_die} · Primary ${capital(entry.primary_ability)} · ${list(bonuses)}`,
    `Saving throws: ${list(entry.saving_throws.map(capital))}`,
    `Armour: ${list(entry.armor_training)}`,
    `Weapons: ${list(entry.weapon_proficiencies)}`,
    abilities,
  ], 'wide');
}

function summary(view: CreationView, choices: Choices, preview: PreviewView | null): HTMLElement[] {
  const portrait = view.portraits.find((entry) => entry.path === choices.portrait) ?? null;
  const picture = document.createElement('img');
  picture.className = 'create-summary-portrait';
  picture.alt = portrait?.label ?? '';
  if (portrait) picture.src = portrait.path;
  const lines: [string, string][] = [
    ['Name', choices.name.trim()],
    ['Race', choices.race ?? ''],
    ['Class', choices.class_name ?? ''],
    ['Portrait', portrait?.label ?? ''],
    ['Weapon', choices.weapon ?? ''],
    ['Armour', choices.armor ?? 'No armour'],
    ['Skills', list(choices.skills)],
  ];
  if (preview) {
    lines.push(
      ['Scores', preview.scores.map((score) => `${short(score.name)} ${score.score} (${signed(score.modifier)})`).join(' · ')],
      ['Hit points', String(preview.hit_points)],
      ['Power points', String(preview.power_points)],
      ['Armour class', String(acFor(preview, choices.armor))],
      ['Abilities', list(preview.starting_abilities)],
    );
  }
  return [
    node('div', 'create-summary', '', [
      picture,
      node('div', 'create-summary-lines', '', lines.map(([label, text]) =>
        node('div', 'create-summary-line', '', [node('span', 'create-summary-label', label), node('span', '', text)]))),
    ]),
  ];
}

function stepBody(view: CreationView, step: CreationStep, choices: Choices, preview: PreviewView | null): HTMLElement[] {
  const chosen = classOf(choices, view);
  switch (step) {
    case 'race':
      return [node('div', 'create-grid', '', view.races.map((race) => card(race.name, race.name === choices.race, race.name, [race.bonus_display])))];
    case 'class':
      return [node('div', 'create-list', '', view.classes.map((entry) => classCard(entry, entry.name === choices.class_name)))];
    case 'skills': {
      const max = chosen?.num_skills ?? 0;
      const full = choices.skills.length >= max;
      return [
        node('p', 'create-count', `${choices.skills.length} / ${max} chosen`),
        node('div', 'create-grid', '', (chosen?.skill_choices ?? []).map((skill) => {
          const on = choices.skills.includes(skill);
          const toggle = card(skill, on, skill, [], full && !on ? 'full' : '');
          toggle.setAttribute('aria-pressed', String(on));
          return toggle;
        })),
      ];
    }
    case 'name': {
      const field = document.createElement('input');
      field.id = 'creation-name';
      field.type = 'text';
      field.maxLength = view.name_max;
      field.value = choices.name;
      field.autocomplete = 'off';
      field.spellcheck = false;
      field.placeholder = 'Name';
      return [field];
    }
    case 'weapon':
      return [node('div', 'create-grid', '', (chosen?.weapons ?? []).map((weapon) => card(weapon.name, weapon.name === choices.weapon, weapon.name, [
        `1d${weapon.damage_die} ${weapon.damage_type} · ${weapon.category}`,
        list(weapon.properties),
      ])))];
    case 'armour': {
      const ac = (armor: string | null): string => (preview ? `AC ${acFor(preview, armor)}` : '');
      return [node('div', 'create-grid', '', [
        card('', choices.armor === null, 'No armour', [ac(null), 'Unarmoured']),
        ...(chosen?.armors ?? []).map((armor) => card(armor.name, armor.name === choices.armor, armor.name, [
          ac(armor.name),
          `${armor.category} · ${armor.weight} lb${armor.stealth_disadvantage ? ' · Stealth disadvantage' : ''}`,
        ])),
      ])];
    }
    case 'portrait':
      return [node('div', 'create-grid portraits', '', view.portraits.map((portrait) => {
        const picture = document.createElement('img');
        picture.src = portrait.path;
        picture.alt = portrait.label;
        return card(portrait.path, portrait.path === choices.portrait, portrait.label, [picture]);
      }))];
    case 'summary':
      return summary(view, choices, preview);
  }
}

function previewBox(choices: Choices, preview: PreviewView): HTMLElement[] {
  return [
    node('div', 'create-scores', '', preview.scores.map((score) =>
      node('div', `sheet-score${score.primary ? ' primary' : ''}`, '', [
        node('span', 'score-name', short(score.name)),
        node('span', 'score-value', String(score.score)),
        node('span', 'score-mod', signed(score.modifier)),
        ...(score.primary ? [node('span', 'score-tag', 'Primary')] : []),
      ]))),
    node('div', 'sheet-line', '', [
      node('span', '', `Hit points ${preview.hit_points}`),
      node('span', '', `Power points ${preview.power_points}`),
      node('span', 'create-ac', `Armour class ${acFor(preview, choices.armor)}`),
    ]),
    node('p', 'sheet-text', `Starts with ${list(preview.starting_abilities)}`),
  ];
}

/** Whether Next leads on from this step; on the summary also whether the new game is on its way. */
export function showCreationFoot(view: CreationView, step: CreationStep, choices: Choices, locked: boolean): void {
  const next = el<HTMLButtonElement>('creation-next');
  next.textContent = step === 'summary' ? BEGIN_LABEL : NEXT_LABEL;
  next.disabled = locked || !stepComplete(step, choices, view);
  el<HTMLButtonElement>('creation-back').disabled = locked;
}

let shownStep: CreationStep | null = null;

/** The creation panel at `step`. `preview` is the server's, for the race and class chosen, when it is in. */
export function renderCreation(
  view: CreationView, step: CreationStep, choices: Choices, preview: PreviewView | null, message: PanelMessage | null, locked: boolean,
): void {
  const panel = el('creation-panel');
  showMessage(panel, message);
  el('creation-heading').textContent = STEP_TITLES[step];
  el('creation-steps').replaceChildren(...CREATION_STEPS.map((name, index) => {
    const at = CREATION_STEPS.indexOf(step);
    const mark = node('span', `create-step${index === at ? ' current' : index < at ? ' done' : ''}`, capital(name));
    mark.dataset.step = name;
    return mark;
  }));
  // The name field is never rebuilt while its step is shown: an answer that arrives while the player types
  // (the preview) must not take the field, its caret or its focus away.
  const typing = step === 'name' && shownStep === 'name' && document.getElementById('creation-name') !== null;
  if (!typing) el('creation-body').replaceChildren(...stepBody(view, step, choices, preview));
  const box = el('creation-preview');
  box.hidden = preview === null;
  box.replaceChildren(...(preview ? previewBox(choices, preview) : []));
  showCreationFoot(view, step, choices, locked);
  if (shownStep !== step) {
    shownStep = step;
    panel.scrollTop = 0;
    if (step === 'name') el<HTMLInputElement>('creation-name').focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }
}

/** Creation is left: the next time it opens, its first step is shown from the top. */
export function forgetCreationStep(): void {
  shownStep = null;
}

// --- the opening ---------------------------------------------------------------------------------

export function bindOpeningPanel(handlers: { proceed: () => void }): void {
  el('opening-continue').addEventListener('click', () => handlers.proceed());
}

export function showOpening(opening: Opening | null): void {
  el('opening-panel').hidden = opening === null;
  if (!opening) return;
  const lines = openingLines(opening);
  el('opening-heading').textContent = lines.heading;
  el('opening-act').textContent = lines.act;
  el('opening-text').replaceChildren(...lines.paragraphs.map((text) => node('p', '', text)));
  el('opening-quest').textContent = lines.quest;
}

// --- the save slots ------------------------------------------------------------------------------

export type SavesMode = 'save' | 'load';
export interface SaveConfirm { action: 'overwrite' | 'delete'; id: string }
/** What a button of a slot row asks for. `id` is null for "Save here". */
export type SlotAction = 'save' | 'overwrite' | 'load' | 'delete';

export interface SavesHandlers {
  act: (action: SlotAction, id: string | null) => void;
  yes: () => void;
  no: () => void;
  close: () => void;
}

export function bindSavesPanel(handlers: SavesHandlers): void {
  el('saves-slots').addEventListener('click', (event) => {
    const pressed = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!pressed || pressed.disabled) return;
    const id = pressed.closest<HTMLElement>('[data-save-id]')?.dataset.saveId ?? '';
    handlers.act(pressed.dataset.action as SlotAction, id === '' ? null : id);
  });
  el('saves-yes').addEventListener('click', () => handlers.yes());
  el('saves-no').addEventListener('click', () => handlers.no());
  el('saves-close').addEventListener('click', () => handlers.close());
}

export function showSavesPanel(on: boolean): void {
  el('saves-panel').hidden = !on;
}

const QUESTIONS: Record<SaveConfirm['action'], string> = { overwrite: 'Overwrite this save?', delete: 'Delete this save?' };

/** The ten slots. `locked`: an action is on its way to the server. */
export function renderSaves(view: SavesView, mode: SavesMode, confirm: SaveConfirm | null, message: PanelMessage | null, locked: boolean): void {
  showMessage(el('saves-panel'), message);
  el('saves-heading').textContent = mode === 'save' ? 'Save game' : 'Load game';
  const held = locked || confirm !== null;
  el('saves-slots').replaceChildren(...slotRows(view).map(({ index, save }) => {
    const row = node('div', `save-slot${save ? '' : ' empty'}${confirm && save?.id === confirm.id ? ' asked' : ''}`);
    row.dataset.saveId = save?.id ?? '';
    row.append(node('span', 'save-number', String(index + 1)));
    row.append(node('span', 'save-line', save ? slotLine(save) : 'Empty'));
    const add = (action: SlotAction, text: string, disabled: boolean): void => {
      const made = button('btn btn-small', text, disabled);
      made.dataset.action = action;
      row.append(made);
    };
    if (save && mode === 'save') add('overwrite', 'Overwrite', held || !view.can_save);
    if (save && mode === 'load') add('load', 'Load', held);
    if (save) add('delete', 'Delete', held);
    if (!save && mode === 'save') add('save', 'Save here', held || !view.can_save);
    return row;
  }));
  el('saves-confirm').hidden = confirm === null;
  el('saves-question').textContent = confirm ? QUESTIONS[confirm.action] : '';
  el<HTMLButtonElement>('saves-yes').disabled = locked;
  el<HTMLButtonElement>('saves-no').disabled = locked;
}

// --- settings ------------------------------------------------------------------------------------

export function bindSettingsPanel(handlers: { change: (settings: Settings) => void; sound: (sound: SoundSettings) => void; close: () => void }): void {
  const sensitivity = el<HTMLInputElement>('set-sensitivity');
  const invert = el<HTMLInputElement>('set-invert-y');
  const fov = el<HTMLInputElement>('set-fov');
  for (const [field, range] of [[sensitivity, SENSITIVITY_RANGE], [fov, FOV_RANGE]] as const) {
    field.min = String(range.min);
    field.max = String(range.max);
    field.step = String(range.step);
  }
  const changed = (): void => handlers.change(clampSettings({ sensitivity: Number(sensitivity.value), invertY: invert.checked, fov: Number(fov.value) }));
  for (const field of [sensitivity, invert, fov]) {
    field.addEventListener('input', changed);
    field.addEventListener('change', changed);
  }
  // The sound: two volumes and mute, kept apart from the settings above.
  const effects = el<HTMLInputElement>('settings-effects');
  const ambience = el<HTMLInputElement>('settings-ambience');
  const mute = el<HTMLInputElement>('settings-mute');
  for (const field of [effects, ambience]) {
    field.min = String(VOLUME_RANGE.min);
    field.max = String(VOLUME_RANGE.max);
    field.step = String(VOLUME_RANGE.step);
  }
  const heard = (): void => handlers.sound({ effects: Number(effects.value), ambience: Number(ambience.value), muted: mute.checked });
  for (const field of [effects, ambience]) field.addEventListener('input', heard);
  mute.addEventListener('change', heard);
  el('settings-close').addEventListener('click', () => handlers.close());
  el('settings-keys').replaceChildren(...KEY_LIST.map((entry) =>
    node('div', 'settings-key', '', [node('kbd', '', entry.keys), node('span', '', entry.action)])));
}

export function showSettingsPanel(on: boolean): void {
  el('settings-panel').hidden = !on;
}

/** The sound controls at the sound settings in use. */
export function renderSound(sound: SoundSettings): void {
  const effects = el<HTMLInputElement>('settings-effects');
  const ambience = el<HTMLInputElement>('settings-ambience');
  if (Number(effects.value) !== sound.effects) effects.value = String(sound.effects);
  if (Number(ambience.value) !== sound.ambience) ambience.value = String(sound.ambience);
  el<HTMLInputElement>('settings-mute').checked = sound.muted;
  el('settings-effects-value').textContent = `${Math.round(sound.effects * 100)}%`;
  el('settings-ambience-value').textContent = `${Math.round(sound.ambience * 100)}%`;
}

/** The controls at the settings in use. */
export function renderSettings(settings: Settings): void {
  const sensitivity = el<HTMLInputElement>('set-sensitivity');
  const fov = el<HTMLInputElement>('set-fov');
  if (Number(sensitivity.value) !== settings.sensitivity) sensitivity.value = String(settings.sensitivity);
  if (Number(fov.value) !== settings.fov) fov.value = String(settings.fov);
  el<HTMLInputElement>('set-invert-y').checked = settings.invertY;
  el('set-sensitivity-value').textContent = `× ${settings.sensitivity.toFixed(1)}`;
  el('set-fov-value').textContent = `${Math.round(settings.fov)}°`;
}
