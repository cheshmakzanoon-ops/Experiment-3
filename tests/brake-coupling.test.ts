import { it } from 'vitest';
import { brakeOracles } from '../scripts/brake-oracles.ts';
for (const [name, test] of Object.entries(brakeOracles)) it(name, test);
