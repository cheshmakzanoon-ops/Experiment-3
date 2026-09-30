# Game modes

Every mode runs the same fixed-step worker simulation, AI, pit service, race
control, replay and telemetry. No mode teleports cars, adds grip, or edits
results. Modes differ only in session rules, placement and scoring. The Grand
Prix and Free Practice modes are unchanged.

| Mode | Where | Rules |
| --- | --- | --- |
| Grand Prix | Menu → SESSION | Lights start from the grid and a classified finish. With a `grid` option (race weekend) cars line up in qualifying order; without it, car order is used as before. |
| Free practice | Menu → SESSION | Open session from the grid; laps are timed. |
| Time trial · ghost | Menu → SESSION | Solo (validated to zero opponents). Your fastest valid, unassisted lap is saved per circuit, replayed as a translucent ghost, and timed live against you (`DELTA TO PB`). |
| Race weekend · qualifying | Menu → SESSION, or a championship round | The field starts spread around the lap for an out-lap and gets two timed laps. It is classified by fastest valid lap, and **START RACE FROM THIS GRID** starts the race in that order. |
| Endurance · mandatory stop | Menu → SESSION, 15 or 25 laps | A long race carrying fuel for the full distance (real mass, no refuelling). A dry finish needs two different dry compounds (one real stop); running intermediates or wets also counts. Race control adds 30 s at the flag to anyone who skipped the stop, and the HUD warns you in the last three laps. The AI plans one stop onto a different dry compound, in a window set by each driver's tyre management. |
| Championship | Menu → CHAMPIONSHIP | A calendar of race weekends (by default four rounds across Aurel and Vellamar, dry and changeable). Each round is qualifying, then the race from that grid. The top ten score 25-18-15-12-10-8-6-4-2-1. Ties go to wins, then count-back. Progress is saved on the device. |

## Saved data

All saved data lives in the existing local `SaveStore` (IndexedDB) and is
validated on load.

- `ghost:v1:<circuit>`: circuit, track length, lap and sector times, assist,
  compound, weather, and poses sampled at 30 Hz (`src/core/ghost-lap.ts`).
  A ghost recorded for another circuit or layout is rejected, and so is one
  with non-finite or out-of-order samples.
- `championship:v1`: the calendar and one result per completed round: finish
  order, retirements, grid, whether the AI demonstration drove, and the
  session id (`src/core/championship.ts`). Points are always recomputed from
  those results, never stored.
- `best:<CIRCUIT>:<assist>:<compound>:<weather>`: best lap per circuit.
  Aurel keeps its original key.

## Honesty rules

- A ghost is saved only from a lap that was valid, penalty-free and unassisted
  (`LAST_LAP_VALID`, `LAST_LAP_ASSISTED`). A lap that drove through the pit
  lane does not count either. AI-demonstration laps never become a personal
  best.
- A championship round driven with the AI demonstration is still scored, but
  it is recorded and shown as `AI DEMO`.
- A retirement scores no points and is never given a finishing time.

## Evidence

| Check | What it proves |
| --- | --- |
| `tests/ghost-lap.test.ts` | Laps driven through the production simulation are recorded, saved by structured clone, replayed within 5 cm, and give a zero delta against themselves. AI laps are never saved. |
| `tests/qualifying.test.ts` | A full 8-car qualifying session through the production AI classifies by best lap, and the race starts from that grid. |
| `tests/endurance-mode.test.ts` | A full 6-car endurance race: every car stops once onto a second dry compound and nobody runs out of fuel. A one-lap race shows the penalty. |
| `tests/championship.test.ts` | Points, count-back, calendar limits, save validation, race classification and the qualifying grid. |
| `e2e/47-time-trial-ghost.spec.ts` | A saved ghost is loaded, drawn and timed against the live lap in the browser build. |
| `e2e/48-championship-weekend.spec.ts` | A championship round in the browser: qualifying, then the race from its grid, then scored and saved standings. |

## Open

- The ghost uses the reduced rival representation with one translucent
  material. Its look needs human art review.
- There is no online or shared leaderboard; ghosts are local only.
- Endurance has no driver swaps, time-of-day progression or safety car.
- Championship calendars are fixed presets; there is no custom calendar
  editor.
