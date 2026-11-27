// First-person movement on the ground plane. Pure, so it can be tested without a browser.
// Axes follow Three.js: x to the right, z towards the viewer; yaw 0 looks down -z and
// a positive yaw turns left.

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Displacement for one step of `dt` seconds at `speed` metres per second. Diagonals are not faster. */
export function moveStep(keys: MoveKeys, yaw: number, speed: number, dt: number): Vec2 {
  const ahead = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const len = Math.hypot(ahead, side);
  if (len === 0) return { x: 0, z: 0 };
  const a = ahead / len;
  const s = side / len;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const d = speed * dt;
  const x = (-sin * a + cos * s) * d;
  const z = (-cos * a - sin * s) * d;
  return { x: x === 0 ? 0 : x, z: z === 0 ? 0 : z };
}
