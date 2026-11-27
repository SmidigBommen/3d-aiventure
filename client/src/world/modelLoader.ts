import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Loads the models under /models. Every file is asked for at most once per page load, also when it
// failed; the geometry and materials of a loaded model are shared by everything drawn from it.

/** One mesh of a model: what to draw, and where it sits inside the model. */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}
export interface Model {
  parts: ModelPart[];
  /** Bounding box of the model in its own units, node transforms applied. */
  box: THREE.Box3;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Model | null>>();
const errors: string[] = [];

/** Keys of the models that could not be loaded since the page was opened. */
export function modelErrors(): string[] {
  return [...errors];
}

function prepare(material: THREE.Material): void {
  // Leaves drawn on a texture with transparency: cut them out instead of blending, and show both sides.
  if (material.transparent) {
    material.transparent = false;
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
  }
}

function toModel(scene: THREE.Object3D): Model {
  scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) prepare(m);
    // Scenery stands still: shape keys are dropped (an instanced mesh cannot play them anyway).
    mesh.geometry.morphAttributes = {};
    parts.push({ geometry: mesh.geometry, material: mesh.material, matrix: mesh.matrixWorld.clone() });
  });
  return { parts, box: new THREE.Box3().setFromObject(scene, true) };
}

/** The model with manifest key `key` ("env/town/well"), or null when it cannot be loaded. */
export function loadModel(key: string): Promise<Model | null> {
  let pending = cache.get(key);
  if (!pending) {
    pending = loader.loadAsync(`/models/${key}.glb`).then(
      (gltf) => toModel(gltf.scene),
      () => {
        errors.push(key);
        return null;
      },
    );
    cache.set(key, pending);
  }
  return pending;
}

export async function loadModels(keys: Iterable<string>): Promise<Map<string, Model | null>> {
  const unique = [...new Set(keys)];
  const loaded = await Promise.all(unique.map(loadModel));
  return new Map(unique.map((key, i) => [key, loaded[i]]));
}
