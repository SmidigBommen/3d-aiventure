import * as THREE from 'three';
import { INWARD, boundaryBlocks, type AreaLayout, type Box, type Gate, type Prop, type Side } from './layout';

// Draws an area from its layout. Everything solid comes from the layout; nothing here decides
// where anything stands, and nothing is random.

const GOLD = '#d4a94a';
const INK = '#e8dcc4';
const DARK = '#0b0a10';
const DUSK = 0x2b2438;
const OPENING_HEIGHT = 2.5; // m, clear height of a gate
const SIGN_HEIGHT = 0.9;
const SIGN_OVERHANG = 0.5; // m the sign reaches past the opening on each side
const WALL_THICKNESS = 0.6;

export interface AreaScene {
  scene: THREE.Scene;
  /** Called every frame with the player's position. */
  update: (x: number, z: number, time: number) => void;
  dispose: () => void;
}

interface Look {
  ground: number;
  outside: number;
  boundary: number;
  boundaryHeight: number;
  post: number;
}

const LOOKS: Record<AreaLayout['type'], Look> = {
  town: { ground: 0x6b6a72, outside: 0x2c2b33, boundary: 0x7a7684, boundaryHeight: 1.2, post: 0x625e70 },
  wilderness: { ground: 0x3f6b3a, outside: 0x22381f, boundary: 0x2a4a2c, boundaryHeight: 2.2, post: 0x6b4c32 },
  dungeon: { ground: 0x4c4a52, outside: 0x000000, boundary: 0x5a5762, boundaryHeight: 0, post: 0x2f2d36 },
};

function material(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });
}

function boxMesh(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A tiled floor texture: a light square with a dark joint, repeated once per `tile` metres. */
function tileTexture(tile: number, halfX: number, halfZ: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set((halfX * 2) / tile, (halfZ * 2) / tile);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function buildGate(gate: Gate, name: string, layout: AreaLayout, look: Look): THREE.Group {
  const group = new THREE.Group();
  group.position.set(gate.x, 0, gate.z);
  group.rotation.y = facing(gate.side);
  // In the group's own frame the floor is towards +z and the gate spans x = -width/2 .. width/2.
  const half = gate.width / 2;
  const post = material(look.post);
  const top = layout.ceiling ?? OPENING_HEIGHT + SIGN_HEIGHT + 0.2;

  if (layout.type === 'dungeon') {
    // The wall above the doorway, and a dark passage behind it.
    group.add(boxMesh(gate.width, top - OPENING_HEIGHT, WALL_THICKNESS, material(look.boundary), 0, (top + OPENING_HEIGHT) / 2, -WALL_THICKNESS / 2));
    const passage = new THREE.Mesh(
      new THREE.BoxGeometry(gate.width, OPENING_HEIGHT, 4),
      new THREE.MeshBasicMaterial({ color: 0x050408, side: THREE.BackSide, fog: false }),
    );
    passage.position.set(0, OPENING_HEIGHT / 2, -2.01);
    group.add(passage);
    const frame = material(look.post);
    // The door frame stands beside the opening, not in it: the doorway stays gate.width wide.
    group.add(boxMesh(0.3, OPENING_HEIGHT, 0.3, frame, -half - 0.15, OPENING_HEIGHT / 2, 0.15));
    group.add(boxMesh(0.3, OPENING_HEIGHT, 0.3, frame, half + 0.15, OPENING_HEIGHT / 2, 0.15));
  } else {
    // A free-standing arch in the wall or hedge: two posts and a beam.
    group.add(boxMesh(0.5, top, 0.7, post, -half - 0.25, top / 2, -WALL_THICKNESS / 2));
    group.add(boxMesh(0.5, top, 0.7, post, half + 0.25, top / 2, -WALL_THICKNESS / 2));
    group.add(boxMesh(gate.width + 1, 0.25, 0.7, post, 0, top + 0.125, -WALL_THICKNESS / 2));
    group.add(boxMesh(gate.width, SIGN_HEIGHT + 0.2, 0.3, post, 0, OPENING_HEIGHT + (SIGN_HEIGHT + 0.2) / 2, -0.09));
    // A path leading out through the arch.
    const path = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 30), material(layout.type === 'town' ? 0x57565e : 0x6b5a3c));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.01, -15);
    group.add(path);
  }

  // The sign is lit by nothing and hidden by no fog, so it reads from across the area.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(gate.width + SIGN_OVERHANG * 2, SIGN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: signTexture(name), fog: false }),
  );
  sign.position.set(0, OPENING_HEIGHT + 0.1 + SIGN_HEIGHT / 2, layout.type === 'dungeon' ? 0.02 : 0.08);
  group.add(sign);
  return group;
}

