// Compiles festival open-world materials in a real (software) WebGL2 context
// and reports any shader compile/link errors.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/Experiment-3/node_modules/');
const { chromium } = require('playwright');
const exe = ['/opt/pw-browsers/chromium_headless_shell-1243/chrome-linux/headless_shell','/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'].find((p) => (require('node:fs').existsSync(p)));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] } : {});
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5184/src/rendering/sea.ts');
const result = await page.evaluate(async ([which, markers]) => {
  window.__markers = markers;
  const T = await import('/node_modules/.vite/deps/three.js').catch(() => import('/node_modules/three/build/three.module.js'));
  const out = { errors: [], compiled: [] };
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  document.body.appendChild(canvas);
  const renderer = new T.WebGLRenderer({ canvas });
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    out.errors.push(String(gl.getProgramInfoLog(program)) + '\nVS:' + gl.getShaderInfoLog(vs) + '\nFS:' + gl.getShaderInfoLog(fs));
  };
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 5, 10); camera.lookAt(0, 0, 0);
  const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(1, 2, 1); scene.add(sun);
  scene.add(new T.HemisphereLight(0xffffff, 0x444444, 1));
  const materials = [];
  try {
    const build = new Function('return (async (T) => {' + which + '})')();
    for (const m of [].concat(await build(T))) materials.push(m);
  } catch (e) { out.errors.push('build: ' + (e.stack || e)); }
  const geo = new T.PlaneGeometry(4, 4, 2, 2);
  for (const m of materials) {
    const mesh = new T.Mesh(geo, m);
    scene.add(mesh);
    out.compiled.push(m.name || m.type);
  }
  try { renderer.compile(scene, camera); renderer.render(scene, camera); } catch (e) { out.errors.push('render: ' + (e.stack || e)); }
  const gl = renderer.getContext();
  out.glError = gl.getError();
  out.programs = renderer.info.programs?.length;
  out.markers = {};
  for (const p of renderer.info.programs || []) {
    const shaders = gl.getAttachedShaders(p.program) || [];
    const src = shaders.map((sh) => gl.getShaderSource(sh)).join('\n');
    for (const marker of (window.__markers || [])) if (src.includes(marker)) out.markers[marker] = (out.markers[marker] || 0) + 1;
  }
  return out;
}, [(await import('node:fs')).readFileSync(process.argv[2], 'utf8'), (process.argv[3] || '').split(',')]);
console.log(JSON.stringify(result, null, 1));
console.log(logs.filter((l) => /error|ERROR|warn/i.test(l)).slice(0, 20).join('\n'));
await browser.close();
