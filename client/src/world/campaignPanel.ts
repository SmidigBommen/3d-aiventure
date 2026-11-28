// The HTML of travel, the journal, the compass, the arrival title and the ending. They show the views the
// server answered; the lines come from campaign.ts and the marks from compass.ts.

import {
  actBadge, endingSteps, legendLines, shardSockets, travelChoices,
  type EndingView, type JournalView, type TravelView,
} from './campaign';
import type { CompassMark } from './compass';
import type { PanelMessage } from './sheetPanel';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function node(tag: string, cls: string, text = '', children: Node[] = []): HTMLElement {
  const made = document.createElement(tag);
  if (cls) made.className = cls;
  if (text) made.textContent = text;
  made.append(...children);
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

// --- the map -------------------------------------------------------------------------------------

export function showTravelPanel(open: boolean): void {
  el('travel-panel').hidden = !open;
}

/** The map: one block per act, every location with its hotkey. A location that cannot be chosen is greyed, not disabled: choosing it says why. */
export function renderTravel(view: TravelView, message: PanelMessage | null, locked: boolean): void {
  const panel = el('travel-panel');
  showMessage(panel, message);
  const choices = travelChoices(view);
  let at = 0;
  el('travel-acts').replaceChildren(...view.acts.map((act) => {
    const block = node('section', `travel-act${act.locked ? ' locked' : ''}`, '', [node('h3', '', `Act ${act.number}: ${act.title}`)]);
    if (act.locked_reason) block.append(node('p', 'travel-reason', act.locked_reason));
    for (const location of act.locations) {
      const choice = choices[at++];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `travel-location${choice.enabled ? '' : ' unavailable'}${location.current ? ' current' : ''}`;
      card.dataset.location = location.name;
      card.dataset.hotkey = choice.hotkey;
      card.setAttribute('aria-disabled', String(!choice.enabled));
      card.disabled = locked;
      const tags = [node('span', 'travel-tag', capital(location.type))];
      if (location.level_range) tags.push(node('span', 'travel-tag', `Level ${location.level_range}`));
      if (location.cleared) tags.push(node('span', 'travel-tag cleared', 'Guardian defeated'));
      else if (location.has_boss) tags.push(node('span', 'travel-tag boss', 'Boss'));
      card.append(
        node('span', 'travel-key', choice.hotkey),
        node('span', 'travel-name', location.name),
        node('span', 'travel-tags', '', tags),
      );
      if (location.current) card.append(node('span', 'travel-here', 'You are here.'));
      block.append(card);
    }
    return block;
  }));
}

export function bindTravelPanel(handlers: { choose: (location: string) => void; close: () => void }): void {
  el('travel-acts').addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-location]');
    if (card && !card.disabled) handlers.choose(card.dataset.location ?? '');
  });
  el('travel-close').addEventListener('click', () => handlers.close());
}

// --- the journal ---------------------------------------------------------------------------------

export function showJournalPanel(open: boolean): void {
  el('journal-panel').hidden = !open;
}

export function renderJournal(view: JournalView): void {
  el('journal-campaign').textContent = view.campaign.title;
  el('journal-crown').replaceChildren(...shardSockets(view.shards).map((socket) => {
    const gem = node('span', 'shard-gem');
    if (socket.colour) gem.style.background = socket.colour;
    const made = node('div', `shard-socket${socket.found ? ' found' : ''}`, '', [gem, node('span', 'shard-label', socket.label)]);
    made.dataset.shard = socket.name;
    return made;
  }));
  el('journal-complete').hidden = !view.campaign_complete;

  el('journal-acts').replaceChildren(...view.acts.map((act) => {
    const badge = actBadge(act);
    const block = node('section', `journal-act${act.locked ? ' locked' : ''}${act.current ? ' current' : ''}`, '', [
      node('div', 'journal-act-head', '', [
        node('span', 'journal-act-number', `Act ${act.number}`),
        node('h3', '', act.locked ? '???' : act.title),
        node('span', `journal-badge badge-${badge.toLowerCase().replace(' ', '-')}`, badge),
      ]),
    ]);
    if (act.locked) {
      block.append(node('p', 'journal-unknown', 'The road ahead is not yet known.'));
      return block;
    }
    block.append(node('p', 'journal-description', act.description), node('p', 'journal-quest', `Main quest: ${act.main_quest}`));
    block.append(node('ul', 'journal-bosses', '', act.bosses.map((boss) => node('li', boss.defeated ? 'defeated' : '', '', [
      node('span', 'journal-mark', boss.defeated ? '✓' : '☠'),
      node('span', 'journal-boss-name', boss.name),
      node('span', 'journal-boss-where', `${boss.where} · Lvl ${boss.level}`),
    ]))));
    return block;
  }));

  const quests = el('journal-quests');
  quests.hidden = view.active_quests.length === 0;
  quests.replaceChildren(node('h3', '', 'Side Quests'), node('ul', 'journal-bosses', '', view.active_quests.map((quest) => node('li', '', '', [
    node('span', 'journal-boss-name', quest.name),
    node('span', 'journal-boss-where', quest.ready ? 'Ready to turn in' : `${quest.progress} / ${quest.target}`),
  ]))));

  const deeds: [string, number][] = [
    ['Monsters Slain', view.stats.kills], ['Bosses Felled', view.stats.bosses], ['Events', view.stats.events], ['Quests Done', view.stats.quests],
  ];
  el('journal-deeds').replaceChildren(...deeds.map(([label, value]) => node('div', 'journal-deed', '', [node('span', 'label', label), node('span', 'value', String(value))])));
}

