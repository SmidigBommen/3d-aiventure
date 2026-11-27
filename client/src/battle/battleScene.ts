import * as THREE from 'three';
import type { Vec2 } from '../input/movement';
import { standModel, type Look } from '../world/contentScene';
import { creatureMotion, type ClipSlot, type Motion } from '../world/contents';
import { EYE_HEIGHT } from '../world/layout';
import type { Figure } from '../world/modelLoader';
import { fxLook, type FxLook, type FxPattern } from './fx';
import type { Anim, Cue, Side } from './timeline';

// Draws a fight: the monster on its slot with its clips (or the fallback motions of contents.ts),
// the effects on it, what flies between the two, and how the player's eye moves. It runs the cues
// it is given; which cue comes when is decided in timeline.ts, what a key looks like in fx.ts.

const PARTICLES = 48;
const FX_SECONDS = 0.6;
const FLIGHT_SECONDS = 0.15;
const SINK_DEPTH = 1.5; // m
const FALLEN_EYE = 0.4; // m above the floor

export interface EyeOffset { forward: number; side: number; up: number; roll: number }

export interface BattleScene {
  group: THREE.Group;
  /** Runs an `anim` or `fx` cue. Banners, floating texts and bars belong to the panel. */
  run: (cue: Cue) => void;
  /** Shows the end of a fight without playing it: who lies on the ground. */
  settle: (fallen: Side | null) => void;
  update: (dt: number) => void;
  /** How far what plays now moves the player's eye from the battle stance. */
  eye: () => EyeOffset;
  /** A point above the monster's head, for what floats there. */
  head: () => THREE.Vector3;
  dispose: () => void;
}

type MoveKind = Motion | 'dodge';
interface Move { kind: MoveKind; t: number; d: number }

let dot: THREE.CanvasTexture | null = null;
/** A soft round dot, shared by every particle. */
function dotTexture(): THREE.CanvasTexture {
  if (dot) return dot;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const fade = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(canvas);
  return dot;
}

/**
 * Where particle `i` of `n` is at life fraction `t`, around the middle of a target `r` wide and `h`
 * tall; x sideways, y up, z towards the one looking at it. `a`, `b`, `c` are the particle's own numbers in 0..1.
 */
