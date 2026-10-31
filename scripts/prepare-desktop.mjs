import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { desktopTarget } from '../desktop-dist/target.js';
const target = desktopTarget(process.platform, process.arch, process.env.MOTOBOUND_TARGET_ARCH);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const identity = JSON.parse(await readFile('dist/BUILD_IDENTITY.json', 'utf8'));
if (process.env.GITHUB_ACTIONS === 'true' && identity.commit !== process.env.GITHUB_SHA)
  throw new Error('Desktop source does not match the CI commit');
await rm('desktop-stage', { recursive: true, force: true });
await mkdir('desktop-stage', { recursive: true });
await cp('dist', 'desktop-stage/dist', {
  recursive: true,
  filter: (path) => !path.endsWith('.map'),
});
await cp('desktop-dist', 'desktop-stage/desktop-dist', { recursive: true });
await writeFile(
  'desktop-stage/package.json',
  JSON.stringify(
    {
      name: 'motobound',
      version: pkg.version,
      private: true,
      type: 'module',
      main: 'desktop-dist/main.js',
      description: pkg.description,
      author: 'MOTOBOUND contributors',
      license: 'UNLICENSED',
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  'desktop-stage/DESKTOP_BUILD.json',
  JSON.stringify(
    {
      version: 1,
      ...identity,
      electron: pkg.devDependencies.electron,
      ...target,
    },
    null,
    2,
  ) + '\n',
);
// Deterministic raster of the original MOTOBOUND monogram in build/icon.svg.
const size = 512,
  raw = Buffer.alloc((size * 4 + 1) * size),
  polygon = [
    [96, 384],
    [96, 128],
    [166, 128],
    [256, 261],
    [346, 128],
    [416, 128],
    [416, 384],
    [344, 384],
    [344, 255],
    [256, 376],
    [168, 255],
    [168, 384],
  ];
const inside = (x, y) => {
  let c = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const at = y * (size * 4 + 1) + 1 + x * 4;
    const dx = Math.max(96 - x, x - 416, 0),
      dy = Math.max(96 - y, y - 416, 0);
    const visible = dx * dx + dy * dy <= 96 * 96;
    const color = inside(x + 0.5, y + 0.5) ? [252, 72, 84] : [17, 24, 32];
    raw.set([...color, visible ? 255 : 0], at);
  }
const crc = (data) => {
  let n = 0xffffffff;
  for (const b of data) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name),
    len = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([len, type, data, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
await mkdir('build', { recursive: true });
await writeFile('build/icon.png', png);
await writeFile('desktop-stage/icon.png', png);
console.log(
  `Prepared offline desktop application for ${identity.commit ?? 'uncommitted local development'}`,
);
