import * as THREE from 'three';
import { SHARD_COLOURS } from './world/campaign';

/**
 * The scene behind the epilogue: the Crown of Unity restored, slowly turning under a dawn sky.
 * Plain geometry only: a gold band with five points, and a gem per shard in the shard's colour.
 */
export function buildEndingScene(shards: string[]): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void; dispose: () => void } {
  const scene = new THREE.Scene();
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };

  // Dawn: night blue overhead, rose and gold at the horizon.
  const sky = new THREE.Mesh(
    own(new THREE.SphereGeometry(120, 24, 16)),
    own(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x27325e) }, middle: { value: new THREE.Color(0xd9788a) }, low: { value: new THREE.Color(0xffd27a) } },
      vertexShader: 'varying float h; void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 middle; uniform vec3 low; varying float h;'
        + ' void main() { float t = clamp(h * 1.6 + 0.12, 0.0, 1.0); vec3 c = t < 0.35 ? mix(low, middle, t / 0.35) : mix(middle, top, (t - 0.35) / 0.65); gl_FragColor = vec4(c, 1.0); }',
    })),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog(0xe0a08a, 30, 110);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x3a2f4a, 1.3));
  const sun = new THREE.DirectionalLight(0xffc27a, 2.4);
  sun.position.set(-6, 4, -10);
  scene.add(sun);

  const ground = new THREE.Mesh(own(new THREE.CircleGeometry(110, 48)), own(new THREE.MeshStandardMaterial({ color: 0x4a4352, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const plinth = new THREE.Mesh(own(new THREE.CylinderGeometry(1.5, 1.9, 1.1, 10)), own(new THREE.MeshStandardMaterial({ color: 0x8a8292, roughness: 0.9, flatShading: true })));
  plinth.position.y = 0.55;
  scene.add(plinth);

  const gold = own(new THREE.MeshStandardMaterial({ color: 0xd4a94a, emissive: 0x6b4a10, metalness: 0.85, roughness: 0.28, flatShading: true, side: THREE.DoubleSide }));
  const crown = new THREE.Group();
  const RADIUS = 1;
  const band = new THREE.Mesh(own(new THREE.CylinderGeometry(RADIUS, RADIUS, 0.5, 40, 1, true)), gold);
  crown.add(band);
  for (const y of [-0.25, 0.25]) {
    const rim = new THREE.Mesh(own(new THREE.TorusGeometry(RADIUS, 0.05, 8, 40)), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    crown.add(rim);
  }
  const point = own(new THREE.ConeGeometry(0.22, 0.75, 4));
  const gemShape = own(new THREE.OctahedronGeometry(0.17));
  const gems: THREE.Mesh[] = [];
  const names = shards.length > 0 ? shards : Object.keys(SHARD_COLOURS);
  names.slice(0, 5).forEach((name, i) => {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.sin(a) * RADIUS;
    const z = Math.cos(a) * RADIUS;
    const spike = new THREE.Mesh(point, gold);
    spike.position.set(x, 0.62, z);
    spike.rotation.y = a + Math.PI / 4;
    crown.add(spike);
    const colour = new THREE.Color(Object.prototype.hasOwnProperty.call(SHARD_COLOURS, name) ? SHARD_COLOURS[name] : '#d4af37');
    const gem = new THREE.Mesh(gemShape, own(new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.7, roughness: 0.15, flatShading: true })));
    gem.position.set(Math.sin(a) * (RADIUS + 0.06), 0, Math.cos(a) * (RADIUS + 0.06));
    gem.scale.set(1, 1.3, 0.6);
    gem.rotation.y = a;
    crown.add(gem);
    gems.push(gem);
  });
  crown.position.y = 2.6;
  scene.add(crown);
  const glow = new THREE.PointLight(0xffd27a, 40, 18);
  glow.position.set(0, 3.6, 0);
  scene.add(glow);

  const update = (t: number): void => {
    crown.rotation.y = t * 0.35;
    crown.position.y = 2.6 + Math.sin(t * 0.9) * 0.08;
    for (const [i, gem] of gems.entries()) (gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(t * 1.7 + i * 1.3) * 0.25;
    // The crown sits in the upper half of the view, above the panel.
    camera.position.set(Math.sin(t * 0.05) * 0.6, 2.5, 6.2);
    camera.lookAt(0, 1.75, 0);
  };
  update(0);
  return { scene, camera, update, dispose: () => owned.forEach((thing) => thing.dispose()) };
}
