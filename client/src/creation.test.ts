import { describe, expect, it } from 'vitest';
import {
  CREATION_STEPS, acFor, chooseClass, chooseRace, emptyChoices, nextStep, openingLines, prevStep, requestBody, stepComplete, toggleSkill,
  type Choices, type ClassEntry, type CreationStep, type CreationView, type PreviewView,
} from './creation';

const cls = (over: Partial<ClassEntry>): ClassEntry => ({
  name: 'Fighter', playstyle: 'Hits things.', hit_die: 10, primary_ability: 'strength', ability_bonuses: { strength: 4, constitution: 2 },
  saving_throws: ['strength', 'constitution'], armor_training: ['Light', 'Heavy'], weapon_proficiencies: ['Simple', 'Martial'],
  num_skills: 2, skill_choices: ['Athletics', 'History', 'Perception'],
  abilities: [{ id: 'second_wind', name: 'Second Wind', unlock_level: 1, cost: 1, description: 'Heals.' }],
  weapons: [
    { name: 'Dagger', damage_die: 4, damage_type: 'piercing', category: 'Simple', properties: ['finesse'], description: '' },
    { name: 'Longsword', damage_die: 8, damage_type: 'slashing', category: 'Martial', properties: [], description: '' },
  ],
  armors: [
    { name: 'Leather', base_ac: 11, category: 'Light', weight: 10, stealth_disadvantage: false },
    { name: 'Chain Mail', base_ac: 16, category: 'Heavy', weight: 55, stealth_disadvantage: true },
  ],
  ...over,
});

const VIEW: CreationView = {
  races: [
    { name: 'Human', bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 }, bonus_display: '+1 STR' },
    { name: 'Dwarf', bonuses: { strength: 0, dexterity: 0, constitution: 2, intelligence: 0, wisdom: 0, charisma: 0 }, bonus_display: '+2 CON' },
  ],
  classes: [
    cls({}),
    cls({
      name: 'Wizard', num_skills: 1, skill_choices: ['Arcana', 'History'],
      weapons: [{ name: 'Dagger', damage_die: 4, damage_type: 'piercing', category: 'Simple', properties: ['finesse'], description: '' }],
      armors: [],
    }),
  ],
  portraits: [
    { id: 'knight', label: 'Knight', path: '/static/images/player_fighter.png' },
    { id: 'wizard', label: 'Wizard', path: '/static/images/player_wizard.png' },
  ],
  name_max: 30,
  opening: {
    campaign: { title: 'The Shattered Crown', description: 'A realm breaks.' },
    act: { number: 1, title: 'The Awakening', description: 'It begins.', main_quest: 'Find the truth' },
  },
};

const FULL: Choices = {
  race: 'Human', class_name: 'Fighter', skills: ['Perception', 'History'], name: '  Smoke ', weapon: 'Longsword', armor: 'Chain Mail',
  portrait: '/static/images/player_fighter.png',
};
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
frozen(VIEW);
frozen(FULL);

describe('the steps', () => {
  it('are eight, in order', () => {
    expect(CREATION_STEPS).toEqual(['race', 'class', 'skills', 'name', 'weapon', 'armour', 'portrait', 'summary']);
  });

  it('are complete only with a valid choice', () => {
    const none = emptyChoices();
    expect(none).toEqual({ race: null, class_name: null, skills: [], name: '', weapon: null, armor: null, portrait: null });
    for (const step of CREATION_STEPS) expect(stepComplete(step, none, VIEW), step).toBe(false);
    for (const step of CREATION_STEPS) expect(stepComplete(step, FULL, VIEW), step).toBe(true);
    expect(stepComplete('race', { ...FULL, race: 'Martian' }, VIEW)).toBe(false);
    expect(stepComplete('class', { ...FULL, class_name: 'Plumber' }, VIEW)).toBe(false);
    expect(stepComplete('skills', { ...FULL, skills: [] }, VIEW)).toBe(true);
    expect(stepComplete('skills', { ...FULL, class_name: null }, VIEW)).toBe(false);
    expect(stepComplete('name', { ...FULL, name: '   ' }, VIEW)).toBe(false);
    expect(stepComplete('name', { ...FULL, name: 'x'.repeat(30) }, VIEW)).toBe(true);
    expect(stepComplete('name', { ...FULL, name: 'x'.repeat(31) }, VIEW)).toBe(false);
    expect(stepComplete('name', { ...FULL, name: ` ${'x'.repeat(30)}` }, VIEW)).toBe(false);
    expect(stepComplete('weapon', { ...FULL, class_name: 'Wizard' }, VIEW)).toBe(false);
    expect(stepComplete('armour', { ...FULL, armor: null }, VIEW)).toBe(true);
    expect(stepComplete('armour', { ...FULL, armor: null, class_name: null }, VIEW)).toBe(false);
    expect(stepComplete('armour', { ...FULL, class_name: 'Wizard' }, VIEW)).toBe(false);
    expect(stepComplete('portrait', { ...FULL, portrait: '/nobody.png' }, VIEW)).toBe(false);
    expect(stepComplete('summary', { ...FULL, weapon: null }, VIEW)).toBe(false);
  });

  it('go forward only from a complete step, and back to null', () => {
    expect(nextStep('race', emptyChoices(), VIEW)).toBe('race');
    expect(nextStep('race', FULL, VIEW)).toBe('class');
    expect(nextStep('weapon', { ...FULL, weapon: 'Banana' }, VIEW)).toBe('weapon');
    expect(nextStep('summary', FULL, VIEW)).toBe('summary');
    expect(prevStep('race')).toBeNull();
    expect(prevStep('class')).toBe('race');
    expect(prevStep('summary')).toBe('portrait');
  });

  it('keep every choice on the way there and back', () => {
    const before = JSON.stringify(FULL);
    let step: CreationStep = 'race';
    for (let i = 0; i < 10; i++) step = nextStep(step, FULL, VIEW);
    expect(step).toBe('summary');
    for (let back = prevStep(step); back !== null; back = prevStep(step)) step = back;
    expect(step).toBe('race');
    for (let i = 0; i < 7; i++) step = nextStep(step, FULL, VIEW);
    expect(step).toBe('summary');
    expect(JSON.stringify(FULL)).toBe(before);
  });
});

