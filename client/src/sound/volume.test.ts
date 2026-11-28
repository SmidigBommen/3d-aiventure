import { describe, expect, it } from 'vitest';
import { AMBIENCE_LEVEL, DEFAULT_SOUND, SOUND_KEY, VOLUME_RANGE, gains, parseSound, serializeSound, toggleMute } from './volume';

describe('sound settings', () => {
  it('has the defaults', () => {
    expect(DEFAULT_SOUND).toEqual({ effects: 0.8, ambience: 0.5, muted: false });
    expect(VOLUME_RANGE).toEqual({ min: 0, max: 1, step: 0.05 });
    expect(SOUND_KEY).toBe('aiv.sound');
    expect(AMBIENCE_LEVEL).toBe(0.35);
  });

  it('reads what it can and takes the default for the rest', () => {
    for (const raw of [null, '{', '[]', '7', 'null', '', '"x"']) {
      const parsed = parseSound(raw);
      expect(parsed).toEqual(DEFAULT_SOUND);
      expect(parsed).not.toBe(DEFAULT_SOUND);
    }
    expect(parseSound('{"effects":9,"ambience":-1,"muted":true}')).toEqual({ effects: 1, ambience: 0, muted: true });
    expect(parseSound('{"effects":"loud","ambience":0.2,"muted":1}')).toEqual({ effects: 0.8, ambience: 0.2, muted: false });
    expect(parseSound('{"effects":0.3}')).toEqual({ effects: 0.3, ambience: 0.5, muted: false });
  });

  it('writes three keys in order and reads them back', () => {
    expect(serializeSound({ effects: 0.3, ambience: 0.2, muted: false })).toBe('{"effects":0.3,"ambience":0.2,"muted":false}');
    expect(parseSound(serializeSound({ effects: 2, ambience: -3, muted: true }))).toEqual({ effects: 1, ambience: 0, muted: true });
    for (const s of [DEFAULT_SOUND, { effects: 0.05, ambience: 0.95, muted: true }]) expect(parseSound(serializeSound(s))).toEqual(s);
  });

  it('makes the gains', () => {
    expect(gains({ effects: 1, ambience: 1, muted: true })).toEqual({ effects: 0, ambience: 0 });
    expect(gains(DEFAULT_SOUND).effects).toBeCloseTo(0.64, 12);
    expect(gains(DEFAULT_SOUND).ambience).toBeCloseTo(0.0875, 12);
    expect(gains({ effects: 1, ambience: 1, muted: false })).toEqual({ effects: 1, ambience: 0.35 });
    expect(gains({ effects: 5, ambience: -1, muted: false })).toEqual({ effects: 1, ambience: 0 });
  });

  it('toggles mute and nothing else', () => {
    const s = { effects: 0.3, ambience: 0.2, muted: false };
    expect(toggleMute(s)).toEqual({ effects: 0.3, ambience: 0.2, muted: true });
    expect(toggleMute(toggleMute(s))).toEqual(s);
    expect(s.muted).toBe(false);
  });
});
