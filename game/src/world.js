// Duskworks Yard: a decommissioned freight yard at dusk, built from boxes. Three lanes
// run south to north — A on the west, Mid in the centre, B on the east — between two
// bomb sites at the north end. Every box is a collider and a surface a bullet stops on.
// Plain geometry only, no models and no textures; the palette and the low amber sun do
// the styling. Waypoints below are the graph the bots walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { x: -19, z: -13, name: 'Site A' },
  B: { x: 19, z: -13, name: 'Site B' },
};

export const SPAWNS = {
  ember: [
    [-3, 17], [0, 17.5], [3, 17], [-1.5, 15], [1.5, 15],
  ],
  vanta: [
    [-3, -17], [0, -17.5], [3, -17], [-1.5, -15], [1.5, -15],
  ],
};

// Waypoint graph: nodes by name, edges by name. Bots path with BFS over it.
export const WAYPOINTS = {
  emberSpawn: { x: 0, z: 16, links: ['midSouth', 'aSouth', 'bSouth'] },
  midSouth: { x: 0, z: 10, links: ['emberSpawn', 'mid', 'aSouth', 'bSouth'] },
  mid: { x: 0, z: 3, links: ['midSouth', 'midNorth', 'aConn', 'bConn'] },
  midNorth: { x: 0, z: -7, links: ['mid', 'vantaSpawn', 'vantaA', 'vantaB'] },
  aSouth: { x: -17, z: 11, links: ['emberSpawn', 'midSouth', 'aMid'] },
  aMid: { x: -19, z: 1, links: ['aSouth', 'aSite', 'aConn'] },
  aSite: { x: -19, z: -12, links: ['aMid', 'vantaA'] },
  aConn: { x: -9, z: -7, links: ['mid', 'aMid', 'vantaA'] },
  bSouth: { x: 17, z: 11, links: ['emberSpawn', 'midSouth', 'bMid'] },
  bMid: { x: 19, z: 1, links: ['bSouth', 'bSite', 'bConn'] },
  bSite: { x: 19, z: -12, links: ['bMid', 'vantaB'] },
  bConn: { x: 9, z: -7, links: ['mid', 'bMid', 'vantaB'] },
  vantaSpawn: { x: 0, z: -16, links: ['midNorth', 'vantaA', 'vantaB'] },
  vantaA: { x: -12, z: -14, links: ['vantaSpawn', 'midNorth', 'aSite', 'aConn'] },
  vantaB: { x: 12, z: -14, links: ['vantaSpawn', 'midNorth', 'bSite', 'bConn'] },
};

// Breadth-first route between two waypoint names; returns an array of {x, z} to follow.
export function findRoute(from, to) {
  if (from === to) return [WAYPOINTS[to]];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const name = queue.shift();
    for (const link of WAYPOINTS[name].links) {
      if (prev[link] !== undefined) continue;
      prev[link] = name;
      if (link === to) {
        const path = [];
        let at = to;
        while (at) {
          path.unshift(WAYPOINTS[at]);
          at = prev[at];
        }
        return path;
      }
      queue.push(link);
    }
  }
  return [WAYPOINTS[to]];
}

