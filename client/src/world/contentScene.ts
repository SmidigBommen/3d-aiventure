import * as THREE from 'three';
import {
  BOSS_SCALE, ELARA, ELARA_IDLE, SEARCH_MARKERS, creatureLook, creatureMotion, objectLook, remainsOf, type AreaContents, type CreatureLook,
} from './contents';
import { NOTICE_SECONDS, type Wanderer } from './wander';
import { footprint, modelSize, stallFront, type Placement } from './dressing';
import type { AreaLayout } from './layout';
import type { Figure } from './modelLoader';

// Draws what an area holds on the slots of its layout: the monster, the event object, the boss and
// the search spot, each with its name above it. Which model shows what is decided in contents.ts;
// what is present is decided by the server. A discovery has no object of its own: the special
// landmark of the area (drawn by areaScene.ts) glows instead. What stays of a resolved event stands
// where it stood, without glow, light or name. Elara stands in her stall whatever the area holds, with a
// gold "!" above her while a quest waits to be turned in. Rebuilt whenever the contents change.

const GOLD = '#daa520'; // the gold of the headings
const INK = '#e8dcc4';
const FALLBACK = '#6a6672'; // a model that failed to load is a box of this colour, or of its tint
const LABEL_WIDTH = 2; // m
const CEILING_ROOM = 0.2; // m a boss stays under a dungeon's ceiling
const SPENT_SHADE = 0.45; // what stays of a resolved event is this much darker
const LID_OPEN = -1.25; // rad about the hinge of a chest's lid
const OPENED = ['chest', 'treasure']; // object kinds that are drawn opened once resolved
const TURN_RATE = 10; // per second: how fast the monster turns to where it looks (most of the way in 0.3 s)
const LUNGE_SECONDS = 0.5; // the notice of a monster without an attack clip

export interface ContentScene {
  group: THREE.Group;
  /** Called every frame with the player's position. */
  update: (x: number, z: number, time: number, dt: number) => void;
  /** Whether the "!" above Elara shows: a quest is ready to be turned in. */
  setQuestReady: (ready: boolean) => void;
  /** Where the monster of the area stands and looks this frame, and whether it has just noticed the player. */
  setMonster: (w: Wanderer, dt: number) => void;
  dispose: () => void;
}

/** Whether what stays of this resolved event is drawn on the event slot. */
const staysOnSlot = (spent: AreaContents['spent']): boolean => Boolean(spent) && !spent?.landmark && remainsOf(spent?.object ?? '') === 'stays';

/** The models a content scene for these contents is drawn from. `landmark`: the special landmark of the dressing. */
export function contentModels(layout: AreaLayout, contents: AreaContents | null, landmark: Placement | null = null): string[] {
  const keys: string[] = [];
  if (layout.slots?.shop) keys.push(ELARA.model);
  if (!contents) return keys;
  if (contents.monster) keys.push(creatureLook(contents.monster.race).model);
  if (contents.event && !contents.event.landmark) keys.push(objectLook(contents.event.object).model);
  if (contents.event?.landmark && landmark) keys.push(landmark.model);
  if (contents.spent && staysOnSlot(contents.spent)) keys.push(objectLook(contents.spent.object).model);
  if (contents.boss) keys.push(creatureLook(contents.boss.id).model);
  if (contents.search_spot) keys.push(SEARCH_MARKERS[layout.type].model);
  return keys;
}

/** Lines of text on a dark plate, the first one in gold. */
function label(lines: string[]): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 40 + lines.length * 84;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(11, 10, 16, 0.7)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((text, i) => {
    let size = i === 0 ? 68 : 50;
    do {
      g.font = i === 0 ? `600 ${size}px Cinzel, Georgia, serif` : `${size}px Georgia, serif`;
      size -= 3;
    } while (g.measureText(text).width > canvas.width - 40 && size > 20);
    g.fillStyle = i === 0 ? GOLD : INK;
    g.fillText(text, canvas.width / 2, 20 + 84 * i + 44);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, transparent: true, depthWrite: false }));
  sprite.scale.set(LABEL_WIDTH, (LABEL_WIDTH * canvas.height) / canvas.width, 1);
  return sprite;
}

