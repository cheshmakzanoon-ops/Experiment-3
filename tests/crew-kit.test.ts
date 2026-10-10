import { expect, it } from 'vitest';
import * as T from 'three';
import { PLAYER_CREW_COLOUR, crewTeamColour } from '../src/rendering/crew-geometry.ts';
import { LIVERIES } from '../src/simulation/config.ts';
import { crewSuitFragment } from '../src/rendering/crew-suit.ts';

it('dresses each crew in its team kit with a dark secondary yoke and trousers', () => {
  expect(crewTeamColour(0).getHex()).toBe(new T.Color(PLAYER_CREW_COLOUR).getHex());
  for (let car = 1; car < 12; car++)
    expect(crewTeamColour(car).getHex()).toBe(
      new T.Color(LIVERIES[car % LIVERIES.length]).getHex(),
    );
  expect(crewTeamColour(3)).toBe(crewTeamColour(3));
  expect(crewTeamColour(-1).getHex()).toBe(crewTeamColour(0).getHex());
  expect(crewSuitFragment).toContain('diffuseColor.rgb * .3,');
  expect(crewSuitFragment).toContain('diffuseColor.rgb *= mix(1., .42, suitLeg * suitCloth);');
});
