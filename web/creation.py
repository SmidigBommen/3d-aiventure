"""Character creation as functions, shared by the classic routes and the JSON API.

No Request, no saving. `create` raises fight.Rejected before anything on the session changed.
"""

from armorFactory import ArmorFactory
from character import WeaponSlot
from characterFactory import CharacterFactory
from items import HealingPotion
from weaponFactory import WeaponFactory

from web.fight import Rejected
from web.game_session import (
    calculate_max_pp, get_all_armors_flat, get_all_weapons_flat, get_campaign, get_class_abilities,
    get_classes, get_primary_modifier, get_races,
)

NAME_MAX = 30
ABILITIES = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
PORTRAITS = [
    {"id": "knight", "label": "Knight", "path": "/static/images/player_fighter.png"},
    {"id": "berserker", "label": "Berserker", "path": "/static/images/player_berserker.png"},
    {"id": "wizard", "label": "Wizard", "path": "/static/images/player_wizard.png"},
]
DEFAULT_PORTRAIT = PORTRAITS[0]["path"]

MESSAGES = {
    "unknown_race": "There is no such race.",
    "unknown_class": "There is no such class.",
    "bad_name": f"Your name must have 1 to {NAME_MAX} characters.",
    "bad_weapon": "Your class cannot start with that weapon.",
    "bad_armor": "Your class cannot start with that armour.",
    "bad_portrait": "There is no such portrait.",
    "bad_skills": "Those are not skills your class can choose.",
}


def _rejected(code: str) -> Rejected:
    return Rejected(code, MESSAGES[code])


def allowed_weapons(class_name: str) -> list[str]:
    """The weapons a class may start with, in catalogue order."""
    proficiencies = get_classes()[class_name]["weapon_proficiencies"]
    return [
        name for name, data in get_all_weapons_flat().items()
        if (data["category"] in ("Simple", "Martial") and data["category"] in proficiencies) or name in proficiencies
    ]


def allowed_armors(class_name: str) -> list[str]:
    """The armours a class may start with, in catalogue order."""
    training = get_classes()[class_name]["armor_training"]
    return [name for name, data in get_all_armors_flat().items() if data["category"] in training]


def weapon_entries(class_name: str) -> list[dict]:
    weapons = get_all_weapons_flat()
    return [
        {"name": name, "damage_die": weapons[name]["damage_die"], "damage_type": weapons[name]["damage_type"],
         "category": weapons[name]["category"], "properties": list(weapons[name].get("properties", [])),
         "description": weapons[name].get("description", "")}
        for name in allowed_weapons(class_name)
    ]


def armor_entries(class_name: str) -> list[dict]:
    armors = get_all_armors_flat()
    return [
        {"name": name, "base_ac": armors[name]["base_ac"], "category": armors[name]["category"],
         "weight": armors[name]["weight"], "stealth_disadvantage": armors[name]["stealth_disadvantage"]}
        for name in allowed_armors(class_name)
    ]


def bonus_display(bonuses: dict) -> str:
    """A race's bonuses as one line: "+2 CON, +1 WIS"."""
    parts = [f"+{value} {stat.replace('_bonus', '').upper()[:3]}" for stat, value in bonuses.items() if value > 0]
    return ", ".join(parts) if parts else "No bonuses"


def race_entries() -> list[dict]:
    return [
        {"name": name, "bonuses": {ability: bonuses.get(f"{ability}_bonus", 0) for ability in ABILITIES},
         "bonus_display": bonus_display(bonuses)}
        for name, bonuses in get_races().items()
    ]


def class_abilities(class_name: str) -> list[dict]:
    """Every ability of a class, in the order it is learned."""
    return [
        {"id": a["id"], "name": a["name"], "unlock_level": a["unlock_level"], "cost": a["cost"],
         "description": a["description"]}
        for a in sorted(get_class_abilities(class_name, 99), key=lambda a: (a["unlock_level"], a["cost"]))
    ]


