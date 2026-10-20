import * as T from 'three';
import type { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';
import { RIDER } from '../../src/rendering/rider.ts';
import {
  MX_BOOT_ANKLE,
  MX_GLOVE_GRIP,
  MX_GLOVE_WRIST,
  motocrossSoleContact,
} from '../../src/rendering/offroad/motocross-rider-contact.ts';

/** Inspect the actual posed equipment, including CPU evaluation of the same
 * boot skinning used by the GPU. An assigned control target alone cannot
 * satisfy the sole ray, calf vertices, or wrist/ankle attachment checks. */
export function inspectMotocrossRiderContacts(model: DirtBikeModel, dab = 0) {
  model.root.updateMatrixWorld(true);
  const up = new T.Vector3(0, 1, 0).transformDirection(model.sprung.matrixWorld),
    point = new T.Vector3(),
    target = new T.Vector3(),
    joint = new T.Vector3(),
    expected = new T.Vector3(),
    ray = new T.Raycaster();
  return [0, 1].map((i) => {
    const label = i === 0 ? 'left' : 'right',
      side = i === 0 ? 1 : -1,
      hand = model.rider.root.getObjectByName(`Motocross ${label} hand`)!,
      boot = model.rider.root.getObjectByName(`Motocross ${label} boot`)!;
    point.fromArray(MX_GLOVE_GRIP).applyMatrix4(hand.matrixWorld);
    target.copy(model.rider.grips[i]).applyMatrix4(model.sprung.matrixWorld);
    const handError = point.distanceTo(target);
    point.fromArray(MX_GLOVE_WRIST).applyMatrix4(hand.matrixWorld);
    joint.set(0, RIDER.forearm, 0).applyMatrix4(hand.parent!.matrixWorld);
    const wristJointError = point.distanceTo(joint);
    point.fromArray(MX_BOOT_ANKLE).applyMatrix4(boot.matrixWorld);
    joint.set(0, RIDER.shin, 0).applyMatrix4(boot.parent!.matrixWorld);
    const ankleJointError = point.distanceTo(joint);
    motocrossSoleContact(model.rider.pegs[i], side, dab, target).applyMatrix4(
      model.sprung.matrixWorld,
    );
    ray.set(point.copy(target).addScaledVector(up, -0.08), up);
    ray.near = 0;
    ray.far = 0.22;
    const hits = ray.intersectObject(boot, true),
      // This is the rendered sole surface, not the foot group's origin.
      ankleError = hits.length ? Math.abs(hits[0].distance - 0.08) : 999;
    let calfAttachmentError = 0,
      calfSamples = 0,
      skinMeshes = 0;
    boot.traverse((object) => {
      if (!(object instanceof T.SkinnedMesh)) return;
      skinMeshes++;
      const positions = object.geometry.getAttribute('position');
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (positions.getY(vertex) > -0.15) continue;
        object.getVertexPosition(vertex, point).applyMatrix4(object.matrixWorld);
        expected.fromBufferAttribute(positions, vertex);
        expected.y += RIDER.shin - MX_BOOT_ANKLE[1];
        expected.z -= MX_BOOT_ANKLE[2];
        expected.applyMatrix4(boot.parent!.matrixWorld);
        calfAttachmentError = Math.max(calfAttachmentError, point.distanceTo(expected));
        calfSamples++;
      }
    });
    return {
      handError,
      ankleError,
      wristJointError,
      ankleJointError,
      calfAttachmentError,
      calfSamples,
      skinMeshes,
      soleContactFound: hits.length > 0,
    };
  });
}
