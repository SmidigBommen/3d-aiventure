"""A fight, as functions of a GameSession: every battle action, the round loop, the end of a fight
and the view of it for the JSON API.

No Request, no saving: the API routes (web/api/) call these.
The rules themselves are in engine/.
"""

import random

from web.game_session import (
    get_abilities, get_class_abilities, get_primary_modifier,
    get_quests, get_monster_taunts, get_bosses, get_monster_abilities,
    get_save_modifiers, get_campaign, get_all_weapons_flat, BATTLE_LOG_LIMIT,
)
from monsterFactory import MonsterFactory
from dice import Dice
from items import HealingPotion
from character import WeaponSlot
from lootGenerator import LootGenerator
from web.shop import restock_shop
from engine.effects import (
    get_effect_bonus, tick_effects, is_stunned, resolve_round_conditions,
    describe_effect, CONDITION_LABELS, DOT_STATS,
)
from engine.combat import (
    get_weapon_attack_modifier, resolve_weapon_attack, resolve_flee,
    calculate_xp_reward, calculate_gold_reward,
)
from engine.abilities import resolve_player_ability_detail, summarize_ability
from engine.turn_events import TurnRecorder, ability_fx, outcome_of
from engine.monster_ai import choose_monster_action, resolve_monster_ability, tick_cooldowns
from engine.leveling import asi_points_available, grant_xp
from engine.quests import check_quest_progress
from engine.combatant import CombatantState
from engine import campaign as campaign_rules
from web import world


