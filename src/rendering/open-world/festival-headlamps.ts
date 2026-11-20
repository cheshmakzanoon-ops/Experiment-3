import * as T from 'three';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { bodySheetFor } from '../vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../vehicle-bodies/closed-body.ts';
import { festivalFaceLamps } from '../vehicle-bodies/festival-face-lamps.ts';
import { festivalLampPockets, festivalNoseZ } from '../vehicle-bodies/festival-nose.ts';
import { bodyFrame } from '../vehicle-bodies/frame.ts';

/** Photometric mask in projector space. The horizontal cutoff keeps the dipped
 * beam below opposing drivers' eyes; the near field is broad and falls off
 * gradually. Both sides sample the same linear, mipmapped intensity map. */
function dippedBeam() {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    const y = ((row + 0.5) * 2) / size - 1;
    for (let column = 0; column < size; column++) {
      const x = ((column + 0.5) * 2) / size - 1;
      const falloff = Math.exp(-1.25 * x * x - 2.6 * (y + 0.08) ** 2);
      const cutoff = 1 - T.MathUtils.smoothstep(y, 0.015, 0.085);
      const value = Math.round(255 * falloff * cutoff);
      const i = (row * size + column) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.name = 'Dipped headlamp intensity';
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class FestivalHeadlamps {
  readonly root = new T.Group();
  private readonly mask = dippedBeam();
  private readonly lamps = [-1, 1].map((side) => {
    const light = new T.SpotLight(0xfff2dc, 0, 85, 0.38, 0.65, 2);
    light.name = side < 0 ? 'Right dipped headlamp' : 'Left dipped headlamp';
    light.map = this.mask;
    light.castShadow = false;
    this.root.add(light, light.target);
    return light;
  });
  private definition: VehicleDefinition | null = null;

  constructor() {
    this.root.name = 'Followed car headlamps';
    this.root.visible = false;
  }
  private fit(definition: VehicleDefinition) {
    const f = bodyFrame(definition),
      s = bodySheetFor(definition);
    let x = f.trackFront * 0.4,
      y = f.y(0.66),
      z = f.frontAxle + 0.45;
    if (s?.kind === 'closed') {
      const model = new ClosedBodyModel(f, s, [s.wheels.width[0] / 2, s.wheels.width[1] / 2]);
      const vertical = festivalFaceLamps(model)[0],
        flush = festivalLampPockets(model)[0];
      if (vertical) {
        x = Math.abs(vertical.x);
        y = vertical.y;
        z = model.zFront;
      } else if (flush) {
        const lens = new T.Vector3().setFromMatrixPosition(flush.base);
        x = Math.abs(lens.x);
        y = lens.y + 0.003;
        z = lens.z;
      } else {
        z = model.zFront - (s.lamps.front === 'pod' ? 0.3 : 0.22);
        x = model.halfWidth(z) * (s.lamps.front === 'bar' ? 0.45 : 0.66);
        y = model.surfaceY(z, x);
      }
      z = festivalNoseZ(model, x, z);
    }
    for (let i = 0; i < this.lamps.length; i++) {
      const side = i ? 1 : -1,
        light = this.lamps[i];
      light.position.set(side * x, y, z + 0.012);
      // The two pools overlap down the road. Their axes remain slightly
      // splayed so the near edge of the carriageway is illuminated as well.
      light.target.position.set(side * (x + 0.8), f.ground, z + 30);
    }
    this.definition = definition;
  }
  update(holder: T.Object3D | null, definition: VehicleDefinition, level: number) {
    this.root.visible = !!holder && level > 0.05;
    if (!holder || !this.root.visible) return;
    if (definition !== this.definition) this.fit(definition);
    this.root.position.copy(holder.position);
    this.root.quaternion.copy(holder.quaternion);
    for (const light of this.lamps) light.intensity = 70 * T.MathUtils.clamp(level, 0, 1);
  }
  clear() {
    this.root.visible = false;
    this.definition = null;
    for (const light of this.lamps) light.intensity = 0;
  }
  dispose() {
    this.clear();
    this.mask.dispose();
    for (const light of this.lamps) light.dispose();
  }
}
