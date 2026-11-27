// The HTML panel of a fight: both plates, the action buttons, the log, the banner, the texts that
// float, the flash of an effect on the player, and the result. It shows the view it is given.

import { flashPlace, type FxLook } from './fx';
import type { FloatStyle, Side } from './timeline';
import type { BattleAction, BattleEffect, BattleView } from './view';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** An element with a class, a text and children. Text only ever goes in as text. */
function h(tag: string, cls = '', text = '', children: (HTMLElement | null)[] = []): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  for (const child of children) if (child) node.append(child);
  return node;
}

interface Bar { fill: HTMLElement; text: HTMLElement; max: number }
const bars: Partial<Record<Side, Bar>> = {};

function bar(kind: 'hp' | 'pp', value: number, max: number): { node: HTMLElement; bar: Bar } {
  const fill = h('div', 'bar-fill');
  const text = h('span', 'bar-text');
  const made = { fill, text, max };
  const node = h('div', `bar bar-${kind}`, '', [fill, text]);
  paint(made, value, kind);
  return { node, bar: made };
}

function paint(target: Bar, value: number, kind: 'hp' | 'pp' = 'hp'): void {
  const share = target.max > 0 ? Math.max(0, Math.min(1, value / target.max)) : 0;
  target.fill.style.width = `${share * 100}%`;
  target.text.textContent = `${Math.max(0, value)}/${target.max}`;
  if (kind === 'hp') {
    target.fill.classList.toggle('hp-mid', share <= 0.5 && share > 0.25);
    target.fill.classList.toggle('hp-low', share <= 0.25);
  }
}

function badges(effects: BattleEffect[]): HTMLElement | null {
  if (!effects.length) return null;
  return h('div', 'effects', '', effects.map((effect) => {
    const badge = h('span', `effect-badge effect-${effect.kind}`, effect.duration > 0 ? `${effect.label} (${effect.duration})` : effect.label);
    badge.title = effect.source;
    return badge;
  }));
}

export function showBattlePanel(on: boolean): void {
  el('battle-panel').hidden = !on;
  el('hud').classList.toggle('in-battle', on);
  if (!on) {
    el('battle-result').hidden = true;
    el('battle-floats').replaceChildren();
    showBanner(null);
  }
}

/**
 * The plates, the buttons and the log for a view. `locked` disables every button. `hp` is what the
 * HP bars show instead of the view's values: where they stood before the turn that is about to be played.
 */
export function renderBattle(view: BattleView, locked: boolean, hp: { player: number; monster: number } | null = null): void {
  const { monster, player } = view;
  const monsterHp = bar('hp', hp ? hp.monster : monster.hp, monster.max_hp);
  bars.monster = monsterHp.bar;
  el('battle-monster').replaceChildren(
    h('div', 'plate-head', '', [
      h('span', 'plate-name', monster.name),
      monster.is_boss ? h('span', 'tag tag-boss', 'Boss') : null,
      monster.enraged ? h('span', 'tag tag-enraged', 'Enraged') : null,
      h('span', 'plate-level', `Level ${monster.level}`),
    ]),
    monsterHp.node,
    ...[badges(monster.effects)].filter((node): node is HTMLElement => node !== null),
  );

  const playerHp = bar('hp', hp ? hp.player : player.hp, player.max_hp);
  bars.player = playerHp.bar;
  el('battle-player').replaceChildren(
    h('div', 'plate-head', '', [h('span', 'plate-name', player.name), h('span', 'plate-level', `Level ${player.level} · AC ${player.ac}`)]),
    playerHp.node,
    bar('pp', player.pp, player.max_pp).node,
    ...[badges(player.effects)].filter((node): node is HTMLElement => node !== null),
  );

  const open = view.phase === 'fight' && view.player_turn && !locked;
  const button = (cls: string, action: BattleAction, hotkey: string, enabled: boolean, children: (HTMLElement | null)[]): HTMLElement => {
    const node = h('button', cls, '', [...children, hotkey ? h('kbd', '', hotkey.toUpperCase()) : null]) as HTMLButtonElement;
    node.type = 'button';
    node.dataset.hotkey = hotkey;
    node.dataset.action = JSON.stringify(action);
    node.disabled = !enabled;
    return node;
  };
  el('battle-actions').replaceChildren(
    h('div', 'action-row', '', [
      button('btn-battle btn-attack', { type: 'attack' }, 'a', open, [h('span', '', 'Attack')]),
      button('btn-battle btn-defend', { type: 'defend' }, 'd', open, [h('span', '', 'Defend')]),
      view.can_flee ? button('btn-battle btn-flee', { type: 'flee' }, 'f', open, [h('span', '', 'Flee')]) : null,
      ...view.items.map((item) => {
        const node = button('btn-battle btn-item', { type: 'item', item_index: item.index }, item.hotkey, open, [
          h('span', '', item.name), h('span', 'count', `x${item.count}`),
        ]);
        node.title = item.description;
        return node;
      }),
    ]),
    h('div', 'ability-row', '', view.abilities.map((ability) =>
      button('ability-card', { type: 'ability', ability_id: ability.id }, ability.hotkey, open && ability.usable, [
        h('span', 'ability-name', ability.name),
        h('span', 'ability-cost', ability.cost > 0 ? `${ability.cost} PP` : 'Free'),
        h('span', 'ability-text', ability.description),
        ...ability.summary.map((line) => h('span', 'ability-stat', line)),
      ]))),
  );

  const log = el('battle-log');
  log.replaceChildren(...view.log.map((line) => h('div', line.cls ? `log-${line.cls}` : '', line.text)));
  log.scrollTop = log.scrollHeight;
}