function place(pattern: FxPattern, i: number, n: number, t: number, r: number, h: number, a: number, b: number, c: number): [number, number, number] {
  const f = i / n;
  const turn = f * Math.PI * 2;
  const theta = a * Math.PI * 2;
  const lift = b * 2 - 1;
  const flat = Math.sqrt(1 - lift * lift);
  const dir: [number, number, number] = [Math.cos(theta) * flat, lift, Math.sin(theta) * flat];
  const spread = (v: number, width: number): number => (v - 0.5) * r * width;
  switch (pattern) {
    case 'slash': {
      const s = (f * 2 - 1) * (0.3 + t);
      return [s * r * 1.4 + spread(a, 0.1), -s * r * 1.1 + spread(b, 0.1), 0.35];
    }
    case 'spikes': {
      const angle = ((i % 3) * 2 * Math.PI) / 3 + 0.5;
      const along = (1 - t) * r * 1.8 * (0.25 + a);
      return [Math.cos(angle) * along, Math.sin(angle) * along, 0.35];
    }
    case 'thud': {
      const rad = r * (0.2 + 1.5 * t);
      return [Math.cos(turn) * rad, (b - 0.5) * 0.3 * h * (1 - t), Math.sin(turn) * rad];
    }
    case 'flame': {
      const narrow = 1 - 0.6 * t;
      return [spread(a, 1.3) * narrow + Math.sin(t * 20 + i) * 0.05, -h * 0.45 + t * (0.5 + c) * h, spread(b, 1.3) * narrow];
    }
    case 'shards':
      return [dir[0] * r * 1.7 * t, dir[1] * r * 1.7 * t - 1.6 * t * t, dir[2] * r * 1.7 * t];
    case 'bolt': {
      const jag = ((i * 7 + Math.floor(t * 8) * 3) % 5) / 4 - 0.5;
      return [jag * r * 0.7, (0.5 - f) * h * 1.7, 0.35];
    }
    case 'drip':
      return [spread(a, 1.4), h * 0.35 * c - t * t * h * 0.9 - t * 0.1, spread(b, 1.4)];
    case 'burst': {
      const out = r * (0.2 + 1.8 * t ** 0.6);
      return [dir[0] * out, dir[1] * out, dir[2] * out];
    }
    case 'ring': {
      const rad = r * (0.3 + 1.5 * t);
      return [Math.cos(turn) * rad, Math.sin(turn) * rad, 0.35];
    }
    case 'implode': {
      const out = r * 1.9 * (1 - t);
      return [dir[0] * out, dir[1] * out, dir[2] * out];
    }
    case 'spiral': {
      const angle = f * Math.PI * 4 + t * 5;
      return [Math.cos(angle) * r * 0.9, -h * 0.45 + (f * 0.4 + t * 0.8) * h, Math.sin(angle) * r * 0.9];
    }
    case 'wave': {
      const rad = r * (0.3 + 2.3 * t);
      return [Math.cos(turn) * rad, (i % 2 ? 0.25 : -0.25) * h, Math.sin(turn) * rad];
    }
    case 'rise':
      return [spread(a, 1.6), -h * 0.45 + t * (0.5 + c * 0.6) * h, spread(b, 1.6)];
    case 'fall':
      return [spread(a, 1.6), h * 0.6 - t * (0.5 + c * 0.6) * h, spread(b, 1.6)];
    case 'dome': {
      const out = r * 1.5 * (0.9 + 0.2 * t);
      return [dir[0] * out, dir[1] * out, Math.abs(dir[2]) * out];
    }
    case 'orbit': {
      const angle = turn + t * 8;
      return [Math.cos(angle) * r * 0.7, h * 0.5 + 0.1, Math.sin(angle) * r * 0.7];
    }
  }
}

