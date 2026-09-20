import { it } from 'vitest';
import { instrumentOracles } from '../scripts/instrument-oracles.ts';
for (const [name, test] of Object.entries(instrumentOracles)) it(name, test);