def class_entries() -> list[dict]:
    return [
        {"name": name, "playstyle": props.get("playstyle", ""), "hit_die": props["hit_die"],
         "primary_ability": props["primary_ability"].lower(),
         "ability_bonuses": {ability.lower(): bonus for ability, bonus in props.get("ability_bonuses", {}).items()},
         "saving_throws": [ability.lower() for ability in props["saving_throw_proficiencies"]],
         "armor_training": list(props["armor_training"]),
         "weapon_proficiencies": list(props["weapon_proficiencies"]),
         "num_skills": props["num_skill_choices"],
         "skill_choices": list(props["skill_proficiency_choices"]),
         "abilities": class_abilities(name),
         "weapons": weapon_entries(name),
         "armors": armor_entries(name)}
        for name, props in get_classes().items()
    ]


def opening() -> dict:
    """What the player reads before the first step into the world."""
    campaign = get_campaign()
    act = campaign["acts"][0]
    return {
        "campaign": {"title": campaign["title"], "description": campaign["description"]},
        "act": {"number": 1, "title": act["title"], "description": act["description"],
                "main_quest": act["mainQuest"]},
    }


def creation_view() -> dict:
    return {"races": race_entries(), "classes": class_entries(), "portraits": [dict(p) for p in PORTRAITS],
            "name_max": NAME_MAX, "opening": opening()}


def preview(race: str, class_name: str) -> dict:
    """What a character of this race and class will be. Its scores do not depend on the other choices."""
    if race not in get_races():
        raise _rejected("unknown_race")
    if class_name not in get_classes():
        raise _rejected("unknown_class")
    character = CharacterFactory().create_character(name="", race=race, class_name=class_name)
    primary = get_classes()[class_name]["primary_ability"].lower()
    armor_factory = ArmorFactory()
    return {
        "race": race,
        "class_name": class_name,
        "scores": [
            {"name": ability, "score": getattr(character, f"{ability}_score"),
             "modifier": getattr(character, f"{ability}_modifier"), "primary": ability == primary}
            for ability in ABILITIES
        ],
        "hit_points": character.max_hit_points,
        "power_points": calculate_max_pp(character.class_name, 1, get_primary_modifier(character)),
        "unarmored_ac": character.ac_if_wearing(None),
        "starting_abilities": [a["name"] for a in get_class_abilities(character.class_name, 1)],
        "armors": [
            {"name": name, "total_ac": character.ac_if_wearing(armor_factory.get_armor_by_name(name))}
            for name in allowed_armors(class_name)
        ],
    }


def create(session, race, class_name, name, weapon, armor, portrait, skills) -> None:
    """Puts a new level 1 character at the start of the campaign into `session`."""
    if race not in get_races():
        raise _rejected("unknown_race")
    if class_name not in get_classes():
        raise _rejected("unknown_class")
    if not name.strip() or len(name) > NAME_MAX:
        raise _rejected("bad_name")
    if weapon not in allowed_weapons(class_name):
        raise _rejected("bad_weapon")
    if armor and armor not in allowed_armors(class_name):
        raise _rejected("bad_armor")
    if portrait not in [p["path"] for p in PORTRAITS]:
        raise _rejected("bad_portrait")
    props = get_classes()[class_name]
    skills = list(skills)
    if (len(skills) > props["num_skill_choices"] or len(set(skills)) != len(skills)
            or any(skill not in props["skill_proficiency_choices"] for skill in skills)):
        raise _rejected("bad_skills")

    character = CharacterFactory().create_character(name=name, race=race, class_name=class_name)
    character.equip_weapon(WeaponFactory().get_weapon_by_name(weapon), WeaponSlot.MAIN_HAND)
    if armor:
        character.equip(ArmorFactory().get_armor_by_name(armor))
    for skill in skills:
        character.add_skill_proficiency(skill)

    character.gold = 25
    character.add_item(HealingPotion("Small Healing Potion", 10))
    character.add_item(HealingPotion("Medium Healing Potion", 25))

    character.max_power_points = calculate_max_pp(character.class_name, character.level, get_primary_modifier(character))
    character.power_points = character.max_power_points

    session.character = character
    session.character_creation.race = race
    session.character_creation.class_name = class_name
    session.character_creation.name = name
    session.character_creation.weapon = weapon
    session.character_creation.armor = armor if armor else None
    session.character_creation.portrait = portrait
    session.character_creation.skills = skills

    campaign = get_campaign()
    session.act = campaign["acts"][0]
    session.current_location = session.act["locations"][0]
    if session.current_location.get("areas"):
        session.current_area = session.current_location["areas"][0]
