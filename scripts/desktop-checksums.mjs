import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { desktopTarget } from '../desktop-dist/target.js';
const receipt = JSON.parse(await readFile('desktop-stage/DESKTOP_BUILD.json', 'utf8'));
const target = desktopTarget(receipt.platform, receipt.hostArch ?? receipt.arch, receipt.arch);
const files = (await readdir('desktop-out'))
  .filter((n) => /\.(exe|dmg|AppImage|tar\.gz|zip)$/.test(n))
  .sort();
if (!files.length) throw new Error('No desktop packages were produced');
const lines = [];
for (const name of files)
  lines.push(
    `${createHash('sha256')
      .update(await readFile('desktop-out/' + name))
      .digest('hex')}  ${name}`,
  );
await writeFile(
  `desktop-out/SHA256SUMS-${target.platform}-${target.arch}.txt`,
  lines.join('\n') + '\n',
);
await copyFile(
  'desktop-stage/DESKTOP_BUILD.json',
  `desktop-out/source-${target.platform}-${target.arch}.json`,
);
