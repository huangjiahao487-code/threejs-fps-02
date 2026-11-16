// The human player: look, recoil and the eye height, over the shared mover. Movement
// has acceleration, friction, gravity, crouch and jump; collision is the mover's.
import { createMover } from './mover.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, startX, startZ) {
  const mover = createMover(colliders, 0.34, STAND_HEIGHT);
  mover.state.position.set(startX, 0, startZ);
  const player = {
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: false,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys, ads) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
      mover.state.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !mover.overlaps(mover.state.position.x, mover.state.position.y, mover.state.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
      mover.state.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const len = Math.hypot(-sin * forward + cos * strafe, -cos * forward - sin * strafe) || 1;
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    const speed = (player.crouching ? CROUCH_SPEED : WALK_SPEED) * (ads ? 0.6 : 1);
    mover.step(dt, wishX, wishZ, speed, mover.state.onGround ? GROUND_ACCEL : AIR_ACCEL, FRICTION, keys.has('Space'), JUMP_SPEED);
  }

  return {
    state: player,
    mover,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(mover.state.velocity.x, mover.state.velocity.z);
    },
    reset(x, z) {
      mover.state.position.set(x, 0, z);
      mover.state.velocity.set(0, 0, 0);
      player.yaw = 0;
      player.pitch = 0;
      player.health = 100;
      player.crouching = false;
      player.height = STAND_HEIGHT;
      mover.state.height = STAND_HEIGHT;
    },
  };
}