export function nearestWaypoint(x, z) {
  let best = 'mid';
  let bestD = Infinity;
  for (const [name, node] of Object.entries(WAYPOINTS)) {
    const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // Dusk sky: a gradient dome (zenith indigo down to an amber horizon band) and a
  // low sun glow to the west, both generated on canvas — no textures, no network.
  // The dome is BackSide and ignores fog, so the walls fade into it instead of
  // into a flat background colour.
  function gradientTexture(stops, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const skyTex = gradientTexture([
    [0, PALETTE.canvas], [0.3, PALETTE.surface], [0.42, PALETTE.rust],
    [0.5, PALETTE.accent], [0.56, PALETTE.rust], [0.75, PALETTE.surface],
    [1, PALETTE.canvas],
  ], 8, 512);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(130, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(skyDome);
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 128;
  sunCanvas.height = 128;
  const sunCtx = sunCanvas.getContext('2d');
  const sunGrad = sunCtx.createRadialGradient(64, 64, 4, 64, 64, 64);
  sunGrad.addColorStop(0, 'rgba(255, 214, 140, 1)');
  sunGrad.addColorStop(0.3, 'rgba(240, 168, 48, 0.55)');
  sunGrad.addColorStop(1, 'rgba(240, 168, 48, 0)');
  sunCtx.fillStyle = sunGrad;
  sunCtx.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false }));
  sunGlow.position.set(-105, 16, 5);
  sunGlow.scale.setScalar(36);
  scene.add(sunGlow);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'container' || name === 'containerB' ? 0.25 : 0.03,
    });
  }
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.55,
    roughness: 0.6,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and outer walls: 52 x 40 m yard, 5 m walls, open to the dusk sky.
  box(52.4, 0.4, 40.4, 0, -0.2, 0, 'ground');
  box(0.4, 5, 40.4, -26.2, 2.5, 0, 'surface');
  box(0.4, 5, 40.4, 26.2, 2.5, 0, 'surface');
  box(52.4, 5, 0.4, 0, 2.5, -20.2, 'surface');
  box(52.4, 5, 0.4, 0, 2.5, 20.2, 'surface');

  // Mid: an S-bend through two pillars and a low block, so the centre lane is never a
  // single straight sightline.
  box(2, 3.4, 2, -2.5, 1.7, -1, 'hairline');
  box(2, 3.4, 2, 2.5, 1.7, 5, 'hairline');
  box(4.5, 1.1, 1.4, 0, 0.55, 8, 'rust');
  box(3.6, 1.1, 1.2, -5.5, 0.55, -4.5, 'rust');
  box(3.6, 1.1, 1.2, 5.5, 0.55, -4.5, 'rust');

  // A lane (west): container stack and crates make corners and a crouch-height wall.
  box(6, 2.6, 2.4, -15, 1.3, 4, 'container');
  box(6, 2.6, 2.4, -21, 1.3, -4, 'containerB');
  box(1.2, 1.1, 1.2, -22, 0.55, 7, 'rust');
  box(1.2, 1.1, 1.2, -13, 0.55, -6, 'rust');
  box(3.4, 1.1, 1, -19, 0.55, -8.5, 'hairline');
  box(2.4, 2.6, 2.4, -23.5, 1.3, -13, 'container');
  // B lane (east): mirrored, different dressing so the two lanes read apart.
  box(6, 2.6, 2.4, 15, 1.3, 4, 'containerB');
  box(6, 2.6, 2.4, 21, 1.3, -4, 'container');
  box(1.2, 1.1, 1.2, 22, 0.55, 7, 'rust');
  box(1.2, 1.1, 1.2, 13, 0.55, -6, 'rust');
  box(3.4, 1.1, 1, 19, 0.55, -8.5, 'hairline');
  box(2.4, 2.6, 2.4, 23.5, 1.3, -13, 'containerB');

  // North wall cover: crates the defenders hold behind, and the mid connector blocks.
  box(1.6, 0.9, 1.6, -6, 0.45, -16, 'rust');
  box(1.6, 0.9, 1.6, 6, 0.45, -16, 'rust');
  box(2, 2.8, 1, -9, 1.4, -10, 'hairline');
  box(2, 2.8, 1, 9, 1.4, -10, 'hairline');
  // South spawn cover.
  box(2.4, 0.9, 1.2, -5, 0.45, 14, 'hairline');
  box(2.4, 0.9, 1.2, 5, 0.45, 14, 'hairline');

  // Two freight rail pairs down the yard, flat on the ground: ballast beds and
  // steel rails. Visual only (collide=false) — they never block a bot or a bullet.
  for (const cx of [-6.1, 6.1]) {
    box(2.6, 0.05, 38, cx, 0.025, 0, 'hairline', false);
    box(0.16, 0.06, 38, cx - 0.8, 0.05, 0, 'container', false);
    box(0.16, 0.06, 38, cx + 0.8, 0.05, 0, 'container', false);
  }

  // Bomb sites: glowing amber pads with four corner posts each. The pads are visual
  // only; the site itself is the SITES coordinate above. A floating letter above
  // each pad names the site at a glance, from anywhere in the yard.
  function letterTexture(letter) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    g.font = '700 190px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = PALETTE.canvas;
    g.strokeText(letter, 128, 138);
    g.fillStyle = PALETTE.accent;
    g.fillText(letter, 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  for (const [key, site] of Object.entries(SITES)) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 4.4), siteMat);
    pad.position.set(site.x, 0.04, site.z);
    pad.receiveShadow = true;
    group.add(pad);
    const letter = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(key), transparent: true, depthWrite: false, fog: false }));
    letter.position.set(site.x, 5.4, site.z);
    letter.scale.setScalar(4);
    scene.add(letter);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), materials.accent);
      post.position.set(site.x + dx, 0.75, site.z + dz);
      post.castShadow = true;
      group.add(post);
    }
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 12);
    lamp.position.set(site.x, 3.2, site.z);
    scene.add(lamp);
  }

  // A gantry crane silhouette across the north end: two legs and a beam, yard dressing.
  box(0.8, 6, 0.8, -14, 3, -19, 'hairline');
  box(0.8, 6, 0.8, 14, 3, -19, 'hairline');
  box(28.8, 0.8, 0.8, 0, 6.2, -19, 'hairline');

  // Light: a low amber sun from the west, a cool fill from the east, dusk sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#3a4a6b'), new THREE.Color(PALETTE.ground), 0.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-22, 10, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(14, 9, -12);
  scene.add(fill);

  return { colliders, shootables, group };
}