class Rejected(Exception):
    """An action that is not carried out. Nothing has changed when this is raised."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


NO_ESCAPE_TEXT = "There is no escape from this fight!"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def begin_turn(session):
    """Start recording a new turn (see engine/turn_events.py)."""
    battle = session.battle
    battle.recorder = TurnRecorder(session.character.current_hit_points, battle.monster.hp)
    battle.turn_events = battle.recorder.events
    battle.turn_seq += 1


def record(session, actor, kind, name="", outcome=None, fx="impact", ranged=False):
    """Add a step to the turn being recorded; HP changes since the last step are measured here."""
    battle = session.battle
    if getattr(battle, "recorder", None) is None:
        begin_turn(session)
    battle.recorder.add(actor, kind, session.character.current_hit_points, battle.monster.hp,
                        name=name, outcome=outcome, fx=fx, ranged=ranged)


def weapon_fx(weapon_name: str) -> str:
    """Damage type of a weapon by name, for the hit effect."""
    return get_all_weapons_flat().get(weapon_name, {}).get("damage_type", "slashing").lower()


def get_monster_taunt(race: str, context: str, boss_id: str = "") -> str:
    """Get a random taunt by race and context. Bosses speak their own lines."""
    if boss_id:
        lines = get_bosses().get(boss_id, {}).get("taunts", {}).get(context)
        if lines:
            return random.choice(lines)
    all_taunts = get_monster_taunts()
    default = all_taunts.get("Default", {})
    taunts = all_taunts.get(race, default)
    lines = taunts.get(context, default.get(context, [""]))
    return random.choice(lines)


def _taunt(battle, context: str) -> str:
    return get_monster_taunt(battle.monster.race, context, battle.monster.boss_id)


def get_monster_for_area(area, location=None):
    """Generate a monster appropriate for the area."""
    # Get monster info from area - default to Goblin for simple areas
    monster_types = area.get("monster_types", ["Goblin"])
    monster_race = random.choice(monster_types)

    # Get level range from location's encounterLevel field
    level_range_str = None
    if location:
        level_range_str = location.get("encounterLevel")
    if level_range_str and "-" in str(level_range_str):
        min_level, max_level = map(int, level_range_str.split("-"))
        level = random.randint(min_level, max_level)
    else:
        # Fall back to area encounter_levels or default
        level_range = area.get("encounter_levels", [1, 2])
        if isinstance(level_range, list) and len(level_range) >= 2:
            level = random.randint(level_range[0], level_range[1])
        else:
            level = 1

    return monster_race, level


def classify_log_entry(entry: str) -> str:
    """CSS class for a battle log line (drives color and sound)."""
    if "CRITICAL" in entry:
        return "crit"
    if '"' in entry and ":" in entry:
        return "taunt"
    if "hits for" in entry or "deals" in entry or "damage" in entry or "drains" in entry:
        return "damage"
    if "heals" in entry or "regenerates" in entry:
        return "heal"
    if "defensive stance" in entry:
        return "defend"
    if "misses" in entry or "Miss" in entry or "resist" in entry:
        return "miss"
    if "stunned" in entry or "afflicted" in entry or "flee" in entry:
        return "condition"
    if "uses" in entry or "casts" in entry:
        return "ability"
    return ""


def effect_badges(effects, friendly_is_positive=True):
    """Build display badges for a list of active effects."""
    badges = []
    for eff in effects:
        stat = eff["stat"]
        if stat in CONDITION_LABELS:
            label = CONDITION_LABELS[stat]
            harmful = stat != "regen"
        else:
            label = f"{stat.replace('_', ' ').title().replace('Ac', 'AC')} {eff['value']:+d}"
            harmful = eff["value"] < 0
        title = f"{eff['source']}: {describe_effect(eff)}"
        if eff["duration"] > 0:
            title += f" ({eff['duration']} rd)"
        badges.append({"label": label, "title": title, "kind": "debuff" if harmful else "buff"})
    return badges


def begin_battle(session, monster_state: CombatantState, intro_lines=None, place: str = "monster") -> bool:
    """Set up battle state and roll initiative. `place` is where in the area the monster stands.

    Returns False if the player was struck down by the opening blow.
    """
    char = session.character
    battle = session.battle
    battle.monster = monster_state
    session.battle_place = place
    battle.is_active = True
    battle.round_count = 1
    battle.battle_log = list(intro_lines or [])
    battle.player_effects = []
    begin_turn(session)

    player_init = char.dexterity_modifier + Dice.roll_d20()
    monster_init = monster_state.dex_mod + Dice.roll_d20()
    battle.initiative_order = sorted(
        [("player", player_init), ("monster", monster_init)], key=lambda x: x[1], reverse=True)
    battle.is_player_turn = battle.initiative_order[0][0] == "player"

    battle.battle_log.append(f"Battle begins: {char.name} vs {monster_state.name}!")
    battle.battle_log.append(
        f"Initiative: {char.name} ({player_init}) vs {monster_state.name} ({monster_init})")

    # If the monster won initiative it gets a free opening action
    if not battle.is_player_turn:
        execute_monster_turn(session)
        battle.is_player_turn = True
    return char.current_hit_points > 0


def pick_monster(area, location=None) -> dict:
    """Draw the monster met in an area: race, level, name, class and weapon. Builds nothing."""
    monster_race, level = get_monster_for_area(area, location)

    factory = MonsterFactory()
    if monster_race not in factory.races:
        monster_race = "Goblin"

    race_data = factory.races[monster_race]
    return {
        "race": monster_race,
        "level": level,
        "name": random.choice(race_data.get("names", [monster_race])),
        "class_name": random.choice(race_data.get("class_options", ["Fighter"])),
        "weapon": random.choice(race_data.get("weapons", [race_data.get("weapon_name", "Club")])),
    }


def begin_monster_battle(session, picked: dict, place: str = "monster") -> bool:
    """Start a fight against a monster drawn by pick_monster()."""
    monster = MonsterFactory().create_monster(
        name=picked["name"],
        race=picked["race"],
        class_name=picked["class_name"],
        monster_level=picked["level"],
        weapon_name=picked["weapon"],
    )
    state = CombatantState.from_monster(monster)
    state.abilities = list(get_monster_abilities()["races"].get(picked["race"], []))
    return begin_battle(session, state, place=place)


def begin_random_battle(session, place: str = "monster") -> bool:
    """Start a fight against a random monster from the current area."""
    return begin_monster_battle(session, pick_monster(session.current_area, session.current_location), place)


def begin_boss_battle(session, boss_id: str, place: str = "boss") -> bool:
    """Start a fight against a boss from bosses.json. The ambush on the road passes place "road"."""
    boss = get_bosses()[boss_id]
    state = CombatantState.from_boss(boss_id, boss)
    return begin_battle(session, state, intro_lines=[boss["intro"]] if boss.get("intro") else None,
                        place=place)


def opened(session, player_stands: bool) -> str:
    """The phase of a fight that has just begun: the opening blow may have ended it in a defeat."""
    return "fight" if player_stands else end_battle(session, False)


def enrage_text(monster) -> str:
    """The line that announces this boss's rage."""
    boss = get_bosses().get(monster.boss_id, {})
    return boss.get("enrage_text", f"{monster.name} flies into a rage!")


