// The sound settings: how they are kept in the browser, their limits and the gains they make. Pure.
// They are separate from the Settings of settings.ts and are stored under their own key.

export interface SoundSettings { effects: number; ambience: number; muted: boolean }

export const DEFAULT_SOUND: SoundSettings = { effects: 0.8, ambience: 0.5, muted: false };
export const VOLUME_RANGE = { min: 0, max: 1, step: 0.05 };
export const SOUND_KEY = 'aiv.sound'; // localStorage
export const AMBIENCE_LEVEL = 0.35; // ambience at full slider, against effects at full slider

const clamp = (value: number): number => Math.min(VOLUME_RANGE.max, Math.max(VOLUME_RANGE.min, value));

/** The sound settings in the stored text. Whatever cannot be read is the default, field by field. */
export function parseSound(raw: string | null): SoundSettings {
  let stored: unknown = null;
  try {
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    stored = null;
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return { ...DEFAULT_SOUND };
  const fields = stored as Record<string, unknown>;
  const volume = (value: unknown, fallback: number): number => clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    effects: volume(fields.effects, DEFAULT_SOUND.effects),
    ambience: volume(fields.ambience, DEFAULT_SOUND.ambience),
    muted: typeof fields.muted === 'boolean' ? fields.muted : false,
  };
}

export function serializeSound(s: SoundSettings): string {
  return JSON.stringify({ effects: clamp(s.effects), ambience: clamp(s.ambience), muted: s.muted });
}

export function toggleMute(s: SoundSettings): SoundSettings {
  return { effects: s.effects, ambience: s.ambience, muted: !s.muted };
}

/** The gains of the two master nodes: the sliders squared, so that the middle of a slider sounds half as loud. */
export function gains(s: SoundSettings): { effects: number; ambience: number } {
  if (s.muted) return { effects: 0, ambience: 0 };
  const e = clamp(s.effects);
  const a = clamp(s.ambience);
  return { effects: e * e, ambience: a * a * AMBIENCE_LEVEL };
}
