// The HTML panel of Elara's shop and the quest lines of the heads-up display. They show the views the
// server answered; the lines come from shop.ts and every number in them from the views.

import type { ShopActionKind } from '../api';
import {
  SHOP_TABS, questBadge, trackerLines, wareActions, wareLine,
  type ShopTab, type ShopView, type TrackedQuest, type haggleFeedback,
} from './shop';
import type { PanelMessage } from './sheetPanel';

export type HaggleShown = ReturnType<typeof haggleFeedback>;

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function node(tag: string, cls: string, text = ''): HTMLElement {
  const made = document.createElement(tag);
  if (cls) made.className = cls;
  if (text) made.textContent = text;
  return made;
}

/** A button of the panel: what it does and to what, read back by the click handler. */
function button(action: ShopActionKind, text: string, disabled: boolean, target: { index?: number; quest?: string }): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = 'btn btn-small shop-action';
  made.textContent = text;
  made.disabled = disabled;
  made.dataset.action = action;
  if (target.index !== undefined) made.dataset.index = String(target.index);
  if (target.quest !== undefined) made.dataset.quest = target.quest;
  return made;
}

export function showShopPanel(open: boolean): void {
  el('shop-panel').hidden = !open;
}

const rewardsLine = (rewards: { gold: number; xp: number }): string => `Reward: ${rewards.gold} gold, ${rewards.xp} XP`;

/** The shop panel on `tab`. `locked`: an action is on its way to the server. */
export function renderShop(view: ShopView, tab: ShopTab, message: PanelMessage | null, locked: boolean): void {
  const portrait = el<HTMLImageElement>('shop-portrait');
  if (portrait.getAttribute('src') !== view.keeper.portrait) portrait.src = view.keeper.portrait;
  portrait.alt = view.keeper.name;
  el('shop-name').textContent = view.keeper.name;
  el('shop-title').textContent = view.keeper.title;
  el('shop-dialog').textContent = `“${view.dialog.line}”`;
  el('shop-gold').textContent = `${view.gold} gold`;

  const line = el('shop-panel').querySelector<HTMLElement>('.panel-message');
  if (line) {
    line.hidden = message === null || message.text === '';
    line.textContent = message?.text ?? '';
    line.classList.toggle('refused', message?.refused === true);
  }
  for (const name of SHOP_TABS) {
    el(`shop-tab-${name}`).classList.toggle('active', name === tab);
    el(`shop-${name}`).hidden = name !== tab;
  }

  el('shop-wares').replaceChildren(...view.wares.map((ware) => {
    const can = wareActions(ware, view.gold);
    const row = node('div', ware.quantity > 0 ? 'shop-row' : 'shop-row out-of-stock');
    const text = node('div', 'shop-text');
    const price = node('div', ware.haggled && ware.discount > 0 ? 'shop-price cheaper' : ware.haggled && ware.discount < 0 ? 'shop-price dearer' : 'shop-price', wareLine(ware));
    text.append(node('div', 'shop-item-name', ware.name), node('div', 'shop-line', ware.description), node('div', 'shop-line', `${ware.quantity} in stock`), price);
    row.append(text, button('haggle', 'Haggle', locked || !can.haggle, { index: ware.index }), button('buy', 'Buy', locked || !can.buy, { index: ware.index }));
    return row;
  }));

  const selling = view.sell.map((entry) => {
    const row = node('div', 'shop-row');
    const text = node('div', 'shop-text');
    text.append(node('div', 'shop-item-name', entry.name));
    if (entry.description) text.append(node('div', 'shop-line', entry.description));
    text.append(node('div', 'shop-price', `${entry.sell_price} gold`));
    row.append(text, button('sell', 'Sell', locked, { index: entry.index }));
    return row;
  });
  el('shop-sell').replaceChildren(...(selling.length > 0 ? selling : [node('p', 'inv-empty', 'You have nothing to sell.')]));

  const { active, available, slots_full: full } = view.quests;
  const board: HTMLElement[] = [node('h3', '', 'Active quests')];
  if (active.length === 0) board.push(node('p', 'inv-empty', 'No active quests.'));
  for (const quest of active) {
    const card = node('div', quest.status === 'ready' ? 'quest-card ready' : 'quest-card');
    card.dataset.quest = quest.id;
    const bar = node('div', 'bar quest-bar');
    const fill = node('div', 'bar-fill');
    fill.style.width = `${quest.progress_pct}%`;
    bar.append(fill, node('div', 'bar-text', `${quest.progress}/${quest.target_count}`));
    const buttons = node('div', 'quest-buttons');
    if (quest.status === 'ready') buttons.append(button('turn-in', 'Turn in', locked, { quest: quest.id }));
    buttons.append(button('abandon', 'Abandon', locked, { quest: quest.id }));
    card.append(node('div', 'shop-item-name', quest.name), node('div', 'shop-line', quest.description), bar, node('div', 'shop-line quest-rewards', rewardsLine(quest.rewards)), buttons);
    board.push(card);
  }
  board.push(node('h3', '', 'Available quests'));
  if (available.length === 0) board.push(node('p', 'inv-empty', 'Elara has no more work for you.'));
  for (const quest of available) {
    const card = node('div', 'quest-card');
    card.dataset.quest = quest.id;
    const buttons = node('div', 'quest-buttons');
    buttons.append(button('accept', full ? 'Quest log full' : 'Accept', locked || full, { quest: quest.id }));
    card.append(
      node('div', 'shop-item-name', quest.name), node('div', 'shop-line quest-offer', `“${quest.dialog_offer}”`),
      node('div', 'shop-line', `Target: ${quest.target_count} × ${quest.target_monster}`), node('div', 'shop-line quest-rewards', rewardsLine(quest.rewards)), buttons,
    );
    board.push(card);
  }
  el('shop-quests').replaceChildren(...board);
}

