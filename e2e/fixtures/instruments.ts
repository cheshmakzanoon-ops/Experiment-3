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
    a[p + W.STEER] = 0.12;
    b[p + W.STEER] = 0.32;
    a[p + W.CAMBER] = 0.04;
    b[p + W.CAMBER] = 0.06;
    car.update(a, b, o, 0.5, 1 / 60, 1 + 1 / 30, true);
    const articulated = {
      phase: car.wheelSpins[0].rotation.x,
      hubHeight: car.wheelPivots[0].position.y,
      steer: car.wheelPivots[0].rotation.y,
      steeringWheel: car.steering.rotation.z,
      camber: car.wheelPivots[0].rotation.z,
    };
    const transform = new T.Matrix4(), colour = new T.Color();
    const poses = (mesh: T.InstancedMesh) => Array.from({ length: mesh.count }, (_, i) => {
      mesh.getMatrixAt(i, transform);
      return new T.Vector3().setFromMatrixPosition(transform).toArray();
    });
    const colours = (mesh: T.InstancedMesh) => Array.from({ length: mesh.count }, (_, i) => {
      mesh.getColorAt(i, colour); return colour.getHex();
    });
    frame[o + F.RPM] = 0; update(3, 2, 20);
    const off = colours(car.shiftLeds);
    frame[o + F.RPM] = 15000; update(3.1, 2, 20);
    const on = colours(car.shiftLeds), version = car.shiftLeds.instanceColor!.version;
    update(3.1, 2, 20);
    const controls = {
      ledPositions: poses(car.shiftLeds), buttonPositions: poses(car.wheelButtons),
      buttonColours: colours(car.wheelButtons), off, on,
      pausedUpload: car.shiftLeds.instanceColor!.version === version,
      instancedDraws: 3, ledCount: car.shiftLeds.count, buttonCount: car.wheelButtons.count,
      paddleCount: car.driver.paddles.count,
    };
    return { first, hitch, gear, paused, rewind, brightPixels, articulated, controls };
  } finally {
    context.fillText = original;
    const geometry = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    car.root.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
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
