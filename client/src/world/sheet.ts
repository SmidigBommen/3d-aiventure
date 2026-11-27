// The inventory panel and the character sheet: the shapes of the server's views and the lines the
// panels show. Every number comes from the views; nothing here is a rule.

export interface ItemCompare { cls: 'better' | 'worse' | 'same'; text: string }
export interface InventoryItem {
  name: string; description: string; type: 'weapon' | 'armor' | 'potion' | 'quest_item';
  index: number; count: number; can_equip: boolean;
  can_use?: boolean; compare?: ItemCompare; ac_if_equipped?: number;
  damage_die?: number; damage_dice_count?: number; damage_type?: string; category?: string; properties?: string[];
  base_ac?: number; healing_amount?: number; quest_id?: string;
}
export interface InventoryView {
  weapon: { name: string; damage_die: number; damage_dice_count: number; damage_type: string; category: string; properties: string[] } | null;
  armor: { name: string; base_ac: number; category: string } | null;
  armor_class: number;
  items: InventoryItem[];
}
export interface SheetAttack { weapon: string; bonus: number; damage_dice: string; damage_modifier: number; damage_type: string }
export type AbilityName = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export const ABILITY_NAMES: AbilityName[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export interface SheetSkill { name: string; ability: string; modifier: number; proficient: boolean }
export interface SheetAbility { id: string; name: string; description: string; cost: number; unlock_level: number; summary: string[] }
export interface SheetView {
  name: string; race: string; class_name: string; level: number; portrait: string | null;
  xp: number; xp_to_next_level: number; gold: number;
  current_hit_points: number; max_hit_points: number; power_points: number; max_power_points: number;
  armor_class: number; weapon: string | null; armor: string | null;
  asi_points: number; ability_score_cap: number;
  strength_score: number; strength_modifier: number;
  dexterity_score: number; dexterity_modifier: number;
  constitution_score: number; constitution_modifier: number;
  intelligence_score: number; intelligence_modifier: number;
  wisdom_score: number; wisdom_modifier: number;
  charisma_score: number; charisma_modifier: number;
  primary_ability: string; unarmored_defense: string;
  improvable: string[];
  proficiency_bonus: number;
  attack: SheetAttack;
  weapon_proficiencies: string[]; armor_training: string[];
  saving_throws: string[];
  save_modifiers: Record<string, number>;
  skills: SheetSkill[];
  abilities: SheetAbility[];
}
export type PanelKind = 'inventory' | 'sheet';
export type ItemActionKind = 'use' | 'equip-weapon' | 'equip-armor';
export interface ItemAction { action: ItemActionKind; label: string; enabled: boolean }

/** The panel a key opens: I the inventory, C the character sheet. */
export function panelForKey(code: string): PanelKind | null {
  if (code === 'KeyI') return 'inventory';
  if (code === 'KeyC') return 'sheet';
  return null;
}

/** A modifier with its sign: +3, +0, -1. */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function itemTitle(item: InventoryItem): string {
  return item.count > 1 ? `${item.name} ×${item.count}` : item.name;
}

/** The lines under an item's name, as the classic inventory page. */
export function itemLines(item: InventoryItem): string[] {
  const lines: string[] = [];
  if (item.type === 'weapon') {
    const properties = item.properties ?? [];
    lines.push(`${item.damage_dice_count}d${item.damage_die} ${item.damage_type}`);
    lines.push(properties.length > 0 ? `${item.category} · ${properties.join(', ')}` : `${item.category}`);
  } else if (item.type === 'armor') {
    lines.push(`Base AC: ${item.base_ac} · AC ${item.ac_if_equipped} when worn`);
    lines.push(`${item.category}`);
  } else {
    lines.push(item.description);
    return lines;
  }
  if (item.compare && item.can_equip) lines.push(`${item.compare.text} vs equipped`);
  return lines;
}

/** The button of an item: what it posts, what it reads, whether it can be pressed. Null for a quest item. */
export function itemAction(item: InventoryItem): ItemAction | null {
  if (item.type === 'potion') return { action: 'use', label: 'Drink', enabled: item.can_use === true };
  if (item.type === 'weapon' || item.type === 'armor') {
    const action: ItemActionKind = item.type === 'weapon' ? 'equip-weapon' : 'equip-armor';
    return item.can_equip ? { action, label: 'Equip', enabled: true } : { action, label: 'Not proficient', enabled: false };
  }
  return null;
}

export function attackLine(attack: SheetAttack): string {
  const sign = attack.damage_modifier >= 0 ? '+' : '-';
  return `${attack.weapon}: ${signed(attack.bonus)} to hit, ${attack.damage_dice} ${sign} ${Math.abs(attack.damage_modifier)} ${attack.damage_type}`;
}

/** How far the XP bar is filled, 0 to 1. */
export function xpFraction(xp: number, toNext: number): number {
  if (!(toNext > 0)) return 0;
  return Math.max(0, Math.min(1, xp / toNext));
}

/** The line of the heads-up display while ability score points are unspent. */
export function asiBadge(points: number): string | null {
  if (!(points > 0)) return null;
  return points === 1 ? '1 ability point to spend (C)' : `${points} ability points to spend (C)`;
}
