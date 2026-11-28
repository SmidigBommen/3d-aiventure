"""Elara's shop and her quest board, as functions of a session, called by the JSON API.

No Request, no saving, no redirect. An action returns {"message", "context", "haggle"}: the line
for the player, the context of Elara's answer and the roll of a haggle. It raises
fight.Rejected(code, message) before anything changed.
"""

import random

from armor import Armor
from engine.leveling import calculate_max_pp
from engine.quests import turn_in_quest as engine_turn_in_quest
from items import HealingPotion, QuestItem
from skills import make_skill_check
from weapon import Weapon
from web.game_session import (
    GameSession, get_all_armors_flat, get_all_weapons_flat, get_default_shop_inventory,
    get_primary_modifier, get_quests, get_shopkeeper,
)

MAX_ACTIVE_QUESTS = 3

# Lists of json/shopkeeper.json whose name differs from the context.
DIALOG_LISTS = {"greeting": "greetings", "buy": "buy_reactions", "sell": "sell_reactions"}

# What Elara says to a refusal that has a line of its own.
REFUSAL_CONTEXT = {"already_haggled": "browse", "quest_slots_full": "quest_full"}

QUEST_KEYS = ("name", "description", "type", "target_monster", "target_count", "rewards")


def _rejected(code: str, message: str) -> Exception:
    # Imported here: web.fight imports this module.
    from web.fight import Rejected

    return Rejected(code, message)


def get_shopkeeper_dialog(context: str, character_gold: int = 0) -> str:
    """Get a context-appropriate shopkeeper dialog line."""
    shopkeeper = get_shopkeeper()
    if context in shopkeeper:
        return random.choice(shopkeeper[context])
    if context == "buy":
        return random.choice(shopkeeper["buy_reactions"])
    elif context == "sell":
        return random.choice(shopkeeper["sell_reactions"])
    elif context == "low_gold" or character_gold <= 5:
        return random.choice(shopkeeper["low_gold"])
    elif context == "greeting":
        return random.choice(shopkeeper["greetings"])
    elif context == "farewell":
        return random.choice(shopkeeper["farewell"])
    else:
        return random.choice(shopkeeper["browse"])


def dialog(context: str) -> dict:
    """Elara's line for a context: {"context", "line"}. The one draw of random a view makes."""
    lines = get_shopkeeper()[DIALOG_LISTS.get(context, context)]
    return {"context": context, "line": random.choice(lines)}


def _default_stock() -> list:
    return [{**item, "quantity": 5} for item in get_default_shop_inventory()]


def _stock(session) -> list:
    """The wares as they stand, without storing anything."""
    return session.shop_inventory if session.shop_inventory is not None else _default_stock()


def get_shop_inventory(session):
    """Get shop inventory from session, initializing if needed."""
    if session.shop_inventory is None:
        session.shop_inventory = _default_stock()
    return session.shop_inventory


def restock_shop(session):
    """Reset all shop items to full stock (quantity 5) and clear haggle state."""
    session.shop_inventory = _default_stock()
    session.haggled_items = {}


def get_effective_price(base_price, item_index, haggle_state):
    """Get the effective price for an item after any haggle discount."""
    key = str(item_index)
    if key in haggle_state:
        discount = haggle_state[key]
        return max(1, int(base_price * (1 - discount / 100)))
    return base_price


