// EMBER LINE — boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|buy|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets window.__shotReady.
// window.__game exposes live state for automated checks; window.__gameError names a
// load-time failure.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, findRoute, nearestWaypoint } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME } from './bomb.js';
import { createGrenades } from './grenade.js';
import { createEconomy, ARMOR_PRICE } from './economy.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
// ?lowfx=1 drops antialiasing and shadows: a real quality toggle for weak machines,
// and what the headless checks use so software rendering keeps up.
const lowFx = params.get('lowfx') === '1';

window.addEventListener('error', (event) => { window.__gameError = String(event.message || event.error); });

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: !lowFx, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowFx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 75);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const hud = createHud();
const economy = createEconomy();
const rounds = createRounds();
const bomb = createBomb(scene);
const grenades = createGrenades(scene, world.colliders);
const player = createPlayer(world.colliders, 0, 17);
const weapon = createWeapon(camera);

const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

// Tracers: a fixed pool, no allocation while playing.
const tracers = [];
for (let i = 0; i < 12; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffc45e, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerAt = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerAt];
  tracerAt = (tracerAt + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.9;
  t.life = 0.08;
}

// Explosion flash: one sphere and one light, reused.
const boomGeo = new THREE.SphereGeometry(1, 20, 14);
const boomMat = new THREE.MeshBasicMaterial({ color: 0xffb13d, transparent: true, opacity: 0, depthWrite: false });
const boom = new THREE.Mesh(boomGeo, boomMat);
boom.visible = false;
scene.add(boom);
const boomLight = new THREE.PointLight(0xffa030, 0, 40);
scene.add(boomLight);
let boomLife = 0;
function explodeAt(pos) {
  boom.position.copy(pos);
  boom.position.y = 0.8;
  boom.visible = true;
  boomLife = 0.6;
  boomLight.position.copy(pos);
  boomLight.position.y = 1.5;
  boomLight.intensity = 120;
  audio.explosion();
}

const playerRef = { alive: true, pos: player.mover.state.position, eye: 1.6, moving: false };
// Bots shoot through botFireAdapter (below): the same hitscan, but one that can also
// hit the player. It is a hoisted function declaration, so passing it here is safe.
const bots = createBots(scene, world, botFireAdapter, audio);
bots.ensureBots();
// One raycast target list for the whole match: world surfaces plus every bot's
// hit meshes. It never changes, so no shot allocates a new list.
const shootTargets = world.shootables.concat(bots.hitMeshes);

const state = {
  started: false,
  everLocked: false,
  carrier: 'player', // 'player' | bot object | null
  dropPos: null,
  ads: false,
  fov: 74,
  spectating: null,
  stepDistance: 0,
  lastStepX: 0,
  lastStepZ: 0,
  planting: false,
  shots: [],
  elapsed: 0,
  frozen: false,
  buyOpen: false,
  currentWeapon: 'pistol',
};

function aliveEmber() {
  return (playerRef.alive ? 1 : 0) + bots.aliveCount('ember');
}
function aliveVanta() {
  return bots.aliveCount('vanta');
}

function fireHitscan(shooter, origin, dir, def) {
  raycaster.set(origin, dir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootTargets, false);
  let end = tmpC.copy(origin).addScaledVector(dir, def.range);
  let endPoint = end;
  for (const hit of hits) {
    const bot = hit.object.userData.bot;
    if (bot) {
      if (!bot.alive) continue;
      if (shooter.team && bot.team === shooter.team) continue; // no friendly fire
      const part = hit.object.userData.part || 'torso';
      const dmg = def.damage * (part === 'head' ? def.headMult : 1);
      endPoint = hit.point;
      if (shooter.isPlayer) {
        const killed = bots.damage(bot, dmg, part);
        hud.hitMarker(killed, killed ? 400 : 90);
        if (part === 'head') audio.headshot(); else audio.hit();
        if (killed) {
          economy.kill();
          hud.setMoney(economy.state.money);
          hud.killfeed('You', bot.name, part === 'head', 'ember');
          audio.kill();
          if (state.carrier === bot) dropBomb(bot.mover.state.position);
          if (bot.defusing) bot.defusing = false;
          if (bot.planting) { bot.planting = false; bomb.cancelPlant(); }
        }
      } else {
        const killed = bots.damage(bot, dmg, part);
        if (killed) {
          hud.killfeed(shooter.name, bot.name, part === 'head', shooter.team);
          if (state.carrier === bot) dropBomb(bot.mover.state.position);
          if (bot.defusing) bot.defusing = false;
          if (bot.planting) { bot.planting = false; bomb.cancelPlant(); }
        }
      }
      spawnTracer(origin, endPoint);
      return { hit: true, point: endPoint, bot, part };
    }
    endPoint = hit.point;
    spawnTracer(origin, endPoint);
    return { hit: true, point: endPoint, bot: null, part: null };
  }
  spawnTracer(origin, endPoint);
  return { hit: false, point: endPoint, bot: null, part: null };
}