/** The roll of the last haggle and what came of it; `flash` plays the gold or the red flash (0.6 s, in style.css) once. Nothing for `null`. */
export function showHaggle(shown: HaggleShown | null, flash: boolean): void {
  const box = el('shop-haggle');
  box.hidden = shown === null;
  box.classList.remove('haggle-success', 'haggle-failure');
  if (!shown) return;
  (box.querySelector('.haggle-roll') as HTMLElement).textContent = shown.roll;
  (box.querySelector('.haggle-verdict') as HTMLElement).textContent = shown.verdict;
  box.dataset.outcome = shown.outcome;
  if (!flash) return;
  void box.offsetWidth; // the animation starts again for a second haggle with the same outcome
  box.classList.add(`haggle-${shown.outcome}`);
}

/** The quest tracker and the badge of the heads-up display. */
export function showQuests(quests: TrackedQuest[]): void {
  const tracker = el('hud-quests');
  const lines = trackerLines(quests);
  tracker.hidden = lines.length === 0;
  tracker.replaceChildren(...lines.map((line) => {
    const row = node('div', line.ready ? 'quest-line ready' : 'quest-line', line.text);
    row.dataset.quest = line.id;
    return row;
  }));
  const badge = questBadge(quests);
  el('hud-quest-ready').hidden = badge === null;
  el('hud-quest-ready').textContent = badge ?? '';
}

/** What the buttons do: one handler for every action, one for the tabs, one for Close. */
export function bindShopPanel(handlers: {
  item: (action: 'buy' | 'sell' | 'haggle', index: number) => void;
  quest: (action: 'accept' | 'turn-in' | 'abandon', id: string) => void;
  tab: (tab: ShopTab) => void;
  close: () => void;
}): void {
  el('shop-panel').addEventListener('click', (event) => {
    const pressed = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!pressed || pressed.disabled) return;
    const action = pressed.dataset.action;
    if (pressed.dataset.tab) handlers.tab(pressed.dataset.tab as ShopTab);
    else if (action === 'buy' || action === 'sell' || action === 'haggle') handlers.item(action, Number(pressed.dataset.index));
    else if (action === 'accept' || action === 'turn-in' || action === 'abandon') handlers.quest(action, pressed.dataset.quest ?? '');
  });
  el('shop-close').addEventListener('click', () => handlers.close());
}
