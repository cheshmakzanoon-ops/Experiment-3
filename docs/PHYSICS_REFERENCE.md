# Physics against Formula 1 reference figures

`scripts/reference-targets.ts` runs the production `Vehicle` (tyre, aero,
drivetrain, brake and suspension solvers) at 240 Hz on isolated analytic
surfaces. Only pedals and steering are scripted; no pose, velocity or grip is
written during a measured run. It writes `docs/reference-targets.json`. Pass
`--strict` to fail when a figure is outside its band.

The reference bands are approximate public figures for current Formula 1
cars. They vary with season, circuit trim and conditions, so they are bands
rather than exact targets. The car here is an original design and is not
meant to reproduce any team's data.

| Metric | Measured | Reference band | Source of band |
| --- | --- | --- | --- |
| 0-100 km/h | 2.27 s | 2.3-3.2 s | About 2.5-2.6 s ([F1 Academy](https://www.f1academy.com/About/6zGmsPscfUgxbgTXODCFVB/the-car-and-engine), fan summaries) |
| 0-200 km/h | 4.90 s | 4.3-5.8 s | About 4.5-5 s |
| Top speed (flat, ERS deploy) | 320 km/h | 320-360 km/h | Race-trim speed traps on low-drag circuits |
| 200-0 km/h distance | 54.8 m | 50-70 m | Brembo: about 65 m and 2.9 s ([conceptcarz/Brembo](https://www.conceptcarz.com/a48268/brembo-formula-1-brake-mexican-grand-prix.aspx)) |
| 200-0 km/h time | 2.33 s | 2.4-3.3 s | Same |
| Peak braking | 5.9 g (from 300 km/h) | 4-6 g | Brembo corner data: 4.5 g, 4.8 g |
| Lateral, fast corner | 4.3 g (at 264 km/h) | 4-6.5 g | [Mercedes-AMG F1 "G-force explained"](https://www.mercedesamgf1.com/news/g-force-and-formula-one-explained): over 5 g at the apex |
| Lateral, ~80 km/h | 1.9 g | 1.8-3.2 g | Engineering estimate (mechanical grip, little downforce) |

Lateral limits come from a constant-speed ramp-steer: speed is held with the
throttle while the steering rises slowly, and the peak filtered lateral
acceleration is the limit. Measured limits by speed: 1.9 g at 80 km/h, 2.8 g
at 157 km/h, 4.0 g at 234 km/h and 4.3 g at 264 km/h.

Wet braking from 200 km/h on 1.2 mm of standing water: slicks 123 m,
intermediates 70 m, full wets 71 m (dry 55 m).

### Outside the bands

- **0-100 km/h (2.27 s) and 200-0 km/h time (2.33 s)** are about 2-3% quicker
  than the band's lower edge. The braking distance is inside its band. Neither
  has been retuned: the fastest figures for these cars are traction- and
  test-dependent, and the gap is smaller than the uncertainty of the public
  figures.
- **The top speed** sits exactly on the lower edge. Low-drag trims and
  slipstream would add to it.

## AI driving to the measured envelope

Before this calibration the AI used a fixed cornering budget of at most
21.5 m/s² (2.2 g) and a constant 8.5 m/s² (0.87 g) braking envelope. That is
about half of what the car it drives can do, and it put braking points
several hundred metres early. The AI now plans with the measured capability
(`AI_ENVELOPE` in `src/simulation/ai.ts`):

- Lateral: `15.95 + 0.00548·v²` m/s², fitted to the ramp-steer limits.
- Braking: `19.9 + 0.0056·v²` m/s², fitted to the 100/200/300 km/h stops.
- A backward velocity profile over the next 240 m, where braking uses only
  the part of the friction circle the corner leaves (trail braking).
- Downforce loss in another car's wake and less reserve in passing lanes.
- Throttle and brake are squeezed within the friction circle. The driver
  eases off against wheelspin and lock-up. These are pedal commands only.
- Margins of 72% (fast corners), 62% (slow corners) and 55% (braking) of
  the measured limits. Higher margins made the field quicker in isolation (an
  Aurel lap of 52 s at 84%/72%/72%), but they caused first-lap contacts and
  spins in 10-car races. The chosen margins are the highest tried where every
  race acceptance suite passes with no timeout DNF.

| Single AI car, dry | Before | After |
| --- | --- | --- |
| Aurel lap | 61.8 s | 56.0 s |
| Vellamar lap | 81.1 s | 75.0 s |
| Peak lateral (Aurel) | 1.5 g | 2.7 g |
| Braking deceleration at 300 km/h | 0.87 g | 3.3 g |

`npm run test:physics`, `scripts/race-classification.ts`,
`scripts/pit-integration.ts` and `scripts/vellamar-race.ts` (clear and
changeable) all pass.

## Racing line

The AI used to drive the centreline, with passing lanes 3.5 m to either
side, so every car ran down the middle of every corner.
`src/simulation/racing-line.ts` now solves a minimum-curvature line for each
circuit: outside on entry, inside at the apex, outside on exit, within the
traffic planner's 2.4 m edge clearance. The solver relaxes the path's
second-difference (curvature) energy, coarse to fine, with every point clamped
inside the track. Neighbour averaging was rejected because it finds the shortest
path, which hugs the inside of a whole corner and tightens it. It runs once per
circuit geometry (30-45 ms).

| | Centreline | Racing line |
| --- | --- | --- |
| Aurel tightest radius driven | 43.8 m | 61.6 m |
| Vellamar tightest radius driven | 24.3 m | 27.1 m (summit hairpin) |
| Aurel single-car dry lap | 56.0 s | 50.1 s |
| Vellamar single-car dry lap | 75.0 s | 69.6 s |

- The AI steers to the line at its look-ahead point. A passing or defending
  lane is a tactical distance from the line. The speed envelope uses the
  driven path's curvature: the line's, corrected for that distance.
- The traffic planner predicts each candidate path along the line, including
  the line's own lateral shift. With fixed absolute lanes, a car following the
  line ran into a slower car ahead. Lane commitments are also held relative to
  the line.
- It predicts the other cars along the line too, extrapolating only the part
  of their lateral velocity that is a lane change. Predicting them from their
  current lateral position made a car alongside, drifting across the track with
  the line, look like a collision, so followers left their lane and racing
  thinned out. Measured from a mid-field start on Aurel (5 laps, 8 cars, seeds
  73021/11/29, the race-review criterion of one rival within 18 m for 5 s):

  | | Centreline | Line, rivals extrapolated | Line, rivals on the line |
  | --- | --- | --- | --- |
  | Longest close run (player) | 8.9-28.6 s | 2.4-3.5 s | 6.1-10.8 s |
  | On-track position changes | 23-25 | 18-21 | 20-27 |
  | Race time | 316-317 s | 284 s | 283-284 s |

  Cars on one line string out more than cars spread across the centreline and
  its lanes (10th-percentile time to the car ahead 0.65 s against 0.38 s), so
  the share of time within 18 m of a rival is lower (1-10% per car, against
  2-17%).
- The pit approach and the pit lane keep absolute corridors.
- In the wet the line narrows towards the centreline (to 55% from about 0.8 mm
  of water under the car), and the envelope keeps up to 15% more in reserve.
  Without these, cars trail-braking into fast sweepers in the rain stepped the
  rear out and left the track.
- Race-day rubber is laid along the line (a band about a car wide, peak 0.45
  over a 0.035 coating) instead of down the centre. The existing rubber grip
  term (+5% at full rubber, dry only) gives it about 2% more grip, and the
  road shader shows it as a darker band.
- The changeable race-classification scenario now runs 4 laps. Its storm
  arrives on a fixed weather clock, and at the new pace a 3-lap race ended
  before a car that called for wets just after the pit entry could be
  serviced. Its requirement, that every car physically fit wet tyres, is
  unchanged.

## Open

- The AI still uses only 55-72% of the measured limits. Closing that gap needs
  racecraft work (first-lap caution, side-by-side braking, overtake abort
  distances), not just larger margins.
- Line tracking is pure pursuit and averages about 1.2 m from the line on
  Aurel, cutting slightly inside on long corners. Kerb use at the apex is not
  modelled as a choice.
- Wet-weather reference figures are not published in a comparable form; the
  wet ratios here are internal consistency checks only.
- Force feedback and steering-rack feel are not calibrated against reference
  data.
