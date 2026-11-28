import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, FOV_RANGE, KEY_LIST, SENSITIVITY_RANGE, SETTINGS_KEY, clampSettings, parseSettings, serializeSettings, settingsTurn,
  type Settings,
} from './settings';
import { MOUSE_SENSITIVITY, mouseTurn } from './world/walk';

describe('settings', () => {
  it('have their defaults and ranges', () => {
    expect(DEFAULT_SETTINGS).toEqual({ sensitivity: 1, invertY: false, fov: 70 });
    expect(SENSITIVITY_RANGE).toEqual({ min: 0.2, max: 3, step: 0.1 });
    expect(FOV_RANGE).toEqual({ min: 50, max: 100, step: 1 });
    expect(SETTINGS_KEY).toBe('aiv.settings');
  });

  it('are read from whatever is stored', () => {
    for (const raw of [null, '{', '[]', '7', 'null', '"x"', '']) expect(parseSettings(raw), String(raw)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":99,"invertY":true,"fov":10}')).toEqual({ sensitivity: 3, invertY: true, fov: 50 });
    expect(parseSettings('{"sensitivity":0,"fov":400}')).toEqual({ sensitivity: 0.2, invertY: false, fov: 100 });
    expect(parseSettings('{"sensitivity":"2","invertY":1,"fov":null}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"sensitivity":1e999,"invertY":true,"fov":85.5}')).toEqual({ sensitivity: 1, invertY: true, fov: 85.5 });
    expect(parseSettings('{"sensitivity":1.7}')).toEqual({ sensitivity: 1.7, invertY: false, fov: 70 });
  });

  it('come back as they were written', () => {
    const cases: Settings[] = [DEFAULT_SETTINGS, { sensitivity: 2.35, invertY: true, fov: 93 }, { sensitivity: -4, invertY: false, fov: 1000 }];
    for (const s of cases) {
      expect(parseSettings(serializeSettings(s))).toEqual(clampSettings(s));
      expect(Object.keys(JSON.parse(serializeSettings(s)))).toEqual(['sensitivity', 'invertY', 'fov']);
    }
    expect(clampSettings({ sensitivity: 1.2345, invertY: true, fov: 61.5 })).toEqual({ sensitivity: 1.2345, invertY: true, fov: 61.5 });
  });

  it('turn the view', () => {
    for (const [dx, dy] of [[0, 0], [12, -7], [-3, 40]]) {
      expect(settingsTurn(dx, dy, DEFAULT_SETTINGS)).toEqual(mouseTurn(dx, dy));
    }
    const fast = settingsTurn(10, 4, { sensitivity: 2.5, invertY: false, fov: 70 });
    expect(fast.dYaw).toBeCloseTo(-10 * MOUSE_SENSITIVITY * 2.5, 12);
    expect(fast.dPitch).toBeCloseTo(-4 * MOUSE_SENSITIVITY * 2.5, 12);
    const flipped = settingsTurn(10, 4, { sensitivity: 2.5, invertY: true, fov: 70 });
    expect(flipped.dYaw).toBe(fast.dYaw);
    expect(flipped.dPitch).toBe(-fast.dPitch);
  });

  it('list the keys', () => {
    expect(KEY_LIST).toEqual([
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
    ]);
  });
});
