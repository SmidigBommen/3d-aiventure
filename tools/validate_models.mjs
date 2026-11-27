#!/usr/bin/env node
// Load every .glb/.gltf under the given paths and print one line per file:
// size KB, triangles, bounding box (x y z), skin yes/no, animation names.
// For skinned meshes the box is computed from the skinned rest pose (joint world matrices x inverse bind
// matrices), which is what a renderer shows; the mesh node's own transform is ignored, as in three.js.
// usage: node validate.mjs [--json] PATH...   exit code 1 if any file fails to load.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node validate.mjs [--json] PATH...\nPATH is a .glb/.gltf file or a directory searched recursively.');
  process.exit(0);
}
const json = args.includes('--json');
const files = [];
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
  else if (/\.(glb|gltf)$/i.test(p)) files.push(p);
};
args.filter((a) => !a.startsWith('--')).forEach(walk);

const mul = (a, b) => { // column-major 4x4, a*b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
function skinnedBounds(root) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const node of root.listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!mesh) continue;
    if (!skin) { // rigid mesh (weapon, helmet, static prop): plain world transform
      const m = node.getWorldMatrix(), p = [];
      for (const prim of mesh.listPrimitives()) {
        const P = prim.getAttribute('POSITION');
        for (let v = 0; P && v < P.getCount(); v++) {
          P.getElement(v, p);
          for (let r = 0; r < 3; r++) { const x = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]; if (x < min[r]) min[r] = x; if (x > max[r]) max[r] = x; }
          any = true;
        }
      }
      continue;
    }
    const ibm = skin.getInverseBindMatrices();
    const mats = skin.listJoints().map((j, i) => {
      const w = j.getWorldMatrix();
      return ibm ? mul(w, ibm.getElement(i, [])) : w;
    });
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      if (!P || !J || !W) continue;
      const p = [], j = [], w = [];
      for (let v = 0; v < P.getCount(); v++) {
        P.getElement(v, p); J.getElement(v, j); W.getElement(v, w);
        const o = [0, 0, 0]; let ws = 0;
        for (let k = 0; k < 4; k++) {
          if (!w[k]) continue;
          const m = mats[j[k]]; ws += w[k];
          for (let r = 0; r < 3; r++) o[r] += w[k] * (m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
        }
        if (!ws) continue;
        for (let r = 0; r < 3; r++) { const x = o[r] / ws; if (x < min[r]) min[r] = x; if (x > max[r]) max[r] = x; }
        any = true;
      }
    }
  }
  return any ? { min, max } : null;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = [];
let failed = 0;
for (const f of files) {
  try {
    const doc = await io.read(f);
    const root = doc.getRoot();
    let tris = 0;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      const n = prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount();
      if (mode === 4) tris += n / 3; else if (mode === 5 || mode === 6) tris += n - 2;
    }
    const scene = root.getDefaultScene() || root.listScenes()[0];
    const { min, max } = (root.listSkins().length && skinnedBounds(root)) || getBounds(scene);
    const size = max.map((v, i) => +(v - min[i]).toFixed(2));
    let kb = fs.statSync(f).size;
    if (/\.gltf$/i.test(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const r of [...(j.buffers || []), ...(j.images || [])])
        if (r.uri && !r.uri.startsWith('data:')) kb += fs.statSync(path.join(path.dirname(f), decodeURIComponent(r.uri))).size;
    }
    out.push({ file: f, kb: Math.round(kb / 1024), tris: Math.round(tris), size, minY: +min[1].toFixed(2), skin: root.listSkins().length > 0,
      textures: root.listTextures().length, animations: root.listAnimations().map((a) => a.getName()) });
  } catch (e) {
    failed++;
    out.push({ file: f, error: String(e.message || e).slice(0, 200) });
  }
}
if (json) console.log(JSON.stringify(out, null, 1));
else for (const o of out)
  console.log(o.error ? `FAIL ${o.file}: ${o.error}`
    : `${o.file} | ${o.kb} KB | ${o.tris} tris | ${o.size.join(' x ')} (minY ${o.minY}) | skin ${o.skin ? 'yes' : 'no'} | tex ${o.textures} | ${o.animations.join(',') || 'no animations'}`);
console.error(`${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