def maybe_enrage(session):
    """Bosses enrage the first time they drop to half health."""
    monster = session.battle.monster
    if not monster.is_boss or monster.enraged or monster.hp <= 0:
        return
    if monster.hp * 2 > monster.max_hp:
        return
    monster.enraged = True
    monster.cooldowns = {}
    monster.effects.append({"stat": "damage_bonus", "value": 2 + monster.level // 5,
                            "duration": 0, "source": "Enraged"})
    session.battle.battle_log.append(enrage_text(monster))
    record(session, "monster", "enrage", name="Enraged", fx="rage")


def execute_monster_turn(session):
    """Execute the monster's turn: attack, defend or use a special ability."""
    battle = session.battle
    monster = battle.monster
    char = session.character
    catalog = get_monster_abilities()["abilities"]

    maybe_enrage(session)

    hp_fraction = char.current_hit_points / char.max_hit_points if char.max_hit_points else 1
    action, ability_id = choose_monster_action(monster, catalog, hp_fraction)

    if action == "ability":
        result = resolve_monster_ability(
            monster, ability_id, catalog[ability_id],
            player_ac=char.armor_class,
            player_effects=battle.player_effects,
            player_save_mods=get_save_modifiers(char),
        )
        battle.battle_log.extend(result["log"])
        if result["damage"]:
            char.current_hit_points = max(0, char.current_hit_points - result["damage"])
        ability = catalog[ability_id]
        record(session, "monster", "ability", name=ability["name"], fx=ability_fx(ability),
               ranged=ability["kind"] == "save",
               outcome=None if ability["kind"] == "self"
               else outcome_of(result["landed"], result["crit"], result["half"]))

    elif action == "attack":
        ability_mod = get_weapon_attack_modifier(
            monster.str_mod, monster.dex_mod, monster.weapon.properties)

        result = resolve_weapon_attack(
            attacker_mod=ability_mod,
            attacker_prof=monster.proficiency,
            target_ac=char.armor_class,
            damage_dice_count=monster.weapon.damage_dice_count,
            damage_die=monster.weapon.damage_die,
            attacker_effects=monster.effects,
            target_effects=battle.player_effects,
        )

        battle.battle_log.append(f'{monster.name}: "{_taunt(battle, "attack")}"')
        if result["crit"]:
            battle.battle_log.append(
                f"{monster.name} attacks with {monster.weapon.name} — CRITICAL HIT! "
                f"{result['damage']} damage!")
        elif result["hit"]:
            battle.battle_log.append(
                f"{monster.name} attacks with {monster.weapon.name}! "
                f"(Roll: {result['attack_roll']} vs AC {result['target_ac']})")
            battle.battle_log.append(f"{monster.name} hits for {result['damage']} damage!")
        else:
            battle.battle_log.append(
                f"{monster.name} attacks with {monster.weapon.name}! "
                f"(Roll: {result['attack_roll']} vs AC {result['target_ac']})")
            battle.battle_log.append(f"{monster.name}'s attack misses!")
        if result["hit"]:
            char.current_hit_points = max(0, char.current_hit_points - result["damage"])
        record(session, "monster", "attack", name=monster.weapon.name,
               outcome=outcome_of(result["hit"], result["crit"]), fx=weapon_fx(monster.weapon.name),
               ranged="ammunition" in monster.weapon.properties)

    else:
        monster.ac += 2
        battle.battle_log.append(f"{monster.name} takes a defensive stance (+2 AC).")
        record(session, "monster", "defend", name="Defend", fx="shield")


