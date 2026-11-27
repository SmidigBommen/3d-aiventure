// The HTML panels of an exploration event and of the moment before a boss fight. They show what
// they are given; the lines come from event.ts and every number in them from the server.

import type { BossContent } from './contents';
import { choiceLine, outcomeChips, rollLine, verdict, type EventResult, type EventView } from './event';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function node(tag: string, cls: string, text: string): HTMLElement {
  const made = document.createElement(tag);
  if (cls) made.className = cls;
  made.textContent = text;
  return made;
}

export function showEventPanel(on: boolean): void {
  el('event-panel').hidden = !on;
}

/** The event with one button per choice. `locked`: a choice is on its way to the server. */
export function renderEvent(view: EventView, locked: boolean): void {
  el('event-title').textContent = view.title;
  el('event-text').textContent = view.text;
  el('event-choices').replaceChildren(...view.choices.map((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-choice';
    button.dataset.choice = String(choice.index);
    button.disabled = locked;
    button.append(
      node('kbd', '', choice.hotkey),
      node('span', 'event-choice-label', choice.label),
      node('span', choice.proficient ? 'event-choice-check proficient' : 'event-choice-check', choiceLine(choice)),
    );
    return button;
  }));
  el('event-choices').hidden = false;
  el('event-result').hidden = true;
  el('event-panel').className = 'panel';
}

/** The outcome of the choice: the roll when there was one, what happened, and what was gained or lost. */
export function renderEventResult(result: EventResult, locked: boolean): void {
  const outcome = verdict(result);
  el('event-title').textContent = result.title;
  el('event-text').textContent = result.label;
  el('event-choices').hidden = true;
  const roll = el('event-roll');
  roll.textContent = result.check ? `${result.check.skill}: ${rollLine(result.check)}` : '';
  roll.hidden = result.check === null;
  const word = el('event-verdict');
  word.textContent = outcome ?? '';
  word.hidden = outcome === null;
  el('event-outcome').textContent = result.text;
  el('event-chips').replaceChildren(...outcomeChips(result).map((chip) => {
    const made = node('span', `event-chip chip-${chip.kind}`, chip.text);
    made.dataset.kind = chip.kind;
    return made;
  }));
  el<HTMLButtonElement>('event-continue').disabled = locked;
  el('event-result').hidden = false;
  el('event-panel').className = `panel ${result.success ? 'event-success' : 'event-failure'}`;
}

/** What the buttons do: the same handlers the keys run. */
export function bindEventPanel(handlers: { choose: (index: number) => void; proceed: () => void }): void {
  el('event-choices').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-choice]');
    if (button && !button.disabled) handlers.choose(Number(button.dataset.choice));
  });
  el('event-continue').addEventListener('click', () => handlers.proceed());
}

/** The boss before the fight: its name, title and the authored introduction. `null` closes the panel. */
export function showBossIntro(boss: BossContent | null): void {
  el('boss-intro').hidden = boss === null;
  if (!boss) return;
  el('boss-intro-name').textContent = boss.name;
  el('boss-intro-title').textContent = boss.title;
  el('boss-intro-title').hidden = !boss.title;
  el('boss-intro-text').textContent = boss.intro ?? '';
  el('boss-intro-text').hidden = !boss.intro;
}

export function bindBossIntro(handlers: { fight: () => void; back: () => void }): void {
  el('boss-intro-fight').addEventListener('click', () => handlers.fight());
  el('boss-intro-back').addEventListener('click', () => handlers.back());
}