/** Triangular prism: the roof of a house, ridge along z. */
function roofGeometry(halfX: number, halfZ: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-halfX, 0);
  shape.lineTo(halfX, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: halfZ * 2, bevelEnabled: false });
  geometry.translate(0, 0, -halfZ);
  return geometry;
}

function buildProp(prop: Prop, index: number, scene: THREE.Scene, flames: THREE.PointLight[]): void {
  const at = (mesh: THREE.Object3D, y: number): void => {
    mesh.position.set(prop.x, y, prop.z);
    scene.add(mesh);
  };
  const w = prop.halfX * 2;
  const d = prop.halfZ * 2;
  switch (prop.kind) {
    case 'house': {
      const wallHeight = prop.height * 0.6;
      const walls = [0x8a7f6e, 0x7d7468, 0x91836c][index % 3];
      at(new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), material(walls)), wallHeight / 2);
      const alongZ = prop.halfZ >= prop.halfX;
      const roof = new THREE.Mesh(
        alongZ ? roofGeometry(prop.halfX + 0.3, prop.halfZ + 0.3, prop.height - wallHeight) : roofGeometry(prop.halfZ + 0.3, prop.halfX + 0.3, prop.height - wallHeight),
        material([0x5a2f2a, 0x3f3a4d, 0x4f3a26][index % 3]),
      );
      if (!alongZ) roof.rotation.y = Math.PI / 2;
      at(roof, wallHeight);
      break;
    }
    case 'crate':
      at(new THREE.Mesh(new THREE.BoxGeometry(w, prop.height, d), material(0x7a5a34)), prop.height / 2);
      break;
    case 'tree': {
      const trunk = prop.height * 0.45;
      at(new THREE.Mesh(new THREE.CylinderGeometry(prop.halfX * 0.6, prop.halfX * 0.8, trunk, 7), material(0x4a3524)), trunk / 2);
      at(new THREE.Mesh(new THREE.ConeGeometry(1.2 + (index % 3) * 0.25, prop.height - trunk, 7), material([0x24502c, 0x2c5d2f, 0x1f4630][index % 3])), trunk + (prop.height - trunk) / 2);
      break;
    }
    case 'rock': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), material(0x6f6a78));
      rock.scale.set(prop.halfX, prop.height, prop.halfZ);
      rock.rotation.y = index;
      at(rock, prop.height * 0.35);
      break;
    }
    case 'pillar':
      at(new THREE.Mesh(new THREE.BoxGeometry(w, prop.height, d), material(0x6a6672)), prop.height / 2);
      at(new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3), material(0x57545f)), 0.15);
      at(new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3), material(0x57545f)), prop.height - 0.15);
      break;
    case 'brazier': {
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, prop.height - 0.2, 6), material(0x2a2a30, { metalness: 0.6 })), (prop.height - 0.2) / 2);
      at(new THREE.Mesh(new THREE.CylinderGeometry(prop.halfX, prop.halfX * 0.6, 0.25, 8), material(0x2a2a30, { metalness: 0.6 })), prop.height - 0.125);
      at(new THREE.Mesh(new THREE.ConeGeometry(prop.halfX * 0.7, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xffb040 })), prop.height + 0.25);
      const flame = new THREE.PointLight(0xff9a3c, 40, 18, 1.8);
      flame.position.set(prop.x, prop.height + 0.5, prop.z);
      flame.userData.phase = index * 1.7;
      scene.add(flame);
      flames.push(flame);
      break;
    }
  }
}

