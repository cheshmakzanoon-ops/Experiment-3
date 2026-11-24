# Agent 15 — discrete input delivery at worker ticks

Date: 2026-11-24. Engine infrastructure only.

## Outcome

Circuit and Festival workers now retain shift pulses across input-message turns. A shift followed by a neutral polling sample before the next physics tick is delivered once instead of being erased. Analog controls keep their immediate latest-message semantics, including the existing sanitization; circuit DRS and overtake requests keep their immediate behavior.

Owned paths:

- `src/workers/input-queue.ts` (new fixed-storage helper)
- `src/workers/physics.worker.ts` (input application and ownership boundaries only)
- `src/workers/open-world.worker.ts` (input application and ownership boundaries only)
- `tests/worker-input-edges.test.ts` (new)

No simulation tuning, gearbox timing, models, characters, environments, assets, dependencies, recording transport or rendering changes were made. Existing surface delivery and fatal-error classification remain intact.

## Delivery contract

The fixed `Int8Array` stores up to 32 pending shift pulses. Each real physics step takes at most one pulse. A worker turn with no physics step retains it; later catch-up steps cannot repeat an already consumed pulse. Neutral and non-finite shift samples do not add entries. Finite nonzero values use the existing sign normalization.

The input wire protocol carries pulses: the host clears `input.shift` after each send. Consequently, separate nonzero messages are separate intent even when their signs match and no neutral poll intervenes. There is no sequence number capable of distinguishing a duplicated message from a genuine second press; this change does not invent level-based deduplication. A single held sample is never replayed every tick.

Overflow drops the newest pulse while retaining the earliest 32 in FIFO order. This bounds storage to 32 bytes and a short active-step backlog (267 ms at 120 Hz). It is not a guarantee that every burst causes a gear change: the existing gearbox cooldown, rev and direction constraints still decide whether an applied request is accepted. No shift timing was changed.

Pause, initialization, stale-input watchdog ownership, errors, flashback start/completion and driver handoff clear the queue. Shift messages received while paused or rewinding cannot leave latent intent for resume. Successful Festival reset/travel/event/driver transitions clear previous driving intent; a rejected command preserves the still-valid queue. Traffic toggles preserve it.

## Flashback and ordinary simulation

Circuit analog messages are logged with shift zero at their original immediate application point. When a pulse is consumed, the worker passes the current actual controls plus that pulse through `applyLoggedInput` immediately before the corresponding simulation step. The log therefore records the exact tick and controls actually applied, including FIFO bursts spread over several ticks.

The new replay regression compares the real worker's resulting complete Float32 snapshot and selected Float64 body state with `Resimulation` over the captured production input log. Ordinary one-message-per-tick traces also compare every tick against direct immediate input application for Formula APX-01, MotoGP `gpr1`, motocross `mx450`, and Festival `tc1`.

## Verification

The final 26-case new worker suite passed within the combined compatibility run. It executes both actual worker modules, real simulations and actual structured-clone transfer detachment. The graph is imported once per worker and tests reinitialize via the production protocol.

Coverage: bounded FIFO and wraparound; invalid/neutral values; shift-then-neutral; neutral-then-shift; latest analog controls; opposing and repeated distinct pulses; full catch-up; turns without ticks; pause and paused messages; reinitialization; 750 ms watchdog; overflow; successful/rejected Festival commands; actual application-tick logging; complete replay state; flashback ownership; autopilot handoff; and ordinary traces across all four driving families.

All six combined suites passed: **83/83 tests**, 43.12 seconds total.

| Suite | Passed |
| --- | ---: |
| worker-input-edges.test.ts | 26 |
| surface-channel-backpressure.test.ts | 14 |
| festival-fatal-worker.test.ts | 16 |
| engine-flashback-state.test.ts | 10 |
| flashback-work-budget.test.ts | 12 |
| worker-pause.test.ts | 5 |

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/worker-input-edges.test.ts tests/worker-pause.test.ts tests/flashback-work-budget.test.ts tests/engine-flashback-state.test.ts tests/festival-fatal-worker.test.ts tests/surface-channel-backpressure.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/workers/input-queue.ts src/workers/physics.worker.ts src/workers/open-world.worker.ts tests/worker-input-edges.test.ts
```

Final targeted ESLint passed for all four owned files, and `git diff --check` passed. New helper/test formatting passed. Root owns whole-project compiler/build and remote publication gates; no full TypeScript pass or native-browser/FPS claim is made here. No Git commits or ref updates were performed.
