"""The backpack and what is worn, as functions of a session: shared by the classic routes and the JSON API.

No Request, no saving, no redirect. An action returns the line for the player or raises
fight.Rejected(code, message) before anything changed.
"""

from armor import Armor
from character import WeaponSlot
from equipmentType import EquipmentType
from items import HealingPotion
from weapon import Weapon
from web.fight import Rejected
from web.game_session import GameSession, get_classes


def _class_props(session: GameSession) -> dict:
    return get_classes().get(session.character_creation.class_name, {})


def _can_equip_item(item, weapon_proficiencies, armor_training):
    """Check if the character is proficient with an inventory item."""
    if isinstance(item, Weapon):
        return item.category in weapon_proficiencies or item.name in weapon_proficiencies
    if isinstance(item, Armor):
        return item.category in armor_training
    return False


def _average_damage(weapon) -> float:
    return weapon.damage_dice_count * (weapon.damage_die + 1) / 2


def _compare(diff, unit):
    """Display data for a difference against the equipped item."""
    if diff == 0:
        return {"cls": "same", "text": f"Same {unit}"}
    return {"cls": "better" if diff > 0 else "worse", "text": f"{diff:+g} {unit}"}


def annotated_items(session: GameSession, serialized: dict) -> list:
    """The serialized inventory with what the player can do with each entry.

    Identical potions and quest items collapse into one stack.
    """
    class_props = _class_props(session)
    weapon_proficiencies = class_props.get("weapon_proficiencies", [])
    armor_training = class_props.get("armor_training", [])

    character = session.character
    equipped_weapon = character.weapon_slots.get(WeaponSlot.MAIN_HAND)
    equipped_avg = _average_damage(equipped_weapon) if equipped_weapon else 0
    hp_missing = character.max_hit_points - character.current_hit_points

    stacks = {}
    items = []
    for i, item in enumerate(serialized["inventory"]):
        actual_item = character.inventory[i]
        item["can_equip"] = _can_equip_item(actual_item, weapon_proficiencies, armor_training)
        item["index"] = i
        item["count"] = 1
        if isinstance(actual_item, Weapon):
            item["compare"] = _compare(_average_damage(actual_item) - equipped_avg, "avg damage")
        elif isinstance(actual_item, Armor):
            item["ac_if_equipped"] = character.ac_if_wearing(actual_item)
            item["compare"] = _compare(item["ac_if_equipped"] - character.armor_class, "AC")
        else:
            item["can_use"] = isinstance(actual_item, HealingPotion) and hp_missing > 0
            key = (item["type"], item["name"], item["description"])
            if key in stacks:
                stacks[key]["count"] += 1
                continue
            stacks[key] = item
        items.append(item)
    return items


def inventory_view(session: GameSession) -> dict:
    """What is worn and what is in the backpack, for the 3D panel."""
    serialized = session.serialize_character()
    return {
        "weapon": serialized["weapon_details"],
        "armor": serialized["armor_details"],
        "armor_class": serialized["armor_class"],
        "items": annotated_items(session, serialized),
    }


def _item_at(character, item_index):
    return character.inventory[item_index] if 0 <= item_index < len(character.inventory) else None


def use_potion(session: GameSession, item_index: int) -> str:
    """Drink a healing potion outside of battle."""
    character = session.character
    item = _item_at(character, item_index)
    if not isinstance(item, HealingPotion):
        raise Rejected("no_such_item", "That item cannot be used.")
    if character.current_hit_points <= 0:
        raise Rejected("defeated", "You are in no state to drink anything.")
    if character.current_hit_points >= character.max_hit_points:
        raise Rejected("full_health", "You are already at full health.")
    old_hp = character.current_hit_points
    character.current_hit_points = min(character.max_hit_points, old_hp + item.healing_amount)
    character.inventory.pop(item_index)
    return f"You drink the {item.name} and recover {character.current_hit_points - old_hp} HP."


def equip_weapon(session: GameSession, item_index: int) -> str:
    """Equip a weapon from the backpack in the main hand."""
    character = session.character
    item = _item_at(character, item_index)
    if item is None:
        raise Rejected("no_such_item", "Invalid item.")
    if not isinstance(item, Weapon):
        raise Rejected("not_a_weapon", "That item is not a weapon.")
    weapon_proficiencies = _class_props(session).get("weapon_proficiencies", [])
    if item.category not in weapon_proficiencies and item.name not in weapon_proficiencies:
        raise Rejected("not_proficient", f"You are not proficient with {item.name}.")

    # equip_weapon handles inventory (removes new from inventory, returns old to inventory)
    character.equip_weapon(item, WeaponSlot.MAIN_HAND)
    session.character_creation.weapon = item.name
    return f"Equipped {item.name}."


def unequip_weapon(session: GameSession) -> str:
    """Put the main hand weapon into the backpack."""
    character = session.character
    weapon = character.weapon_slots.get(WeaponSlot.MAIN_HAND)
    if not weapon:
        raise Rejected("nothing_equipped", "No weapon equipped.")
    character.unequip_weapon(WeaponSlot.MAIN_HAND)
    session.character_creation.weapon = None
    return f"Unequipped {weapon.name}."


def equip_armor(session: GameSession, item_index: int) -> str:
    """Wear armor from the backpack."""
    character = session.character
    item = _item_at(character, item_index)
    if item is None:
        raise Rejected("no_such_item", "Invalid item.")
    if not isinstance(item, Armor):
        raise Rejected("not_armor", "That item is not armor.")
    if item.category not in _class_props(session).get("armor_training", []):
        raise Rejected("not_proficient", f"You are not trained with {item.name}.")

    # entity.equip() does NOT manage inventory, so handle manually
    old_armor = character.equipment.get(EquipmentType.ARMOR)
    character.inventory.remove(item)
    if old_armor:
        character.inventory.append(old_armor)
    character.equip(item)
    session.character_creation.armor = item.name
    return f"Equipped {item.name}."


def unequip_armor(session: GameSession) -> str:
    """Put the armor worn into the backpack."""
    character = session.character
    armor = character.equipment.get(EquipmentType.ARMOR)
    if not armor:
        raise Rejected("nothing_equipped", "No armor equipped.")
    character.inventory.append(armor)
    character.unequip(EquipmentType.ARMOR)
    session.character_creation.armor = None
    return f"Unequipped {armor.name}."
