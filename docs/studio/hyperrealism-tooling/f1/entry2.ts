import * as T from '/home/user/Experiment-3/node_modules/three/build/three.module.js';
import { applyPaintFinish, installPaintFlakes, installRaceGrime, installPaintObservation } from '/home/user/Experiment-3/.claude/worktrees/agent-a54a73eab89a18e33/src/rendering/paint-finish.ts';
export function run() {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 160;
  document.body.appendChild(canvas);
  const renderer = new T.WebGLRenderer({ canvas });
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const errors: string[] = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => { errors.push(String(gl.getShaderInfoLog(fs)) + String(gl.getProgramInfoLog(program))); };
  const scene = new T.Scene();
  scene.background = new T.Color(0x8899aa);
  const cam = new T.PerspectiveCamera(30, 2, 0.1, 50);
  cam.position.set(0, 0, 6); cam.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xbfd4ff, 0x404040, 1.2));
  const sun = new T.DirectionalLight(0xffffff, 2.5); sun.position.set(2, 3, 4); scene.add(sun);
  const make = (flake: boolean) => {
    const m = new T.MeshPhysicalMaterial({ color: 0x1040c0 });
    applyPaintFinish(m, flake ? 'metallic' : 'gloss');
    installPaintFlakes(m, flake ? 1 : 0, 0.002);
    installRaceGrime(m);
    installPaintObservation(m);
    return m;
  };
  const a = new T.Mesh(new T.SphereGeometry(0.9, 64, 32), make(false)); a.position.x = -1.1; scene.add(a);
  const b = new T.Mesh(new T.SphereGeometry(0.9, 64, 32), make(true)); b.position.x = 1.1; scene.add(b);
  renderer.render(scene, cam);
  return { errors, url: canvas.toDataURL() };
}
