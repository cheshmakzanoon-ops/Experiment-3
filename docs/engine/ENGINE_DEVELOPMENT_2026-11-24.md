# Engine development programme — 24 November 2026

## Scope and baseline

This programme improves the shared game engine of Experiment-3 on `main`.
Baseline: `5bb8a45843c853fcdbfe3fe422d303b5c2932fca`.

The user requested 60 agents in 10 waves, with six distinct agent assignments
per wave. Available execution capacity is three workers plus the coordinating
agent, so each wave runs in two batches of three. The coordinator reviews,
integrates, validates, commits, and pushes the completed work to `main`.

**Excluded:** 3D models, characters, authored environments, geometry, scene
decoration, textures, material appearance, asset exports, vehicle specifications,
and artistic changes. Runtime infrastructure that operates on these resources
may be improved without altering the resources or their intended appearance.

## Architecture

- Circuit racing, road motorcycles, and motocross share `RacingRenderer` and
  the worker-owned `Simulation`.
- Vehicle dynamics are provided by `Vehicle`, `BikeVehicle`, and
  `DirtBikeVehicle`, with shared collision, race, and snapshot infrastructure.
- Festival uses `FestivalSession`, `FestivalRenderer`, and
  `OpenWorldSimulation`, reusing the graphics context and vehicle systems.
- Rendering is based on Three.js; the project's game systems are TypeScript.

## Acceptance criteria

1. Changes address an observed defect, measured inefficiency, or demonstrated
   integration gap; speculative rewrites are excluded.
2. Physics retains its fixed timestep and existing vehicle tuning.
3. Regression tests exercise behavior such as pause/resume, stalls, repeated
   initialization, ownership transfer, disposal, boundary values, and recovery.
4. Type checking, relevant unit tests, and production bundling must pass.
5. Broader physics and browser checks are selected to cover actual risks.
6. No excluded model, character, environment, or asset file is changed.
7. Every wave records its evidence and is committed and pushed to `main`.
8. Performance claims require measured results; correctness improvements alone
   are not described as an unmeasured FPS improvement.

## Wave plan

Specific assignments are refined against findings from preceding waves.

| Wave | Agents | Engine focus | Status |
|---|---:|---|---|
| 1 | 1–6 | Fixed-step scheduling, input cadence, live/replay timing, worker snapshots | Complete |
| 2 | 7–12 | Runtime ownership, asynchronous lifecycle, resource reuse | In progress |
| 3 | 13–18 | Collision queries, numerical stability, simulation throughput | Pending |
| 4 | 19–24 | Worker protocols, input validation, cancellation and recovery | Pending |
| 5 | 25–30 | Replay, telemetry, recording, persistence and bounded memory | Pending |
| 6 | 31–36 | Rendering infrastructure, frame scheduling and quality transitions | Pending |
| 7 | 37–42 | Audio graph lifecycle, input devices and session transitions | Pending |
| 8 | 43–48 | Determinism, shared runtime integration and open-world engine services | Pending |
| 9 | 49–54 | Performance measurement and adversarial integration review | Pending |
| 10 | 55–60 | Independent regression audits, remaining fixes and final validation | Pending |

## Validation environment

The checkout is isolated from the pre-existing development checkout. Installed
dependencies are reused. Tests invoke Vitest directly to avoid asset-generation
pretest scripts. Asset contents are not regenerated or modified.

## Completed work and evidence

Wave results, test commands, limitations, and commits are recorded here as work
is integrated. Agent-specific receipts are maintained in the accompanying task
ledger.

### Baseline and first batch

The initial targeted baseline passed 64 tests across eight suites: collision
continuity, wheel-solver accuracy, integrator stability, input, both worker
paths, live-frame timing, and replay clocks.

Agents 01–03 added a bounded-work simulation clock, input-pump lifecycle
guards, migration of valid older clutch bindings, and replay-clock validation.
The scheduling contract retains the existing 120 Hz physics timestep; an
individual tick remains indivisible. A synthetic 100 ms backlog with 6 ms
ticks now performs two ticks and reports 83.3 ms discarded instead of running
the full catch-up batch. This is a deterministic scheduling test, not an FPS
benchmark. The Festival worker will adopt the same clock in the second batch.

### Wave 1 — second batch

Festival now uses the same bounded-work clock, including pause/reinitialization
and an exact 100 ms status deadline. Recording pools reject duplicate local
returns, maintain outstanding-transfer credits, and preserve attached pages
when a send fails. Both recording streams stage a shared tick before either
stream is delivered. Controls become neutral on disposal or visibility loss;
keyboard widgets and individual touch pointers retain ownership of their inputs.

All six assignments completed with focused regression suites. The first batch
is published as `db3b4f13c135cbe8b0ad35ff49cd36cfeea7a5d9`. Full-project
compiler runs are serialized because concurrent instances exceeded available
memory; a compiler termination is not counted as a passing check.

Wave 1 integration: **81 tests passed across six suites**. Full project
`tsc --noEmit --extendedDiagnostics` passed after serialization (3,112+ files;
approximately 2.0 GiB compiler memory). Scoped ESLint and whitespace checks
passed. No excluded content files were changed.