def _apply_round_conditions(session):
    """Apply end-of-round damage-over-time and regeneration to both sides."""
    battle = session.battle
    monster = battle.monster
    char = session.character

    for name, effects, is_monster in (
        (monster.name, monster.effects, True),
        (char.name, battle.player_effects, False),
    ):
        outcome = resolve_round_conditions(effects)
        for stat, value in outcome["sources"]:
            if stat in DOT_STATS:
                battle.battle_log.append(f"{name} takes {value} {stat} damage!")
            else:
                battle.battle_log.append(f"{name} regenerates {value} HP.")
        if is_monster:
            monster.hp = max(0, min(monster.max_hp, monster.hp - outcome["damage"] + outcome["heal"]))
        else:
            char.current_hit_points = max(0, min(
                char.max_hit_points, char.current_hit_points - outcome["damage"] + outcome["heal"]))
        if outcome["sources"]:
            # One event per side; the strongest condition picks the visual
            stat = max(outcome["sources"], key=lambda source: source[1])[0]
            record(session, "monster" if is_monster else "player", "condition",
                   name=CONDITION_LABELS.get(stat, stat.title()), fx=stat)


def finish_player_turn(session) -> str:
    """Resolve everything that follows the player's action. Returns the phase after it.

    Monster turn → end-of-round conditions → effect/cooldown ticks → next round.
    If the player is stunned the loop repeats, costing them their turn.
    """
    battle = session.battle
    monster = battle.monster
    char = session.character

    if monster.hp <= 0:
        return end_battle(session, player_won=True)

    while True:
        battle.is_player_turn = False
        if is_stunned(monster.effects):
            battle.battle_log.append(f"{monster.name} is stunned and loses its turn!")
            record(session, "monster", "stunned", name="Stunned", fx="stun")
        else:
            execute_monster_turn(session)

        if char.current_hit_points <= 0:
            return end_battle(session, player_won=False)

        _apply_round_conditions(session)
        if monster.hp <= 0:
            return end_battle(session, player_won=True)
        if char.current_hit_points <= 0:
            return end_battle(session, player_won=False)
        maybe_enrage(session)

        # Round bookkeeping
        monster.reset_ac()
        battle.player_effects = tick_effects(battle.player_effects)
        monster.effects = tick_effects(monster.effects)
        tick_cooldowns(monster)
        battle.round_count += 1
        battle.is_player_turn = True

        if is_stunned(battle.player_effects):
            battle.battle_log.append(f"{char.name} is stunned and loses their turn!")
            record(session, "player", "stunned", name="Stunned", fx="stun")
            continue
        break

    return "fight"


# ---------------------------------------------------------------------------
# Player actions
# ---------------------------------------------------------------------------

def check_turn(session) -> None:
    """The two checks every action starts with: there is a fight, and it is the player's turn."""
    if not session.battle.is_active:
        raise Rejected("no_battle", "You are not in a battle.")
    if not session.battle.is_player_turn:
        raise Rejected("not_your_turn", "It is not your turn.")


def attack(session) -> str:
    """The player attacks the monster with the weapon in the main hand."""
    check_turn(session)
    char = session.character
    battle = session.battle
    monster = battle.monster

    begin_turn(session)
    weapon = char.weapon_slots.get(WeaponSlot.MAIN_HAND)
    if weapon:
        ability_mod = char.get_attack_modifier(weapon)
        damage_die = weapon.damage_die
        damage_dice_count = weapon.damage_dice_count
    else:
        ability_mod = char.strength_modifier
        damage_die = 4
        damage_dice_count = 1

    result = resolve_weapon_attack(
        attacker_mod=ability_mod,
        attacker_prof=char.proficiency_bonus,
        target_ac=monster.ac,
        damage_dice_count=damage_dice_count,
        damage_die=damage_die,
        attacker_effects=battle.player_effects,
        target_effects=monster.effects,
    )

    if result["crit"]:
        battle.battle_log.append(
            f"{char.name} attacks — CRITICAL HIT! {result['damage']} damage!")
    else:
        battle.battle_log.append(
            f"{char.name} attacks! (Roll: {result['attack_roll']} vs AC {result['target_ac']})")
        if result["hit"]:
            battle.battle_log.append(f"{char.name} hits for {result['damage']} damage!")
        elif result["fumble"]:
            battle.battle_log.append(f"{char.name} fumbles — the attack misses badly!")
        else:
            battle.battle_log.append(f"{char.name}'s attack misses!")

    if result["hit"]:
        monster.hp = max(0, monster.hp - result["damage"])
        if monster.hp > 0:
            battle.battle_log.append(f'{monster.name}: "{_taunt(battle, "hurt")}"')
    record(session, "player", "attack", name=weapon.name if weapon else "Unarmed Strike",
           outcome=outcome_of(result["hit"], result["crit"]),
           fx=weapon.damage_type.lower() if weapon else "bludgeoning",
           ranged=bool(weapon) and "ammunition" in weapon.properties)

    return finish_player_turn(session)


