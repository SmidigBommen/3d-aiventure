import * as THREE from 'three';
import { SIGN_HEIGHT, footprint, type Dressing, type Placement } from './dressing';
import { GLOW_COLOURS, GLOW_MODELS, MAX_GLOWS, MAX_PARTICLES, flicker, glowPulse, type Air, type Drift } from './atmosphere';
import { INWARD, boundaryBlocks, generator, hash, type AreaLayout, type Gate, type Side } from './layout';
import type { Model } from './modelLoader';

// Draws an area from its dressing: every placement where the dressing put it, the light, fog and
// sky from the mood. Nothing here decides which model goes where, and nothing is random. Besides
// the models there is only plain geometry: the floor plane, what backs the boundary, the signs,
// and the dirt road of the ambush scene.

const GOLD = '#d4a94a';
const INK = '#e8dcc4';
const DARK = '#0b0a10';
const FALLBACK = '#6a6672'; // a model that failed to load is a box of this colour, or of its tint
const SIGN_OVERHANG = 0.5; // m the sign reaches past the opening on each side
const BACKING = 1.2; // m, thickness of the plain wall behind a dungeon's wall models
const MAX_FLAMES = 6;
const ROAD_WIDTH = 3.6; // m, the dirt road of an ambush
const ROAD_COLOUR = '#7a6344';
// Every light is paid for by each pixel of the area: with two, the town square of Rivermeet lost a frame slot
// in the smoke test's software renderer (66.7 ms against 50.1 ms; execution/frames.mjs). One keeps the budget.
const MAX_GLOW_LIGHTS = Math.min(MAX_GLOWS, 1);
const GLOW_STRENGTH = 7; // a glow's light at the top of its pulse
const GLOW_EMISSIVE = 0.55; // how strongly a glowing model shines in its colour, at the top of its pulse
// How each kind of drift moves: metres per second it sinks (negative: rises), metres per second it is blown sideways, metres it sways.
const DRIFT_MOTION: Record<Drift, [number, number, number]> = {
  dust: [0.12, 0.05, 0.3], ash: [0.3, 0.1, 0.35], leaves: [0.55, 0.9, 0.6], embers: [-0.7, 0.15, 0.3], motes: [0, 0, 0.4],
};
const DRIFT_SIZE: Record<Drift, number> = { dust: 0.05, ash: 0.07, leaves: 0.11, embers: 0.07, motes: 0.08 };

// Models that burn: each gets a flickering light, the first MAX_FLAMES of an area at least.
// `flame` adds a flame for a model that has none of its own.
const BURNING: Record<string, { colour: number; strength: number; flame?: boolean }> = {
  'env/wilderness/campfire': { colour: 0xff9a3c, strength: 40, flame: true },
  'env/dungeon/torch_mounted': { colour: 0xff9a3c, strength: 14 },
  'env/dungeon/torch_lit': { colour: 0xff9a3c, strength: 14 },
  'env/town/lantern_standing': { colour: 0xffc070, strength: 10 },
  'env/town/lantern_post': { colour: 0xffc070, strength: 18 },
};

export interface AreaScene {
  scene: THREE.Scene;
  /** Called every frame with the player's position. */
  update: (x: number, z: number, time: number) => void;
  dispose: () => void;
}

function material(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });
}