export function buildBattleScene(look: Look, figure: Figure | null, slot: Vec2, stance: Vec2): BattleScene {
  const group = new THREE.Group();
  const standing = standModel(look, figure);
  const base = new THREE.Vector3(slot.x, 0, slot.z);
  const towards = new THREE.Vector3(stance.x - slot.x, 0, stance.z - slot.z).normalize();
  const sideways = new THREE.Vector3(towards.z, 0, -towards.x);
  const facing = Math.atan2(towards.x, towards.z);
  standing.root.position.copy(base);
  standing.root.rotation.y = facing;
  group.add(standing.root);
  const height = Math.max(standing.top, 0.6);
  const width = Math.max(0.45, height * 0.3);
  const chest = (): THREE.Vector3 => new THREE.Vector3(slot.x, height * 0.55, slot.z);
  const eyePoint = new THREE.Vector3(stance.x, EYE_HEIGHT - 0.3, stance.z);
  const opacities = standing.materials.map((material) => material.opacity);

  // --- the monster's clips, by the names of contents.ts; a missing one falls back to a motion ---
  const mixer = standing.body && standing.clips.length ? new THREE.AnimationMixer(standing.body) : null;
  const actions: Partial<Record<ClipSlot, THREE.AnimationAction>> = {};
  if (mixer) {
    for (const part of ['idle', 'attack', 'hurt', 'death'] as const) {
      const how = creatureMotion(look.model, part);
      const clip = 'clip' in how ? standing.clips.find((candidate) => candidate.name === how.clip) : undefined;
      if (clip) actions[part] = mixer.clipAction(clip);
    }
    actions.idle?.play();
    mixer.update(0);
    mixer.addEventListener('finished', (event) => {
      if (event.action === actions.death) return; // held on the last frame
      event.action.stop();
      actions.idle?.reset().play();
    });
  }
  const fallback = (part: ClipSlot): Motion => (creatureMotion('', part) as { motion: Motion }).motion;

  let move: Move | null = null; // the monster's motion that is not a clip
  let sunk = false;
  let eyeMove: { anim: Anim; t: number; d: number } | null = null;
  let fallen = false; // the player lies on the ground

  const once = (part: 'attack' | 'hurt' | 'death', seconds: number): void => {
    const action = actions[part];
    if (!mixer || !action) {
      move = { kind: fallback(part), t: 0, d: part === 'death' ? Math.max(seconds, 0.5) : part === 'hurt' ? 0.3 : Math.max(seconds, 0.35) };
      return;
    }
    mixer.stopAllAction();
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setDuration(Math.min(action.getClip().duration, seconds));
    action.play();
  };

  // --- effects ------------------------------------------------------------------------------------
  interface Burst { points: THREE.Points; look: FxLook; t: number; seeds: Float32Array; r: number; h: number }
  interface Flight { ball: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; then: () => void }
  const bursts: Burst[] = [];
  const flights: Flight[] = [];
  const ballGeometry = new THREE.SphereGeometry(0.12, 10, 8);

  const drawBurst = (burst: Burst): void => {
    const positions = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const life = Math.min(burst.t / FX_SECONDS, 1);
    for (let i = 0; i < PARTICLES; i++) {
      const [x, y, z] = place(burst.look.pattern, i, PARTICLES, life, burst.r, burst.h, burst.seeds[i * 3], burst.seeds[i * 3 + 1], burst.seeds[i * 3 + 2]);
      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;
    (burst.points.material as THREE.PointsMaterial).opacity = 1 - life * life;
  };

  /** The particles of an effect around `centre`, turned so that their front faces `yaw`. */
  const burst = (key: FxLook, centre: THREE.Vector3, yaw: number, r: number, h: number): void => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    const material = new THREE.PointsMaterial({
      color: key.color, size: 0.16, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(centre);
    points.rotation.y = yaw;
    points.frustumCulled = false;
    const seeds = new Float32Array(PARTICLES * 3).map(() => Math.random());
    const made: Burst = { points, look: key, t: 0, seeds, r, h };
    drawBurst(made);
    bursts.push(made);
    group.add(points);
  };

  const fly = (key: FxLook, from: THREE.Vector3, to: THREE.Vector3, then: () => void): void => {
    const ball = new THREE.Mesh(ballGeometry, new THREE.MeshBasicMaterial({ color: key.color, fog: false }));
    ball.position.copy(from);
    group.add(ball);
    flights.push({ ball, from, to, t: 0, then });
  };

  const effect = (key: FxLook, side: Side, source: Side | null): void => {
    if (side === 'monster') {
      const land = (): void => burst(key, chest(), facing, width, height);
      if (source === 'player') fly(key, eyePoint.clone(), chest(), land);
      else land();
    } else if (source === 'monster') {
      // What hits the player is drawn on the screen by the panel; here it only flies at them.
      fly(key, chest(), eyePoint.clone(), () => {});
    }
  };

  const setSunk = (amount: number): void => {
    standing.root.position.y = -SINK_DEPTH * amount;
    standing.materials.forEach((material, i) => {
      material.transparent = true;
      material.opacity = opacities[i] * (1 - amount);
    });
    standing.root.visible = amount < 1;
  };

  return {
    group,
    run(cue) {
      if (cue.type === 'fx') {
        effect(fxLook(cue.fx), cue.side, cue.source);
        return;
      }
      if (cue.type !== 'anim') return;
      if (cue.side === 'player') {
        eyeMove = { anim: cue.anim, t: 0, d: cue.anim === 'hurt' ? 0.3 : Math.max(cue.d, 0.3) };
        return;
      }
      if (cue.anim === 'dodge') move = { kind: 'dodge', t: 0, d: Math.max(cue.d, 0.25) };
      else if (cue.anim === 'hurt') once('hurt', 0.45);
      else if (cue.anim === 'death') once('death', Math.max(cue.d, 0.5));
      else once('attack', 0.6);
    },
    settle(who) {
      if (who === 'player') {
        fallen = true;
        eyeMove = null;
      }
      if (who !== 'monster') return;
      const death = actions.death;
      if (mixer && death) {
        mixer.stopAllAction();
        death.reset();
        death.setLoop(THREE.LoopOnce, 1);
        death.clampWhenFinished = true;
        death.play();
        death.time = death.getClip().duration;
        death.paused = true;
        mixer.update(0);
      } else {
        sunk = true;
        setSunk(1);
      }
    },
    update(dt) {
      mixer?.update(dt);
      if (move) {
        move.t += dt;
        const p = Math.min(move.t / move.d, 1);
        const swing = Math.sin(Math.PI * p);
        standing.root.position.copy(base);
        if (move.kind === 'lunge') standing.root.position.addScaledVector(towards, 0.5 * swing);
        else if (move.kind === 'dodge') standing.root.position.addScaledVector(sideways, 0.3 * swing);
        else if (move.kind === 'shake') standing.root.position.addScaledVector(sideways, 0.08 * Math.sin(p * Math.PI * 8) * (1 - p));
        else if (move.kind === 'sink') {
          sunk = true;
          setSunk(p);
        }
        if (p >= 1) move = null;
      }
      if (eyeMove) {
        eyeMove.t += dt;
        if (eyeMove.t >= eyeMove.d) {
          if (eyeMove.anim === 'death') fallen = true;
          eyeMove = null;
        }
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const flight = flights[i];
        flight.t += dt;
        const p = Math.min(flight.t / FLIGHT_SECONDS, 1);
        flight.ball.position.lerpVectors(flight.from, flight.to, p);
        if (p < 1) continue;
        group.remove(flight.ball);
        (flight.ball.material as THREE.Material).dispose();
        flights.splice(i, 1);
        flight.then();
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const made = bursts[i];
        made.t += dt;
        if (made.t < FX_SECONDS) {
          drawBurst(made);
          continue;
        }
        group.remove(made.points);
        made.points.geometry.dispose();
        (made.points.material as THREE.Material).dispose();
        bursts.splice(i, 1);
      }
    },
    eye() {
      const drop = EYE_HEIGHT - FALLEN_EYE;
      if (fallen) return { forward: 0, side: 0, up: -drop, roll: 0.6 };
      if (!eyeMove) return { forward: 0, side: 0, up: 0, roll: 0 };
      const p = Math.min(eyeMove.t / eyeMove.d, 1);
      const swing = Math.sin(Math.PI * p);
      const shake = Math.sin(p * Math.PI * 8) * (1 - p);
      const ease = p * p * (3 - 2 * p);
      switch (eyeMove.anim) {
        case 'strike': return { forward: 0.6 * swing, side: 0, up: 0, roll: 0 };
        case 'cast': return { forward: 0, side: 0, up: 0.1 * swing, roll: 0 };
        case 'hurt': return { forward: 0, side: 0.07 * shake, up: 0, roll: 0.03 * shake };
        case 'dodge': return { forward: 0, side: 0.3 * swing, up: 0, roll: 0 };
        case 'death': return { forward: 0, side: 0, up: -drop * ease, roll: 0.6 * ease };
      }
    },
    head() {
      return new THREE.Vector3(slot.x, sunk ? 0.5 : height + 0.25, slot.z);
    },
    dispose() {
      mixer?.stopAllAction();
      standing.dispose();
      ballGeometry.dispose();
      for (const made of bursts) {
        made.points.geometry.dispose();
        (made.points.material as THREE.Material).dispose();
      }
      for (const flight of flights) (flight.ball.material as THREE.Material).dispose();
    },
  };
}