def defend(session) -> str:
    """The player takes a defensive stance: +1d4 AC until the end of the round."""
    check_turn(session)
    char = session.character
    begin_turn(session)
    ac_bonus = Dice.roll_d4()
    session.battle.player_effects.append(
        {"stat": "ac", "value": ac_bonus, "duration": 1, "source": "Defend"})
    session.battle.battle_log.append(f"{char.name} takes a defensive stance (+{ac_bonus} AC)!")
    record(session, "player", "defend", name="Defend", fx="shield")

    return finish_player_turn(session)


def use_item(session, item_index: int) -> str:
    """The player uses the inventory item at this index. Only healing potions work in a fight."""
    check_turn(session)
    char = session.character
    item = char.inventory[item_index] if 0 <= item_index < len(char.inventory) else None
    if not isinstance(item, HealingPotion):
        # Nothing usable at that slot — don't waste the player's turn
        raise Rejected("no_such_item", "There is nothing to use in that slot.")

    begin_turn(session)
    old_hp = char.current_hit_points
    char.current_hit_points = min(char.max_hit_points, old_hp + item.healing_amount)
    char.inventory.pop(item_index)
    session.battle.battle_log.append(
        f"{char.name} uses {item.name} and heals for {char.current_hit_points - old_hp} HP!")
    record(session, "player", "item", name=item.name, fx="heal")

    return finish_player_turn(session)


def use_ability(session, ability_id: str) -> str:
    """The player uses a class ability."""
    check_turn(session)
    char = session.character
    ability = get_abilities().get(ability_id)
    # The class must have this ability and the level must be high enough
    if (not ability or char.class_name not in ability.get("classes", [])
            or char.level < ability.get("unlock_level", 1)):
        raise Rejected("no_such_ability", "You do not know that ability.")
    if char.power_points < ability["cost"]:
        raise Rejected("not_enough_pp", f"Not enough power points for {ability['name']}.")

    begin_turn(session)
    detail = resolve_player_ability_detail(
        char, ability, session.battle.monster,
        session.battle.player_effects, get_primary_modifier(char))
    session.battle.battle_log.extend(detail["log"])
    record(session, "player", "ability", name=ability["name"],
           outcome=detail["outcome"], fx=ability_fx(ability),
           ranged=ability["attack_method"] != "melee_attack")

    return finish_player_turn(session)


def flee(session) -> str:
    """Try to escape: d20 + DEX vs DC 10 + half the monster's level. Bosses can't be fled.

    The roll is kept on the battle as `flee_roll` (not stored) for whoever wants to show it.
    """
    check_turn(session)
    battle = session.battle
    char = session.character
    if battle.monster.is_boss:
        raise Rejected("cannot_flee", NO_ESCAPE_TEXT)

    result = resolve_flee(char.dexterity_modifier, battle.monster.level)
    battle.flee_roll = result
    if result["success"]:
        battle.is_active = False
        battle.player_effects = []
        battle.monster.effects = []
        char.active_effects = []
        # A monster met in the 3D world goes back to where it stood
        contents = world.stored_contents(session)
        if session.engaged_monster and contents and not contents.get("monster"):
            contents["monster"] = session.engaged_monster
        session.engaged_monster = None
        return "fled"

    begin_turn(session)
    battle.battle_log.append(
        f"{char.name} tries to flee but {battle.monster.name} cuts off the escape! "
        f"(Rolled {result['total']} vs DC {result['dc']})")
    record(session, "player", "flee", name="Flee", outcome="miss", fx="impact")
    return finish_player_turn(session)


# ---------------------------------------------------------------------------
# Battle resolution
# ---------------------------------------------------------------------------

