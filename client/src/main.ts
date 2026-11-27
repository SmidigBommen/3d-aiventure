import * as THREE from 'three';
import { buildTitleScene } from './titleScene';

// What the smoke test and the production check read. `ready` turns true after the first rendered frame.
declare global {
  interface Window {
    __aiv: { ready: boolean; frames: number };
  }
}
window.__aiv = { ready: false, frames: 0 };

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const { scene, camera, update } = buildTitleScene();

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  update(clock.getElapsedTime());
  renderer.render(scene, camera);
  window.__aiv.frames += 1;
  window.__aiv.ready = true;
});
