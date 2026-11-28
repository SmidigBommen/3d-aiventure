import sys
from pathlib import Path
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web.game_session import get_session, save_session, get_races, get_classes
from web import creation, sheet
from web.fight import Rejected
from web.dependencies import require_character

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent.parent / "templates")


@router.get("/new", response_class=HTMLResponse)
async def new_character(request: Request):
    """Start character creation - show race selection."""
    # Reset character creation state
    session = get_session(request)
    session.character_creation.race = None
    session.character_creation.class_name = None
    session.character_creation.name = None
    session.character_creation.weapon = None
    session.character_creation.armor = None
    session.character_creation.skills = []
    session.character = None
    save_session(request, session)

    races = get_races()

    race_list = [
        {"name": race_name, "bonuses": bonuses, "bonus_display": creation.bonus_display(bonuses)}
        for race_name, bonuses in races.items()
    ]

    return templates.TemplateResponse(request, "character/select_race.html", {
        "request": request,
        "title": "Choose Your Race",
        "races": race_list
    })


@router.post("/race")
async def select_race(request: Request, race: str = Form(...)):
    """Process race selection."""
    session = get_session(request)
    races = get_races()

    if race not in races:
        return RedirectResponse("/character/new", status_code=303)

    session.character_creation.race = race
    save_session(request, session)

    return RedirectResponse("/character/class", status_code=303)


@router.get("/class", response_class=HTMLResponse)
async def select_class_page(request: Request):
    """Show class selection page."""
    session = get_session(request)

    if not session.character_creation.race:
        return RedirectResponse("/character/new", status_code=303)

    classes = get_classes()

    # Format class data for display
    class_list = []
    for class_name, props in classes.items():
        class_list.append({
            "name": class_name,
            "playstyle": props.get("playstyle", ""),
            "abilities": creation.class_abilities(class_name),
            "hit_die": props["hit_die"],
            "primary_ability": props["primary_ability"],
            "ability_bonuses": ", ".join(
                f"+{bonus} {ability[:3].upper()}"
                for ability, bonus in props.get("ability_bonuses", {}).items()),
            "saving_throws": ", ".join(props["saving_throw_proficiencies"]),
            "num_skills": props["num_skill_choices"],
            "armor": ", ".join(props["armor_training"]) if props["armor_training"] else "None",
            "weapons": ", ".join(props["weapon_proficiencies"][:3]) + ("..." if len(props["weapon_proficiencies"]) > 3 else "")
        })

    return templates.TemplateResponse(request, "character/select_class.html", {
        "request": request,
        "title": "Choose Your Class",
        "race": session.character_creation.race,
        "classes": class_list
    })


@router.post("/class")
async def select_class(request: Request, class_name: str = Form(...)):
    """Process class selection."""
    session = get_session(request)
    classes = get_classes()

    if class_name not in classes:
        return RedirectResponse("/character/class", status_code=303)

    session.character_creation.class_name = class_name
    save_session(request, session)

    return RedirectResponse("/character/details", status_code=303)


@router.get("/details", response_class=HTMLResponse)
async def details_page(request: Request):
    """Show name and weapon selection page."""
    session = get_session(request)

    if not session.character_creation.race or not session.character_creation.class_name:
        return RedirectResponse("/character/new", status_code=303)

    race = session.character_creation.race
    class_name = session.character_creation.class_name
    class_props = get_classes()[class_name]

    # What the finished character will look like (scores do not depend on the choices below)
    preview = creation.preview(race, class_name)
    total_ac = {armor["name"]: armor["total_ac"] for armor in preview["armors"]}

    return templates.TemplateResponse(request, "character/details.html", {
        "request": request,
        "title": "Character Details",
        "race": race,
        "class_name": class_name,
        "weapons": [
            {**weapon, "properties": ", ".join(weapon["properties"]) or "None"}
            for weapon in creation.weapon_entries(class_name)
        ],
        "armors": [
            {**armor, "total_ac": total_ac[armor["name"]]}
            for armor in creation.armor_entries(class_name)
        ],
        "preview": preview,
        "skill_choices": class_props["skill_proficiency_choices"],
        "num_skills": class_props["num_skill_choices"],
    })


@router.post("/create")
async def create_character(
    request: Request,
    name: str = Form(...),
    weapon: str = Form(...),
    armor: str = Form(default=""),
    portrait: str = Form(default="/static/images/player_fighter.png"),
    skills: list = Form(default=[])
):
    """Finalize character creation."""
    session = get_session(request)

    if not session.character_creation.race or not session.character_creation.class_name:
        return RedirectResponse("/character/new", status_code=303)

    if isinstance(skills, str):
        skills = [skills]
    try:
        creation.create(session, session.character_creation.race, session.character_creation.class_name,
                        name, weapon, armor, portrait, skills)
    except Rejected:
        return RedirectResponse("/character/details", status_code=303)

    save_session(request, session)

    return RedirectResponse("/character/summary", status_code=303)


@router.get("/summary", response_class=HTMLResponse)
async def character_summary(request: Request):
    """Display created character summary."""
    session = get_session(request)

    if not session.character:
        return RedirectResponse("/character/new", status_code=303)

    char_data = session.serialize_character()
    class_props = get_classes().get(char_data["class_name"], {})

    return templates.TemplateResponse(request, "character/summary.html", {
        "request": request,
        "title": f"{char_data['name']} - Character Summary",
        "character": char_data,
        "abilities": ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"],
        "primary_ability": sheet.primary_ability(class_props),
        "unarmored_defense": sheet.unarmored_defense(class_props),
        "improve_message": session.pop_flash("improve_message"),
        "is_new": char_data["level"] == 1 and char_data["xp"] == 0,
    })


@router.post("/improve")
async def improve(request: Request, ability: str = Form(...), session=Depends(require_character)):
    """Spend one Ability Score Improvement point."""
    try:
        session.set_flash("improve_message", sheet.improve(session, ability))
    except Rejected:
        pass
    save_session(request, session)
    return RedirectResponse("/character/summary", status_code=303)
