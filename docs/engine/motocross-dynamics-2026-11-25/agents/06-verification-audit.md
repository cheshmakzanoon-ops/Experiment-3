# Assignment 06 — motocross integration and verification audit

Inspected task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887`. This assignment reviewed source and existing acceptance coverage; it did not execute a browser run or alter production/model/environment files.

## Existing integration is real

`e2e/45-motocross-gameplay.spec.ts` launches the production app and worker, selects DIRT → OUTDOOR MX with MX450 and DIRT → STADIUM SX with MX250, and observes eight initialized entrants. It uses normal key bindings for fore/aft rider weight and throttle before explicitly enabling the AI demonstration. It then requires at least 20 simulated seconds, 100 m forward progress, a qualifying flight, recorded touchdown, and advancing rendered time. It also checks independent mudguard animation for the followed rider and at least one opponent, chase/cockpit presentation, pause acknowledgement, held tick/frame counts, and return to paddock.

This is substantial app-to-worker-to-presentation coverage. I found no evidence that the existing motocross animation helpers are detached from the live game. New physics/controller work should extend this path rather than create another demonstration-only entry point.

## Important remaining acceptance gaps

1. **Manual-player jumps are not the browser journey's jump proof.** The journey proves manual throttle and rider-weight input, then uses AI for its observed flight and touchdown. The independent player soil solver can fail while this AI flight still passes. Preserve player-path numerical/integration scenarios for braking, landing, and rough-ground riding; describe the browser result accurately.
2. **The native journey covers two machine/venue combinations, not all four.** The CPU display-cadence script already covers MX250 and MX450 on both venues. Use that full matrix plus targeted player simulations; do not report four native journeys from the two existing entries.
3. **Deterministic transforms alone do not prove physically correct wheel placement or smooth velocity.** `scripts/bench/motocross-display-cadence.ts` compares ten joint/wheel matrices at common times across 30/60/120/144/240 Hz, including fractional sampling and LOD changes. This detects render-history dependence but a consistently lagged suspension still passes. Add dynamic wheel-gap/pose coherence and transition-velocity assertions for the reproduced issues from assignments 01–03.
4. **Component browser fixtures are not full-game riding.** The practice, berm, and flow specs mount production HUD components and drive synthetic samples. They are useful if signals or scoring change, but do not replace the real journey for physics integration.

## Efficient staged verification

Run from the repository root. Invoke tools directly to avoid npm's model-generation pretest/prebuild hooks, keeping protected source unchanged.

### Fast physical and motion contracts

```sh
npx vitest run tests/motocross-ground-physics.test.ts tests/motocross-contact-traction.test.ts tests/motocross-contact-impulse.test.ts tests/motocross-wheel-pickup.test.ts tests/motocross-rider-weight.test.ts tests/motocross-machine-animation.test.ts tests/motocross-rider-motion.test.ts tests/motocross-camera.test.ts tests/motocross-snapshot-cadence.test.ts
```

The coordinator's initial baseline run of these nine files recorded 100 passing tests in `/workspace/scratch/e91efca799c8/validation/baseline-focused.log`. That is the baseline observation, not acceptance of future changes.

After relevant fixes, include `tests/motocross-sprung-pose.test.ts`, `tests/motocross-control-animation.test.ts`, `tests/motocross-landing-prediction.test.ts`, `tests/motocross-riding.test.ts`, `tests/motocross-rider-recovery.test.ts`, and all new focused regressions. Run the complete `tests/motocross-*.test.ts` set once at integrated acceptance rather than repeatedly during each small edit.

### Complete playback and production build

```sh
npx vite-node --script scripts/bench/motocross-field.ts --cadence
npx tsc --noEmit
npx vite build
```

The cadence command uses the script's minimal canvas shim and real production simulation/rig transforms. It submits no pixels to a GPU and must be reported as CPU transform verification. The direct Vite command builds the normal product variant; do not substitute `build:qa`, which deliberately includes owner/review-only content.

### Native production journey

```sh
APEX_BROWSER_BACKEND=swiftshader APEX_MOTOCROSS_JOURNEY_QUALITY=low APEX_MOTOCROSS_JOURNEY_PROGRESS=1 npx playwright test e2e/45-motocross-gameplay.spec.ts --config playwright.motocross.config.ts
```

The config starts a fresh preview on port 4197, uses one worker and zero retries, and records actual WebGL backend identity. Chromium must already be installed. Medium can be selected explicitly for a second quality observation when needed. A Low pass is functional Low acceptance; it does not establish High/Ultra rendering, physical hardware frame rate, or perceived quality.

The existing workflow uses `APEX_MOTOCROSS_XVFB_CAPTURE=1` with `xvfb-run -a -s '-screen 0 1920x1080x24'` for native screenshot capture. Reuse that supported path if the available environment requires display capture; do not disable capture assertions or inflate deadlines. The journey has its own 20-minute ceiling because it constructs and captures both complete venues.

### Larger physics regression only after solver changes

```sh
node --experimental-transform-types scripts/offroad-calibration.ts
node --experimental-transform-types scripts/offroad-races.ts --mx-full-grid
```

The first checks launch bands, surveyed jump trajectories/landing windows, and slow jump rolling. It writes tracked `docs/offroad-calibration.json`, so preserve its output in task evidence and explicitly manage that generated report rather than treating it as a source change. The second exercises eight mixed-class, twelve-rider races across both venues, clear/rain conditions, and two seeds, writing `test-results/motocross-full-grid.json`. The `--mx-stress-grid` variant increases this to 24 races; reserve it for a concrete unresolved stability risk.

## Workflow and provenance limits

`.github/workflows/motocross-final-review.yml` runs the focused motocross contracts and product build, then separates full world/material suites from real-input journeys at several qualities. Its prepare job also includes unrelated GP/material coverage, and the broader repository workflow has documented preexisting content failures. A new failure must be reproduced against the task baseline before being labeled preexisting. Neither old green handoffs nor a currently passing subset certifies a new physics change.

Record source commit, command, exit status, test count, backend, and limitations for the final integrated run. Preserve models/assets by comparing actual source diffs, not by assuming a physics-focused test command cannot generate files.
