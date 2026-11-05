import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/home/user/Experiment-3/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://127.0.0.1:5184/src/rendering/sea.ts');
const age = Number(process.argv[3] ?? 0.32);
const img = await page.evaluate(async (age) => {
  const T = await import('/node_modules/three/build/three.module.js');
  const mats = await import('/src/rendering/materials/index.ts');
  const surf = await import('/src/rendering/open-world/festival-road-surface.ts');
  const W = 14, L = 400, PX = 6;
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
  const r = new T.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  const a = mats.materials.asphalt({ variant: 'worn' });
  surf.installFestivalRoadSurface(a, age); surf.festivalRoadDetail.value = 1;
  const g = new T.PlaneGeometry(W, L, 1, 1); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i) + L / 2);
  const n = p.count;
  g.setAttribute('festivalRoadData', new T.BufferAttribute(new Float32Array(n * 4).map((_, k) => [7, 3.5, 1.234, 1][k % 4]), 4));
  g.setAttribute('festivalSurfaceData', new T.BufferAttribute(new Float32Array(n * 2), 2));
  const scene = new T.Scene();
  scene.add(new T.Mesh(g, a));
  const sun = new T.DirectionalLight(0xffffff, 2.5); sun.position.set(3, 10, 2); scene.add(sun);
  scene.add(new T.HemisphereLight(0xbcd4ff, 0x404030, 1.2));
  // Perspective view along the road from 1.4 m.
  const cam = new T.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 1000);
  cam.position.set(1.8, 1.3, L / 2 - 2); cam.lookAt(1.8, 0, L / 2 - 25);
  const cam2 = new T.OrthographicCamera(-W / 2, W / 2, L / 2, -L / 2, 0.1, 100);
  cam2.position.set(0, 50, 0); cam2.up.set(0, 0, -1); cam2.lookAt(0, 0, 0);
  r.toneMapping = T.ACESFilmicToneMapping; r.outputColorSpace = T.SRGBColorSpace; r.render(scene, cam);
  return canvas.toDataURL('image/png');
}, age);
writeFileSync(process.argv[2], Buffer.from(img.split(',')[1], 'base64'));
await browser.close();
