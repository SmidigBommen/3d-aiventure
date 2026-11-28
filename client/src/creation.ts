// Character creation as the client holds it until the last step: the choices, which step is complete,
// and the lines of the opening. Pure. Every score, hit point and armour class comes from the server.

export interface RaceEntry {
  name: string;
  bonuses: Record<string, number>;
  bonus_display: string;
}

export interface ClassAbility { id: string; name: string; unlock_level: number; cost: number; description: string }
export interface ClassWeapon { name: string; damage_die: number; damage_type: string; category: string; properties: string[]; description: string }
export interface ClassArmor { name: string; base_ac: number; category: string; weight: number; stealth_disadvantage: boolean }

export interface ClassEntry {
  name: string;
  playstyle: string;
  hit_die: number;
  primary_ability: string;
  ability_bonuses: Record<string, number>;
  saving_throws: string[];
  armor_training: string[];
  weapon_proficiencies: string[];
  num_skills: number;
  skill_choices: string[];
  abilities: ClassAbility[];
  weapons: ClassWeapon[];
  armors: ClassArmor[];
}

export interface Portrait { id: string; label: string; path: string }

export interface Opening {
  campaign: { title: string; description: string };
  act: { number: number; title: string; description: string; main_quest: string };
}

export interface CreationView {
  races: RaceEntry[];
  classes: ClassEntry[];
  portraits: Portrait[];
  name_max: number;
  opening: Opening;
}

export interface PreviewView {
  race: string;
  class_name: string;
  scores: { name: string; score: number; modifier: number; primary: boolean }[];
  hit_points: number;
  power_points: number;
  unarmored_ac: number;
  starting_abilities: string[];
  armors: { name: string; total_ac: number }[];
}

export const CREATION_STEPS = ['race', 'class', 'skills', 'name', 'weapon', 'armour', 'portrait', 'summary'] as const;
export type CreationStep = typeof CREATION_STEPS[number];

/** What the player has chosen so far. `armor: null` is no armour; `portrait` is a portrait's `path`. */
export interface Choices {
  race: string | null;
  class_name: string | null;
  skills: string[];
  name: string;
  weapon: string | null;
  armor: string | null;
  portrait: string | null;
}

export function emptyChoices(): Choices {
  return { race: null, class_name: null, skills: [], name: '', weapon: null, armor: null, portrait: null };
}

/** The class the choices name, when the view has it. */
export function classOf(choices: Choices, view: CreationView): ClassEntry | null {
  return view.classes.find((entry) => entry.name === choices.class_name) ?? null;
}

export function chooseRace(choices: Choices, race: string): Choices {
  return { ...choices, skills: [...choices.skills], race };
}

/** Another class keeps the skills, the weapon and the armour it allows too, and drops the others. */
export function chooseClass(choices: Choices, view: CreationView, class_name: string): Choices {
  const next = view.classes.find((entry) => entry.name === class_name);
  if (!next) return { ...choices, skills: [], class_name, weapon: null, armor: null };
  return {
    ...choices,
    class_name,
    skills: choices.skills.filter((skill) => next.skill_choices.includes(skill)).slice(0, next.num_skills),
    weapon: next.weapons.some((weapon) => weapon.name === choices.weapon) ? choices.weapon : null,
    armor: next.armors.some((armor) => armor.name === choices.armor) ? choices.armor : null,
  };
}

/** Takes a chosen skill away, or adds one the class offers while there is room. */
export function toggleSkill(choices: Choices, view: CreationView, skill: string): Choices {
  const chosen = classOf(choices, view);
  const same = { ...choices, skills: [...choices.skills] };
  if (!chosen) return same;
  if (choices.skills.includes(skill)) return { ...choices, skills: choices.skills.filter((other) => other !== skill) };
  if (!chosen.skill_choices.includes(skill) || choices.skills.length >= chosen.num_skills) return same;
  return { ...choices, skills: [...choices.skills, skill] };
}

export function stepComplete(step: CreationStep, choices: Choices, view: CreationView): boolean {
  const chosen = classOf(choices, view);
  switch (step) {
    case 'race':
      return view.races.some((race) => race.name === choices.race);
    case 'class':
    case 'skills':
      return chosen !== null;
    case 'name': {
      const length = choices.name.trim().length;
      return length >= 1 && length <= view.name_max && choices.name.length <= view.name_max;
    }
    case 'weapon':
      return chosen !== null && chosen.weapons.some((weapon) => weapon.name === choices.weapon);
    case 'armour':
      return chosen !== null && (choices.armor === null || chosen.armors.some((armor) => armor.name === choices.armor));
    case 'portrait':
      return view.portraits.some((portrait) => portrait.path === choices.portrait);
    case 'summary':
      return CREATION_STEPS.every((other) => other === 'summary' || stepComplete(other, choices, view));
  }
}

/** The step after a complete one; an incomplete step and the summary stay. */
export function nextStep(step: CreationStep, choices: Choices, view: CreationView): CreationStep {
  const index = CREATION_STEPS.indexOf(step);
  if (step === 'summary' || !stepComplete(step, choices, view)) return step;
  return CREATION_STEPS[index + 1];
}

/** The step before, or null on the first one: from there Back leaves creation. */
export function prevStep(step: CreationStep): CreationStep | null {
  const index = CREATION_STEPS.indexOf(step);
  return index > 0 ? CREATION_STEPS[index - 1] : null;
}

export interface NewGameBody {
  race: string | null;
  class_name: string | null;
  name: string;
  weapon: string | null;
  armor: string | null;
  portrait: string | null;
  skills: string[];
}

/** The body of POST /api/new-game. */
export function requestBody(choices: Choices): NewGameBody {
  return {
    race: choices.race,
    class_name: choices.class_name,
    name: choices.name.trim(),
    weapon: choices.weapon,
    armor: choices.armor ?? null,
    portrait: choices.portrait,
    skills: [...choices.skills],
  };
}

/** The armour class the preview gives for the armour chosen. */
export function acFor(preview: PreviewView, armor: string | null): number {
  if (armor === null) return preview.unarmored_ac;
  return preview.armors.find((entry) => entry.name === armor)?.total_ac ?? preview.unarmored_ac;
}

export function openingLines(opening: Opening): { heading: string; act: string; paragraphs: string[]; quest: string } {
  return {
    heading: opening.campaign.title,
    act: `Act ${opening.act.number}: ${opening.act.title}`,
    paragraphs: [opening.campaign.description, opening.act.description],
    quest: `Your quest: ${opening.act.main_quest}`,
  };
}
