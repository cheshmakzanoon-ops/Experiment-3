import { it } from 'vitest';
import { weatherOracles } from '../scripts/weather-oracles.ts';
for (const [name, test] of Object.entries(weatherOracles)) it(name, test);
