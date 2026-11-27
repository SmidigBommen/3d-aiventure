// Elara's shop and the quests as the server answers them, and the lines the panel and the heads-up
// display show for them. Every price, roll and reward comes from the views. Pure: no rendering, no browser.

export interface Ware {
  index: number; name: string; description: string; healing: number; quantity: number;
  original_price: number; effective_price: number; haggled: boolean; discount: number;
}
export interface SellEntry { index: number; name: string; description: string; sell_price: number }
export interface QuestRewards { gold: number; xp: number }
export interface AvailableQuest {
  id: string; name: string; description: string; type: 'kill' | 'gather';
  target_monster: string; target_count: number; rewards: QuestRewards; dialog_offer: string;
}
export interface ActiveQuest {
  id: string; name: string; description: string; type: 'kill' | 'gather';
  target_monster: string; target_count: number; rewards: QuestRewards; progress: number; progress_pct: number; status: 'active' | 'ready';
}
export interface ShopView {
  keeper: { name: string; title: string; portrait: string };
  dialog: { context: string; line: string };
  gold: number;
  wares: Ware[];
  sell: SellEntry[];
  quests: { available: AvailableQuest[]; active: ActiveQuest[]; slots_full: boolean };
}
export interface HaggleResult {
  roll: number; modifier: number; total: number; discount: number; tier: string;
  item_name: string; original_price: number; new_price: number;
}
/** An active quest as the world state carries it, for the tracker. */
export interface TrackedQuest {
  id: string; name: string; type: string; target_monster: string; target_count: number;
  progress: number; status: 'active' | 'ready';
}

export type ShopTab = 'wares' | 'sell' | 'quests';
export const SHOP_TABS: readonly ShopTab[] = ['wares', 'sell', 'quests'];

/** The tab a key opens: 1, 2, 3 in the order of the tabs. */
export function tabForKey(code: string): ShopTab | null {
  const match = /^(?:Digit|Numpad)([1-3])$/.exec(code);
  return match ? SHOP_TABS[Number(match[1]) - 1] : null;
}

/** The price of a ware, with what a haggle did to it. */
export function wareLine(ware: Ware): string {
  if (!ware.haggled) return `${ware.effective_price} gold`;
  if (ware.discount === 0) return `${ware.effective_price} gold (no discount)`;
  const sign = ware.discount > 0 ? '-' : '+';
  return `${ware.effective_price} gold (was ${ware.original_price}, ${sign}${Math.abs(ware.discount)}%)`;
}

/** Which of a ware's buttons can be pressed with `gold` in the purse. */
export function wareActions(ware: Ware, gold: number): { buy: boolean; haggle: boolean } {
  return { buy: ware.quantity > 0 && gold >= ware.effective_price, haggle: !ware.haggled };
}

/** What a haggle is shown as: the roll, what came of it, and whether it flashes gold or red. */
export function haggleFeedback(h: HaggleResult): { outcome: 'success' | 'failure'; roll: string; verdict: string } {
  const roll = `Persuasion: d20 ${h.roll} ${h.modifier < 0 ? '-' : '+'} ${Math.abs(h.modifier)} = ${h.total}`;
  let verdict = `No discount on ${h.item_name}`;
  if (h.discount > 0) verdict = `${h.discount}% off: ${h.item_name} now costs ${h.new_price} gold`;
  else if (h.discount < 0) verdict = `Price raised ${-h.discount}%: ${h.item_name} now costs ${h.new_price} gold`;
  return { outcome: h.discount > 0 ? 'success' : 'failure', roll, verdict };
}

/** The lines of the quest tracker, one per active quest, in order. */
export function trackerLines(quests: TrackedQuest[]): { id: string; text: string; ready: boolean }[] {
  return quests.map((quest) => {
    const ready = quest.status === 'ready';
    return { id: quest.id, text: ready ? `${quest.name}: return to Elara` : `${quest.name} ${quest.progress}/${quest.target_count}`, ready };
  });
}

export function readyCount(quests: TrackedQuest[]): number {
  return quests.filter((quest) => quest.status === 'ready').length;
}

/** The badge of the heads-up display while a quest waits to be turned in. */
export function questBadge(quests: TrackedQuest[]): string | null {
  const ready = readyCount(quests);
  if (ready === 0) return null;
  return ready === 1 ? 'Quest ready to turn in' : `${ready} quests ready to turn in`;
}

/** The notice after a fight that moved a quest on. */
export function killAnnouncement(updates: string[]): string | null {
  return updates.length === 0 ? null : `Quest: ${updates.join(' · ')}`;
}
