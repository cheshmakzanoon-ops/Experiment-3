# Storage / replay audit — wave 1, worker 4

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`.
Production was read-only. This report is the only file written by this worker.
Reviewed storage, ghost playback and replay clock, including the previous runtime-followup storage review.
No 3D content, authored assets, vehicle tuning, schemas, capture bounds or git state changed.

## 1. Ghost distance queries search an array that valid laps do not keep sorted

**Scope:** `src/core/ghost-lap.ts:262–325`, with a focused new query regression test.
**Reachability:** `TimeTrialRecords.observe()` feeds `GhostPlayer.delta()` directly into the time-trial HUD.
`GhostPlayer.index(1, s)` binary-searches raw sample distance, although only sample **time** is guaranteed monotone.
`LapTracker.update()` accepts small on-track negative movements (`src/simulation/race.ts:63–71`), so this occurs in legitimate recordings; no corrupt save is needed.

**Reproduced:** actual `LapTracker` plus `GhostRecorder`, 3,000 m lap, 120 Hz timing, 30 Hz observations, one 10 m reversal at 1,500 m.
The recorder produced a valid 100.666664 s ghost with 3,021 samples, including ten decreasing-distance pairs.
At 1,495 m, `timeAt()` returns **50.499999 s**; the first recorded ascending crossing is **49.833334 s**.
Queries at 1,491–1,499 m show approximately **0.666667 s** disagreement. The selected crossing is an artifact of binary-search pivots.
The existing `LapReference` deliberately retains first crossings, providing an established policy for the distance reference.

**Safe change:** construct a bounded monotone index of first-passage distance intervals for `timeAt()` / `delta()` only.
Keep each interval's original time interpolation and preserve original pose samples, recording and persisted format.
An O(n) construction and O(log n) lookup are sufficient; retain original segment endpoints when a new maximum is reached after reversing or stopping.
Simply filtering increasing sample maxima is insufficient: it interpolates across the reversal/stationary delay.
Keep `poseAt()` on the original time-ordered samples, including the visible reversal.

**Meaningful verification:** compare indexed queries with a slow first-ascending-crossing oracle on a produced valid lap; test repeated station values, pauses, two reversals, exact first/last stations and samples immediately after regained progress.
Assert ordinary monotone laps retain their results and `poseAt()` outputs / stored sample bytes remain unchanged.
The reproduction below executes the real timing/recorder/query implementations, not a reimplementation of their algorithms.

## 2. Completed-lap telemetry validation omits the closing capture interval

**Scope:** `src/storage/telemetry-plots.ts:314–334`, plus `tests/telemetry-plots.test.ts`.
`completeLaps()` treats row `i` as the evidence that the previous lap finished but checks sample gaps only for `j < i`.
A gap between `i - 1` and `i` is never examined. The first row of the next lap also skips that interval because `j > start` is false.
If the adjacent distance samples are near the finish/start, a missed crossing interval is presented as a complete recorded lap in COMPARE LAPS.
This bypasses the same 0.15 s continuity rule that correctly excludes gaps inside a lap.

**Reproduced:** the existing three-lap fixture shape returns laps `[0, 1]` both before and after adding a 1 s timestamp gap exactly at row 100, where the counter increments.
The incomplete closing interval of lap 0 is accepted. Moving the same gap inside lap 0 is already rejected by existing logic/tests.

**Safe change:** include the closing interval in continuity validation without applying the next lap's validity flag to the previous lap.
Keep range endpoints and CSV/recorder contracts intact. Define the start boundary consistently when the preceding gap also means the next lap's opening section was not observed.
**Meaningful verification:** gaps just before, exactly at and just after the counter transition; ordinary contiguous transitions; the 0.15 s threshold; ring-truncated starts; invalid-next-lap flags must not contaminate a fully recorded previous lap.

## Reproduction and validation evidence

Executed successfully with Node `v24.22.3`, direct production imports, no npm hooks or production edits:

```sh
node --no-warnings --experimental-transform-types --input-type=module <<'JS'
import { GhostPlayer, GhostRecorder, GHOST_FIELDS } from './src/core/ghost-lap.ts';
import { LapTracker } from './src/simulation/race.ts';
import { F, HEADER, CAR_STRIDE, carBase } from './src/simulation/protocol.ts';
import { completeLaps, channelIndex } from './src/storage/telemetry-plots.ts';
const o = carBase(0), length = 3000, tracker = new LapTracker(length, length - 0.25);
const recorder = new GhostRecorder({ circuit: 'aurel', trackLength: length,
  assist: 'sport', compound: 'medium', weather: 'clear' });
const f = new Float32Array(HEADER + CAR_STRIDE); f[o + F.QW] = 1;
let s = length - 0.25, phase = 0, back = 0, saved;
for (let tick = 1; tick < 18000 && !saved; tick++) {
  let delta = 0.25;
  if (phase === 0 && s >= 1500 && s < 1501) phase = 1;
  if (phase === 1) { delta = -0.25; if (++back === 40) phase = 2; }
  s = (s + delta + length) % length;
  tracker.update(s, tick / 120, false);
  if (tick % 4 !== 0 && !tracker.crossedFinish) continue;
  for (const [field, value] of [[F.S, s], [F.LAPS, tracker.completed],
    [F.LAP_TIME, tracker.lapTime], [F.LAST_LAP, tracker.last],
    [F.LAP_VALID, +tracker.valid], [F.LAST_LAP_VALID, +tracker.lastValid],
    [F.LAST_LAP_ASSISTED, +tracker.lastAssisted],
    [F.SECTOR_1, tracker.lastSectors[0]], [F.SECTOR_2, tracker.lastSectors[1]],
    [F.SECTOR_3, tracker.lastSectors[2]]]) f[o + field] = value;
  saved = recorder.observe(f, true);
}
if (!saved) throw Error('No valid ghost');
const player = new GhostPlayer(saved), d = saved.samples, station = 1495;
let firstCross;
for (let i = GHOST_FIELDS; i < d.length; i += GHOST_FIELDS) {
  const a = i - GHOST_FIELDS;
  if (d[a + 1] <= station && d[i + 1] >= station && d[i + 1] > d[a + 1]) {
    firstCross = d[a] + (d[i] - d[a]) * (station - d[a + 1]) / (d[i + 1] - d[a + 1]);
    break;
  }
}
console.log({ lap: saved.lapTime, valid: tracker.lastValid,
  samples: d.length / GHOST_FIELDS, station, actual: player.timeAt(station), firstCross });
const base = { count: 300, at: (r, c) => c === 0 ? r / 60 : c === 1 ? r % 100 :
  c === 2 ? Math.floor(r / 100) : c === channelIndex('lap_valid') ? 1 : 0 };
const gap = { count: 300, at: (r, c) => base.at(r, c) + (c === 0 && r >= 100 ? 1 : 0) };
console.log({ normal: completeLaps(base, 100), boundaryGap: completeLaps(gap, 100) });
JS
```

No broad test rerun was necessary for this read-only audit; root's focused baseline is separate evidence.
Replay-clock review did not establish another defect. Persistent orphan cleanup was not claimed without a concrete crash/reopen verification.