describe('choosing', () => {
  it('sets the race and keeps the rest', () => {
    expect(chooseRace(FULL, 'Dwarf')).toEqual({ ...FULL, race: 'Dwarf' });
  });

  it('keeps what the new class allows and drops the rest', () => {
    expect(chooseClass(FULL, VIEW, 'Fighter')).toEqual(FULL);
    expect(chooseClass(FULL, VIEW, 'Wizard')).toEqual({ ...FULL, class_name: 'Wizard', skills: ['History'], weapon: null, armor: null });
    const light: Choices = { ...FULL, skills: ['History', 'Athletics'], weapon: 'Dagger', armor: null };
    expect(chooseClass(light, VIEW, 'Wizard')).toEqual({ ...light, class_name: 'Wizard', skills: ['History'] });
    const two: CreationView = { ...VIEW, classes: [VIEW.classes[0], { ...VIEW.classes[1], skill_choices: ['History', 'Perception', 'Arcana'] }] };
    expect(chooseClass(FULL, two, 'Wizard').skills).toEqual(['Perception']);
  });

  it('toggles skills within the class list and the maximum', () => {
    const one = { ...FULL, skills: ['History'] };
    expect(toggleSkill(one, VIEW, 'Athletics').skills).toEqual(['History', 'Athletics']);
    expect(toggleSkill(one, VIEW, 'History').skills).toEqual([]);
    expect(toggleSkill(one, VIEW, 'Arcana')).toEqual(one);
    expect(toggleSkill(FULL, VIEW, 'Athletics')).toEqual(FULL);
    expect(toggleSkill({ ...one, class_name: null }, VIEW, 'Athletics')).toEqual({ ...one, class_name: null });
    let choices: Choices = { ...FULL, skills: [] };
    for (const skill of ['Athletics', 'Arcana', 'History', 'Perception', 'Stealth']) choices = toggleSkill(choices, VIEW, skill);
    expect(choices.skills).toEqual(['Athletics', 'History']);
  });
});

describe('what is sent and shown', () => {
  it('builds the body of the new game', () => {
    const body = requestBody(FULL);
    expect(body).toEqual({
      race: 'Human', class_name: 'Fighter', name: 'Smoke', weapon: 'Longsword', armor: 'Chain Mail',
      portrait: '/static/images/player_fighter.png', skills: ['Perception', 'History'],
    });
    expect(body.skills).not.toBe(FULL.skills);
    expect(requestBody({ ...FULL, armor: null }).armor).toBeNull();
    expect(Object.keys(body).sort()).toEqual(['armor', 'class_name', 'name', 'portrait', 'race', 'skills', 'weapon']);
  });

  it('reads the armour class from the preview', () => {
    const preview: PreviewView = {
      race: 'Human', class_name: 'Fighter', scores: [], hit_points: 12, power_points: 2, unarmored_ac: 11, starting_abilities: [],
      armors: [{ name: 'Leather', total_ac: 12 }, { name: 'Chain Mail', total_ac: 16 }],
    };
    expect(acFor(preview, null)).toBe(11);
    expect(acFor(preview, 'Chain Mail')).toBe(16);
    expect(acFor(preview, 'Tinfoil')).toBe(11);
  });

  it('writes the opening', () => {
    expect(openingLines(VIEW.opening)).toEqual({
      heading: 'The Shattered Crown', act: 'Act 1: The Awakening', paragraphs: ['A realm breaks.', 'It begins.'], quest: 'Your quest: Find the truth',
    });
  });
});
