#!/usr/bin/env node
// Writes client/src/world/models.json: one entry per .glb under client/public/models.
//   key    the file's path under client/public/models without ".glb" ("env/town/well")
//   size   bounding size [x, y, z] in file units with the node transforms applied; for a file with
//          a skin, the skinned rest pose (the measure tools/validate_models.mjs prints)
//   triangles   triangle count over the file's meshes
// The dressing (client/src/world/dressing.ts) and its tests compute footprints from this file.
// Reads the .glb files itself; needs no package.
// usage: node tools/make_model_manifest.mjs [--check] [--models DIR] [--out FILE]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`usage: node tools/make_model_manifest.mjs [--check] [--models DIR] [--out FILE]
Measures every .glb under DIR (default client/public/models) and writes FILE
(default client/src/world/models.json): { "<key>": { "size": [x, y, z], "triangles": n } }.
--check   write nothing; exit 1 when FILE differs from what would be written`);
  process.exit(0);
}
const modelsDir = path.resolve(arg('--models', path.join(root, 'client/public/models')));
const outFile = path.resolve(arg('--out', path.join(root, 'client/src/world/models.json')));

/** The JSON and binary chunks of a .glb file. */
export function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('not a .glb file');
  let json = null;
  let bin = null;
  for (let at = 12; at < data.length; ) {
    const length = data.readUInt32LE(at);
    const type = data.readUInt32LE(at + 4);
    const chunk = data.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942 && !bin) bin = chunk;
    at += 8 + length;
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, bin };
}

const COMPONENTS = {
  5120: [1, (b, o) => b.readInt8(o), 127],
  5121: [1, (b, o) => b.readUInt8(o), 255],
  5122: [2, (b, o) => b.readInt16LE(o), 32767],
  5123: [2, (b, o) => b.readUInt16LE(o), 65535],
  5125: [4, (b, o) => b.readUInt32LE(o), 1],
  5126: [4, (b, o) => b.readFloatLE(o), 1],
};
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Reads accessor `index` as an array of elements (each an array of numbers). */
export function readAccessor({ json, bin }, index) {
  const accessor = json.accessors[index];
  if (accessor.sparse) throw new Error('sparse accessors are not supported');
  const view = json.bufferViews[accessor.bufferView];
  if (view.buffer !== 0 || !bin) throw new Error('only the embedded buffer is supported');
  const [bytes, read, max] = COMPONENTS[accessor.componentType];
  const width = WIDTH[accessor.type];
  const stride = view.byteStride || bytes * width;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Array(accessor.count);
  for (let i = 0; i < accessor.count; i++) {
    const element = new Array(width);
    for (let c = 0; c < width; c++) {
      const value = read(bin, start + i * stride + c * bytes);
      element[c] = accessor.normalized ? Math.max(value / max, -1) : value;
    }
    out[i] = element;
  }
  return out;
}

// Column-major 4x4 matrices, as in glTF.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
/** World matrix of every node (identity for a node outside every scene's tree). */
function worldMatrices(json) {
  const nodes = json.nodes || [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => (node.children || []).forEach((child) => (parent[child] = i)));
  const world = new Array(nodes.length);
  const of = (i) => world[i] || (world[i] = parent[i] < 0 ? localMatrix(nodes[i]) : multiply(of(parent[i]), localMatrix(nodes[i])));
  nodes.forEach((_, i) => of(i));
  return world;
}

/** Bounding box and triangle count of one .glb file. */
export function measure(file) {
  const glb = readGlb(file);
  const { json } = glb;
  const nodes = json.nodes || [];
  const world = worldMatrices(json);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (m, p) => {
    for (let r = 0; r < 3; r++) {
      const v = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
      if (v < min[r]) min[r] = v;
      if (v > max[r]) max[r] = v;
    }
  };
  const growAll = (o) => {
    for (let r = 0; r < 3; r++) {
      if (o[r] < min[r]) min[r] = o[r];
      if (o[r] > max[r]) max[r] = o[r];
    }
  };
  const positions = new Map();
  const read = (index) => positions.get(index) || positions.set(index, readAccessor(glb, index)).get(index);

  const skinned = (json.skins || []).length > 0;
  // Without a skin: the nodes of the default scene. With one: every node that has a mesh.
  const inScene = new Set();
  if (!skinned) {
    const scene = (json.scenes || [])[json.scene ?? 0];
    const visit = (i) => {
      inScene.add(i);
      (nodes[i].children || []).forEach(visit);
    };
    (scene ? scene.nodes : nodes.map((_, i) => i)).forEach(visit);
  }
  nodes.forEach((node, i) => {
    if (node.mesh === undefined || (!skinned && !inScene.has(i))) return;
    const primitives = json.meshes[node.mesh].primitives;
    if (node.skin === undefined) {
      for (const prim of primitives) if (prim.attributes.POSITION !== undefined) for (const p of read(prim.attributes.POSITION)) grow(world[i], p);
      return;
    }
    // Skinned rest pose: joint world matrix x inverse bind matrix, blended by the weights.
    const skin = json.skins[node.skin];
    const inverse = skin.inverseBindMatrices !== undefined ? readAccessor(glb, skin.inverseBindMatrices) : null;
    const joints = skin.joints.map((j, k) => (inverse ? multiply(world[j], inverse[k]) : world[j]));
    for (const prim of primitives) {
      const { POSITION, JOINTS_0, WEIGHTS_0 } = prim.attributes;
      if (POSITION === undefined || JOINTS_0 === undefined || WEIGHTS_0 === undefined) continue;
      const P = read(POSITION);
      const J = readAccessor(glb, JOINTS_0);
      const W = readAccessor(glb, WEIGHTS_0);
      for (let v = 0; v < P.length; v++) {
        const o = [0, 0, 0];
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = W[v][k];
          if (!w) continue;
          const m = joints[J[v][k]];
          sum += w;
          for (let r = 0; r < 3; r++) o[r] += w * (m[r] * P[v][0] + m[4 + r] * P[v][1] + m[8 + r] * P[v][2] + m[12 + r]);
        }
        if (sum) growAll(o.map((value) => value / sum));
      }
    }
  });

  let triangles = 0;
  for (const mesh of json.meshes || [])
    for (const prim of mesh.primitives) {
      const mode = prim.mode ?? 4;
      const n = json.accessors[prim.indices ?? prim.attributes.POSITION].count;
      if (mode === 4) triangles += n / 3;
      else if (mode === 5 || mode === 6) triangles += n - 2;
    }
  if (!Number.isFinite(min[0])) throw new Error('no geometry');
  return { min, max, triangles: Math.round(triangles) };
}

function glbFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return glbFiles(full);
    return entry.name.endsWith('.glb') ? [full] : [];
  });
}

function main() {
  const manifest = {};
  for (const file of glbFiles(modelsDir)) {
    const key = path.relative(modelsDir, file).split(path.sep).join('/').replace(/\.glb$/, '');
    try {
      const { min, max, triangles } = measure(file);
      // A size of 0 (a flat plane) would make scale meaningless; no file has one today.
      manifest[key] = { size: max.map((v, i) => Math.max(+(v - min[i]).toFixed(3), 0.001)), triangles };
    } catch (error) {
      console.error(`${key}: ${error.message}`);
      process.exit(1);
    }
  }
  const lines = Object.entries(manifest).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const text = `{\n${lines.join(',\n')}\n}\n`;
  if (args.includes('--check')) {
    const same = fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === text;
    console.log(same ? `${path.relative(root, outFile)} is up to date` : `${path.relative(root, outFile)} is out of date; run node tools/make_model_manifest.mjs`);
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(outFile, text);
  console.log(`${Object.keys(manifest).length} models written to ${path.relative(root, outFile)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
