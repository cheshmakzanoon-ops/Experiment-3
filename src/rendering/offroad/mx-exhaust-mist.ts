import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { B, BIKE_BASE, F, H, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { vehicleIndex } from '../../simulation/vehicles.ts';
import { renderWind } from '../../simulation/weather.ts';
import { markItems } from '../attribute-ranges.ts';
import { MxDustMaterial } from './mx-dust-material.ts';

import { MX_SILENCER_MOUNT } from './mx-silencer.ts';

const MOUNT = MX_SILENCER_MOUNT,
  UP = Math.sin(MOUNT.pitch),
  BACK = -Math.cos(MOUNT.pitch);
const OUTLET = new T.Vector3(
  MOUNT.x,
  MOUNT.y - Math.sin(MOUNT.pitch) * MOUNT.outletZ,
  MOUNT.z + Math.cos(MOUNT.pitch) * MOUNT.outletZ,
);
const SLOTS = 10,
  LIMIT = 64 * SLOTS,
  MX250 = vehicleIndex('mx250');

/** Thin, blue-grey oil mist at the two-stroke outlet. Only a short local trail
 * is resolved. Its location and phase are wholly determined by the snapshot,
 * so an inspection, held replay or backward seek shows the identical plume. */
export class MxExhaustMist {
  readonly points: T.Points<T.BufferGeometry, MxDustMaterial>;
  private readonly xyz = new T.Float32BufferAttribute(LIMIT * 3, 3).setUsage(T.DynamicDrawUsage);
  private readonly size = new T.Float32BufferAttribute(LIMIT, 1).setUsage(T.DynamicDrawUsage);
  private readonly opacity = new T.Float32BufferAttribute(LIMIT, 1).setUsage(T.DynamicDrawUsage);
  private readonly seed = new T.Float32BufferAttribute(LIMIT * 2, 2).setUsage(T.DynamicDrawUsage);
  private readonly floor = new T.Float32BufferAttribute(LIMIT, 1).setUsage(T.DynamicDrawUsage);
  private readonly q = new T.Quaternion();
  private readonly pos = new T.Vector3();
  private readonly jet = new T.Vector3();

  constructor(material: MxDustMaterial) {
    const g = new T.BufferGeometry(),
      colour = new Float32Array(LIMIT * 3);
    for (let i = 0; i < LIMIT; i++) colour.set([0.45, 0.51, 0.6], i * 3);
    g.setAttribute('position', this.xyz);
    g.setAttribute('color', new T.BufferAttribute(colour, 3));
    g.setAttribute('mxParticleSize', this.size);
    g.setAttribute('mxParticleAlpha', this.opacity);
    g.setAttribute('mxParticleShape', this.seed);
    g.setAttribute('mxParticleFloor', this.floor);
    this.points = new T.Points(g, material);
    this.points.name = 'MX250 two-stroke exhaust mist';
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer) => material.updateViewport(renderer);
    this.clear();
  }
  clear() {
    this.points.visible = false;
    this.points.geometry.setDrawRange(0, 0);
  }

  update(frame: Float32Array, density: number, exposed: boolean) {
    const t = frame[H.TIME];
    if (!(density > 0) || !(t >= 0)) {
      this.clear();
      return;
    }
    const windX = exposed ? renderWind(frame[H.WIND_X]) : 0,
      windZ = exposed ? renderWind(frame[H.WIND_Z]) : 0;
    let n = 0;
    for (let id = 0; id < Math.min(64, frame[H.CARS]); id++) {
      const o = carBase(id);
      if (
        Math.round(frame[o + RACE_BASE + R.VEHICLE]) !== MX250 ||
        frame[o + F.RETIRED] > 0.5 ||
        frame[o + F.RPM] < 800 ||
        frame[o + BIKE_BASE + B.STATE] > 0.5
      )
        continue;
      this.q.fromArray(frame, o + F.QX);
      const pos = this.pos.copy(OUTLET).applyQuaternion(this.q);
      pos.x += frame[o + F.X];
      pos.y += frame[o + F.Y];
      pos.z += frame[o + F.Z];
      const jet = this.jet.set(0, UP, BACK).applyQuaternion(this.q);
      const throttle = clamp(frame[o + F.THROTTLE], 0, 1),
        speed = Math.abs(frame[o + F.SPEED]);
      const load = clamp((frame[o + F.RPM] - 1400) / 7500, 0, 1);
      // Puffs integrate many firing strokes. Higher load adds momentum while
      // relative wind disperses them faster as the bike accelerates.
      const life = 0.72 / (1 + 0.014 * speed),
        rate = 12,
        cycle = t * rate + id * 0.381966;
      const latest = Math.floor(cycle);
      for (let i = 0; i < SLOTS; i++) {
        const age = (cycle - latest + i) / rate;
        if (age >= life || age > t) break;
        const turn = age / life,
          tail = 1 - turn;
        const drift = age + Math.expm1(-5 * age) / 5;
        const jetTravel = ((1.2 + 1.4 * load + 1.1 * throttle) * -Math.expm1(-4 * age)) / 4;
        // Fresh gas inherits the motorcycle's velocity at emission. Drag
        // gradually replaces it with the ambient wind, with buoyant rise.
        const phase = (latest - i) * 2.39996 + id * 1.67;
        const x =
          pos.x +
          jet.x * jetTravel +
          (windX - frame[o + F.VX]) * drift +
          Math.sin(phase) * 0.08 * turn;
        const y = pos.y + jet.y * jetTravel - frame[o + F.VY] * drift + 0.28 * age * age;
        const z =
          pos.z +
          jet.z * jetTravel +
          (windZ - frame[o + F.VZ]) * drift +
          Math.cos(phase) * 0.08 * turn;
        this.xyz.setXYZ(n, x, y, z);
        this.size.setX(n, 0.054 + (0.38 + 0.15 * load) * turn);
        this.opacity.setX(n, Math.min(1, density) * (0.085 + 0.075 * throttle) * tail * tail);
        this.seed.setXY(n, 1, phase * 0.19);
        this.floor.setX(n, pos.y - 0.75);
        n++;
      }
    }
    const last = n - 1;
    for (const attr of [this.xyz, this.size, this.opacity, this.seed, this.floor])
      markItems(attr, 0, last);
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
  }
}