/** Dusk: warm at the horizon, dark above. */
function skyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(150, 24, 12);
  const low = new THREE.Color(0x8a4a3a);
  const mid = new THREE.Color(DUSK);
  const high = new THREE.Color(0x0b0a10);
  const colors: number[] = [];
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, position.getY(i) / 150);
    const c = t < 0.25 ? low.clone().lerp(mid, t / 0.25) : mid.clone().lerp(high, (t - 0.25) / 0.75);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

export function buildAreaScene(layout: AreaLayout, exits: { id: string; name: string }[]): AreaScene {
  const scene = new THREE.Scene();
  const look = LOOKS[layout.type];
  const { halfX, halfZ } = layout.floor;
  const flames: THREE.PointLight[] = [];
  let torch: THREE.PointLight | null = null;

  if (layout.type === 'dungeon') {
    scene.background = new THREE.Color(0x050408);
    scene.fog = new THREE.Fog(0x050408, 14, 60);
    scene.add(new THREE.AmbientLight(0x8088b0, 0.5));
    torch = new THREE.PointLight(0xffc890, 12, 16, 1.6);
    scene.add(torch);
  } else {
    scene.background = new THREE.Color(DUSK);
    scene.add(skyDome());
    scene.fog = layout.type === 'wilderness' ? new THREE.Fog(0x4a3a44, 10, 55) : new THREE.Fog(0x4a3a44, 30, 110);
    scene.add(new THREE.HemisphereLight(0xc4bce8, 0x5a4638, 2.2));
    const sun = new THREE.DirectionalLight(0xffb27a, 1.6);
    sun.position.set(-12, 9, 7);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8f8fd0, 0.7);
    fill.position.set(9, 6, -11);
    scene.add(fill);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material(look.outside));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.02;
    scene.add(outside);
  }

  const floorMaterial = material(look.ground);
  if (layout.type !== 'wilderness') floorMaterial.map = tileTexture(layout.type === 'town' ? 1 : 2, halfX, halfZ);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  if (layout.ceiling !== null) {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2 + 2, halfZ * 2 + 2), material(0x34323a));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = layout.ceiling;
    scene.add(ceiling);
  }

  // The boundary: a town wall, a hedge, or the walls of the room, open at the gates.
  const boundary = material(look.boundary);
  const height = layout.ceiling ?? look.boundaryHeight;
  boundaryBlocks(layout, WALL_THICKNESS).forEach((block, i) => {
    // A hedge is not level: its height steps with the block's index.
    const h = layout.type === 'wilderness' ? height + (i % 3) * 0.4 : height;
    scene.add(boxMesh(block.halfX * 2, h, block.halfZ * 2, boundary, block.x, h / 2, block.z));
  });

  const names = new Map(exits.map((e) => [e.id, e.name]));
  for (const gate of layout.gates) scene.add(buildGate(gate, names.get(gate.exitId) ?? gate.exitId, layout, look));

  const wall = material(0x5a5762);
  layout.walls.forEach((box: Box) => scene.add(boxMesh(box.halfX * 2, box.height, box.halfZ * 2, wall, box.x, box.height / 2, box.z)));
  layout.props.forEach((prop, i) => buildProp(prop, i, scene, flames));

  return {
    scene,
    update(x, z, time) {
      if (torch) torch.position.set(x, 2, z);
      for (const flame of flames) flame.intensity = 40 + Math.sin(time * 9 + flame.userData.phase) * 6;
    },
    dispose() {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
    },
  };
}
