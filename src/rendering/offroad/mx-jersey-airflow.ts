import * as T from 'three';

const smooth = T.MathUtils.smoothstep;

/** Sag and pressure on the loose back panels between the trouser waist, the
 * kidney belt and the shoulder straps. These three sewn/strapped regions
 * stay still. Negative Z is away from the rider's back in garment space. */
function displacement(x: number, y: number, z: number, phase: number) {
  const back = smooth(-z, 0.025, 0.103);
  const hem = smooth(y, 0.071, 0.094) * (1 - smooth(y, 0.117, 0.147));
  const upper = smooth(y, 0.216, 0.255) * (1 - smooth(y, 0.323, 0.365));
  const fold = y * 65 + x * 19 + 0.86 * Math.sin(x * 15 + y * 6);
  return -back * (0.005 * hem + 0.0085 * upper) * Math.sin(fold + phase);
}

/** Bake the two phases once on the skinned jersey. Three applies their
 * signed sum before skinning in both the colour and shadow programs.
 * The normal follows the deformed cloth even under a grazing arena light. */
export function prepareMxJerseyAirflow(skin: T.SkinnedMesh) {
  const g = skin.geometry,
    positions = g.getAttribute('position'),
    normals = g.getAttribute('normal');
  const delta = 0.0002,
    normal = new T.Vector3();
  g.morphTargetsRelative = true;
  g.morphAttributes.position = [];
  g.morphAttributes.normal = [];
  for (const phase of [0, Math.PI / 2]) {
    const move = new Float32Array(positions.count * 3),
      tilt = new Float32Array(move.length);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      if (z >= -0.024 || y <= 0.07 || y > 0.366) continue;
      move[i * 3 + 2] = displacement(x, y, z, phase);
      const dx =
        (displacement(x + delta, y, z, phase) - displacement(x - delta, y, z, phase)) / (2 * delta);
      const dy =
        (displacement(x, y + delta, z, phase) - displacement(x, y - delta, z, phase)) / (2 * delta);
      const dz =
        (displacement(x, y, z + delta, phase) - displacement(x, y, z - delta, phase)) / (2 * delta);
      // Inverse transpose of (x, y, z + displacement), up to a scalar.
      normal.fromBufferAttribute(normals, i);
      normal
        .set((1 + dz) * normal.x - dx * normal.z, (1 + dz) * normal.y - dy * normal.z, normal.z)
        .normalize();
      tilt[i * 3] = normal.x - normals.getX(i);
      tilt[i * 3 + 1] = normal.y - normals.getY(i);
      tilt[i * 3 + 2] = normal.z - normals.getZ(i);
    }
    g.morphAttributes.position.push(new T.BufferAttribute(move, 3));
    g.morphAttributes.normal.push(new T.BufferAttribute(tilt, 3));
  }
  skin.updateMorphTargets();
  // The spine owns a conservative animated bound for this complete garment.
  return skin.morphTargetInfluences!;
}

/** Horizontal air reaching the back of the jersey, in the presented bike frame. */
export class MxJerseyAir {
  speed = 0;
  cross = 0;

  set(vx: number, vz: number, windX: number, windZ: number, nose: T.Vector3) {
    const x = windX - vx, z = windZ - vz;
    this.speed = Math.hypot(x, z);
    const span = this.speed * Math.hypot(nose.x, nose.z);
    this.cross = span > 0.1 ? T.MathUtils.clamp((x * nose.z - z * nose.x) / span, -1, 1) : 0;
    return this;
  }
}

export function poseMxJerseyAirflow(
  weights: number[],
  time: number | undefined,
  speed: number | undefined,
  raceNumber: number,
  air?: MxJerseyAir,
) {
  const airSpeed = air?.speed ?? speed;
  let pressure = Number.isFinite(airSpeed) ? smooth(Math.abs(airSpeed!), 2.5, 25) : 0;
  if (pressure === 0) {
    weights[0] = weights[1] = 0;
    return;
  }
  const clock = Number.isFinite(time) ? time! : 0, seed = raceNumber * 2.39996323;
  let phase = clock * 15.5 + seed;
  if (air) {
    // The free fabric fills, flutters and releases. Modulate the travelling
    // fold continuously so a change in speed or a crosswind cannot restart it.
    const swell = Math.sin(clock * 2.1 + seed + 0.6 * air.cross);
    const ripple = Math.sin(clock * 3.7 - seed * 0.73 + 0.65 * swell);
    pressure *= 0.76 + 0.16 * swell + 0.08 * ripple;
    phase += 0.9 * swell + 0.38 * ripple + 0.8 * air.cross;
  }
  weights[0] = pressure * Math.cos(phase);
  weights[1] = pressure * Math.sin(phase);
}
