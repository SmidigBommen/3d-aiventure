import * as THREE from 'three';

/** The backdrop behind the title screen: a ring of standing stones in fog, slowly circled by the camera. */
export function buildTitleScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1626);
  scene.fog = new THREE.Fog(0x1a1626, 12, 48);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0x8b8fc7, 0x2a1f14, 1.1));
  const moon = new THREE.DirectionalLight(0xcfd6ff, 1.4);
  moon.position.set(8, 14, 6);
  scene.add(moon);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshStandardMaterial({ color: 0x2c3a2a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const stone = new THREE.MeshStandardMaterial({ color: 0x6f6a78, roughness: 0.9, flatShading: true });
  const count = 9;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const h = 3 + (i % 3) * 0.8;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 0.8), stone);
    pillar.position.set(Math.cos(a) * 7, h / 2, Math.sin(a) * 7);
    pillar.rotation.y = -a + (i % 2) * 0.2;
    scene.add(pillar);
  }

  const crown = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.16, 10, 5),
    new THREE.MeshStandardMaterial({ color: 0xd4a94a, emissive: 0x6b4a10, metalness: 0.8, roughness: 0.3, flatShading: true }),
  );
  crown.position.set(0, 1.8, 0);
  crown.rotation.x = Math.PI / 2;
  scene.add(crown);
  const glow = new THREE.PointLight(0xffc860, 30, 14);
  glow.position.set(0, 2.2, 0);
  scene.add(glow);

  const update = (t: number): void => {
    const a = t * 0.08;
    camera.position.set(Math.cos(a) * 15, 3.2, Math.sin(a) * 15);
    camera.lookAt(0, 1.6, 0);
    crown.rotation.z = t * 0.5;
    crown.position.y = 1.8 + Math.sin(t * 1.3) * 0.12;
  };
  update(0);
  return { scene, camera, update };
}
