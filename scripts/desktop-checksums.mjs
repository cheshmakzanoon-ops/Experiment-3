import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  `desktop-out/SHA256SUMS-${process.platform}-${process.arch}.txt`,
  lines.join('\n') + '\n',
);
await copyFile(
  'desktop-stage/DESKTOP_BUILD.json',
  `desktop-out/source-${process.platform}-${process.arch}.json`,
);
