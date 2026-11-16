// The bots: nine of them, four beside the player and five against. Each one is a
// low-poly figure built from boxes, and a small state machine: it walks a waypoint
// route to its site, holds and scans, engages what it can see, and reacts to sound.
// It shoots with the same hitscan ray main.js fires for the player, so a bot's bullets
// stop on walls and can hit a head. Bomb roles: the carrier plants, defenders defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './mover.js';
import { findRoute, nearestWaypoint, WAYPOINTS } from './world.js';
import { WEAPONS } from './weapons.js';

const BOT_SPEED = 3.8;
const VISION_RANGE = 34;
const VISION_HALF_FOV = 1.0;
const REACT_MIN = 0.35;
const REACT_MAX = 0.7;
const HEAR_RANGE = 20;

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Sable'];
const VANTA_NAMES = ['Vex', 'Noct', 'Umbra', 'Wraith', 'Hollow'];

export function createBots(scene, world, fireHitscan, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VISION_RANGE;
  const losDir = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.28, 0.3);
  const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.24);
  const armGeo = new THREE.BoxGeometry(0.14, 0.5, 0.16);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.6);

  const mats = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6 }),
    vanta: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.vanta), roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262c'), roughness: 0.85 }),
    skin: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a582'), roughness: 0.7 }),
  };

  const bots = [];
  const hitMeshes = [];

  function buildMesh(team) {
    const group = new THREE.Group();
    // Torso and head get their own material instances per bot, so a hit flash
    // lights up exactly the bot that was shot, not the whole team.
    const torsoMat = mats[team].clone();
    torsoMat.emissive = new THREE.Color(0xffffff);
    torsoMat.emissiveIntensity = 0;
    const headMat = mats.skin.clone();
    headMat.emissive = new THREE.Color(0xffffff);
    headMat.emissiveIntensity = 0;
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.12;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), mats[team]);
    visor.position.set(0, 1.62, -0.16);
    const legL = new THREE.Mesh(legGeo, mats.dark);
    legL.position.set(-0.13, 0.38, 0);
    const legR = new THREE.Mesh(legGeo, mats.dark);
    legR.position.set(0.13, 0.38, 0);
    const armL = new THREE.Mesh(armGeo, mats.dark);
    armL.position.set(-0.32, 1.1, -0.08);
    armL.rotation.x = -0.9;
    const armR = new THREE.Mesh(armGeo, mats.dark);
    armR.position.set(0.32, 1.1, -0.08);
    armR.rotation.x = -0.9;
    const gun = new THREE.Mesh(gunGeo, mats.dark);
    gun.position.set(0.1, 1.05, -0.42);
    group.add(torso, head, visor, legL, legR, armL, armR, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    return { group, torso, head, gun, torsoMat, headMat };
  }

  function makeBot(team, name, weaponId) {
    const parts = buildMesh(team);
    scene.add(parts.group);
    const mover = createMover(world.colliders, 0.34, 1.72);
    const bot = {
      team, name, weapon: WEAPONS[weaponId],
      mover, group: parts.group, torso: parts.torso, head: parts.head,
      torsoMat: parts.torsoMat, headMat: parts.headMat, flash: 0,
      health: 100, alive: true,
      yaw: 0, pitch: 0, eye: 1.55,
      state: 'route', route: [], routeIndex: 0, holdUntil: 0, scanBase: 0,
      target: null, lastSeen: new THREE.Vector3(), reactAt: 0,
      burstLeft: 0, nextShotAt: 0, visionAt: Math.random() * 0.15,
      blindUntil: 0, stuckAt: 0, stuckPos: new THREE.Vector3(),
      alertPos: null, carrying: false, defusing: false, planting: false,
      fall: 0, walkPhase: 0,
    };
    parts.torso.userData.bot = bot;
    parts.head.userData.bot = bot;
    hitMeshes.push(parts.torso, parts.head);
    bots.push(bot);
    return bot;
  }

  function spawnRound() {
    for (const bot of bots) {
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.visible = true;
      bot.blindUntil = 0;
      bot.target = null;
      bot.carrying = false;
      bot.defusing = false;
      bot.planting = false;
      bot.state = 'route';
      bot.routeIndex = 0;
      bot.flash = 0;
      bot.torsoMat.emissiveIntensity = 0;
      bot.headMat.emissiveIntensity = 0;
    }
    // Ember split: two to A, two to B (the fifth Ember is the player). Vanta split:
    // two hold A, two hold B, one roams mid.
    const emberTargets = ['aSite', 'aSite', 'bSite', 'bSite'];
    const vantaTargets = ['aSite', 'aSite', 'bSite', 'bSite', 'midNorth'];
    let ei = 0;
    let vi = 0;
    bots.forEach((bot) => {
      const isEmber = bot.team === 'ember';
      const idx = isEmber ? ei++ : vi++;
      const spawn = isEmber
        ? [[-3, 17], [3, 17], [-1.5, 15], [1.5, 15]][idx]
        : [[-3, -17], [3, -17], [-1.5, -15], [1.5, -15], [0, -16]][idx];
      bot.mover.state.position.set(spawn[0], 0, spawn[1]);
      bot.mover.state.velocity.set(0, 0, 0);
      bot.yaw = isEmber ? Math.PI : 0;
      const target = isEmber ? emberTargets[idx] : vantaTargets[idx];
      bot.route = findRoute(nearestWaypoint(spawn[0], spawn[1]), target);
      bot.routeIndex = 0;
      bot.routeTarget = null;
      bot.holdSite = target;
      bot.group.position.copy(bot.mover.state.position);
    });
  }

  function reset() {
    bots.length = 0;
    hitMeshes.length = 0;
  }

  function ensureBots() {
    if (bots.length) return;
    EMBER_NAMES.forEach((name, i) => {
      const w = ['rifle', 'rifle', 'smg', 'dmr'][i];
      makeBot('ember', name, w);
    });
    VANTA_NAMES.forEach((name, i) => {
      const w = ['rifle', 'rifle', 'smg', 'smg', 'dmr'][i];
      makeBot('vanta', name, w);
    });
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
    return n;
  }

  function eyePos(bot, out) {
    return out.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.eye, bot.mover.state.position.z);
  }

  function hasLineOfSight(from, to) {
    losDir.copy(to).sub(from);
    const dist = losDir.length();
    if (dist > VISION_RANGE) return false;
    losDir.divideScalar(dist || 1);
    raycaster.set(from, losDir);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  // The nearest living enemy this bot can see: in range, inside its view cone, with a
  // clear line. Checked on a stagger so nine bots do not raycast every frame.
  function seeEnemy(bot, player, now) {
    const from = eyePos(bot, tmpV);
    let best = null;
    let bestD = Infinity;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const consider = (pos, ref, isPlayer) => {
      const dx = pos.x - from.x;
      const dy = pos.y - from.y;
      const dz = pos.z - from.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > VISION_RANGE || d >= bestD) return;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < Math.cos(VISION_HALF_FOV) && d > 3) return;
      if (!hasLineOfSight(from, pos)) return;
      best = { ref, isPlayer, pos: pos.clone(), dist: d };
      bestD = d;
    };
    if (player.alive) {
      consider(new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z), player, true);
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      consider(new THREE.Vector3(other.mover.state.position.x, other.mover.state.position.y + 1.2, other.mover.state.position.z), other, false);
    }
    return best;
  }

  function aimAt(bot, point, dt) {
    const p = bot.mover.state.position;
    const dx = point.x - p.x;
    const dy = point.y - (p.y + bot.eye);
    const dz = point.z - p.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1))));
    let dyaw = wantYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turn = 7 * dt;
    bot.yaw += Math.max(-turn, Math.min(turn, dyaw));
    bot.pitch += Math.max(-turn, Math.min(turn, wantPitch - bot.pitch));
  }

  function fireBurst(bot, ctx) {
    if (bot.burstLeft <= 0 || ctx.time < bot.nextShotAt) return;
    bot.burstLeft -= 1;
    bot.nextShotAt = ctx.time + bot.weapon.gap + Math.random() * 0.03;
    const target = bot.target;
    if (!target) return;
    const from = eyePos(bot, new THREE.Vector3());
    const aim = target.pos.clone();
    aim.y += Math.random() < 0.12 ? 0.4 : 0; // a few rounds go for the head
    const dist = from.distanceTo(aim);
    const spread = 0.02 + dist * 0.0009 + (target.moving ? 0.012 : 0);
    aimDir.copy(aim).sub(from).normalize();
    aimDir.x += (Math.random() * 2 - 1) * spread;
    aimDir.y += (Math.random() * 2 - 1) * spread;
    aimDir.z += (Math.random() * 2 - 1) * spread;
    aimDir.normalize();
    fireHitscan(bot, from, aimDir, bot.weapon);
    audio.shot(bot.weapon.kind, Math.min(1, dist / 40));
  }

  function stepBot(bot, dt, ctx) {
    const now = ctx.time;
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.5;
      }
      return;
    }
    const blinded = now < bot.blindUntil;
    // Hit flash: a bot that was just shot glows white for a blink, then fades.
    if (bot.flash > 0) {
      bot.flash = Math.max(0, bot.flash - dt);
      const k = bot.flash / 0.12;
      bot.torsoMat.emissiveIntensity = k;
      bot.headMat.emissiveIntensity = k;
    }
    // Vision, staggered.
    if (now >= bot.visionAt) {
      bot.visionAt = now + 0.15 + Math.random() * 0.05;
      const seen = blinded ? null : seeEnemy(bot, ctx.player, now);
      if (seen) {
        if (!bot.target) bot.reactAt = now + REACT_MIN + Math.random() * (REACT_MAX - REACT_MIN);
        bot.target = seen;
        bot.lastSeen.copy(seen.pos);
      } else if (bot.target && now - bot.visionAt > 1.2) {
        bot.target = null;
      }
    }
    // Hearing: a nearby gunshot turns the bot toward it.
    if (!blinded && ctx.shots.length) {
      for (const shot of ctx.shots) {
        const d = bot.mover.state.position.distanceTo(shot.pos);
        if (d < HEAR_RANGE && now - shot.at < 0.5) {
          bot.alertPos = shot.pos.clone();
          if (!bot.target) bot.reactAt = Math.min(bot.reactAt || now + 0.4, now + 0.4);
        }
      }
    }

    const p = bot.mover.state.position;
    let wishX = 0;
    let wishZ = 0;
    let speed = 0;
    // A bot planting or defusing stands still and does not shoot: the job is the job.
    const busy = bot.planting || bot.defusing;

    if (!busy && bot.target && now >= bot.reactAt && !blinded) {
      // Engage: stop, face the enemy, fire in bursts.
      aimAt(bot, bot.target.pos, dt);
      if (bot.burstLeft <= 0 && now >= bot.nextShotAt) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.nextShotAt = now + 0.7 + Math.random() * 0.5;
      }
      fireBurst(bot, ctx);
      // Small strafe so a duel is not two statues.
      const strafe = Math.sin(now * 0.9 + bot.scanBase) * 0.6;
      wishX = Math.cos(bot.yaw) * strafe;
      wishZ = -Math.sin(bot.yaw) * strafe;
      speed = 1.1;
    } else if (bot.defusing) {
      // Stand on the bomb and hold still.
    } else if (bot.planting) {
      // Stand on the site and hold still.
    } else if (bot.state === 'route' && bot.route.length) {
      const node = bot.route[Math.min(bot.routeIndex, bot.route.length - 1)];
      const dx = node.x - p.x;
      const dz = node.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.state = 'hold';
          bot.holdUntil = now + 6 + Math.random() * 6;
          bot.scanBase = Math.random() * Math.PI * 2;
        }
      } else {
        wishX = dx / d;
        wishZ = dz / d;
        speed = BOT_SPEED;
        bot.yaw = Math.atan2(-wishX, -wishZ);
        // Stuck? Skip to the next node.
        if (p.distanceTo(bot.stuckPos) < 0.3) {
          if (now - bot.stuckAt > 1.5) {
            bot.routeIndex += 1;
            bot.stuckAt = now;
            bot.stuckPos.copy(p);
          }
        } else {
          bot.stuckAt = now;
          bot.stuckPos.copy(p);
        }
      }
    } else if (bot.state === 'hold') {
      // Scan the lane: slow yaw sweep, and re-route when the hold expires.
      bot.yaw = bot.scanBase + Math.sin(now * 0.5) * 0.9;
      if (now > bot.holdUntil) {
        const dest = bot.team === 'ember' ? bot.holdSite : (bot.holdSite === 'aSite' ? 'vantaA' : bot.holdSite === 'bSite' ? 'vantaB' : 'midNorth');
        bot.route = findRoute(nearestWaypoint(p.x, p.z), dest);
        bot.routeIndex = 0;
        bot.state = 'route';
      }
    }

    // Alert: turn toward a sound even while walking.
    if (!bot.target && bot.alertPos && !blinded) {
      const dx = bot.alertPos.x - p.x;
      const dz = bot.alertPos.z - p.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
    }

    bot.mover.step(dt, wishX, wishZ, speed, 30, 6, false, 0);
    bot.walkPhase += dt * (speed > 0.5 ? 9 : 0);
    bot.group.position.set(p.x, p.y, p.z);
    bot.group.rotation.y = bot.yaw;
    bot.group.rotation.x = 0;
    // Walk cycle: legs swing, body bobs a touch.
    const swing = speed > 0.5 ? Math.sin(bot.walkPhase) * 0.45 : 0;
    bot.group.children[3].rotation.x = swing;
    bot.group.children[4].rotation.x = -swing;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.flash = 0.12;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.target = null;
    bot.defusing = false;
    bot.planting = false;
    return true;
  }

  return {
    bots, hitMeshes, ensureBots, spawnRound, reset, aliveCount, damage,
    step(dt, ctx) {
      for (const bot of bots) stepBot(bot, dt, ctx);
    },
  };
}
