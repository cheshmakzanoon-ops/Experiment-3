export { captureGpFloodlightGlare } from './gp-floodlight-glare.ts';
import * as T from 'three';
import { HeatHaze } from '../../src/rendering/heat-haze.ts';
import { SceneAmbientPass } from '../../src/rendering/scene-ambient-pass.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { H, HEADER } from '../../src/simulation/protocol.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

/** Look through an actual surveyed GP start straight at a striped target.
 * A red foreground pole crosses the same rays. Only the distant target
 * should shift. Frames use the real depth and colour composite. */
export function captureGpRoadAir() {
  const width = 576,
    height = 324,
    canvas = document.createElement('canvas');
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  const track = new Track('clear', false, undefined, CIRCUITS.haarveld),
    p = track.at(0, trackPoint());
  const centre = new T.Vector3(p.x, p.y, p.z),
    forward = new T.Vector3(p.tx, p.gradient, p.tz).normalize();
  const up = new T.Vector3(
    -p.tx * p.gradient - p.nx * p.bank,
    1,
    -p.tz * p.gradient - p.nz * p.bank,
  ).normalize();
  const camera = new T.PerspectiveCamera(16, width / height, 0.25, 500);
  camera.position.copy(centre).addScaledVector(forward, -77).addScaledVector(up, 1.27);
  camera.lookAt(centre.clone().addScaledVector(up, 0.45));
  camera.updateMatrixWorld();
  const scene = new T.Scene();
  scene.background = new T.Color(0.19, 0.27, 0.37);
  const data = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 128; x++) {
      const v = ((x >> 1) + (y >> 1)) % 2 ? 217 : 50;
      data.set([v, v, v, 255], 4 * (x + 128 * y));
    }
  const boardMap = new T.DataTexture(data, 128, 32);
  boardMap.needsUpdate = true;
  boardMap.magFilter = T.LinearFilter;
  boardMap.minFilter = T.LinearFilter;
  const board = new T.Mesh(new T.PlaneGeometry(40, 8), new T.MeshBasicMaterial({ map: boardMap }));
  board.position.copy(centre).addScaledVector(forward, 42).addScaledVector(up, 2);
  board.quaternion.copy(camera.quaternion);
  scene.add(board);
  const front = new T.Mesh(
    new T.PlaneGeometry(0.29, 2.5),
    new T.MeshBasicMaterial({ color: new T.Color(0.93, 0.035, 0.025) }),
  );
  front.position
    .copy(camera.position)
    .addScaledVector(camera.getWorldDirection(new T.Vector3()), 9);
  front.quaternion.copy(camera.quaternion);
  scene.add(front);
  const pass = new SceneAmbientPass(scene, camera),
    haze = new HeatHaze();
  pass.setSize(width, height);
  pass.ambientOcclusion = false;
  pass.setHeatHaze(haze);
  pass.renderToScreen = true;
  const output = new T.WebGLRenderTarget(width, height),
    frame = new Float32Array(HEADER);
  frame[H.AMBIENT] = 35;
  frame[H.CLOUD] = 0.08;
  frame[H.WIND_X] = 1;
  const captures: { name: string; image: string }[] = [];
  const sample = (name: string, rain: number, time: number) => {
    frame[H.RAIN] = rain;
    haze.update(frame, camera, [], 0, time, height, track, 0, true);
    pass.render(renderer, output);
    const gl = renderer.getContext(),
      pix = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    captures.push({ name, image: canvas.toDataURL('image/png') });
    return pix;
  };
  try {
    const off = sample('cool-road', 3, 17),
      a = sample('sunlit-road', 0, 17),
      b = sample('moving-air', 0, 17.42);
    const count = haze.uniforms.gpRoadAirCount.value;
    const again = sample('air-rewound', 0, 17),
      wet = sample('rain-rewound', 3, 17.42);
    let changed = 0,
      moving = 0,
      rewound = 0,
      wetDifference = 0,
      foreground = 0,
      foregroundPixels = 0,
      sky = 0;
    for (let i = 0; i < a.length; i += 4) {
      const gap = (v: Uint8Array, w: Uint8Array) =>
        Math.max(
          Math.abs(v[i] - w[i]),
          Math.abs(v[i + 1] - w[i + 1]),
          Math.abs(v[i + 2] - w[i + 2]),
        );
      if (gap(off, a) > 1) changed++;
      if (gap(a, b) > 1) moving++;
      if (gap(a, again) > 0) rewound++;
      if (gap(off, wet) > 0) wetDifference++;
      if (off[i] > 180 && off[i + 1] < 30) {
        foregroundPixels++;
        if (gap(off, a) > 0) foreground++;
      }
      if (i / (4 * width) > 0.85 * height && gap(off, a) > 0) sky++;
    }
    return {
      captures,
      count,
      changed,
      moving,
      rewound,
      wetDifference,
      foreground,
      foregroundPixels,
      sky,
      glError: renderer.getContext().getError(),
    };
  } finally {
    pass.dispose();
    output.dispose();
    board.geometry.dispose();
    front.geometry.dispose();
    board.material.dispose();
    front.material.dispose();
    boardMap.dispose();
    renderer.dispose();
  }
}
