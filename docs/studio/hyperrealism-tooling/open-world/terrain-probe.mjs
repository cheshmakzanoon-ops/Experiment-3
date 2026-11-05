import { createRequire } from 'node:module';
const require = createRequire('/home/user/Experiment-3/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://127.0.0.1:5184/src/rendering/sea.ts');
const out = await page.evaluate(async () => {
  const T = await import('/node_modules/three/build/three.module.js');
  const tm = await import('/src/rendering/open-world/terrain-material.ts');
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 8;
  const r = new T.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  const res = {};
  for (const level of [-10000, 0]) {
    const m = tm.terrainMaterial();
    m.userData.ow.owSeaLevel.value = level;
    const g = new T.PlaneGeometry(64, 8, 64, 1); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, -0.5 + (p.getX(i) + 32) / 64 * 3.0);
    g.computeVertexNormals();
    const n = p.count;
    g.setAttribute('splat', new T.BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 === 2 ? 1 : 0)), 4));
    g.setAttribute('shade', new T.BufferAttribute(new Float32Array(n * 4), 4));
    const scene = new T.Scene();
    scene.add(new T.Mesh(g, m));
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(0, 10, 3); scene.add(sun);
    scene.add(new T.AmbientLight(0xffffff, 0.5));
    const cam = new T.OrthographicCamera(-32, 32, 4, -4, 0.1, 100); cam.position.set(0, 50, 0); cam.lookAt(0, 0, 0);
    r.render(scene, cam);
    const gl = r.getContext();
    const px = new Uint8Array(64 * 8 * 4);
    gl.readPixels(0, 0, 64, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const row = [];
    for (let x = 0; x < 64; x += 4) row.push(px[(4 * 64 + x) * 4]);
    res[level] = row.join(',');
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
