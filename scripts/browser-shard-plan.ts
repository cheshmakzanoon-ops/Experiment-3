/** Scheduling weights are estimates, not performance claims or pass conditions.
 * Every discovered case is assigned exactly once; serial suites remain atomic. */
export interface BrowserCase {
  id: string;
  title: string;
  file: string;
  serialGroup: string | null;
}
export interface BrowserShard {
  tests: BrowserCase[];
  weight: number;
}
export function browserWeight(test: BrowserCase) {
  // Whole weekends contain qualifying and racing; treating them as a generic
  // forty-unit test concentrates substantial work on one runner.
  if (/Championship weekend:|normal entry, immutable briefing/.test(test.title)) return 750;
  if (/53-a61-rival/.test(test.file)) return 300;
  if (/51-race-day|p0-cockpit-framing/.test(test.file)) return 240;
  if (/29-populated-race-review/.test(test.file)) return 360;
  if (/27-visual-coherence|28-race-pit-presentation/.test(test.file)) return 260;
  if (/fullSceneFogGPU/.test(test.title)) return 210;
  if (/application|24-coupled-driver|35-aurel-race-quality/.test(test.file)) return 120;
  if (/record|replay|endurance|race-completion/.test(test.file)) return 150;
  return 40;
}
export function planBrowserShards(tests: BrowserCase[], count: number): BrowserShard[] {
  if (!Number.isInteger(count) || count < 1 || count > 32 || !tests.length)
    throw new Error('Invalid browser shard request');
  if (new Set(tests.map((test) => test.id)).size !== tests.length)
    throw new Error('Duplicate discovered test ID');
  const groups = new Map<string, BrowserCase[]>();
  for (const test of tests) {
    if (!test.id || !test.title || !test.file) throw new Error('Malformed discovered case');
    const key = test.serialGroup ?? test.id;
    const group = groups.get(key) ?? [];
    group.push(test);
    groups.set(key, group);
  }
  const work = [...groups]
    .map(([key, tests]) => ({
      key,
      tests,
      weight: tests.reduce((sum, test) => sum + browserWeight(test), 0),
    }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key, 'en'));
  const shards = Array.from({ length: count }, () => ({ tests: [] as BrowserCase[], weight: 0 }));
  for (const group of work) {
    let target = 0;
    for (let i = 1; i < count; i++) if (shards[i].weight < shards[target].weight) target = i;
    shards[target].tests.push(...group.tests);
    shards[target].weight += group.weight;
  }
  const assigned = shards.flatMap((shard) => shard.tests.map((test) => test.id));
  if (assigned.length !== tests.length || new Set(assigned).size !== tests.length)
    throw new Error('Incomplete or overlapping shard plan');
  return shards;
}
export function casePattern(tests: BrowserCase[]) {
  if (!tests.length) throw new Error('Empty browser shard');
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^(?:${tests.map((test) => escape(test.title)).join('|')})$`;
}
export function verifySelection(expected: BrowserCase[], actual: BrowserCase[]) {
  const a = expected.map((test) => test.id).sort(),
    b = actual.map((test) => test.id).sort();
  if (a.length !== b.length || a.some((id, i) => id !== b[i]))
    throw new Error('Playwright selection does not exactly match the assigned shard');
}
