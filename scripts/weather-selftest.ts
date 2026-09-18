import { brakeOracles } from './brake-oracles.ts';
import { weatherOracles } from './weather-oracles.ts';
for (const [name, test] of Object.entries({ ...weatherOracles, ...brakeOracles })) {
  test();
  console.log(`PASS: ${name}`);
}
console.log(`${Object.keys(weatherOracles).length + Object.keys(brakeOracles).length} production weather/effects/braking oracles passed`);
