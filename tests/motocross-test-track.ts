import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

/** A level laboratory patch with the production venue's soil and eligibility.
 * This isolates wheel/brake authority from the real venue's cross-bank force.
 * No suspension load, rider pose or wheel speed is fabricated. */
export function levelMotocrossTrack() {
  return levelMotocrossPatch(new Track('clear', false, undefined, circuitDefinition('valley-ridge-mx')));
}

/** Apply the same laboratory surface to an existing simulation's track. */
export function levelMotocrossPatch(track: Track, s = 35) {
  const centre = track.at(s, trackPoint()),
    sample = track.sample.bind(track);
  track.sample = (x, z, out, hint) => {
    sample(x, z, out, hint);
    out.height = centre.y;
    out.normal.set(0, 1, 0);
    return out;
  };
  return track;
}
