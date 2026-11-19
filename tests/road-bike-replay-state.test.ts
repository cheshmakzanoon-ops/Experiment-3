import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareRoadBikeFrames } from '../e2e/fixtures/road-bike-presentation.ts';
import { BikeShells } from '../src/rendering/bike.ts';
import { GpRiderGarment } from '../src/rendering/gp-rider-garment.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { carBase } from '../src/simulation/protocol.ts';

function stubCanvas() {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => vi.unstubAllGlobals());

/** Capture actual world transforms and deformed skin vertices. Resource ids
 * are deliberately excluded: the oracle is an independently constructed rig. */
function poseState(shells: BikeShells, frame: Float32Array) {
  const host = { root: new T.Object3D() },
    camera = new T.PerspectiveCamera(),
    point = new T.Vector3();
  sampleChassisPose(frame, frame, carBase(0), 1, host.root.position, host.root.quaternion);
  shells.update(frame, frame, 1, [host], camera, 'high', 0);
  shells.root.updateMatrixWorld(true);
  const objects: { name: string; visible: boolean; matrix: number[]; morphs: number[] }[] = [],
    skins: { name: string; positions: number[] }[] = [];
  shells.drawnRoot(0)!.traverse((object) => {
    objects.push({
      name: object.name,
      visible: object.visible,
      matrix: object.matrixWorld.toArray(),
      morphs: object instanceof T.Mesh ? [...(object.morphTargetInfluences ?? [])] : [],
    });
    if (!(object instanceof T.SkinnedMesh)) return;
    const positions: number[] = [];
    for (let i = 0; i < object.geometry.getAttribute('position').count; i++) {
      object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
      positions.push(point.x, point.y, point.z);
    }
    skins.push({ name: object.name, positions });
  });
  return { objects, skins };
}

it('matches a backward road-bike seek to an independent cold rig while preserving continuous rider inertia', () => {
  stubCanvas();
  const frames = prepareRoadBikeFrames(),
    live = new BikeShells(),
    cold = new BikeShells();
  try {
    poseState(live, frames.supported);
    const continuous = poseState(live, frames.airborne);
    expect(poseState(live, frames.airborne)).toEqual(continuous);
    poseState(live, frames.landed);
    const reference = poseState(cold, frames.airborne),
      rewind = poseState(live, frames.airborne);
    expect(rewind).toEqual(reference);
    expect(poseState(live, frames.airborne)).toEqual(reference);
    let maximumVertexMotion = 0;
    for (let skin = 0; skin < continuous.skins.length; skin++) {
      const a = continuous.skins[skin],
        b = rewind.skins[skin];
      expect(a.name).toBe(b.name);
      for (let i = 0; i < a.positions.length; i += 3)
        maximumVertexMotion = Math.max(
          maximumVertexMotion,
          Math.hypot(
            a.positions[i] - b.positions[i],
            a.positions[i + 1] - b.positions[i + 1],
            a.positions[i + 2] - b.positions[i + 2],
          ),
        );
    }
    // The first flight retains a real small surge response to the preceding
    // supported deceleration; the documented seek resets it to equilibrium.
    // That submillimetre posture change must not flip a 110 mm garment ring.
    expect(maximumVertexMotion).toBeGreaterThan(1e-6);
    expect(maximumVertexMotion).toBeLessThan(0.0005);
  } finally {
    live.disposeAll();
    cold.disposeAll();
  }
});

it('keeps the garment midpoint continuous and representation-independent at an exact IK half-turn', () => {
  const parent = new T.Group(),
    torso = new T.Group(),
    upper = new T.Group(),
    lower = new T.Group(),
    material = new T.MeshStandardMaterial();
  parent.add(torso, upper, lower);
  lower.position.y = 0.44;
  const garment = new GpRiderGarment(
      parent,
      torso,
      upper,
      lower,
      0.44,
      0.44,
      [0.1, 0, 0],
      'pants',
      'high',
      material,
    ),
    point = new T.Vector3(),
    geometry = garment.mesh.geometry,
    attributes = [
      ...Object.values(geometry.attributes),
      ...Object.values(geometry.morphAttributes).flat(),
    ] as T.BufferAttribute[],
    versions = attributes.map((attribute) => attribute.version);
  const vertices = (bendOnly = false) => {
    parent.updateMatrixWorld(true);
    const result: number[] = [],
      weights = geometry.getAttribute('skinWeight');
    for (let i = 0; i < geometry.getAttribute('position').count; i++) {
      if (bendOnly && weights.getZ(i) !== 1) continue;
      garment.mesh.getVertexPosition(i, point);
      result.push(point.x, point.y, point.z);
    }
    return result;
  };
  try {
    let reference: number[] | undefined;
    for (const scalar of [0, -Number.EPSILON / 8, Number.EPSILON / 8]) {
      let representation: number[] | undefined;
      for (const sign of [1, -1]) {
        // The actual opposed IK section frames, with the measured scalar
        // roundoff and both equivalent quaternion representations.
        lower.quaternion
          .set(0, 0.49698496028246836 * sign, -0.8677591539436698 * sign, scalar * sign)
          .normalize();
        garment.updatePose();
        const actual = vertices(),
          middle = vertices(true);
        reference ??= middle;
        representation ??= actual;
        // The true distal transform differs by scalar roundoff, so its cuff
        // retains that transform. The resolved middle ring is exactly stable;
        // q versus -q gives exactly the same entire skinned surface.
        expect(middle).toEqual(reference);
        expect(actual).toEqual(representation);
      }
    }
    // Old interpolation is a negative control: the scalar's tiny negative
    // sign sends the same protected joint ring down the opposite half-turn.
    lower.quaternion.set(0, 0.49698496028246836, -0.8677591539436698, -Number.EPSILON / 8);
    garment.updatePose();
    garment.mesh.skeleton.bones[2].quaternion.identity().slerp(lower.quaternion, 0.5);
    const wrong = vertices(true);
    expect(Math.max(...wrong.map((value, i) => Math.abs(value - reference![i])))).toBeGreaterThan(
      0.05,
    );
    garment.updatePose();
    expect(vertices(true)).toEqual(reference);
    // A genuine non-half-turn retains its ordinary shortest-arc midpoint.
    lower.quaternion.setFromAxisAngle(new T.Vector3(1, 0, 0), 1.8);
    const expected = new T.Quaternion().slerp(lower.quaternion, 0.5);
    garment.updatePose();
    expect(garment.mesh.skeleton.bones[2].quaternion.toArray()).toEqual(expected.toArray());
    expect(attributes.map((attribute) => attribute.version)).toEqual(versions);
  } finally {
    garment.dispose();
    geometry.dispose();
    material.dispose();
  }
});