export function bindJournalPanel(handlers: { ending: () => void; close: () => void }): void {
  el('journal-ending').addEventListener('click', () => handlers.ending());
  el('journal-close').addEventListener('click', () => handlers.close());
}

// --- arriving ------------------------------------------------------------------------------------

/** The name of the place just arrived in, large, and its act under it. `null` takes it away. */
export function showArrival(shown: { title: string; subtitle: string } | null): void {
  const banner = el('arrival');
  banner.hidden = shown === null;
  if (!shown) return;
  el('arrival-title').textContent = shown.title;
  el('arrival-subtitle').textContent = shown.subtitle;
  // The fade-in plays again for every arrival.
  banner.classList.remove('arriving');
  void banner.offsetWidth;
  banner.classList.add('arriving');
}

// --- the compass ---------------------------------------------------------------------------------

const RING = 46; // px, radius of the ring the marks sit on
const LABELS = 62; // px, radius the labels start at
const LABEL_LINE = 17; // px, height of a label
const LABEL_WIDTH = 120; // px, how near two labels are side by side before one gives way
let drawnMarks = '';

/** The compass: every mark on the ring where it lies from the way the player looks (ahead is up), and north. `null` hides it. */
export function drawCompass(marks: CompassMark[] | null, yaw = 0): void {
  const compass = el('hud-compass');
  if (compass.hidden !== (marks === null)) compass.hidden = marks === null;
  if (!marks) return;
  const key = marks.map((mark) => `${mark.kind}:${mark.label}`).join('|');
  if (key !== drawnMarks) {
    drawnMarks = key;
    compass.replaceChildren(node('div', 'compass-ring'), node('div', 'compass-ahead'), node('div', 'compass-north', 'N'), ...marks.flatMap((mark) => {
      const dot = node('div', `compass-dot compass-${mark.kind}`);
      const label = node('div', `compass-label compass-${mark.kind}`, mark.label);
      label.dataset.kind = mark.kind;
      return [dot, label];
    }));
  }
  const at = (bearing: number, radius: number): { x: number; y: number } => ({ x: -Math.sin(bearing) * radius, y: -Math.cos(bearing) * radius });
  const north = at(-yaw, RING - 13);
  (compass.children[2] as HTMLElement).style.transform = `translate(calc(${north.x.toFixed(1)}px - 50%), calc(${north.y.toFixed(1)}px - 50%))`;
  const placed: { x: number; y: number }[] = [];
  marks.forEach((mark, index) => {
    const dot = compass.children[3 + index * 2] as HTMLElement;
    const label = compass.children[4 + index * 2] as HTMLElement;
    const p = at(mark.bearing, RING);
    const q = at(mark.bearing, LABELS);
    // Two marks in nearly the same direction: the later label moves a line further out, so both can be read.
    for (let tries = 0; tries < 4 && placed.some((other) => Math.abs(other.y - q.y) < LABEL_LINE && Math.abs(other.x - q.x) < LABEL_WIDTH); tries++) {
      q.y += q.y <= 0 ? -LABEL_LINE : LABEL_LINE;
    }
    placed.push(q);
    dot.style.transform = `translate(calc(${p.x.toFixed(1)}px - 50%), calc(${p.y.toFixed(1)}px - 50%))`;
    // A label on the left ends at its point, one on the right starts there, so that none covers the ring.
    const anchor = 50 - 50 * (q.x / LABELS);
    label.style.transform = `translate(calc(${q.x.toFixed(1)}px - ${anchor.toFixed(0)}%), calc(${q.y.toFixed(1)}px - 50%))`;
  });
}

// --- the ending ----------------------------------------------------------------------------------

/** One step of the epilogue: the title, a paragraph, or the legend. `null` closes the panel. */
export function showEnding(view: EndingView | null, step = 0): void {
  const panel = el('ending-panel');
  panel.hidden = view === null;
  if (!view) return;
  const steps = endingSteps(view);
  const shown = steps[Math.max(0, Math.min(step, steps.length - 1))];
  const last = step >= steps.length - 1;
  panel.dataset.kind = shown.kind;
  el('ending-kicker').hidden = shown.kind !== 'title';
  el('ending-heading').hidden = shown.kind === 'text';
  el('ending-heading').textContent = shown.kind === 'text' ? '' : shown.text;
  el('ending-campaign').hidden = shown.kind !== 'title';
  el('ending-campaign').textContent = view.campaign_title;
  el('ending-text').hidden = shown.kind !== 'text';
  el('ending-text').textContent = shown.kind === 'text' ? shown.text : '';
  const legend = el('ending-legend');
  legend.hidden = shown.kind !== 'legend';
  legend.replaceChildren(...(shown.kind === 'legend'
    ? legendLines(view).map(([label, value]) => node('div', 'reward-row', '', [node('span', 'label', label), node('span', 'value', value)]))
    : []));
  el('ending-continue').textContent = last ? 'Return to the title screen' : 'Continue';
}

export function bindEndingPanel(handlers: { proceed: () => void }): void {
  el('ending-continue').addEventListener('click', () => handlers.proceed());
}
