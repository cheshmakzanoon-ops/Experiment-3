import * as T from '/home/user/Experiment-3/node_modules/three/build/three.module.js';
import { RoomEnvironment } from '/home/user/Experiment-3/node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import { installManufacturingFinish } from '/home/user/Experiment-3/.claude/worktrees/agent-a54a73eab89a18e33/src/rendering/manufacturing.ts';
import { installExhaustHeatTint } from '/home/user/Experiment-3/.claude/worktrees/agent-a54a73eab89a18e33/src/rendering/exhaust-heat-tint.ts';
export function run(force?: number) {
  (window as any).forceNm = force;
  const W = 480, H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  document.body.appendChild(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const errors: string[] = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => { errors.push(String(gl.getShaderInfoLog(fs)) + String(gl.getProgramInfoLog(program))); };
  const scene = new T.Scene();
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = new T.Color(0x667788);
  const cam = new T.PerspectiveCamera(30, W / H, 0.01, 20);
  const view = (window as any).forceNm <= -2 ? [0.55, 0.02, -2.05] : [0.32, 0.12, -2.75];
  cam.position.set(view[0], view[1], view[2]); cam.lookAt(0, -0.07, -2.05);
  const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(2, 4, -3); scene.add(sun);
  const metal = installExhaustHeatTint(installManufacturingFinish(new T.MeshPhysicalMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3 }), 'turned-alloy'));
  const prevHook = metal.onBeforeCompile;
  let info = {};
  metal.onBeforeCompile = (shader, r) => { prevHook.call(metal, shader, r); if ((window as any).forceNm > 0) shader.fragmentShader = shader.fragmentShader.replace(/material\.iridescenceThickness = [^;]+;/, 'material.iridescenceThickness = ' + (window as any).forceNm + '.0;'); info = { hasMask: shader.fragmentShader.includes('material.iridescence *= exhaustMask'), lpf: shader.fragmentShader.includes('#include <lights_physical_fragment>'), irid: metal.iridescence, range: metal.iridescenceThicknessRange }; };
  // Hero-like tailpipe: profile from the APX-01 author script.
  const profile = [[-1.91,.055],[-2.01,.049],[-2.16,.042],[-2.17,.039],[-2.15,.036],[-2.01,.043],[-1.91,.049]];
  const pts = profile.map(([z, r]) => new T.Vector2(r, z)).reverse();
  const lathe = new T.LatheGeometry(pts, 48);
  lathe.rotateX(Math.PI / 2); // lathe axis Y -> Z ... positions (r cos, z, r sin) -> rotate so axis is z
  // After rotateX(+90deg): y -> z, z -> -y.
  lathe.translate(0, -0.076, 0);
  const plain = new T.MeshPhysicalMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3, iridescence: 1, iridescenceIOR: 2.2, iridescenceThicknessRange: [75, 75] });
  const pipe = new T.Mesh(lathe, ((window as any).forceNm === -1 || (window as any).forceNm === -3) ? plain : metal);
  scene.add(pipe);
  // A neighbouring plain alloy part outside the envelope (stays untinted).
  const bracket = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.2, 24), metal);
  bracket.position.set(0.16, -0.05, -2.05);
  scene.add(bracket);
  const crash = new T.Mesh(new T.BoxGeometry(0.16, 0.09, 0.45), new T.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }));
  crash.position.set(0, -0.235, -2.05);
  scene.add(crash);
  renderer.render(scene, cam);
  return { errors, info, url: canvas.toDataURL(), zRange: (lathe.computeBoundingBox(), [lathe.boundingBox.min.z, lathe.boundingBox.max.z, lathe.boundingBox.min.y, lathe.boundingBox.max.y]) };
}
