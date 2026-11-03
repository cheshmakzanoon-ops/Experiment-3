// A closed-loop DIGITAL driver for the journey tool: it decides which of the four
// driving keys (throttle, brake, left, right) to hold from the player's measured
// state and the circuit centreline, exactly the information a person gets from the
// road ahead. It never writes to the simulation: the keys go through the browser's
// keyboard like a player's. The same class runs headless against the production
// `Simulation` in `driver-selftest.mjs`, so its tuning is measured, not guessed.
//
// Frame conventions (src/simulation/protocol.ts): +Z nose, +Y up, +X driver's left.
// Steering keys ramp the game's steering state at 2.6/s (hold) and release at 4.8/s
// (src/input/controller.ts), so the driver tracks a model of that state and moves it
// to the wanted value with bang-bang key presses.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (v, target, step) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

/** Heading unit vector (x, z) of a body whose nose is +Z, from its quaternion. */
export function headingOf(qx, qy, qz, qw) {
  const fx = 2 * (qx * qz + qw * qy),
    fz = 1 - 2 * (qx * qx + qy * qy);
  const n = Math.hypot(fx, fz) || 1;
  return [fx / n, fz / n];
}

export class KeyboardDriver {
  /**
   * @param track a simulation `Track`
   * @param opts  gLat: lateral acceleration budget m/s^2; brake: braking decel m/s^2;
   *              vMax: speed cap m/s; steerGain: steering per radian of bearing error
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.o = {
      gLat: 11,
      brake: 13,
      vMax: 120,
      lookBase: 7,
      lookGain: 0.45,
      steerGain: 1.8,
      deadband: 0.07,
      steerRate: 0, // derivative gain on the bearing error (s)
      ...opts,
    };
    this.tp = {};
    this.est = 0; // modelled steering state, + = right key (controller.ts sign)
    this.lastKeys = { left: false, right: false, throttle: false, brake: false };
  }
  /** Advance the steering model by the time the previous keys were held. */
  integrate(dt) {
    const k = this.lastKeys;
    const want = Number(k.right) - Number(k.left);
    this.est = approach(this.est, want, dt * (Math.abs(want) < 0.001 ? 4.8 : 2.6));
  }
  /** Speed (m/s) the road ahead allows from the car's station. */
  targetSpeed(s, speed) {
    const { track, o } = this;
    let allowed = o.vMax;
    const reach = (speed * speed) / (2 * o.brake) + 40;
    for (let d = 0; d <= reach; d += 8) {
      // Worst curvature within a car length either side of the sample.
      let k = 0;
      for (const j of [-8, 0, 8]) k = Math.max(k, Math.abs(track.at(s + d + j, this.tp).curvature));
      const corner = Math.min(o.vMax, Math.sqrt(o.gLat / Math.max(k, 1e-4)));
      allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * o.brake * 0.8 * d));
    }
    return allowed;
  }
  /**
   * @param st {x, z, fx, fz, speed, s}  speed in m/s
   * @param dt seconds since the previous decision
   * @returns {left, right, throttle, brake, target, err}
   */
  decide(st, dt) {
    const { track, o, tp } = this;
    this.integrate(dt);
    const look = o.lookBase + o.lookGain * st.speed;
    track.at(st.s + look, tp);
    const dx = tp.x - st.x,
      dz = tp.z - st.z;
    // +X is the driver's left, so a target on the left has cross < 0 and a target
    // on the right has cross > 0: positive error = steer right.
    const err = Math.atan2(st.fx * dz - st.fz * dx, st.fx * dx + st.fz * dz);
    const rate = this.prevErr === undefined || dt <= 0 ? 0 : (err - this.prevErr) / dt;
    this.prevErr = err;
    const want = clamp(err * o.steerGain + rate * o.steerRate, -1, 1);
    const keys = { left: false, right: false, throttle: false, brake: false };
    if (want > this.est + o.deadband) keys.right = true;
    else if (want < this.est - o.deadband) keys.left = true;
    else if (Math.abs(want) < 0.02 && Math.abs(this.est) > o.deadband) {
      // Release toward centre.
      keys.left = this.est > 0;
      keys.right = this.est < 0;
      if (Math.abs(this.est) < o.deadband * 1.5) keys.left = keys.right = false;
    }
    const target = this.targetSpeed(st.s, st.speed);
    if (Math.abs(err) > 1.2) {
      // Facing well away from the road: crawl until pointed back.
      keys.throttle = st.speed < 6;
      keys.brake = st.speed > 9;
    } else if (st.speed > target + 1.5) keys.brake = true;
    else if (st.speed < target - 0.5) keys.throttle = true;
    this.lastKeys = keys;
    return { ...keys, target, err };
  }
}
