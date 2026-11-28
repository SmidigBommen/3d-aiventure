// The player's settings: how they are kept in the browser, their limits and what they do to mouse look. Pure.

import { MOUSE_SENSITIVITY } from './world/walk';

export interface Settings {
  sensitivity: number; // a multiplier of MOUSE_SENSITIVITY
  invertY: boolean;
  fov: number; // degrees, vertical
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, invertY: false, fov: 70 };
export const SENSITIVITY_RANGE = { min: 0.2, max: 3, step: 0.1 };
export const FOV_RANGE = { min: 50, max: 100, step: 1 };
export const SETTINGS_KEY = 'aiv.settings'; // localStorage

const clamp = (value: number, range: { min: number; max: number }): number => Math.min(range.max, Math.max(range.min, value));

export function clampSettings(s: Settings): Settings {
  return { sensitivity: clamp(s.sensitivity, SENSITIVITY_RANGE), invertY: s.invertY, fov: clamp(s.fov, FOV_RANGE) };
}

/** The settings in the stored text. Whatever cannot be read is the default, field by field. */
export function parseSettings(raw: string | null): Settings {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    stored = null;
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return { ...DEFAULT_SETTINGS };
  const fields = stored as Record<string, unknown>;
  const number = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return clampSettings({
    sensitivity: number(fields.sensitivity, DEFAULT_SETTINGS.sensitivity),
    invertY: typeof fields.invertY === 'boolean' ? fields.invertY : DEFAULT_SETTINGS.invertY,
    fov: number(fields.fov, DEFAULT_SETTINGS.fov),
  });
}

export function serializeSettings(s: Settings): string {
  const { sensitivity, invertY, fov } = clampSettings(s);
  return JSON.stringify({ sensitivity, invertY, fov });
}

/** The turn that mouse travel of (dx, dy) pixels asks for with these settings. */
export function settingsTurn(dx: number, dy: number, s: Settings): { dYaw: number; dPitch: number } {
  return { dYaw: -dx * MOUSE_SENSITIVITY * s.sensitivity, dPitch: (s.invertY ? dy : -dy) * MOUSE_SENSITIVITY * s.sensitivity };
}

/** The keys of the game, as the settings panel lists them. */
export const KEY_LIST: { keys: string; action: string }[] = [
  { keys: 'W A S D / arrows', action: 'Move' },
  { keys: 'Mouse', action: 'Look (click the view first)' },
  { keys: 'E', action: 'Interact' },
  { keys: 'I', action: 'Inventory' },
  { keys: 'C', action: 'Character' },
  { keys: 'J', action: 'Journal' },
  { keys: 'M / Esc', action: 'Menu' },
  { keys: 'A D F', action: 'Battle: attack, defend, flee' },
  { keys: '1-5', action: 'Battle: abilities' },
  { keys: 'Q W E R', action: 'Battle: items' },
  { keys: 'Enter / Space', action: 'Continue' },
];
