// Thrown grenades: a flash that blinds and a frag that blasts. Both fly on a simple
// arc, bounce once off a wall or the floor, then go off on a fuse. No models, no files:
// a small dark sphere in flight, a flash of light and a ring at the burst.
import * as THREE from 'three';

const GRAVITY = 12;
const FLASH_FUSE = 1.4;
const FRAG_FUSE = 2.0;
const FLASH_RADIUS = 20;
const FRAG_RADIUS = 7;

export function createGrenades(scene, colliders) {
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.visible = false;
  scene.add(flashMesh);
  const light = new THREE.PointLight(0xffffff, 0, 30);
  scene.add(light);

  const thrown = [];
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  // onBurst(kind, position) is called by main.js; it owns damage and blinding.
  function throwGrenade(kind, from, direction, onBurst) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    const vel = tmp.copy(direction).multiplyScalar(13);
    vel.y += 4.5;
    thrown.push({
      kind, mesh, onBurst,
      vel: vel.clone(),
      fuse: kind === 'flash' ? FLASH_FUSE : FRAG_FUSE,
      bounced: false,
      done: false,
    });
  }

  function burst(g) {
    g.done = true;
    g.mesh.visible = false;
    scene.remove(g.mesh);
    light.position.copy(g.mesh.position);
    light.intensity = g.kind === 'flash' ? 60 : 40;
    flashMesh.position.copy(g.mesh.position);
    flashMesh.scale.setScalar(g.kind === 'flash' ? 8 : 5);
    flashMat.opacity = 0.85;
    flashMesh.visible = true;
    setTimeout(() => { flashMesh.visible = false; flashMat.opacity = 0; light.intensity = 0; }, 120);
    g.onBurst(g.kind, g.mesh.position.clone());
  }

  function step(dt) {
    for (const g of thrown) {
      if (g.done) continue;
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const p = g.mesh.position;
      const nx = p.x + g.vel.x * dt;
      const ny = p.y + g.vel.y * dt;
      const nz = p.z + g.vel.z * dt;
      if (overlaps(nx, p.y, p.z)) { g.vel.x *= -0.4; g.bounced = true; }
      else p.x = nx;
      if (overlaps(p.x, ny, p.z)) { g.vel.y *= -0.4; g.bounced = true; }
      else p.y = ny;
      if (overlaps(p.x, p.y, nz)) { g.vel.z *= -0.4; g.bounced = true; }
      else p.z = nz;
      if (p.y < 0.09) { p.y = 0.09; g.vel.y = Math.abs(g.vel.y) * 0.4; g.bounced = true; }
      if (g.fuse <= 0 || (g.bounced && g.fuse < 0.3)) burst(g);
    }
    for (let i = thrown.length - 1; i >= 0; i -= 1) {
      if (thrown[i].done) thrown.splice(i, 1);
    }
  }

  return { throwGrenade, step, FLASH_RADIUS, FRAG_RADIUS };
}
