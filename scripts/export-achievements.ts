/**
 * Print the achievement catalogue (src/steam/achievements.ts) as Markdown or
 * CSV for the Steamworks partner site.
 *
 *   node --experimental-strip-types scripts/export-achievements.ts            # Markdown
 *   node --experimental-strip-types scripts/export-achievements.ts --csv      # id,name,description,hidden
 */
import { ACHIEVEMENTS, type AchievementDef } from '../src/steam/achievements.ts';

function unlockText(a: AchievementDef) {
  const { rule } = a;
  const target = typeof rule.target === 'number' ? rule.target : 'every other';
  switch (rule.kind) {
    case 'once':
      return `first matching \`${rule.event}\``;
    case 'count':
      return `${target} x \`${rule.event}\``;
    case 'streak':
      return `${target} in a row (\`${rule.event}\`)`;
    case 'distinct':
      return `${target} distinct \`${rule.field}\` (\`${rule.event}\`)`;
    case 'sum':
      return `sum of \`${rule.field}\` >= ${target}`;
    case 'meta':
      return `${target} other achievements`;
  }
}

if (process.argv.includes('--csv')) {
  const cell = (s: string) => `"${s.replaceAll('"', '""')}"`;
  console.log('api_name,name,description,hidden');
  for (const a of ACHIEVEMENTS)
    console.log([a.id, cell(a.name), cell(a.description), a.hidden ? 1 : 0].join(','));
} else {
  console.log(`# MOTOBOUND achievements (${ACHIEVEMENTS.length})\n`);
  console.log(
    'Generated from `src/steam/achievements.ts` by `scripts/export-achievements.ts`; do not edit by hand.',
  );
  console.log('The `API name` is the id to create in the Steamworks partner site.\n');
  console.log('| API name | Name | Description | Category | Hidden | Unlock rule |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const a of ACHIEVEMENTS)
    console.log(
      `| \`${a.id}\` | ${a.name} | ${a.description} | ${a.category} | ${a.hidden ? 'yes' : ''} | ${unlockText(a)} |`,
    );
}
