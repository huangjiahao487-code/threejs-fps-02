// Shared body physics: one box against the world's colliders, resolved one axis at a
// time, so a wall never swallows a body. The player and the bots both move through it;
// the player adds crouch and jump on top, the bots stay on the ground.
import * as THREE from 'three';

const GRAVITY = 20;

export function createMover(colliders, radius, height) {
  const probe = new THREE.Box3();
  const state = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    onGround: true,
    height,
  };

  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + h - lift, z + radius);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  // wish is a unit XZ direction (or zero); speed is m/s; accel blends velocity toward it.
  function step(dt, wishX, wishZ, speed, accel, friction, canJump, jumpSpeed) {
    const blend = Math.min(1, (accel * dt) / Math.max(speed, 0.01));
    state.velocity.x += (wishX * speed - state.velocity.x) * blend;
    state.velocity.z += (wishZ * speed - state.velocity.z) * blend;
    if (state.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - friction * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (canJump && state.onGround) {
      state.velocity.y = jumpSpeed;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    const nextX = state.position.x + state.velocity.x * dt;
    if (!overlaps(nextX, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nextX;
    else state.velocity.x = 0;
    const nextZ = state.position.z + state.velocity.z * dt;
    if (!overlaps(state.position.x, state.position.y, nextZ, state.height, 0.04)) state.position.z = nextZ;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  return { state, step, overlaps };
}
