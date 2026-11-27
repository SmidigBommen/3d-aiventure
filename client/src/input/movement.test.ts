import { describe, expect, it } from 'vitest';
import { moveStep } from './movement';

const none = { forward: false, back: false, left: false, right: false };

describe('moveStep', () => {
  it('stands still without keys', () => {
    expect(moveStep(none, 1.2, 4, 0.5)).toEqual({ x: 0, z: 0 });
  });

  it('walks down -z at yaw 0', () => {
    const d = moveStep({ ...none, forward: true }, 0, 4, 0.5);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-2);
  });

  it('strafes right along +x at yaw 0', () => {
    const d = moveStep({ ...none, right: true }, 0, 4, 0.5);
    expect(d.x).toBeCloseTo(2);
    expect(d.z).toBeCloseTo(0);
  });

  it('walks towards -x after a quarter turn left', () => {
    const d = moveStep({ ...none, forward: true }, Math.PI / 2, 4, 0.5);
    expect(d.x).toBeCloseTo(-2);
    expect(d.z).toBeCloseTo(0);
  });

  it('is no faster on a diagonal', () => {
    const d = moveStep({ ...none, forward: true, right: true }, 0.7, 4, 0.5);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(2);
  });

  it('cancels opposite keys', () => {
    expect(moveStep({ forward: true, back: true, left: true, right: true }, 0.3, 4, 1)).toEqual({ x: 0, z: 0 });
  });
});
