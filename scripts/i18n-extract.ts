/**
 * The translator's worklist: every English string of the interface with its key and the
 * files it appears in.
 *
 *   node --experimental-transform-types scripts/i18n-extract.ts            # summary
 *   node --experimental-transform-types scripts/i18n-extract.ts --json     # full catalogue
 *   node --experimental-transform-types scripts/i18n-extract.ts --stats    # per-file counts
 */
import { catalogue } from './i18n-catalogue.ts';

const entries = await catalogue();
const args = process.argv.slice(2);
if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(entries, null, 1) + '\n');
} else {
  const words = entries.reduce((n, e) => n + e.source.split(/\s+/).length, 0);
  console.log(`${entries.length} strings, ${words} English words`);
  if (args.includes('--stats')) {
    const byFile = new Map<string, number>();
    for (const e of entries) byFile.set(e.from[0], (byFile.get(e.from[0]) ?? 0) + 1);
    for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${file}`);
  }
}
