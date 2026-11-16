// The armoury: four guns, one set of numbers each. A weapon owns its magazine, its
// reload and the spread that punishes moving fire; main.js owns the ray and the damage.
// The view model is built from boxes in the weapon's own accent: amber for Ember guns.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 22, headMult: 4,
    mag: 12, reserve: 48, auto: false, gap: 0.16, reload: 1.4,
    spreadStill: 0.004, spreadMoving: 0.03, kick: 0.011, kind: 'pistol', range: 60,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Vulture', price: 2700, damage: 34, headMult: 4,
    mag: 30, reserve: 90, auto: true, gap: 0.1, reload: 2.0,
    spreadStill: 0.003, spreadMoving: 0.03, kick: 0.013, kind: 'rifle', range: 80,
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', price: 1500, damage: 24, headMult: 4,
    mag: 32, reserve: 96, auto: true, gap: 0.075, reload: 1.7,
    spreadStill: 0.006, spreadMoving: 0.042, kick: 0.008, kind: 'smg', range: 55,
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', price: 4200, damage: 80, headMult: 2.5,
    mag: 10, reserve: 30, auto: false, gap: 0.5, reload: 2.6,
    spreadStill: 0.001, spreadMoving: 0.012, kick: 0.03, kind: 'dmr', range: 90,
  },
};

export const BUY_ORDER = ['pistol', 'rifle', 'smg', 'dmr'];

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
  sight.position.set(0, 0.075, -0.08);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let def = WEAPONS.pistol;
  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function equip(id) {
    def = WEAPONS[id];
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    // A longer barrel and a taller sight read as the DMR; the SMG reads short.
    barrel.scale.z = id === 'dmr' ? 1.5 : id === 'smg' ? 0.7 : 1;
    barrel.position.z = id === 'dmr' ? -0.5 : id === 'smg' ? -0.32 : -0.38;
    sight.scale.y = id === 'dmr' ? 1.8 : 1;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const take = Math.min(def.mag - state.mag, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    def() { return def; },
    ready() { return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.02 + def.kick * 2;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, ads) {
      const base = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMoving;
      return ads ? base * 0.55 : base;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
