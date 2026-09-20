# Full-race replay and recording continuity milestone — 2026-09-20

## Why this is the next milestone

The exact 148-section `Pasted markdown(6)` directive remains the governing specification. The current game already has a broad connected simulation: the retained `scripts/integrated-driving.ts` journey exercises launch/wheelspin, high-speed gears, wake, brake lock and recovery, kerb/grass contamination, tire thermal/wear evolution, ERS, changing weather, a real tire stop, rejoin, physical front-wing damage, whole-field classification, historical replay seeks and telemetry export in one production-physics run. That makes another isolated menu or decorative feature a lower-priority use of the next pass.

The remaining acceptance path is increasingly **integrated and presentation-facing**. Section 146 explicitly ends with finishing the race, viewing results, watching replay, switching cameras and inspecting telemetry. The reference pack reinforces that requirement: 039 is a broadcast replay view; 075–080 are photo/broadcast compositions; 095 is an in-race pit-service view; 096 is a wet cockpit view. Those compositions are only useful as a quality target if the underlying race can be archived continuously enough to revisit the actual weather, damage, tire and race state later.

The previous renderer/circuit milestones recorded a concrete blocker: the worker owned only six one-second transferable telemetry pages and six one-second replay pages. If the browser's render/UI thread could not return those buffers for roughly six seconds, capture correctly warned and stopped inventing samples—but the resulting hole meant a long hitch could permanently remove part of the race from both replay and telemetry. That directly blocks a trustworthy full-race Section-146 acceptance run.

For that reason the next milestone is **full-race replay and recording continuity under realistic main-thread stalls**, before the next large Phase-27 graphics pass.

## Engineering contract

Capture remains physics-clock-owned:

- telemetry: 60 Hz, one 60-row transferable page per full second;
- replay: 15 Hz, one 15-snapshot transferable page per full second;
- render FPS never determines capture timing;
- no dropped interval is synthesized after the fact;
- storage/page integrity behavior in `SessionReplay` is unchanged.

Transport now uses a bounded elastic reserve:

- normal reserve: **6 pages per stream**;
- maximum reserve: **30 pages per stream**;
- pages are allocated only if recycle responses are delayed;
- after the consumer catches up, surplus elastic pages are discarded and the pool returns to the six-page ordinary reserve;
- if the consumer is unavailable beyond the 30-page bound, each stream emits one explicit gap warning and capture resumes only from real future samples when a page returns.

At the maximum twelve-car field, a replay page is 180,240 bytes and a telemetry page is 54,720 bytes. Thirty pages of each are 7,048,800 bytes total (about 6.72 MiB). The ordinary six-page reserve is about 1.34 MiB. This is a deliberate bounded hitch reserve, not unbounded race-duration memory growth.

## Validation added

`tests/recording.test.ts` now proves that a simulated **20-second consumer stall**:

- emits 20 telemetry pages and 20 replay pages;
- retains all 1,200 telemetry ticks at exact two-tick cadence;
- retains all 300 replay ticks at exact eight-tick cadence;
- produces no recording warning;
- expands only to the pages actually needed;
- returns both pools to six pages after all buffers recycle.

A second regression holds every buffer beyond the 30-second limit. It proves both pools stop at the declared bound, issue exactly one warning per stream, and resume real capture when one telemetry and one replay page are returned. The missing interval remains explicit rather than being backfilled with fabricated poses.

`e2e/replay-state.spec.ts` now contains a real-application regression that deliberately occupies the browser main thread for 8.5 seconds while the dedicated physics worker continues running. After the browser recovers, it requires replay duration and telemetry history to catch up and requires `recordingWarnings` to remain empty. This test specifically exceeds the old six-page reserve and therefore distinguishes the new behavior from the previous implementation.

Local unit, lint and TypeScript checks can run here. This environment still blocks local application navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`, so the new real-browser stall case must be qualified by the normal GitHub browser workflow for the published revision; that restriction is not bypassed or relabelled as a pass.

## What this milestone does not claim

This does not make the 148-section directive complete. A >30-second unavailable consumer can still exhaust the bounded transport reserve and will be reported honestly. IndexedDB quota/device failures can still stop archival storage explicitly. A browser test is not representative-device performance certification.

Most importantly, this milestone does **not** claim that the visual target is reached. The next high-value quality pass after continuity qualification remains the Phase-27 dynamic race presentation pass: stronger original car silhouette/aero surfaces, better driver/cockpit anatomy, denser authored terrain/crowds, dynamic rain/spray readability, atmospheric depth and full-lap lighting/temporal review against the supplied references. The complete human-driven audiovisual Section-146 scenario and the three final audits remain open.
