import * as T from 'three';
import { postSignal } from './marshal-staff.ts';
import { safetyPanelAppearance } from './track-infrastructure.ts';

/** Owns five cached display materials, never the borrowed LED geometry.
 * Panels and nearby physical marshals use the same recorded local witness.
 * No timer, flashing clock, race-control inference or frame writes are introduced.
 */
export class RecordedSignalDisplays {
  readonly meshes: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[] = [];
  readonly materials = Array.from({ length: 5 }, (_, flag) => {
    const state = safetyPanelAppearance(flag);
    return new T.MeshStandardMaterial({
      name: `Recorded marshal display ${flag}`,
      color: state.color,
      emissive: state.color,
      emissiveIntensity: state.intensity,
      roughness: 0.4,
      metalness: 0,
    });
  });
  private readonly bindings: { s: number; original: T.MeshStandardMaterial; flag: number }[] = [];
  private disposed = false;

  bind(mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>, s: number) {
    if (this.disposed) throw new Error('Signal displays disposed');
    if (!Number.isFinite(s) || s < 0 || this.meshes.includes(mesh))
      throw new Error('Invalid or duplicate signal display');
    this.meshes.push(mesh);
    this.bindings.push({ s, original: mesh.material, flag: -1 });
  }

  update(frame: Float32Array) {
    if (this.disposed) return;
    // Validate every witness before changing any visible material.
    for (const binding of this.bindings) postSignal(frame, binding.s);
    for (let i = 0; i < this.bindings.length; i++) {
      const binding = this.bindings[i],
        flag = postSignal(frame, binding.s);
      if (flag === binding.flag) continue;
      this.meshes[i].material = this.materials[flag];
      binding.flag = flag;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.meshes.length; i++)
      this.meshes[i].material = this.bindings[i].original;
    for (const material of this.materials) material.dispose();
    this.meshes.length = this.bindings.length = 0;
  }
}
