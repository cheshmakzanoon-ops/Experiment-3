import * as T from 'three';
import { mergeStatic } from '../geometry.ts';
import { MX_BOOT_ANKLE } from './motocross-rider-contact.ts';

/** Retain the existing continuous boot last and material batching. Its calf
 * follows the shin while its planted forefoot has a separate ankle frame.
 * Only the short bellows blends between them: no detached rigid shoe, new
 * geometry, per-frame vertex upload, or extra material pass is needed. */
export class MotocrossBootSkin {
  readonly skeleton: T.Skeleton;
  private readonly calf = new T.Bone();
  constructor(private readonly foot: T.Group) {
    mergeStatic(foot);
    const meshes = [...foot.children] as T.Mesh[],
      sole = new T.Bone();
    sole.name = 'Motocross planted forefoot';
    this.calf.name = 'Motocross ankle flex calf';
    this.calf.position.fromArray(MX_BOOT_ANKLE);
    foot.add(sole, this.calf);
    this.skeleton = new T.Skeleton(
      [sole, this.calf],
      [new T.Matrix4(), new T.Matrix4().makeTranslation(0, -MX_BOOT_ANKLE[1], -MX_BOOT_ANKLE[2])],
    );
    for (const rigid of meshes) {
      const geometry = rigid.geometry,
        positions = geometry.getAttribute('position'),
        indices = new Uint16Array(positions.count * 4),
        weights = new Float32Array(positions.count * 4);
      for (let i = 0; i < positions.count; i++) {
        // The reinforced toe/sole and the entire upper calf stay rigid.
        // The existing Achilles/instep folds cover the ankle transition.
        const calf = 1 - T.MathUtils.smoothstep(positions.getY(i), -0.13, -0.045);
        indices[i * 4 + 1] = 1;
        weights[i * 4] = 1 - calf;
        weights[i * 4 + 1] = calf;
      }
      geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
      const skin = new T.SkinnedMesh(geometry, rigid.material);
      skin.name = 'Motocross continuous articulated boot';
      skin.bind(this.skeleton, new T.Matrix4());
      skin.castShadow = skin.receiveShadow = true;
      // Covers the full ankle arc independently of world travel or held pose.
      skin.boundingSphere = new T.Sphere(new T.Vector3(0, -0.074, 0), 0.6);
      skin.boundingBox = new T.Box3(
        new T.Vector3(-0.6, -0.67, -0.6),
        new T.Vector3(0.6, 0.53, 0.6),
      );
      foot.remove(rigid);
      foot.add(skin);
    }
  }
  updatePose() {
    // The foot is a child of the solved shin. Undo only the ankle frame for
    // the calf, preserving the ankle pivot in the boot's local coordinates.
    this.calf.quaternion.copy(this.foot.quaternion).invert();
  }
  dispose() {
    this.skeleton.dispose();
  }
}
