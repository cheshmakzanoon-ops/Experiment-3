import * as T from '/home/user/Experiment-3/node_modules/three/build/three.module.js';
import { installManufacturingFinish, ventilatedBrakeGeometry } from '/home/user/Experiment-3/.claude/worktrees/agent-a54a73eab89a18e33/src/rendering/manufacturing.ts';
import { installRotorGlow, rotorGlowColour } from '/home/user/Experiment-3/.claude/worktrees/agent-a54a73eab89a18e33/src/rendering/car-brake-glow.ts';
export function run() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  document.body.appendChild(canvas);
  const renderer = new T.WebGLRenderer({ canvas });
  const errors: string[] = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => { errors.push(String(gl.getShaderInfoLog(fs)) + String(gl.getShaderInfoLog(vs)) + String(gl.getProgramInfoLog(program))); };
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(40, 1, 0.01, 10);
  cam.position.set(0.6, 0.1, 0.2); cam.lookAt(0, 0, 0);
  scene.add(new T.AmbientLight(0xffffff, 0.2));
  const mat = installManufacturingFinish(new T.MeshStandardMaterial({ color: 0x4b4a45, roughness: 0.6, emissive: 0xff4d08 }), 'carbon-ceramic');
  const geo = ventilatedBrakeGeometry();
  installRotorGlow(mat, 0.209);
  rotorGlowColour(950, mat.emissive);
  mat.emissiveIntensity = 1;
  scene.add(new T.Mesh(geo, mat));
  renderer.render(scene, cam);
  const px = new Uint8Array(4 * 256 * 256);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let maxR = 0, maxG = 0;
  for (let i = 0; i < px.length; i += 4) { maxR = Math.max(maxR, px[i]); maxG = Math.max(maxG, px[i + 1]); }
  return { errors, maxR, maxG, programs: renderer.info.programs?.length ?? -1, url: canvas.toDataURL() };
}
