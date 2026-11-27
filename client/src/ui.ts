// The HTML panels over the 3D view: title screen, heads-up display and menu. Shows what it is given.

import type { WorldState } from './api';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const show = (node: HTMLElement, visible: boolean): void => {
  node.hidden = !visible;
};

const PENDING_TEXT: Record<string, [string, string]> = {
  battle: ['A battle is under way.', 'Return to the battle'],
  event: ['Something needs your attention.', 'Return to the event'],
  defeat: ['You have fallen.', 'Continue'],
};
const DANGER_TEXT: Record<string, string> = { safe: 'Safe', low: 'Low', med: 'Medium', high: 'High' };
const DESCRIPTION_SECONDS = 6;

/** The title panel for a state, or for no answer from the server (`null`). */
export function showTitle(state: WorldState | null): void {
  const pending = state?.pending ?? null;
  const message = el('title-message');
  const link = el<HTMLAnchorElement>('pending-link');
  show(el('title-screen'), true);
  show(el('hud'), false);
  show(el('menu'), false);
  show(el('btn-new-game'), state !== null && !state.has_character);
  show(el('btn-continue'), state !== null && state.has_character && !pending);
  show(el('classic-link'), state === null);
  show(link, pending !== null);
  show(message, state === null || pending !== null);
  if (state === null) {
    message.textContent = 'The server did not answer.';
  } else if (pending) {
    const [line, label] = PENDING_TEXT[pending.kind] ?? PENDING_TEXT.event;
    message.textContent = line;
    link.textContent = label;
    link.href = pending.url;
  }
}

let descriptionTimer: number | undefined;

/** The heads-up display for the area the player is in. `entered` shows the description again. */
export function showHud(state: WorldState, entered: boolean): void {
  show(el('title-screen'), false);
  show(el('hud'), true);
  const { location, area, character } = state;
  el('hud-location').textContent = location?.name ?? '';
  el('hud-area').textContent = area?.name ?? '';
  const danger = el('hud-danger');
  danger.textContent = DANGER_TEXT[area?.danger ?? 'safe'] ?? '';
  danger.className = `danger danger-${area?.danger ?? 'safe'}`;
  if (character) {
    el('hud-character').textContent =
      `${character.name} · Level ${character.level} · HP ${character.current_hit_points}/${character.max_hit_points} · PP ${character.power_points}/${character.max_power_points}`;
  }
  if (entered) {
    const description = el('hud-description');
    description.textContent = area?.description ?? '';
    description.classList.remove('faded');
    window.clearTimeout(descriptionTimer);
    descriptionTimer = window.setTimeout(() => description.classList.add('faded'), DESCRIPTION_SECONDS * 1000);
  }
}

/** The title panel away, while the first area loads. */
export function hideTitle(): void {
  show(el('title-screen'), false);
}

/** The loading indicator, shown while an area's models are on their way. */
export function showLoading(on: boolean): void {
  show(el('loading'), on);
}

export function showMenu(open: boolean): void {
  show(el('menu'), open);
}

/** A black veil over the view while the next area is fetched and built. */
export function veil(on: boolean): void {
  el('veil').classList.toggle('on', on);
}
