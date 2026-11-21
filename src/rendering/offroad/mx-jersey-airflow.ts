import * as T from 'three';

const smooth = T.MathUtils.smoothstep;

/** Sag and pressure on the loose back panels between the trouser waist, the
 * kidney belt and the shoulder straps. These three sewn/strapped regions
 * stay still. Negative Z is away from the rider's back in garment space. */
function displacement(x: number, y: number, z: number, phase: number) {
  const back = smooth(-z, 0.025, 0.103);
  const hem = smooth(y, 0.06, 0.089) * (1 - smooth(y, 0.117, 0.147));
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
      if (z >= -0.024 || y < 0.059 || y > 0.366) continue;
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

export function poseMxJerseyAirflow(
  weights: number[],
  time: number | undefined,
  speed: number | undefined,
  raceNumber: number,
) {
  const pressure = Number.isFinite(speed) ? smooth(Math.abs(speed!), 2.5, 25) : 0;
  if (pressure === 0) {
    weights[0] = weights[1] = 0;
    return;
  }
  const phase = (Number.isFinite(time) ? time! : 0) * 15.5 + raceNumber * 2.39996323;
  weights[0] = pressure * Math.cos(phase);
  weights[1] = pressure * Math.sin(phase);
}