def _boss_victory(session, boss_id: str) -> dict:
    """Record a boss kill and work out what it unlocked. Returns display data."""
    bosses = get_bosses()
    boss = bosses[boss_id]
    campaign = get_campaign()

    act_before = campaign_rules.highest_unlocked_act(campaign, session.defeated_bosses)
    complete_before = campaign_rules.is_campaign_complete(campaign, session.defeated_bosses)
    if boss_id not in session.defeated_bosses:
        session.defeated_bosses.append(boss_id)
    act_after = campaign_rules.highest_unlocked_act(campaign, session.defeated_bosses)

    act_unlocked = None
    if act_after > act_before:
        act = next(a for a in campaign["acts"] if a["number"] == act_after)
        act_unlocked = {"number": act["number"], "title": act["title"],
                        "description": act["description"]}

    return {
        "name": boss["name"],
        "defeat_text": boss.get("defeat_text"),
        "shard": boss.get("shard"),
        "shards_collected": len(campaign_rules.collected_shards(bosses, session.defeated_bosses)),
        "shards_total": len(campaign_rules.all_shards(bosses)),
        "act_unlocked": act_unlocked,
        "campaign_complete": (not complete_before
                              and campaign_rules.is_campaign_complete(campaign, session.defeated_bosses)),
    }


def end_battle(session, player_won: bool) -> str:
    """End the fight: rewards for a victory, a restocked shop after a defeat. Returns the phase."""
    battle = session.battle
    monster = battle.monster
    char = session.character

    battle.is_active = False
    battle.player_effects = []
    monster.effects = []
    char.active_effects = []
    session.engaged_monster = None

    if player_won:
        boss = get_bosses().get(monster.boss_id) if monster.is_boss else None
        if boss:
            xp_reward = boss.get("rewards", {}).get("xp", 300 * monster.level)
            gold_reward = boss.get("rewards", {}).get("gold", 30 * monster.level)
        else:
            xp_reward = calculate_xp_reward(monster.level, battle.round_count)
            gold_reward = calculate_gold_reward(monster.level)

        abilities_before = {a["id"] for a in get_class_abilities(char.class_name, char.level)}
        xp_result = grant_xp(char, xp_reward, get_primary_modifier(char))
        new_abilities = [a["name"] for a in get_class_abilities(char.class_name, char.level)
                         if a["id"] not in abilities_before]

        char.gold += gold_reward
        session.monster_kills += 1

        # Restock shop every 10 kills
        if session.monster_kills - session.kills_at_last_restock >= 10:
            restock_shop(session)
            session.kills_at_last_restock = session.monster_kills

        # Loot — bosses always drop something, from a better table
        loot_level = monster.level + 6 if boss else monster.level
        loot = LootGenerator().generate_loot(loot_level, char.level)
        if loot:
            if loot["type"] == "gold":
                char.gold += loot["amount"]
            else:
                char.add_item(loot["item"])

        quest_updates = check_quest_progress(
            session.active_quests, get_quests(), monster.race, char.inventory)

        session.battle_rewards = {
            "xp": xp_reward,
            "gold": gold_reward,
            "loot": loot["message"] if loot else None,
            "loot_type": loot["type"] if loot else None,
            "leveled_up": xp_result["leveled_up"],
            "new_level": char.level,
            "hp_increase": xp_result["hp_increase"],
            "new_abilities": new_abilities,
            "new_max_pp": char.max_power_points if xp_result["leveled_up"] else None,
            "asi_points": asi_points_available(char) if xp_result["leveled_up"] else 0,
            "quest_updates": quest_updates,
            "boss": _boss_victory(session, monster.boss_id) if boss else None,
        }
        return "victory"

    session.battle_rewards = None
    restock_shop(session)
    session.kills_at_last_restock = session.monster_kills
    return "defeat"


