/** Coarse session rows locate a stop, but phase 3 also includes lifting a car
 * whose wheels still carry load. Anchor inspection to the actual decoded replay
 * clock, then request interior service instants through the ordinary seek UI.
 * These are observation requests, never replacement frames or animation inputs. */
export function recordedPitMoment(
  observed: { time: number; phase: number; clock: number },
  stage: 'removal' | 'installation',
) {
  if (
    ![observed.time, observed.phase, observed.clock].every(Number.isFinite) ||
    !Number.isInteger(observed.phase) ||
    observed.phase < 2 ||
    observed.phase > 5 ||
    observed.clock < 0 ||
    observed.clock > 5.2 ||
    observed.time < observed.clock ||
    (stage !== 'removal' && stage !== 'installation')
  )
    throw new Error('Invalid recorded service anchor');
  // Removal finishes at 2.2 s; installation ends at 3.5 s. Stay away from both
  // phase boundaries and let the test independently require unloaded, displaced
  // wheels in the rendered frame. A broken jack cannot pass by choosing a clock.
  const clock = stage === 'removal' ? 2 : 2.6;
  return observed.time - observed.clock + clock;
}
