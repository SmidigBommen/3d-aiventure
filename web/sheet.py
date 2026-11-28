"""The character sheet as functions of a session, called by the JSON API."""

from character import WeaponSlot
from engine.abilities import summarize_ability
from engine.leveling import ABILITIES, ABILITY_SCORE_CAP, asi_points_available, improve_ability
from skills import SKILLS, calculate_skill_modifier
from web.fight import Rejected
from web.game_session import GameSession, get_class_abilities, get_classes, get_save_modifiers

SERIALIZED_KEYS = (
    "name", "race", "class_name", "level", "portrait", "xp", "xp_to_next_level", "gold",
    "current_hit_points", "max_hit_points", "power_points", "max_power_points", "armor_class",
    "weapon", "armor", "asi_points", "ability_score_cap",
    *(f"{ability}_{part}" for ability in ABILITIES for part in ("score", "modifier")),
)


def primary_ability(class_props: dict) -> str:
    return class_props.get("primary_ability", "").lower()


def unarmored_defense(class_props: dict) -> str:
    return (class_props.get("unarmored_defense") or "").lower()


def attack_view(character) -> dict:
    """The attack fight.attack makes, as numbers to show."""
    weapon = character.weapon_slots.get(WeaponSlot.MAIN_HAND)
    if weapon:
        modifier = character.get_attack_modifier(weapon)
        return {"weapon": weapon.name, "bonus": modifier + character.proficiency_bonus,
                "damage_dice": f"{weapon.damage_dice_count}d{weapon.damage_die}",
                "damage_modifier": modifier, "damage_type": weapon.damage_type}
    modifier = character.strength_modifier
    return {"weapon": "Unarmed Strike", "bonus": modifier + character.proficiency_bonus,
            "damage_dice": "1d4", "damage_modifier": modifier, "damage_type": "bludgeoning"}


def sheet_view(session: GameSession) -> dict:
    """Everything the character sheet shows."""
    character = session.character
    serialized = session.serialize_character()
    level = serialized["level"]
    class_props = get_classes().get(serialized["class_name"], {})
    can_improve = serialized["asi_points"] > 0
    view = {key: serialized[key] for key in SERIALIZED_KEYS}
    view.update({
        "primary_ability": primary_ability(class_props),
        "unarmored_defense": unarmored_defense(class_props),
        "improvable": [ability for ability in ABILITIES
                       if can_improve and serialized[f"{ability}_score"] < ABILITY_SCORE_CAP],
        "proficiency_bonus": character.proficiency_bonus,
        "attack": attack_view(character),
        "weapon_proficiencies": class_props.get("weapon_proficiencies", []),
        "armor_training": class_props.get("armor_training", []),
        "saving_throws": [name.lower() for name in class_props.get("saving_throw_proficiencies", [])],
        "save_modifiers": get_save_modifiers(character),
        "skills": [
            {"name": name, "ability": ability.lower(),
             "modifier": calculate_skill_modifier(character, name),
             "proficient": character.has_skill_proficiency(name)}
            for name, ability in SKILLS.items()
        ],
        "abilities": [
            {"id": ability["id"], "name": ability["name"], "description": ability.get("description", ""),
             "cost": ability["cost"], "unlock_level": ability["unlock_level"],
             "summary": summarize_ability(ability, level)}
            for ability in get_class_abilities(serialized["class_name"], level)
        ],
    })
    return view


def improve(session: GameSession, ability: str) -> str:
    """Spend one Ability Score Improvement point."""
    character = session.character
    name = ability.lower()
    if name not in ABILITIES:
        raise Rejected("no_such_ability", "That is not an ability score.")
    if asi_points_available(character) <= 0:
        raise Rejected("no_points", "You have no ability score points to spend.")
    if getattr(character, f"{name}_score") >= ABILITY_SCORE_CAP:
        raise Rejected("score_at_cap", f"{name.capitalize()} is already at {ABILITY_SCORE_CAP}.")

    primary = get_classes().get(character.class_name, {}).get("primary_ability", "Strength")
    result = improve_ability(character, name, primary)
    modifier = result["new_modifier"]
    message = f"{result['ability'].capitalize()} is now {result['new_score']}"
    if result["modifier_increased"]:
        message += f" (modifier {'+' if modifier >= 0 else ''}{modifier})"
    if result["hp_increase"]:
        message += f", +{result['hp_increase']} max HP"
    if result["pp_increase"]:
        message += f", +{result['pp_increase']} max PP"
    return message + "."
