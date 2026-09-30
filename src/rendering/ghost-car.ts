import * as T from 'three';
import { VEHICLE } from '../simulation/config.ts';
import { CAR_STRIDE, HEADER, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { writeGhostFrame, type GhostPose } from '../core/ghost-lap.ts';
import { FormulaCar } from './car.ts';
import type { HeroShells } from './hero-shells.ts';

/** Translucent Time Trial ghost. It is an ordinary car representation posed
 * from the saved personal-best lap, with one shared translucent material,
 * no shadows, no reflections, and a fade near the camera so it never hides
 * the player's own car or cockpit. It never collides and is not simulated. */
export const GHOST_LOOK = Object.freeze({
  color: 0xa9dcff,
  emissive: 0x2c7fb3,
  opacity: 0.34,
  fadeStart: 3,
  fadeEnd: 14,
});

export function ghostOpacity(distance: number) {
  const t = Math.min(1, Math.max(0, (distance - GHOST_LOOK.fadeStart) / (GHOST_LOOK.fadeEnd - GHOST_LOOK.fadeStart)));
  return GHOST_LOOK.opacity * t * t * (3 - 2 * t);
}

export class GhostCar {
  readonly car: FormulaCar;
  readonly material: T.MeshStandardMaterial;
  private frame = new Float32Array(HEADER + CAR_STRIDE);
  private visibleNow = false;
  constructor(hero?: HeroShells) {
    // Car id 1 uses a rival representation, never the supplied player asset.
    this.car = new FormulaCar(1, hero);
    this.car.root.name = 'Time Trial ghost';
    this.material = new T.MeshStandardMaterial({
      color: GHOST_LOOK.color,
      emissive: GHOST_LOOK.emissive,
      emissiveIntensity: 0.55,
      roughness: 0.45,
      metalness: 0,
      transparent: true,
      opacity: GHOST_LOOK.opacity,
      // Nearest surface only: internal parts do not stack into a bright blob.
      depthWrite: true,
    });
    this.material.name = 'Time Trial ghost';
    this.car.root.traverse((object) => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.material;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 3;
    });
    this.car.root.visible = false;
  }
  get root() {
    return this.car.root;
  }
  get visible() {
    return this.visibleNow;
  }
  /** Pose the ghost for this presented frame, or hide it. */
  update(
    pose: GhostPose | null,
    camera: T.Camera,
    quality: 'low' | 'medium' | 'high',
    time: number,
    dt: number,
  ) {
    if (!pose) {
      this.visibleNow = this.car.root.visible = false;
      return;
    }
    const f = this.frame,
      o = carBase(0);
    writeGhostFrame(f, pose, time);
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      f[p + W.STEER] = i < 2 ? pose.steer * VEHICLE.maxSteer : 0;
      f[p + W.ROTATION] = (pose.s / 0.335) % (Math.PI * 2);
      f[p + W.RADIUS] = 0.335;
      f[p + W.LOAD] = 0;
    }
    const distance = camera.position.distanceTo(this.car.root.position.set(pose.x, pose.y, pose.z));
    const opacity = ghostOpacity(distance);
    this.material.opacity = opacity;
    this.visibleNow = this.car.root.visible = opacity > 0.01;
    if (!this.visibleNow) return;
    // The reduced representation is the ghost's detail level at any range.
    this.car.setLod(Math.max(distance, 80), quality, false);
    this.car.update(f, f, o, 1, dt, time, false);
  }
  /** Car geometry is shared with the field and released with the renderer. */
  dispose() {
    this.material.dispose();
  }
}