function boxMesh(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** The destination's name on a board, gold letters on dark. */
function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 216;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = DARK;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = GOLD;
  g.lineWidth = 8;
  g.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  let size = 128;
  do {
    g.font = `600 ${size}px Cinzel, Georgia, serif`;
    size -= 4;
  } while (g.measureText(text).width > canvas.width - 60 && size > 24);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Rotation about y that turns a mesh built facing +z so that it faces into the floor from `side`. */
function facing(side: Side): number {
  const n = INWARD[side];
  return Math.atan2(n.x, n.z);
}

/**
 * The sign of a gate, above its gateway (`top` is the gateway's height), and what is plain around it: the board the sign hangs on, in a dungeon the wall up to
 * the ceiling and a dark passage behind the opening, outdoors the path that leads on.
 */
function buildGate(gate: Gate, name: string, layout: AreaLayout, top: number, stone: THREE.Material, path: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.position.set(gate.x, 0, gate.z);
  group.rotation.y = facing(gate.side);
  // In the group's own frame the floor is towards +z and the gate spans x = -width/2 .. width/2.
  const board = gate.width + SIGN_OVERHANG * 2;
  if (layout.ceiling !== null) {
    if (layout.ceiling > top) group.add(boxMesh(board + 0.4, layout.ceiling - top, 0.7, stone, 0, (layout.ceiling + top) / 2, -0.35));
    const passage = new THREE.Mesh(
      new THREE.BoxGeometry(gate.width, top, 4),
      new THREE.MeshBasicMaterial({ color: 0x050408, side: THREE.BackSide, fog: false }),
    );
    passage.position.set(0, top / 2, -2.01);
    group.add(passage);
  } else {
    group.add(boxMesh(board + 0.2, SIGN_HEIGHT + 0.2, 0.4, stone, 0, top + (SIGN_HEIGHT + 0.2) / 2, -0.2));
    const road = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 30), path);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, -15);
    group.add(road);
  }

  // The sign is lit by nothing and hidden by no fog, so it reads from across the area.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(board, SIGN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: signTexture(name), fog: false }),
  );
  // Above the gateway. In a dungeon the dressing keeps the gateway SIGN_ROOM under the ceiling, so the sign fits.
  const bottom = top + (layout.ceiling !== null ? 0.02 : 0.1);
  sign.position.set(0, bottom + SIGN_HEIGHT / 2, 0.12);
  group.add(sign);
  return group;
}

/** The sky outdoors: the fog's colour at the horizon, the mood's sky above, darker at the top. */
function skyDome(sky: THREE.Color, fog: THREE.Color): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(150, 24, 12);
  const high = sky.clone().multiplyScalar(0.35);
  const colors: number[] = [];
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, position.getY(i) / 150);
    const c = t < 0.25 ? fog.clone().lerp(sky, t / 0.25) : sky.clone().lerp(high, (t - 0.25) / 0.75);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

/** Where a placement puts a model: bounding box centred on (x, z), lowest point at y, turned and scaled. */
function placementMatrix(p: Placement, box: THREE.Box3): THREE.Matrix4 {
  const centre = box.getCenter(new THREE.Vector3());
  const toOrigin = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation),
    new THREE.Vector3(...p.scale),
  );
  return place.multiply(toOrigin);
}