/** The gold "!" above Elara while a quest is ready to be turned in. */
function questMark(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 116px Cinzel, Georgia, serif';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(11, 10, 16, 0.9)';
  g.strokeText('!', 64, 70);
  g.fillStyle = '#ffd54a';
  g.fillText('!', 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, transparent: true, depthWrite: false, depthTest: false }));
  sprite.renderOrder = 11;
  sprite.scale.set(0.7, 0.7, 1);
  return sprite;
}

/** The clip a standing figure plays: its idle, by name. */
function idleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  const named = (test: (name: string) => boolean): THREE.AnimationClip | undefined => clips.find((clip) => test(clip.name.toLowerCase()));
  return named((n) => n === 'idle' || n.endsWith('|idle') || n.endsWith('_idle')) ?? named((n) => n.includes('idle')) ?? null;
}

export interface Look {
  model: string;
  scale: number;
  tint: string | null;
  opacity: number;
  emissive: string | null;
}

/** A model made to stand somewhere: `root` is placed by the caller, `body` is the copy of the file's scene (null for a box). */
export interface Standing {
  root: THREE.Group;
  body: THREE.Object3D | null;
  top: number; // m above the floor
  materials: THREE.MeshStandardMaterial[];
  clips: THREE.AnimationClip[];
  dispose: () => void;
}

/** `scale` for a model, or the largest that keeps it under a dungeon's ceiling. */
export function underCeiling(layout: AreaLayout, model: string, scale: number): number {
  return layout.ceiling === null ? scale : Math.min(scale, (layout.ceiling - CEILING_ROOM) / modelSize(model)[1]);
}

/** The scale a boss is drawn at: its own times BOSS_SCALE, kept under a dungeon's ceiling. */
export function bossScale(layout: AreaLayout, look: CreatureLook): number {
  return underCeiling(layout, look.model, look.scale * BOSS_SCALE);
}

/**
 * A model with its own copies of the materials, tinted. A figure with clips stands on its own origin;
 * anything else is centred with its lowest point on the floor. A model that did not load is a box.
 */
export function standModel(look: Look, figure: Figure | null): Standing {
  const root = new THREE.Group();
  const owned: { dispose: () => void }[] = []; // made here; what belongs to the loader stays
  const own = <T extends { dispose: () => void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };
  const dispose = (): void => {
    for (const thing of owned) thing.dispose();
  };
  const [w, h, d] = modelSize(look.model);
  const materials: THREE.MeshStandardMaterial[] = [];
  if (!figure) {
    const material = own(new THREE.MeshStandardMaterial({ color: look.tint ?? FALLBACK, roughness: 0.95, flatShading: true }));
    const box = new THREE.Mesh(own(new THREE.BoxGeometry(w * look.scale, h * look.scale, d * look.scale)), material);
    box.position.y = (h * look.scale) / 2;
    root.add(box);
    return { root, body: null, top: h * look.scale, materials: [material], clips: [], dispose };
  }
  const body = figure.instance();
  body.scale.setScalar(look.scale);
  const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const copy = (material: THREE.Material): THREE.Material => {
    let mine = copies.get(material);
    if (!mine) {
      mine = own(material.clone()) as THREE.MeshStandardMaterial;
      if (look.tint) mine.color?.multiply(new THREE.Color(look.tint));
      if (look.emissive && mine.emissive) mine.emissive.set(look.emissive);
      if (look.opacity < 1) {
        mine.transparent = true;
        mine.opacity = look.opacity;
      }
      copies.set(material, mine);
      materials.push(mine);
    }
    return mine;
  };
  body.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
    // A skinned mesh is culled by where it stood when it was made; these few are always drawn.
    mesh.frustumCulled = false;
  });
  root.add(body);
  const box = new THREE.Box3().setFromObject(body);
  if (figure.clips.length === 0 && Number.isFinite(box.min.y)) {
    const centre = box.getCenter(new THREE.Vector3());
    body.position.set(-centre.x, -box.min.y, -centre.z);
    return { root, body, top: box.max.y - box.min.y, materials, clips: [], dispose };
  }
  const top = Number.isFinite(box.max.y) && box.max.y > 0.2 ? Math.min(box.max.y, h * look.scale * 2) : h * look.scale;
  return { root, body, top, materials, clips: figure.clips, dispose };
}