function hurtPlayer(dmg, killerName = 'Vanta') {
  if (!playerRef.alive) return;
  const final = player.state.armor ? dmg * 0.6 : dmg;
  player.state.health -= final;
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(player.state.health, player.state.armor);
  if (player.state.health <= 0) {
    player.state.health = 0;
    playerRef.alive = false;
    state.planting = false;
    bomb.cancelPlant();
    hud.killfeed(killerName, 'You', false, 'vanta');
    if (state.carrier === 'player') dropBomb(player.mover.state.position);
    const next = bots.bots.find((b) => b.team === 'ember' && b.alive);
    state.spectating = next || null;
    hud.setSpectate(next ? next.name : null);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function dropBomb(pos) {
  state.carrier = null;
  state.dropPos = pos.clone();
  bomb.drop(pos.x, pos.z);
}

function spawnAll() {
  player.reset(0, 17);
  player.state.yaw = 0;
  player.state.pitch = 0;
  playerRef.alive = true;
  playerRef.pos = player.mover.state.position;
  state.spectating = null;
  hud.setSpectate(null);
  weapon.equip(state.currentWeapon);
  weapon.refill();
  player.state.armor = false;
  bomb.reset();
  state.carrier = 'player';
  state.dropPos = null;
  state.planting = false;
  state.shots.length = 0;
  bots.spawnRound();
  hud.setHealth(100, false);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setMoney(economy.state.money);
  hud.markOwned(economy, state.currentWeapon);
}

function endRoundUI(winner, banner, sub, wonByPlayer) {
  hud.showBanner(banner, sub);
  hud.hideBomb();
  hud.showBuy(false);
  state.buyOpen = false;
  hud.setMoney(economy.state.money); // the round reward was just paid in
  if (wonByPlayer) audio.roundWin(); else audio.roundLose();
}

function checkRoundEnd() {
  const rs = rounds.state;
  if (rs.phase !== 'live') return;
  if (bomb.state.status === 'detonated') {
    explodeAt(bomb.state.position);
    if (rounds.endRound('ember', 'EMBER WINS THE ROUND', 'The charge blew Site ' + bomb.state.site)) {
      economy.roundEnd(true);
      endRoundUI('ember', 'EMBER WINS THE ROUND', 'The charge blew Site ' + bomb.state.site, true);
    }
    return;
  }
  if (bomb.state.status === 'defused') {
    if (rounds.endRound('vanta', 'VANTA WINS THE ROUND', 'The charge was defused')) {
      economy.roundEnd(false);
      endRoundUI('vanta', 'VANTA WINS THE ROUND', 'The charge was defused', false);
    }
    return;
  }
  if (aliveVanta() === 0) {
    if (rounds.endRound('ember', 'EMBER WINS THE ROUND', 'Vanta team eliminated')) {
      economy.roundEnd(true);
      endRoundUI('ember', 'EMBER WINS THE ROUND', 'Vanta team eliminated', true);
    }
    return;
  }
  if (aliveEmber() === 0 && bomb.state.status !== 'planted') {
    if (rounds.endRound('vanta', 'VANTA WINS THE ROUND', 'Ember team eliminated')) {
      economy.roundEnd(false);
      endRoundUI('vanta', 'VANTA WINS THE ROUND', 'Ember team eliminated', false);
    }
  }
}

function buyAction(spec) {
  const [type, id] = spec.split(':');
  if (type === 'weapon') {
    if (economy.state.owned.has(id)) {
      state.currentWeapon = id;
      weapon.equip(id);
      weapon.refill();
      audio.click();
    } else if (economy.buyWeapon(id)) {
      state.currentWeapon = id;
      weapon.equip(id);
      weapon.refill();
      audio.buy();
    } else {
      audio.denied();
      return;
    }
  } else if (type === 'grenade') {
    if (!economy.buyGrenade(id)) { audio.denied(); return; }
    audio.buy();
  } else if (type === 'armor') {
    if (!economy.buyArmor()) { audio.denied(); return; }
    player.state.armor = true;
    audio.buy();
  }
  hud.setMoney(economy.state.money);
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.markOwned(economy, state.currentWeapon);
}

function throwGrenade(kind) {
  if (rounds.state.phase !== 'live' || !playerRef.alive) return;
  if (economy.state.grenades[kind] <= 0) { audio.denied(); return; }
  economy.state.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  tmpA.copy(camera.position).addScaledVector(direction, 0.4);
  tmpA.y -= 0.1;
  grenades.throwGrenade(kind, tmpA, direction, (burstKind, pos) => onGrenadeBurst(burstKind, pos));
  hud.setMoney(economy.state.money);
}

function onGrenadeBurst(kind, pos) {
  if (kind === 'flash') {
    audio.flash();
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = bot.mover.state.position.distanceTo(pos);
      if (d > grenades.FLASH_RADIUS) continue;
      tmpA.set(bot.mover.state.position.x, bot.mover.state.position.y + 1.5, bot.mover.state.position.z);
      if (!hasClearLine(tmpA, pos)) continue;
      bot.blindUntil = state.elapsed + 1.5 + (1 - d / grenades.FLASH_RADIUS);
      bot.target = null;
    }
    if (playerRef.alive) {
      camera.getWorldDirection(direction);
      tmpA.copy(pos).sub(camera.position).normalize();
      const facing = direction.dot(tmpA);
      const d = camera.position.distanceTo(pos);
      if (facing > 0.4 && d < 25 && hasClearLine(camera.position, pos)) hud.flashBlind(900);
    }
  } else {
    explodeAt(pos);
    const hurt = (at, isPlayer, bot, killerName) => {
      const d = at.distanceTo(pos);
      if (d > grenades.FRAG_RADIUS) return;
      const los = hasClearLine(tmpB.set(at.x, at.y + 1.2, at.z), pos);
      const dmg = (110 - (95 * d) / grenades.FRAG_RADIUS) * (los ? 1 : 0.5);
      if (isPlayer) hurtPlayer(dmg, killerName);
      else if (bots.damage(bot, dmg, 'torso')) {
        hud.killfeed('You', bot.name, false, 'ember');
        economy.kill();
        hud.setMoney(economy.state.money);
        audio.kill();
      }
    };
    if (playerRef.alive) hurt(player.mover.state.position, true, null, 'Splinter frag');
    for (const bot of bots.bots) {
      if (bot.alive) hurt(bot.mover.state.position, false, bot);
    }
  }
}

function hasClearLine(from, to) {
  tmpB.copy(to).sub(from);
  const dist = tmpB.length();
  if (dist < 0.01) return true;
  tmpB.divideScalar(dist);
  raycaster.set(from, tmpB);
  raycaster.far = dist;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

const adapterEnd = new THREE.Vector3();
function botFireAdapter(bot, from, dir, def) {
  // Bots shoot through the same hitscan as the player; damage to the player goes
  // through hurtPlayer so armour and the death flow stay in one place.
  raycaster.set(from, dir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootTargets, false);
  adapterEnd.copy(from).addScaledVector(dir, def.range);
  for (const hit of hits) {
    const hitBot = hit.object.userData.bot;
    if (hitBot) {
      if (!hitBot.alive) continue;
      if (hitBot.team === bot.team) continue;
      const part = hit.object.userData.part || 'torso';
      const dmg = def.damage * (part === 'head' ? def.headMult : 1);
      const killed = bots.damage(hitBot, dmg, part);
      if (killed) {
        hud.killfeed(bot.name, hitBot.name, part === 'head', bot.team);
        if (state.carrier === hitBot) dropBomb(hitBot.mover.state.position);
        if (hitBot.defusing) hitBot.defusing = false;
        if (hitBot.planting) { hitBot.planting = false; bomb.cancelPlant(); }
      }
      spawnTracer(from, hit.point);
      return;
    }
    adapterEnd.copy(hit.point);
    break;
  }
  // Did the ray reach the player? Test the player as a capsule: distance from the ray
  // to the player's spine, and no wall in between. Teammates cannot hurt the player
  // — same no-friendly-fire rule as the bot-vs-bot path above (the player is Ember,
  // and the death feed assumes a Vanta killer).
  if (playerRef.alive && bot.team !== 'ember') {
    tmpA.copy(player.mover.state.position);
    tmpA.y += 1.0;
    const toPlayer = tmpB.copy(tmpA).sub(from);
    const along = toPlayer.dot(dir);
    if (along > 0 && along < def.range) {
      const closest = tmpC.copy(from).addScaledVector(dir, along);
      const miss = closest.distanceTo(tmpA);
      if (miss < 0.55 && hasClearLine(from, tmpA)) {
        const head = Math.abs(closest.y - (player.mover.state.position.y + 1.55)) < 0.2;
        hurtPlayer(def.damage * (head ? def.headMult : 1), bot.name);
        spawnTracer(from, closest);
        return;
      }
    }
  }
  spawnTracer(from, adapterEnd);
}

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (rounds.state.phase === 'matchEnd') {
    economy.reset();
    state.currentWeapon = 'pistol';
    rounds.startMatch();
    spawnAll();
    hud.hideBanner();
    hud.hideOverlay();
    hud.showBuy(rounds.state.phase === 'buy');
    state.buyOpen = rounds.state.phase === 'buy';
    input.requestLock();
    return;
  }
  if (!state.started) {
    state.started = true;
    rounds.startMatch();
    spawnAll();
    hud.hideBanner();
  }
  hud.hideOverlay();
  hud.showBuy(rounds.state.phase === 'buy');
  state.buyOpen = rounds.state.phase === 'buy';
  input.requestLock();
});
hud.onBuy((spec) => buyAction(spec));

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    state.everLocked = true;
    hud.hideOverlay();
  } else if (state.everLocked && state.started && rounds.state.phase === 'live' && playerRef.alive) {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  if (playerRef.alive) {
    camera.position.set(player.mover.state.position.x, player.mover.state.position.y + player.state.eye, player.mover.state.position.z);
    camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  } else if (state.spectating) {
    const b = state.spectating;
    const p = b.mover.state.position;
    camera.position.set(p.x - Math.sin(b.yaw) * -2.2, p.y + 2.6, p.z - Math.cos(b.yaw) * -2.2);
    camera.lookAt(p.x, p.y + 1.2, p.z);
  }
  const targetFov = state.ads && playerRef.alive ? (weapon.def().id === 'dmr' ? 52 : 60) : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function playerShoot() {
  if (!weapon.takeRound()) {
    audio.dryFire();
    weapon.reload();
    return null;
  }
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed(), state.ads);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  const def = weapon.def();
  const result = fireHitscan({ team: 'ember', isPlayer: true, name: 'You' }, camera.position, direction, def);
  weapon.pullTrigger();
  player.recoil(0.009 + def.kick * 0.5 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.kind, 0);
  state.shots.push({ pos: camera.position.clone(), at: state.elapsed });
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
  return result;
}