/** `road`: the scene is the road of an ambush, and a strip of dirt runs across the floor through these two points. */
export function buildAreaScene(
  dressing: Dressing, exits: { id: string; name: string }[], models: Map<string, Model | null>,
  road: { from: { x: number; z: number }; to: { x: number; z: number } } | null = null,
  air: Air | null = null,
): AreaScene {
  const scene = new THREE.Scene();
  const { layout, mood, placements } = dressing;
  const { halfX, halfZ } = layout.floor;
  const owned: { dispose: () => void }[] = []; // made here; the models' own geometry and materials are shared and stay
  const own = <T extends { dispose: () => void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };
  const add = (mesh: THREE.Mesh): THREE.Mesh => {
    own(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      own(m);
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map) own(map);
    }
    scene.add(mesh);
    return mesh;
  };
  const addAll = (group: THREE.Object3D): void => {
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    scene.add(group);
    for (const mesh of meshes) {
      own(mesh.geometry);
      const m = mesh.material as THREE.MeshBasicMaterial;
      own(m);
      if (m.map) own(m.map);
    }
  };

  // --- the mood: sky, fog and light ---
  const sky = new THREE.Color(mood.sky);
  const fog = new THREE.Color(mood.fog);
  const light = new THREE.Color(mood.light);
  const ground = new THREE.Color(mood.ground);
  scene.background = sky;
  scene.fog = new THREE.Fog(fog, mood.fogNear, mood.fogFar);
  let torch: THREE.PointLight | null = null;
  if (layout.ceiling !== null) {
    scene.add(new THREE.HemisphereLight(light, ground, 1.5 * mood.intensity));
    const above = new THREE.DirectionalLight(light, 0.9 * mood.intensity);
    above.position.set(-4, 10, 6);
    scene.add(above);
    torch = new THREE.PointLight(0xffc890, 10, 16, 1.6);
    scene.add(torch);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2 + 2, halfZ * 2 + 2), new THREE.MeshBasicMaterial({ color: sky }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = layout.ceiling;
    add(ceiling);
  } else {
    add(skyDome(sky, fog));
    scene.add(new THREE.HemisphereLight(light.clone().lerp(new THREE.Color(0xffffff), 0.5), ground.clone().multiplyScalar(0.6), 1.3 * mood.intensity));
    const sun = new THREE.DirectionalLight(light, mood.intensity);
    sun.position.set(-12, 9, 7);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(sky.clone().lerp(new THREE.Color(0x8f8fd0), 0.5), 0.45 * mood.intensity);
    fill.position.set(9, 6, -11);
    scene.add(fill);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material(ground.clone().multiplyScalar(0.55)));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.03;
    add(outside);
  }

  // --- plain geometry: the floor under the models, and what backs the boundary ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), material(ground));
  floor.rotation.x = -Math.PI / 2;
  add(floor);
  if (road) {
    // The only scene with a road of its own: dirt from one edge of the world to the other, over the ground cover.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 240), material(new THREE.Color(ROAD_COLOUR).lerp(ground, 0.25)));
    strip.rotation.order = 'YXZ';
    strip.rotation.set(-Math.PI / 2, Math.atan2(road.to.x - road.from.x, road.to.z - road.from.z), 0);
    strip.position.set((road.from.x + road.to.x) / 2, 0.09, (road.from.z + road.to.z) / 2);
    add(strip);
  }
  if (layout.ceiling !== null) {
    // Behind the wall models, so that a broken or barred piece does not show the void.
    const backing = material(fog.clone().multiplyScalar(0.5));
    for (const block of boundaryBlocks(layout, BACKING)) {
      const alongX = block.side === 'north' || block.side === 'south';
      const n = INWARD[block.side];
      const w = alongX ? block.halfX * 2 : BACKING - 0.3;
      const d = alongX ? BACKING - 0.3 : block.halfZ * 2;
      add(boxMesh(w, layout.ceiling, d, backing, block.x - n.x * 0.15, layout.ceiling / 2, block.z - n.z * 0.15));
    }
  }

  // --- what glows here (atmosphere.ts): the models of the location's glow kind ---
  const glowing = air?.glow ? GLOW_MODELS[air.glow] : [];
  const glowColour = air?.glow ? GLOW_COLOURS[air.glow] : '#000000';
  const glowMaterials: { material: THREE.MeshStandardMaterial; seed: number }[] = [];

  // --- the models: one instanced mesh per model part and tint ---
  const groups = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.model}|${p.tint ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const group of groups.values()) {
    const { model: key, tint } = group[0];
    const model = models.get(key) ?? null;
    if (!model) {
      // The stand-in for a model that did not load: a box of the placement's footprint and height.
      const stand = material(tint ?? FALLBACK);
      for (const p of group) {
        const f = footprint(p.model, p.scale, p.rotation);
        add(boxMesh(f.halfX * 2, f.height, f.halfZ * 2, stand, p.x, p.y + f.height / 2, p.z));
      }
      continue;
    }
    const lit = glowing.includes(key);
    const tinted = (m: THREE.Material): THREE.Material => {
      if (!tint && !lit) return m;
      const copy = own(m.clone()) as THREE.MeshStandardMaterial;
      if (tint) copy.color?.multiply(new THREE.Color(tint));
      if (lit && copy.emissive) {
        // A model that glows: its own copy of the material, pulsing in the colour of the glow.
        copy.emissive.set(glowColour);
        glowMaterials.push({ material: copy, seed: glowMaterials.length });
      }
      return copy;
    };
    const matrices = group.map((p) => placementMatrix(p, model.box));
    for (const part of model.parts) {
      const mat = Array.isArray(part.material) ? part.material.map(tinted) : tinted(part.material);
      const mesh = new THREE.InstancedMesh(part.geometry, mat, group.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix.clone().multiply(part.matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      own(mesh); // frees the instance buffer; the geometry and the untinted materials belong to the loader
      scene.add(mesh);
    }
  }

  // --- gates: the sign above each gateway ---
  const names = new Map(exits.map((e) => [e.id, e.name]));
  const path = material(ground.clone().lerp(new THREE.Color(0x6b5a3c), 0.5));
  for (const gate of layout.gates) {
    const gateway = placements.filter((p) => p.role === 'gate' && p.gate === gate.exitId);
    const top = Math.max(0, ...gateway.map((p) => p.y + footprint(p.model, p.scale, p.rotation).height));
    const stone = material(new THREE.Color(0x8a8690).multiply(new THREE.Color(gateway[0]?.tint ?? '#ffffff')));
    addAll(buildGate(gate, names.get(gate.exitId) ?? gate.exitId, layout, top, stone, path));
  }

  // --- fire ---
  const flames: THREE.PointLight[] = [];
  const burning = placements.filter((p) => BURNING[p.model]).sort((a, b) => BURNING[b.model].strength - BURNING[a.model].strength);
  burning.slice(0, MAX_FLAMES).forEach((p) => {
    const fire = BURNING[p.model];
    const height = footprint(p.model, p.scale, p.rotation).height;
    if (fire.flame) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
      cone.position.set(p.x, p.y + height + 0.3, p.z);
      add(cone);
    }
    const flame = new THREE.PointLight(fire.colour, fire.strength, 18, 1.8);
    flame.position.set(p.x, p.y + height + 0.4, p.z);
    flame.userData.strength = fire.strength;
    scene.add(flame);
    flames.push(flame);
  });

  // --- glow: a light at the glowing models nearest to where one arrives, MAX_GLOW_LIGHTS at most ---
  const glowLights: THREE.PointLight[] = [];
  placements
    .filter((p) => glowing.includes(p.model))
    .sort((a, b) => Math.hypot(a.x - layout.spawn.x, a.z - layout.spawn.z) - Math.hypot(b.x - layout.spawn.x, b.z - layout.spawn.z))
    .slice(0, MAX_GLOW_LIGHTS)
    .forEach((p, i) => {
      const height = footprint(p.model, p.scale, p.rotation).height;
      const glow = new THREE.PointLight(glowColour, GLOW_STRENGTH, 9, 1.8);
      glow.position.set(p.x, p.y + Math.min(height, 2.4) * 0.6 + 0.3, p.z);
      glow.userData.seed = 100 + i;
      scene.add(glow);
      glowLights.push(glow);
    });

  // --- what drifts in the air: one cloud of points in a box that stays around the player ---
  let drift: { points: THREE.Points; base: Float32Array; positions: THREE.BufferAttribute; kind: Drift } | null = null;
  const driftBox = { x: 26, y: layout.ceiling === null ? 7 : layout.ceiling, z: 26 };
  if (air && air.count > 0) {
    const count = Math.min(air.count, MAX_PARTICLES);
    const rnd = generator(hash(`air/${air.drift}/${halfX}/${halfZ}`)); // the same cloud every time for the same area
    const base = new Float32Array(count * 4); // where each point starts in the box, and a number of its own
    for (let i = 0; i < base.length; i++) base[i] = rnd();
    const geometry = own(new THREE.BufferGeometry());
    const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    geometry.setAttribute('position', positions);
    const material = own(new THREE.PointsMaterial({
      color: air.colour, size: DRIFT_SIZE[air.drift], sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false,
      blending: air.drift === 'embers' || air.drift === 'motes' ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    drift = { points, base, positions, kind: air.drift };
  }
  const wrap = (value: number, size: number): number => value - Math.floor(value / size) * size;

  return {
    scene,
    update(x, z, time) {
      if (torch) torch.position.set(x, 2, z);
      flames.forEach((flame, i) => {
        flame.intensity = flame.userData.strength * flicker(time, i);
      });
      for (const { material: glow, seed } of glowMaterials) glow.emissiveIntensity = GLOW_EMISSIVE * glowPulse(time, seed);
      for (const glow of glowLights) glow.intensity = GLOW_STRENGTH * glowPulse(time, glow.userData.seed);
      if (drift) {
        const { base, positions, kind } = drift;
        const [fall, wind, sway] = DRIFT_MOTION[kind];
        for (let i = 0; i < positions.count; i++) {
          const self = base[i * 4 + 3];
          const turn = time * (0.4 + self) + self * 40;
          // Each point moves through the box on its own line and comes in again on the far side; the box follows the player.
          const px = wrap(base[i * 4] * driftBox.x + wind * time * (0.6 + 0.8 * self) + Math.sin(turn) * sway - x, driftBox.x) + x - driftBox.x / 2;
          const pz = wrap(base[i * 4 + 2] * driftBox.z + Math.cos(turn * 0.8) * sway - z, driftBox.z) + z - driftBox.z / 2;
          const py = kind === 'motes'
            ? 0.3 + base[i * 4 + 1] * (driftBox.y - 0.6) + Math.sin(turn) * 0.25
            : wrap(base[i * 4 + 1] * driftBox.y - fall * time * (0.6 + 0.8 * self), driftBox.y);
          positions.setXYZ(i, px, py, pz);
        }
        positions.needsUpdate = true;
      }
    },
    dispose() {
      for (const thing of new Set(owned)) thing.dispose();
    },
  };
}