def calculate_sell_price(item, shop_inventory):
    """Calculate sell price for an item (50% of buy price)."""
    for shop_item in shop_inventory:
        if item.name == shop_item["name"]:
            return max(1, shop_item["price"] // 2)

    if isinstance(item, HealingPotion):
        return max(1, item.healing_amount // 2)

    if isinstance(item, Weapon):
        all_weapons = get_all_weapons_flat()
        if item.name in all_weapons:
            return max(1, int(all_weapons[item.name].get("cost_gp", 1)) // 2)

    if isinstance(item, Armor):
        all_armors = get_all_armors_flat()
        if item.name in all_armors:
            return max(1, int(all_armors[item.name].get("cost_gp", 1)) // 2)

    return 1


def wares(session: GameSession) -> list:
    """What is on sale, with the price after a haggle."""
    haggle_state = session.haggled_items
    return [{
        "index": i,
        "name": item["name"],
        "description": item["description"],
        "healing": item["healing"],
        "quantity": item["quantity"],
        "original_price": item["price"],
        "effective_price": get_effective_price(item["price"], i, haggle_state),
        "haggled": str(i) in haggle_state,
        "discount": haggle_state.get(str(i), 0),
    } for i, item in enumerate(_stock(session))]


def sellable_items(session: GameSession) -> list:
    """What Elara buys: every backpack entry that is not a quest item, with its place in the backpack."""
    stock = _stock(session)
    return [{
        "index": i,
        "name": item.name,
        "description": item.description if hasattr(item, "description") else "",
        "sell_price": calculate_sell_price(item, stock),
    } for i, item in enumerate(session.character.inventory) if not isinstance(item, QuestItem)]


def active_quests(session: GameSession) -> list:
    """The quests taken, in the order they were taken, with their progress."""
    all_quests = get_quests()
    listed = []
    for quest_id, quest_state in session.active_quests.items():
        quest_def = all_quests.get(quest_id)
        if not quest_def:
            continue
        listed.append({
            "id": quest_id,
            **{key: quest_def[key] for key in QUEST_KEYS},
            "progress": quest_state["progress"],
            "progress_pct": min(100, int(quest_state["progress"] / quest_def["target_count"] * 100)),
            "status": quest_state["status"],
        })
    return listed


def available_quests(session: GameSession) -> list:
    """The quests of the acts reached so far that are neither taken nor done."""
    current_act = session.act.get("number", 1) if session.act else 1
    return [{
        "id": quest_id,
        **{key: quest_def[key] for key in QUEST_KEYS},
        "dialog_offer": quest_def["dialog_offer"],
    } for quest_id, quest_def in get_quests().items()
        if quest_def["act"] <= current_act
        and quest_id not in session.active_quests and quest_id not in session.completed_quests]


def slots_full(session: GameSession) -> bool:
    return len(session.active_quests) >= MAX_ACTIVE_QUESTS


def tracked_quests(session: GameSession) -> list:
    """The quests taken as the heads-up display follows them."""
    return [{key: quest[key] for key in
             ("id", "name", "type", "target_monster", "target_count", "progress", "status")}
            for quest in active_quests(session)]


def shop_view(session: GameSession, context: str = None) -> dict:
    """The shop for the 3D panel. Writes nothing; Elara's line is its only use of random."""
    gold = session.character.gold
    if context is None:
        context = "low_gold" if gold <= 5 else "greeting"
    keeper = get_shopkeeper()
    return {
        "keeper": {key: keeper[key] for key in ("name", "title", "portrait")},
        "dialog": dialog(context),
        "gold": gold,
        "wares": wares(session),
        "sell": sellable_items(session),
        "quests": {
            "available": available_quests(session),
            "active": active_quests(session),
            "slots_full": slots_full(session),
        },
    }


def _done(message, context: str, haggle_result=None) -> dict:
    return {"message": message, "context": context, "haggle": haggle_result}


def _ware_at(session, item_index: int) -> dict:
    stock = _stock(session)
    if not 0 <= item_index < len(stock):
        raise _rejected("no_such_item", "Invalid item selection.")
    return stock[item_index]


def buy(session: GameSession, item_index: int) -> dict:
    """Buy one of a ware at its price after a haggle."""
    item = _ware_at(session, item_index)
    price = get_effective_price(item["price"], item_index, session.haggled_items)
    if item["quantity"] <= 0:
        raise _rejected("out_of_stock", f"{item['name']} is out of stock!")
    character = session.character
    if character.gold < price:
        raise _rejected("not_enough_gold", f"Not enough gold! You need {price} gold.")

    item = get_shop_inventory(session)[item_index]
    character.gold -= price
    item["quantity"] -= 1
    character.add_item(HealingPotion(item["name"], item["healing"]))
    return _done(f"Purchased {item['name']} for {price} gold!", "buy")


def sell(session: GameSession, item_index: int) -> dict:
    """Sell one backpack entry. Quest items are not for sale."""
    character = session.character
    if not 0 <= item_index < len(character.inventory):
        raise _rejected("no_such_item", "Invalid item selection.")
    item = character.inventory[item_index]
    if isinstance(item, QuestItem):
        raise _rejected("not_sellable", "Elara does not buy quest items.")

    price = calculate_sell_price(item, _stock(session))
    character.gold += price
    character.inventory.pop(item_index)
    return _done(f"Sold {item.name} for {price} gold!", "sell")


def haggle(session: GameSession, item_index: int) -> dict:
    """A Persuasion check against the price of a ware, once per ware and restock."""
    item = _ware_at(session, item_index)
    key = str(item_index)
    if key in session.haggled_items:
        raise _rejected("already_haggled", "You've already haggled over this item!")

    result = make_skill_check(session.character, "Persuasion", difficulty_class=10)
    roll = result["roll"]
    total = result["total"]

    if roll == 20:
        discount, tier = 40, "nat20"
    elif total >= 20:
        discount, tier = 25, "great"
    elif total >= 16:
        discount, tier = 15, "good"
    elif total >= 12:
        discount, tier = 10, "okay"
    elif roll == 1:
        discount, tier = -25, "nat1"
    else:
        discount, tier = 0, "fail"

    session.haggled_items[key] = discount
    return _done(None, f"haggle_{tier}", {
        "roll": roll,
        "modifier": result["modifier"],
        "total": total,
        "discount": discount,
        "tier": tier,
        "item_name": item["name"],
        "original_price": item["price"],
        "new_price": get_effective_price(item["price"], item_index, session.haggled_items),
    })


def accept_quest(session: GameSession, quest_id: str) -> dict:
    """Take a quest from the board. The act is not checked: the board only lists what the act offers."""
    quest_def = get_quests().get(quest_id)
    if not quest_def:
        raise _rejected("no_such_quest", "Unknown quest.")
    if slots_full(session):
        raise _rejected("quest_slots_full", f"You can only have {MAX_ACTIVE_QUESTS} active quests!")
    if quest_id in session.active_quests or quest_id in session.completed_quests:
        raise _rejected("quest_taken", "Quest already accepted or completed.")

    session.active_quests[quest_id] = {"progress": 0, "status": "active"}
    return _done(f"Quest accepted: {quest_def['name']}", "quest_accept")


def turn_in_quest(session: GameSession, quest_id: str) -> dict:
    """Hand in a quest that is ready, for its gold and XP."""
    result = engine_turn_in_quest(
        quest_id, session.active_quests, session.completed_quests, get_quests(), session.character)
    if not result:
        raise _rejected("quest_not_ready", "Quest not ready for turn-in.")

    # Quest XP can level the character up: grant the new HP and refresh power points
    message = f"Quest complete: {result['quest_name']}! +{result['gold']} gold, +{result['xp']} XP"
    if result["level_ups"]:
        char = session.character
        char.current_hit_points = min(
            char.max_hit_points,
            char.current_hit_points + sum(lu["hp_increase"] for lu in result["level_ups"]))
        char.max_power_points = calculate_max_pp(
            char.class_name, char.level, get_primary_modifier(char))
        char.power_points = char.max_power_points
        message += f" — Level up! You are now level {char.level}."
    return _done(message, "quest_complete")


def abandon_quest(session: GameSession, quest_id: str) -> dict:
    """Drop an active quest, and what was gathered for it."""
    if quest_id not in session.active_quests:
        raise _rejected("quest_not_active", "Quest not found in your active quests.")
    quest_def = get_quests().get(quest_id)

    if quest_def and quest_def["type"] == "gather":
        session.character.inventory = [
            item for item in session.character.inventory
            if not (isinstance(item, QuestItem) and item.quest_id == quest_id)
        ]
    del session.active_quests[quest_id]
    return _done(f"Quest abandoned: {quest_def['name'] if quest_def else 'Unknown'}", "quest_abandon")
