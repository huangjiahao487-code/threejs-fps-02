// The objective: plant the charge on a site, defend it until it blows, or defuse it.
// One state machine, driven by main.js: idle -> planting -> planted -> (detonated |
// defused), with a defuse in progress on top of planted. Beeps speed up as the fuse runs.
import * as THREE from 'three';
import { SITES } from './world.js';

export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 35;

export function createBomb(scene) {
  const geo = new THREE.BoxGeometry(0.5, 0.3, 0.34);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4, metalness: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampMat);
  lamp.position.set(0.18, 0.17, 0);
  mesh.add(body, lamp);
  mesh.visible = false;
  scene.add(mesh);
  const light = new THREE.PointLight(0xff3020, 0, 6);
  scene.add(light);

  const state = {
    status: 'idle', // idle | planting | planted | detonated | defused
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    fuseLeft: FUSE_TIME,
    position: new THREE.Vector3(),
    lastBeep: 0,
  };

  function siteNear(x, z) {
    for (const [key, site] of Object.entries(SITES)) {
      if (Math.abs(x - site.x) < 2.4 && Math.abs(z - site.z) < 2.4) return key;
    }
    return null;
  }

  function startPlant(siteKey, x, z) {
    state.status = 'planting';
    state.site = siteKey;
    state.plantProgress = 0;
    state.position.set(x, 0, z);
  }

  function cancelPlant() {
    if (state.status !== 'planting') return;
    state.status = 'idle';
    state.site = null;
    state.plantProgress = 0;
  }

  function finishPlant() {
    state.status = 'planted';
    state.fuseLeft = FUSE_TIME;
    state.defuseProgress = 0;
    state.lastBeep = 0;
    mesh.position.set(state.position.x, 0.18, state.position.z);
    mesh.visible = true;
    light.position.set(state.position.x, 0.6, state.position.z);
    light.intensity = 6;
  }

  // Returns 'detonated' when the fuse runs out, else null. beep() is called by main.js
  // when the beep timer fires, so the sound lives in one place.
  function step(dt, onBeep) {
    if (state.status === 'planting') {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) finishPlant();
      return null;
    }
    if (state.status !== 'planted') return null;
    state.fuseLeft -= dt;
    const interval = state.fuseLeft > 20 ? 1 : state.fuseLeft > 10 ? 0.5 : 0.25;
    state.lastBeep += dt;
    if (state.lastBeep >= interval) {
      state.lastBeep = 0;
      onBeep(state.fuseLeft <= 10);
    }
    lampMat.color.setHex(Math.floor(performance.now() / 120) % 2 ? 0xff3020 : 0x881108);
    if (state.fuseLeft <= 0) {
      state.status = 'detonated';
      mesh.visible = false;
      light.intensity = 0;
      return 'detonated';
    }
    return null;
  }

  // The charge on the ground where its carrier fell: visible, inert, waiting to be
  // picked up. Status stays idle; main.js tracks who carries it.
  function drop(x, z) {
    state.position.set(x, 0, z);
    mesh.position.set(x, 0.18, z);
    mesh.visible = true;
    light.position.set(x, 0.6, z);
    light.intensity = 3;
  }

  function pickup() {
    mesh.visible = false;
    light.intensity = 0;
  }

  function reset() {
    state.status = 'idle';
    state.site = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.fuseLeft = FUSE_TIME;
    mesh.visible = false;
    light.intensity = 0;
  }

  return {
    state, siteNear, startPlant, cancelPlant, finishPlant, step, reset, drop, pickup,
    defuseStep(dt) {
      if (state.status !== 'planted') return false;
      state.defuseProgress += dt;
      if (state.defuseProgress >= DEFUSE_TIME) {
        state.status = 'defused';
        mesh.visible = false;
        light.intensity = 0;
        return true;
      }
      return false;
    },
  };
}