def revive(session) -> None:
    """Revive the fallen character at the current location's starting area, for half their gold."""
    char = session.character
    if not char or char.current_hit_points > 0:
        raise Rejected("not_defeated", "You have not fallen.")

    # Gold penalty: lose 50%
    char.gold = char.gold - (char.gold // 2)

    # Heal to full
    char.current_hit_points = char.max_hit_points
    char.power_points = char.max_power_points
    char.active_effects = []

    # Move to starting area of current location
    location = session.current_location
    if location:
        starting_id = location.get("starting_area")
        if starting_id:
            for area in location.get("areas", []):
                if area["id"] == starting_id:
                    session.current_area = area
                    break
    world.roll_contents(session)


# ---------------------------------------------------------------------------
# The view of a fight
# ---------------------------------------------------------------------------

def item_stacks(inventory) -> list:
    """Items usable in a fight. Identical ones share one entry; hotkeys Q, W, E, R go to the first four."""
    stacks = {}
    for i, item in enumerate(inventory):
        if not getattr(item, "is_usable_in_battle", False):
            continue
        stack = stacks.setdefault(
            item.name, {"name": item.name, "description": item.description, "index": i, "count": 0,
                        "hotkey": ""})
        stack["count"] += 1
    usable_items = list(stacks.values())
    for stack, hotkey in zip(usable_items, "qwer"):
        stack["hotkey"] = hotkey
    return usable_items


def log_entries(battle) -> list:
    """The last lines of the battle log with their display class."""
    return [{"text": entry, "cls": classify_log_entry(entry)}
            for entry in battle.battle_log[-BATTLE_LOG_LIMIT:]]


def _effects_view(effects) -> list:
    return [{"stat": eff["stat"], "value": eff["value"], "duration": eff["duration"],
             "source": eff["source"], "label": badge["label"], "kind": badge["kind"]}
            for eff, badge in zip(effects, effect_badges(effects))]


def current_taunt(battle, boss: dict):
    """What the boss last said: its last line in the stored log, else its first opening line. No dice."""
    prefix = f'{battle.monster.name}: "'
    for entry in reversed(battle.battle_log[-BATTLE_LOG_LIMIT:]):
        if len(entry) > len(prefix) and entry.startswith(prefix) and entry.endswith('"'):
            return entry[len(prefix):-1]
    opening = boss.get("taunts", {}).get("start")
    return opening[0] if opening else None


def battle_view(session, fled: bool = False) -> dict:
    """The fight as the 3D client shows it. Reads the session, rolls nothing, changes nothing."""
    battle = session.battle
    monster = battle.monster
    char = session.character

    if fled:
        phase = "fled"
    elif battle.is_active:
        phase = "fight"
    elif char.current_hit_points <= 0:
        phase = "defeat"
    elif session.battle_rewards is not None and monster.hp <= 0:
        phase = "victory"
    else:
        phase = "none"

    boss = get_bosses().get(monster.boss_id) if monster.is_boss else None
    can_act = phase == "fight" and battle.is_player_turn
    abilities = [{
        "id": ability["id"],
        "name": ability["name"],
        "description": ability.get("description", ""),
        "cost": ability["cost"],
        "summary": summarize_ability(ability, char.level),
        "usable": can_act and char.power_points >= ability["cost"],
        "hotkey": str(position),
    } for position, ability in enumerate(get_class_abilities(char.class_name, char.level), start=1)]

    return {
        "phase": phase,
        "round": battle.round_count,
        "player_turn": battle.is_player_turn,
        "turn": {"seq": battle.turn_seq, "events": battle.turn_events},
        "player": {
            "name": char.name,
            "level": char.level,
            "hp": char.current_hit_points,
            "max_hp": char.max_hit_points,
            "pp": char.power_points,
            "max_pp": char.max_power_points,
            "ac": char.armor_class + get_effect_bonus(battle.player_effects, "ac"),
            "effects": _effects_view(battle.player_effects),
        },
        "monster": {
            "name": monster.name,
            "race": monster.race,
            "level": monster.level,
            "hp": monster.hp,
            "max_hp": monster.max_hp,
            "ac": monster.ac + get_effect_bonus(monster.effects, "ac"),
            "is_boss": monster.is_boss,
            "boss_id": monster.boss_id or None,
            "title": boss.get("title") if boss else None,
            "enraged": monster.enraged,
            "effects": _effects_view(monster.effects),
            "taunt": current_taunt(battle, boss) if boss and phase == "fight" else None,
            "enrage_text": enrage_text(monster) if boss else None,
            "place": session.battle_place,
        },
        "abilities": abilities,
        "items": item_stacks(char.inventory),
        "can_flee": phase == "fight" and not monster.is_boss,
        "flee": {"dc": 10 + monster.level // 2, "modifier": char.dexterity_modifier},
        "log": log_entries(battle),
        "rewards": session.battle_rewards if phase == "victory" else None,
        "defeat": {"monster_name": monster.name, "gold": char.gold,
                   "gold_cost": char.gold // 2} if phase == "defeat" else None,
    }