export function buildContentScene(
  layout: AreaLayout, contents: AreaContents | null, figures: Map<string, Figure | null>, landmark: Placement | null = null,
  stall: Placement | null = null,
): ContentScene {
  const group = new THREE.Group();
  const owned: { dispose: () => void }[] = []; // made here; what belongs to the loader stays
  const own = <T extends { dispose: () => void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };
  const mixers: THREE.AnimationMixer[] = [];
  const facing: THREE.Object3D[] = []; // turned to the player every frame
  const pulsing: THREE.MeshStandardMaterial[] = [];
  let glow: THREE.PointLight | null = null;
  let shell: THREE.MeshBasicMaterial | null = null; // the gold over a landmark that holds a discovery
  const slots = layout.slots;

  /** A model standing at (x, z); a figure with clips plays its idle. */
  const stand = (look: Look, x: number, z: number, clip: string | null = null): { root: THREE.Object3D; top: number; materials: THREE.MeshStandardMaterial[] } => {
    const standing = own(standModel(look, figures.get(look.model) ?? null));
    standing.root.position.set(x, 0, z);
    group.add(standing.root);
    const idle = standing.body ? (standing.clips.find((c) => c.name === clip) ?? idleClip(standing.clips)) : null;
    if (idle && standing.body) {
      const mixer = new THREE.AnimationMixer(standing.body);
      mixer.clipAction(idle).play();
      mixer.update(0);
      mixers.push(mixer);
    }
    return standing;
  };

  /** A name plate above (x, z). `through`: it shows through what stands in front of it (a landmark one stands beside). */
  const name = (lines: string[], x: number, z: number, top: number, through = false): void => {
    const sprite = label(lines);
    if (through) {
      sprite.material.depthTest = false;
      sprite.renderOrder = 10;
    }
    own(sprite.material);
    own(sprite.material.map as THREE.Texture);
    const half = sprite.scale.y / 2;
    const y = top + 0.25 + half;
    sprite.position.set(x, layout.ceiling === null ? y : Math.min(y, layout.ceiling - half - 0.02), z);
    group.add(sprite);
  };

  let mark: THREE.Sprite | null = null;
  let markY = 0;
  // The monster of the area. `alerted`: its notice has been played. `lunge`: seconds into the fallback motion, or -1.
  let walker: {
    holder: THREE.Group; root: THREE.Object3D; bang: THREE.Sprite; idle: THREE.AnimationAction | null; attack: THREE.AnimationAction | null;
    alerted: boolean; lunge: number; turned: boolean;
  } | null = null;
  if (slots?.shop) {
    // Elara, behind the table of her stall, looking out of the side the player comes from.
    const { x, z } = slots.shop;
    const { root, top } = stand(ELARA, x, z, ELARA_IDLE);
    const front = stall ? stallFront(stall, layout.spawn) : { x: layout.spawn.x - x, z: layout.spawn.z - z };
    root.rotation.y = Math.atan2(front.x, front.z);
    // Her plate and the mark above it hang under the roof and show through the posts of the stall.
    // The bounds of a skinned figure can come out taller than it stands: the file's height decides.
    const tall = Math.min(top, modelSize(ELARA.model)[1] * ELARA.scale);
    name(['Elara'], x, z, tall, true);
    mark = questMark();
    own(mark.material);
    own(mark.material.map as THREE.Texture);
    markY = tall + 1.0;
    mark.position.set(x, markY, z);
    mark.visible = false;
    group.add(mark);
  }

  if (contents && slots) {
    const creature = (look: CreatureLook, scale: number): Look => ({ ...look, scale });
    if (contents.monster) {
      // The monster walks (wander.ts says where): it, its plate and the "!" of its notice move together.
      const look = creatureLook(contents.monster.race);
      const standing = own(standModel(look, figures.get(look.model) ?? null));
      const holder = new THREE.Group();
      holder.position.set(slots.monster.x, 0, slots.monster.z);
      holder.add(standing.root);
      const plate = label([contents.monster.name, `${contents.monster.race} · Level ${contents.monster.level}`]);
      own(plate.material);
      own(plate.material.map as THREE.Texture);
      const half = plate.scale.y / 2;
      const plateY = standing.top + 0.25 + half;
      plate.position.y = layout.ceiling === null ? plateY : Math.min(plateY, layout.ceiling - half - 0.02);
      holder.add(plate);
      const bang = questMark();
      own(bang.material);
      own(bang.material.map as THREE.Texture);
      bang.material.color.set('#ff8a5a');
      bang.position.y = plate.position.y + half + 0.4;
      bang.visible = false;
      holder.add(bang);
      group.add(holder);
      let idle: THREE.AnimationAction | null = null;
      let attack: THREE.AnimationAction | null = null;
      if (standing.body && standing.clips.length) {
        const mixer = new THREE.AnimationMixer(standing.body);
        const resting = idleClip(standing.clips);
        const how = creatureMotion(look.model, 'attack');
        const attackClip = 'clip' in how ? standing.clips.find((clip) => clip.name === how.clip) : undefined;
        idle = resting ? mixer.clipAction(resting) : null;
        attack = attackClip ? mixer.clipAction(attackClip) : null;
        idle?.play();
        mixer.update(0);
        mixer.addEventListener('finished', (event) => {
          event.action.stop();
          idle?.reset().play();
        });
        mixers.push(mixer);
      }
      walker = { holder, root: standing.root, bang, idle, attack, alerted: false, lunge: -1, turned: false };
    }
    if (contents.boss && slots.boss) {
      const look = creatureLook(contents.boss.id);
      const { root, top } = stand(creature(look, bossScale(layout, look)), slots.boss.x, slots.boss.z);
      facing.push(root);
      name([contents.boss.name], slots.boss.x, slots.boss.z, layout.ceiling === null ? top : Math.min(top, layout.ceiling - CEILING_ROOM));
    }
    if (contents.event?.landmark && landmark) {
      // A discovery: the landmark itself glows. A gold shell of the same model lies over the one areaScene drew.
      const figure = figures.get(landmark.model) ?? null;
      const size = footprint(landmark.model, landmark.scale, landmark.rotation);
      const shellMaterial = own(new THREE.MeshBasicMaterial({
        color: GOLD, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      shell = shellMaterial;
      const holder = new THREE.Group();
      holder.position.set(landmark.x, landmark.y, landmark.z);
      holder.rotation.y = landmark.rotation;
      holder.scale.set(...landmark.scale);
      if (figure) {
        // Placed as areaScene places it: bounding box centred, lowest point on the floor.
        const body = figure.instance();
        body.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(body, true);
        const centre = box.getCenter(new THREE.Vector3());
        body.position.set(-centre.x, -box.min.y, -centre.z);
        body.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) mesh.material = shellMaterial;
        });
        holder.add(body);
      }
      group.add(holder);
      glow = new THREE.PointLight(GOLD, 6, 9, 1.8);
      const lightAt = slots.landmark ?? { x: landmark.x, z: landmark.z };
      // Between the landmark and where one stands at it, so that its front is lit.
      glow.position.set((landmark.x + lightAt.x) / 2, Math.min(Math.max(size.height, 0.6) + 0.5, 2.6), (landmark.z + lightAt.z) / 2);
      group.add(glow);
      name([contents.event.title], landmark.x, landmark.z, Math.max(size.height, 0.9), true);
    } else if (contents.event) {
      const look = objectLook(contents.event.object);
      const scale = look.height / modelSize(look.model)[1];
      const { root, top, materials } = stand({ model: look.model, scale, tint: look.tint, opacity: 1, emissive: null }, slots.event.x, slots.event.z);
      if ((figures.get(look.model)?.clips.length ?? 0) > 0) facing.push(root);
      else root.rotation.y = Math.atan2(layout.spawn.x - slots.event.x, layout.spawn.z - slots.event.z);
      for (const material of materials) {
        if (!material.emissive) continue;
        material.emissive.set(GOLD);
        pulsing.push(material);
      }
      glow = new THREE.PointLight(GOLD, 6, 9, 1.8);
      glow.position.set(slots.event.x, Math.max(top, 0.6) + 0.5, slots.event.z);
      group.add(glow);
      name([contents.event.title], slots.event.x, slots.event.z, Math.max(top, 0.9));
    }
    if (contents.spent && staysOnSlot(contents.spent) && !(contents.event && !contents.event.landmark)) {
      // What is left of a resolved event: where it stood, darker, a chest with its lid up.
      const look = objectLook(contents.spent.object);
      const scale = look.height / modelSize(look.model)[1];
      const standing = own(standModel({ model: look.model, scale, tint: look.tint, opacity: 1, emissive: null }, figures.get(look.model) ?? null));
      standing.root.position.set(slots.event.x, 0, slots.event.z);
      standing.root.rotation.y = Math.atan2(layout.spawn.x - slots.event.x, layout.spawn.z - slots.event.z);
      group.add(standing.root);
      let opened = false;
      if (OPENED.includes(contents.spent.object)) {
        standing.body?.traverse((object) => {
          if (!object.name.endsWith('_lid')) return;
          object.rotation.x = LID_OPEN;
          opened = true;
        });
      }
      for (const material of standing.materials) material.color?.multiplyScalar(opened ? 0.8 : SPENT_SHADE);
    }
    if (contents.search_spot) {
      const look = SEARCH_MARKERS[layout.type];
      const scale = look.height / modelSize(look.model)[1];
      // Something else is here first: the spot is dimmed until that is dealt with.
      const dimmed = contents.monster !== null || contents.event !== null;
      const { root, materials } = stand({ model: look.model, scale, tint: look.tint, opacity: 1, emissive: null }, slots.search.x, slots.search.z);
      root.rotation.y = Math.atan2(layout.spawn.x - slots.search.x, layout.spawn.z - slots.search.z);
      for (const material of materials) {
        if (dimmed) material.color?.multiplyScalar(0.3);
        else if (material.emissive) {
          material.emissive.set(GOLD);
          material.emissiveIntensity = 0.18;
        }
      }
    }
  }

  return {
    group,
    update(x, z, time, dt) {
      for (const mixer of mixers) mixer.update(dt);
      for (const root of facing) root.rotation.y = Math.atan2(x - root.position.x, z - root.position.z);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.6);
      for (const material of pulsing) material.emissiveIntensity = 0.12 + 0.3 * pulse;
      if (glow) glow.intensity = 4 + 5 * pulse;
      if (shell) shell.opacity = 0.12 + 0.2 * pulse;
      if (mark) mark.position.y = markY + 0.08 * Math.sin(time * 3);
    },
    setQuestReady(ready) {
      if (mark) mark.visible = ready;
    },
    setMonster(w, dt) {
      if (!walker) return;
      walker.holder.position.set(w.x, 0, w.z);
      // The model looks along +z; the wanderer's yaw 0 looks along -z. The turn is eased over about 0.3 s.
      const wanted = w.yaw + Math.PI;
      if (!walker.turned) {
        walker.root.rotation.y = wanted;
        walker.turned = true;
      } else {
        const off = Math.atan2(Math.sin(wanted - walker.root.rotation.y), Math.cos(wanted - walker.root.rotation.y));
        walker.root.rotation.y += off * Math.min(1, dt * TURN_RATE);
      }
      const startled = w.noticed && w.noticedFor < NOTICE_SECONDS;
      walker.bang.visible = startled;
      if (startled && !walker.alerted) {
        // Once per notice: the attack clip, or a lunge for a model without one.
        if (walker.attack) {
          walker.idle?.stop();
          walker.attack.reset();
          walker.attack.setLoop(THREE.LoopOnce, 1);
          walker.attack.setDuration(Math.min(walker.attack.getClip().duration, NOTICE_SECONDS));
          walker.attack.play();
        } else {
          walker.lunge = 0;
        }
      }
      walker.alerted = w.noticed;
      if (walker.lunge >= 0) {
        walker.lunge += dt;
        const p = Math.min(walker.lunge / LUNGE_SECONDS, 1);
        walker.root.position.set(Math.sin(walker.root.rotation.y) * 0.4 * Math.sin(Math.PI * p), 0, Math.cos(walker.root.rotation.y) * 0.4 * Math.sin(Math.PI * p));
        if (p >= 1) walker.lunge = -1;
      }
    },
    dispose() {
      for (const mixer of mixers) mixer.stopAllAction();
      for (const thing of new Set(owned)) thing.dispose();
    },
  };
}
