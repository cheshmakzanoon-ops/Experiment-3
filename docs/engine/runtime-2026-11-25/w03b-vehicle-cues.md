# W03B — vehicle-aware driving gear cues

Read `SESSION.md`, `w01d-devices-audit.md`, and the prior advancement README/audio
change guide before implementation. Changes are limited to
`src/audio/driving-cues.ts` and the new
`tests/engine-driving-cue-vehicles.test.ts`.

## Repair

The director resolves the first entrant through protocol `R.VEHICLE` and the
existing catalogue helpers. Forward-gear eligibility uses the authoritative
`gearRatios.length - 2`. Upshift and downshift thresholds use each vehicle's
authored `shiftRPM` and `downshiftRPM`, scaled by the existing APX-01 cue ratios
(`11800 / 12300` and `4800 / 6900`). This retains the exact strict Formula
boundaries while adapting both cues to each engine; no vehicle exception or
authored tuning was introduced.

The TC-1 now emits an upshift at 8,090 RPM in third. The GPR-1 emits no upshift
at 18,190 RPM in sixth, but does in fifth. Single-speed drives cannot emit
either shift cue. Representative 3-, 4-, 5-, 7-, and 8-speed catalogue gearboxes
also suppress upshifts in their final gear.

Chassis-only samples that satisfy the existing required-field contract retain
the Formula fallback when no vehicle identity exists. Present identities must
be in-range integers; gears must be integral and within the resolved gearbox.
Malformed identity/gear/car-count data resets cue state, alongside the existing
non-finite required-field and short-frame rejection. Samples remain read-only.
Tone recipes, dwell, arbitration, cooldown, stale-tick handling, and live-owner
resets are unchanged.

## Focused evidence

Both commands used a 512 MiB Node heap and one thread worker:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-driving-cue-vehicles.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/reference-depth.test.ts --testNamePattern 'live-only audio driving accessibility' --pool=threads --maxWorkers=1 --minWorkers=1
```

- New regression file: **34 passed**, 1.69 s command-reported Vitest duration.
- Existing accessibility group: **14 passed**, 15 unrelated cases excluded by
  the explicit name filter, 2.13 s command-reported Vitest duration.
- Coverage includes both audit witnesses, Formula boundary equality, touring
  and motorcycle downshift behavior, actual gearbox lengths, electric drive,
  legacy/short/invalid samples, reset recovery, priority, dwell, and stale ticks.

No full test run, compiler/build gate, install, git write, audio-owner change,
rendering/protocol/catalogue/off-road change, or performance claim is included.
