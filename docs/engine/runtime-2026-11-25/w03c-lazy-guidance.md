# W03C — lazy driving-audio guidance

## Change and boundary

The [W01D audit](w01d-devices-audit.md) observed 744 `Track.at` calls and
11,904 bytes of retained route-array payload during default-disabled
`configureDriving`, before an audio context existed. The production callers
are renderer installation and settings application (`src/main.ts`).

`src/audio/engine.ts` now keeps the latest track and validated settings without
constructing a `DrivingCueDirector`. The first admitted audio update constructs
one only when playback is live for a human, audio is unmuted, cues are enabled,
cue volume is positive, and at least one cue type is enabled. Frame eligibility,
cue arbitration and route geometry remain owned by the existing director.

Same-track configuration resets cue timing and silences pending tones while
reusing an existing route. A replacement track drops the old director even if
the replacement configuration is disabled. `stop()` retains configuration and
its existing timing reset. `dispose()` resets and releases the track/director
synchronously, including the pre-context case; restarting a disposed owner
requires a fresh driving configuration. Late context-close settlement cannot
clear a newly configured replacement.

The existing cue-synth silencing cadence remains: settings changes silence
immediately, while paused, nonhuman and muted updates silence as before.
Default-disabled driving does not add per-update AudioParam cancellation work.

## Focused evidence

`tests/engine-driving-audio-lazy-route.test.ts` runs the actual `RacingAudio`,
director, route and track. Spies count production `Track.at` calls; the existing
recording Web Audio fixture supplies the browser boundary.

| Scenario | Observed track work |
| --- | --- |
| Cold default-disabled, zero-volume or all-cue-types-off configuration and updates | 0 calls |
| Enabled configuration without a context, then paused/nonhuman/muted updates | 0 calls |
| First eligible update on the default track | 744 route samples + 2 ordinary samples |
| Later eligible updates | 2 ordinary samples each |
| Same-track disable/enable, reconfiguration and stop | Route reused; cue cooldown resets |
| Disabled track replacement, with and without a previously built route | 0 replacement route work until use; only the latest track is sampled |
| Disposal before startup or while close is pending | Old track remains unused; fresh configuration builds a fresh route |

The tests also check copied/latest settings, the actual scheduled 1,100 Hz
upshift envelope, diagnostic counts and independent replacement-context time.
All three inactive-settings cases assert zero recurring cue-silence calls.
The 11,904-byte figure remains logical typed-array payload from W01D; cold
inactive configuration now allocates no director/route. A previously used
same-track route deliberately remains available across toggles. No heap, GC,
FPS, native PCM or speaker claim is made.

## Verification

Final combined gate uses the required 512 MiB heap cap and one threaded worker:

```sh
NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/vitest run tests/engine-driving-audio-lazy-route.test.ts tests/racing-audio-lifetime.test.ts tests/engine-audio-preview-cancellation.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Results: **37/37** tests across three files: **9/9** new focused tests and
**28/28** existing context/preview tests. Scoped Prettier and `git diff --check`
also pass. Full compiler/build remains root-owned hosted CI. No renderer, main, guidance
algorithm, vehicle profile, installation or git write was performed.
