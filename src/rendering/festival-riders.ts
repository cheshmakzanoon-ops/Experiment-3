import * as T from 'three';
import { H, carBase } from '../simulation/protocol.ts';
import { BikeShells } from './bike.ts';
import { presentationAlpha, sampleChassisPose, snapshotSource } from './snapshot-interpolation.ts';
import type { QualityPreset } from './options.ts';

/**
 * Motorcycles in the festival: the circuit's procedural bike presentation
 * (BikeShells: road bikes and the supermoto, rider, lean, suspension) posed
 * over the festival snapshot. The festival car presentation draws no body
 * for a motorcycle entrant, so this is the only representation; it is
 * updated before the festival renderer draws, from the same interpolation.
 */
export class FestivalRiders {
  readonly shells = new BikeShells();
  private readonly hosts: { root: T.Object3D }[] = [];
  private active = false;
  get root() {
    return this.shells.root;
  }
  update(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    camera: T.PerspectiveCamera,
    quality: QualityPreset,
  ) {
    if (a.length !== b.length || a[H.CARS] !== b[H.CARS] || b[H.TIME] < a[H.TIME]) a = b;
    const cars = Math.round(b[H.CARS]),
      t = a === b ? 1 : Math.min(1, Math.max(0, alpha));
    let bikes = false;
    for (let id = 0; id < cars && !bikes; id++)
      bikes = BikeShells.isBike(snapshotSource(a, b, presentationAlpha(a, b, carBase(id), t)), id);
    // Nothing to draw and nothing left over from an earlier rider.
    if (!bikes && !this.active) return;
    this.active = bikes;
    while (this.hosts.length < cars) this.hosts.push({ root: new T.Object3D() });
    for (let id = 0; id < cars; id++) {
      const o = carBase(id),
        host = this.hosts[id].root;
      sampleChassisPose(a, b, o, t, host.position, host.quaternion);
    }
    this.shells.update(a, b, t, this.hosts, camera, quality === 'ultra' ? 'high' : quality, 0);
  }
  /** Release every bike built for this session (models, riders, materials
   * and their textures) and detach the root: the festival shares the
   * application's WebGL renderer, which outlives it. */
  dispose() {
    this.shells.disposeAll();
    this.shells.root.removeFromParent();
    this.active = false;
  }
}