function step(dt) {
  state.elapsed += dt;
  const rs = rounds.state;
  const prevPhase = rs.phase;
  rounds.step(dt);

  // Phase edges: entering buy spawns the round; entering live closes the menu.
  if (rs.phase === 'buy' && prevPhase !== 'buy' && state.started) {
    spawnAll();
    hud.hideBanner();
    hud.showBuy(true);
    state.buyOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (rs.phase === 'live' && prevPhase === 'buy') {
    hud.showBuy(false);
    state.buyOpen = false;
    hud.hideBanner();
  }
  if (rs.phase === 'matchEnd' && prevPhase !== 'matchEnd') {
    hud.showOverlay('matchEnd', { winner: rs.winner, score: rs.score });
    if (document.pointerLockElement) document.exitPointerLock();
  }
  // Live timer run out with no plant: the defenders win the round.
  if (rs.phase === 'live' && rs.timer <= 0 && bomb.state.status !== 'planted') {
    if (rounds.endRound('vanta', 'VANTA WINS THE ROUND', 'Time expired — the charge was never planted')) {
      economy.roundEnd(false);
      endRoundUI('vanta', 'VANTA WINS THE ROUND', 'Time expired — the charge was never planted', false);
    }
  }

  const frozen = rs.phase === 'buy' || rs.phase === 'menu' || rs.phase === 'matchEnd';
  const live = rs.phase === 'live';

  // Input, one-shot keys.
  const pressed = input.takePressed();
  if (pressed.has('KeyB') && rs.phase === 'buy') {
    state.buyOpen = !state.buyOpen;
    hud.showBuy(state.buyOpen);
    if (state.buyOpen && document.pointerLockElement) document.exitPointerLock();
  }
  if (rs.phase === 'buy') {
    if (pressed.has('Digit1')) buyAction('weapon:pistol');
    if (pressed.has('Digit2')) buyAction('weapon:rifle');
    if (pressed.has('Digit3')) buyAction('weapon:smg');
    if (pressed.has('Digit4')) buyAction('weapon:dmr');
    if (pressed.has('Digit5')) buyAction('grenade:flash');
    if (pressed.has('Digit6')) buyAction('grenade:frag');
    if (pressed.has('Digit7')) buyAction('armor');
  } else if (live && playerRef.alive) {
    if (pressed.has('Digit1') && economy.state.owned.has('pistol')) { state.currentWeapon = 'pistol'; weapon.equip('pistol'); weapon.refill(); }
    if (pressed.has('Digit2') && economy.state.owned.has('rifle')) { state.currentWeapon = 'rifle'; weapon.equip('rifle'); weapon.refill(); }
    if (pressed.has('Digit3') && economy.state.owned.has('smg')) { state.currentWeapon = 'smg'; weapon.equip('smg'); weapon.refill(); }
    if (pressed.has('Digit4') && economy.state.owned.has('dmr')) { state.currentWeapon = 'dmr'; weapon.equip('dmr'); weapon.refill(); }
    if (pressed.has('Digit5')) throwGrenade('flash');
    if (pressed.has('Digit6')) throwGrenade('frag');
  }

  if (!frozen) {
    const look = input.takeLook();
    if (playerRef.alive) player.look(look.x, look.y);
    state.ads = input.state.ads && playerRef.alive;
    if (playerRef.alive) player.step(dt, input.state.keys, state.ads);
    weapon.step(dt);

    // Footsteps.
    const px = player.mover.state.position.x;
    const pz = player.mover.state.position.z;
    state.stepDistance += Math.hypot(px - state.lastStepX, pz - state.lastStepZ);
    state.lastStepX = px;
    state.lastStepZ = pz;
    if (state.stepDistance > 2.4 && playerRef.alive && player.mover.state.onGround) {
      state.stepDistance = 0;
      audio.step();
    }

    if (live && playerRef.alive) {
      if (input.state.firing && weapon.ready()) playerShoot();
      if (input.state.keys.has('KeyR')) weapon.reload();
    }

    // Planting: hold E near a site while carrying, standing still.
    if (live && playerRef.alive && state.carrier === 'player' && bomb.state.status === 'idle') {
      const site = bomb.siteNear(player.mover.state.position.x, player.mover.state.position.z);
      if (site && input.state.keys.has('KeyE') && player.groundSpeed() < 1) {
        if (!state.planting) {
          state.planting = true;
          bomb.startPlant(site, player.mover.state.position.x, player.mover.state.position.z);
          audio.beep();
        }
      } else if (state.planting) {
        state.planting = false;
        bomb.cancelPlant();
      }
    }
    if (bomb.state.status === 'planting') {
      hud.setBomb(`PLANTING — ${Math.floor((bomb.state.plantProgress / PLANT_TIME) * 100)}%`, bomb.state.plantProgress / PLANT_TIME);
    } else if (bomb.state.status === 'planted') {
      hud.setBomb(`CHARGE PLANTED — ${bomb.state.fuseLeft.toFixed(0)}s`, bomb.state.fuseLeft / 35);
    } else {
      hud.hideBomb();
    }

    // Bomb progress and the detonation. A planting -> planted edge pays the planter.
    const wasPlanting = bomb.state.status === 'planting';
    bomb.step(dt, (final) => audio.plantTick(final));
    if (wasPlanting && bomb.state.status === 'planted') {
      const planter = bots.bots.find((b) => b.planting);
      if (state.planting) {
        economy.plant();
        hud.setMoney(economy.state.money);
        hud.killfeed('You', 'planted the charge', false, 'ember');
      } else if (planter) {
        hud.killfeed(planter.name, 'planted the charge', false, 'ember');
      }
      state.planting = false;
      for (const b of bots.bots) b.planting = false;
    }

    // Bot bomb roles.
    orchestrateBomb(dt);

    // Bots.
    const ctx = {
      time: state.elapsed,
      player: playerRef,
      shots: state.shots.filter((s) => state.elapsed - s.at < 1),
    };
    bots.step(dt, ctx);
    playerRef.moving = player.groundSpeed() > 1;

    grenades.step(dt);
    checkRoundEnd();
  }

  // Tracers and explosion fade even while frozen, so a still frame is clean.
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  if (boomLife > 0) {
    boomLife -= dt;
    const k = 1 - Math.max(0, boomLife) / 0.6;
    boom.scale.setScalar(1 + k * 9);
    boomMat.opacity = Math.max(0, 0.9 - k);
    boomLight.intensity = Math.max(0, 120 * (1 - k));
    if (boomLife <= 0) boom.visible = false;
  }

  // HUD numbers.
  hud.setTimer(rs.timer, rs.phase);
  hud.setScore(rs.score.ember, rs.score.vanta, rs.round);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setCrosshairSpread(4 + weapon.spread(player.groundSpeed(), state.ads) * 900);
  syncCamera();
}

function orchestrateBomb(dt) {
  const rs = rounds.state;
  if (rs.phase !== 'live') return;
  // A carrier bot that reached its site plants; otherwise it walks there.
  if (bomb.state.status === 'idle' && state.carrier && state.carrier !== 'player') {
    const bot = state.carrier;
    if (!bot.alive) { dropBomb(bot.mover.state.position); return; }
    const siteName = bot.holdSite === 'bSite' ? 'bSite' : 'aSite';
    const site = SITES[siteName === 'aSite' ? 'A' : 'B'];
    const p = bot.mover.state.position;
    if (Math.abs(p.x - site.x) < 2.5 && Math.abs(p.z - site.z) < 2.5) {
      if (!bot.planting) {
        bot.planting = true;
        bomb.startPlant(siteName === 'aSite' ? 'A' : 'B', p.x, p.z);
      }
    } else if (!bot.planting && bot.state !== 'route') {
      bot.route = findRoute(nearestWaypoint(p.x, p.z), siteName);
      bot.routeIndex = 0;
      bot.routeTarget = 'plant';
      bot.state = 'route';
    }
  }
  // A dropped charge is fetched by the nearest living Ember bot.
  if (bomb.state.status === 'idle' && !state.carrier && state.dropPos) {
    let best = null;
    let bestD = Infinity;
    for (const bot of bots.bots) {
      if (bot.team !== 'ember' || !bot.alive) continue;
      const d = bot.mover.state.position.distanceTo(state.dropPos);
      if (d < bestD) { bestD = d; best = bot; }
    }
    if (best) {
      if (bestD < 1.4) {
        state.carrier = best;
        best.carrying = true;
        state.dropPos = null;
        bomb.pickup();
      } else if (best.state !== 'route' || best.routeTarget !== 'fetch') {
        best.routeTarget = 'fetch';
        best.route = [state.dropPos];
        best.routeIndex = 0;
        best.state = 'route';
      }
    }
  }
  // Planted: defenders converge; the closest defuses.
  if (bomb.state.status === 'planted') {
    let defuser = null;
    let bestD = Infinity;
    for (const bot of bots.bots) {
      if (bot.team !== 'vanta' || !bot.alive) continue;
      const d = bot.mover.state.position.distanceTo(bomb.state.position);
      if (d < bestD) { bestD = d; defuser = bot; }
    }
    if (defuser) {
      if (bestD < 2.2 && hasClearLine(tmpA.set(defuser.mover.state.position.x, defuser.mover.state.position.y + 1.5, defuser.mover.state.position.z), bomb.state.position)) {
        defuser.defusing = true;
        defuser.target = null;
        if (bomb.defuseStep(dt)) {
          hud.setBomb('DEFUSED', 1);
        }
      } else {
        defuser.defusing = false;
        if (defuser.state !== 'route' || defuser.routeTarget !== 'defuse') {
          defuser.routeTarget = 'defuse';
          defuser.route = [bomb.state.position];
          defuser.routeIndex = 0;
          defuser.state = 'route';
        }
      }
      if (defuser.defusing) hud.setBomb(`DEFUSING — ${Math.floor((bomb.state.defuseProgress / DEFUSE_TIME) * 100)}%`, bomb.state.defuseProgress / DEFUSE_TIME);
    }
  }
}

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!state.frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      state.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  state.started = true;
  economy.reset();
  rounds.startMatch();
  spawnAll();
  if (name === 'start') {
    player.mover.state.position.set(0, 0, 14);
    player.state.yaw = 0;
    player.state.pitch = 0.02;
    settle(20);
    hud.showOverlay('start');
    hud.showBuy(false);
  } else if (name === 'buy') {
    rounds.state.timer = 12;
    player.mover.state.position.set(0, 0, 14);
    player.state.yaw = 0.3;
    settle(20);
    economy.state.money = 5200;
    economy.buyWeapon('rifle');
    state.currentWeapon = 'rifle';
    weapon.equip('rifle');
    weapon.refill();
    hud.setMoney(economy.state.money);
    hud.markOwned(economy, 'rifle');
    hud.showBuy(true);
    state.buyOpen = true;
  } else if (name === 'play' || name === 'end') {
    rounds.startLive();
    rounds.state.timer = 73;
    player.state.health = 1000; // staged capture: the player cannot die mid-frame
    player.mover.state.position.set(0, 0, 6);
    player.state.yaw = 0;
    player.state.pitch = 0;
    syncCamera(); // aim math below reads camera.position: it must be the new spot
    // March the bots up the lanes, then fight at mid.
    for (let i = 0; i < 120; i += 1) step(FIXED_STEP);
    const aimAtFoe = () => {
      // Nearest living Vanta bot with a clear line from the camera: a crate in
      // the way would eat the shot, and the staged frame must show a real hit.
      let foe = null;
      let bestD = Infinity;
      for (const b of bots.bots) {
        if (b.team !== 'vanta' || !b.alive) continue;
        const p = b.mover.state.position;
        const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
        if (d >= bestD) continue;
        tmpA.set(p.x, p.y + 1.2, p.z);
        if (!hasClearLine(camera.position, tmpA)) continue;
        foe = b;
        bestD = d;
      }
      if (!foe) return null;
      const p = foe.mover.state.position;
      tmpA.set(p.x, p.y + 1.2, p.z);
      const dx = tmpA.x - camera.position.x;
      const dy = tmpA.y - (player.mover.state.position.y + player.state.eye);
      const dz = tmpA.z - camera.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      player.state.yaw = Math.atan2(-dx, -dz);
      player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      syncCamera();
      return foe;
    };
    const shotLog = [];
    for (let r = 0; r < 6; r += 1) {
      const foe = aimAtFoe();
      if (!foe) break;
      // The capture path steps the sim without rendering, so the bots' world
      // matrices are stale from the menu frame: refresh them or every ray
      // passes through the foe's old spot. (In live play the render loop
      // keeps them one frame fresh, which is close enough to hit.)
      scene.updateMatrixWorld(true);
      if (weapon.ready()) {
        const res = playerShoot();
        shotLog.push({
          foe: foe.name,
          foePos: foe.mover.state.position.toArray().map((v) => Math.round(v * 10) / 10),
          hit: res ? res.hit : null,
          part: res ? res.part : null,
          hitBot: res && res.bot ? res.bot.name : null,
          point: res && res.point ? res.point.toArray().map((v) => Math.round(v * 10) / 10) : null,
        });
      }
      settle(10);
    }
    // Diagnostic for the capture path only: what each staged shot actually hit.
    window.__shotDebug = shotLog;
    if (name === 'end') {
      // The round is won for real: every remaining Vanta bot goes down, and the
      // normal round-end check fires the banner and the score.
      for (const bot of bots.bots) {
        if (bot.team === 'vanta' && bot.alive) {
          bots.damage(bot, 9999, 'torso');
          economy.kill();
          hud.setMoney(economy.state.money);
          hud.killfeed('You', bot.name, false, 'ember');
        }
      }
      settle(30);
    }
    hud.setScore(rounds.state.score.ember, rounds.state.score.vanta, rounds.state.round);
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = {
  get phase() { return rounds.state.phase; },
  get round() { return rounds.state.round; },
  get score() { return { ...rounds.state.score }; },
  get timer() { return rounds.state.timer; },
  get playerHealth() { return player.state.health; },
  get money() { return economy.state.money; },
  get aliveEmber() { return aliveEmber(); },
  get aliveVanta() { return aliveVanta(); },
  get bomb() { return bomb.state.status; },
  get weapon() { return weapon.def().id; },
  get started() { return state.started; },
};

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
