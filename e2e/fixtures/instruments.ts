import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { F, H, W, WHEEL_BASE, HEADER, CAR_STRIDE, carBase } from '../../src/simulation/protocol.ts';

/** Test-only canvas oracle. Artificial snapshots isolate rendering cadence, not
 * a claim about vehicle dynamics. No test hooks are exposed in the application. */
export function verifyInstrumentCanvas() {
  const car = new FormulaCar(0),
    frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  const canvas = car.display.image as HTMLCanvasElement,
    context = canvas.getContext('2d')!;
  const original = context.fillText,
    text: string[] = [];
  context.fillText = function (value: string, x: number, y: number, width?: number) {
    text.push(value);
    if (width === undefined) original.call(this, value, x, y);
    else original.call(this, value, x, y, width);
  };
  const update = (time: number, gear: number, speed: number) => {
    frame[H.TIME] = time;
    frame[o + F.GEAR] = gear;
    frame[o + F.SPEED] = speed;
    text.length = 0;
    const version = car.display.version;
    // Deliberately tiny camera delta: uploads must follow snapshot time instead.
    car.update(frame, frame, o, 1, 1 / 300, time, true);
    return { changed: car.display.version > version, text: [...text] };
  };
  try {
    const first = update(0, 1, 0),
      hitch = update(2, 1, 44),
      gear = update(2.001, 3, 45);
    const paused = update(2.001, 3, 45),
      rewind = update(0.4, 2, 20);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let brightPixels = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 100 && pixels[i + 1] > 100 && pixels[i + 2] > 100) brightPixels++;
    const a = frame.slice(),
      b = frame.slice(),
      p = o + WHEEL_BASE;
    a[H.TIME] = 1;
    b[H.TIME] = 1 + 1 / 15;
    a[p + W.LENGTH] = 0.2;
    b[p + W.LENGTH] = 0.3;
    a[p + W.ROTATION] = 6;
    b[p + W.ROTATION] = (6 + 200 / 15) % (2 * Math.PI);
    a[p + W.OMEGA] = b[p + W.OMEGA] = 200;
    a[o + F.STEER] = 0.1;
    b[o + F.STEER] = 0.3;
    car.update(a, b, o, 0.5, 1 / 60, 1 + 1 / 30, true);
    const articulated = {
      phase: car.wheelSpins[0].rotation.x,
      hubHeight: car.wheelPivots[0].position.y,
      steer: car.wheelPivots[0].rotation.y,
      steeringWheel: car.steering.rotation.z,
    };
    return { first, hitch, gear, paused, rewind, brightPixels, articulated };
  } finally {
    context.fillText = original;
    const geometry = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    car.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      geometry.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
      }
    });
    for (const g of geometry) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  }
}