/** One side's HP bar at a value: a step of the playback. */
export function setHp(side: Side, value: number): void {
  const target = bars[side];
  if (target) paint(target, value);
}

export function showBanner(text: string | null): void {
  const banner = el('battle-banner');
  banner.textContent = text ?? '';
  banner.hidden = !text;
}

/** A number or word rising from a side: above the monster (at `at`, in pixels) or above the player's plate. */
export function floatText(side: Side, text: string, style: FloatStyle, at: { x: number; y: number } | null): void {
  const layer = el('battle-floats');
  const node = h('div', `float-number float-${style}`, text);
  let x = window.innerWidth / 2;
  let y = window.innerHeight * 0.3;
  if (side === 'player') {
    const plate = el('battle-player').getBoundingClientRect();
    x = plate.left + plate.width / 2;
    y = plate.top - 8;
  } else if (at) {
    x = at.x;
    y = at.y;
  }
  // Several at once (the word and the number of a critical hit) stack upwards.
  const taken = layer.querySelectorAll(`[data-side="${side}"]`).length;
  node.dataset.side = side;
  node.style.left = `${x}px`;
  node.style.top = `${y - taken * 34}px`;
  node.addEventListener('animationend', () => node.remove());
  layer.append(node);
}

/** An effect on the player: its colour at the edge of the view, where its shape puts it. */
export function flash(look: FxLook): void {
  const node = h('div', `flash flash-${flashPlace(look.pattern)}`);
  node.style.setProperty('--fx', look.color);
  node.addEventListener('animationend', () => node.remove());
  el('battle-flash').append(node);
}

/** The result of the fight: the rewards of a victory, or the healer's offer after a defeat. */
export function showResult(view: BattleView): void {
  const panel = el('battle-result');
  const row = (label: string, value: string, cls = ''): HTMLElement => h('div', `reward-row ${cls}`, '', [h('span', 'label', label), h('span', 'value', value)]);
  if (view.phase === 'victory') {
    const rewards = view.rewards;
    const boss = rewards?.boss ?? null;
    const proceed = h('button', 'btn', 'Continue') as HTMLButtonElement;
    proceed.type = 'button';
    proceed.id = 'battle-continue';
    panel.className = 'panel result-victory';
    panel.replaceChildren(
      h('h2', '', 'Victory'),
      h('p', 'result-line', `You have defeated ${view.monster.name}!`),
      ...(boss ? [h('div', 'boss-block', '', [
        boss.defeat_text ? h('p', 'boss-text', boss.defeat_text) : null,
        boss.shard ? h('p', 'boss-shard', `${boss.shard} recovered · Crown shards: ${boss.shards_collected} / ${boss.shards_total}`) : null,
        boss.act_unlocked ? h('p', 'boss-act', `New lands open: Act ${boss.act_unlocked.number}: ${boss.act_unlocked.title}`) : null,
      ])] : []),
      ...(rewards ? [h('div', 'rewards', '', [
        row('Experience:', `+${rewards.xp} XP`, 'reward-xp'),
        row('Gold:', `+${rewards.gold} gold`, 'reward-gold'),
        rewards.loot ? row('Loot:', rewards.loot, 'reward-loot') : null,
        ...rewards.quest_updates.map((update) => row('Quest:', update, 'reward-quest')),
      ])] : []),
      ...(rewards?.leveled_up ? [h('div', 'level-up', '', [
        h('h3', '', 'Level Up!'),
        h('p', '', `You are now level ${rewards.new_level}!`),
        rewards.hp_increase ? h('p', '', `+${rewards.hp_increase} Max HP`) : null,
        rewards.new_max_pp ? h('p', '', `PP: ${rewards.new_max_pp} max`) : null,
        rewards.new_abilities.length ? h('p', '', `New abilities: ${rewards.new_abilities.join(', ')}`) : null,
        rewards.asi_points ? h('p', '', `Ability points to spend: ${rewards.asi_points}`) : null,
      ])] : []),
      proceed,
    );
  } else {
    const fallen = view.defeat;
    const cost = fallen?.gold_cost ?? 0;
    const rise = h('button', 'btn', cost > 0 ? `Rise Again (-${cost} gold)` : 'Rise Again') as HTMLButtonElement;
    rise.type = 'button';
    rise.id = 'battle-revive';
    const over = h('a', 'btn btn-quiet', 'Start Over') as HTMLAnchorElement;
    over.href = '/character/new';
    panel.className = 'panel result-defeat';
    panel.replaceChildren(
      h('h2', '', 'Defeat'),
      h('p', 'result-line', `You have been slain by ${fallen?.monster_name ?? view.monster.name}...`),
      h('p', '', "A wandering healer found you at death's door and carried you to safety... for a price."),
      cost > 0
        ? h('p', 'healer', `The healer demands ${cost} gold for their services. You will be returned to safety with full health.`)
        : h('p', 'healer', 'The healer takes pity on your empty purse and tends your wounds for free.'),
      h('div', 'result-buttons', '', [rise, over]),
    );
  }
  panel.hidden = false;
}

export function hideResult(): void {
  el('battle-result').hidden = true;
}

/** What the buttons do: the same handlers the keys run. */
export function bindBattlePanel(handlers: { act: (action: BattleAction) => void; proceed: () => void; revive: () => void }): void {
  el('battle-actions').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) handlers.act(JSON.parse(button.dataset.action as string) as BattleAction);
  });
  el('battle-result').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button?.id === 'battle-continue') handlers.proceed();
    else if (button?.id === 'battle-revive') handlers.revive();
  });
}
