# W06D — Native flashback diagnostics ownership

## Change

Adds one focused Playwright case in
`e2e/engine-native-flashback-diagnostics.spec.ts` with its browser host in
`e2e/fixtures/engine-native-flashback-diagnostics.ts`.

The spec bundles `src/workers/physics.worker.ts` directly with esbuild and loads that
production graph in a browser DedicatedWorker. The fixture sends the existing
client protocol through native `Worker.postMessage`; it does not wrap the worker
entry, patch worker globals, replace the clock, or instrument simulation methods.

The regression is the same-session flashback reset disabling an already enabled
engineering probe. The intended worker fix preserves the current toggle and
rebases sampling cadence while retaining any outstanding diagnostic ticket. This
test requires that fix; it does not change production code.

## Observed sequence

1. Start one car in practice mode and use native timer-driven frames to reach at
   least tick 180. Wait for the production pause receipt and its preceding frame.
2. Send `engineering: true` exactly once while paused. Retain that diagnostic
   packet and withhold its ACK.
3. Request an actual backwards flashback to tick 60. Require the production
   completion order `flashback → surface → frame` and a pause receipt at tick 60.
   The normal surface consumer reads the transferred arrays before posting the
   matching surface ACK.
4. Resume until at least tick 84, then pause again. Native frames must advance
   while the diagnostic count remains one. All frame, telemetry, replay and
   surface ownership is returned normally, so another channel cannot explain
   stalled diagnostics.
5. ACK the original diagnostic ticket. A fresh sample must arrive while paused,
   without another enable message, before the following FIFO pause receipt and
   at the current rewound tick. That tick must
   still be below the old sample's cadence boundary. The new packet must advance
   both epoch and sequence by one.
6. Send the duplicate old ticket and a forged current-epoch/old-sequence ticket.
   Resume for at least 24 more ticks, then pause. Frames must advance and the
   diagnostic count must remain two. ACKing the current ticket must produce the
   third sample before its next pause receipt, at the paused tick, in the same
   epoch and next sequence.

The old and fresh copied diagnostic packets must remain unchanged after later
native physics. The production sample validator checks all received diagnostics.
The host also verifies attached frame/recording buffers and their actual
detachment when returned in transfer lists.

## Bounds and evidence

Every successful wait resolves from a production message or pause receipt.
There are no elapsed-time acceptance assertions and no fake timer advancement.
A 30-second packet wait, a 90-second fixture deadline, a 120-second Playwright
deadline and a 10,000-message ceiling only fail a stranded or runaway case.

The case attaches `native-flashback-diagnostics.json` with completion ordering,
pause ticks, diagnostic tickets and samples, surface ACKs, advancing frame
summaries, transferable-return counts, warnings and cleanup state. Worker errors
and message-decoding errors reject pending waits. Cleanup always terminates the
worker, removes handlers, clears timers and revokes the blob URL.

Surface-capacity saturation already has separate native acceptance coverage and
is not reprised here. Default-disabled, explicit-disabled, toggles during a
pending rewind and fresh-init behavior are covered by the companion W06B unit
work.

## Validation status

Authored by reading the engine baseline
`b3b8ec09183734287b71406f8894d07c91eb48c9` and the existing native worker
specs. No local build, TypeScript check, unit test or browser test was executed in
this authoring environment.

After integrating the companion production fix, the focused hosted check is:

```sh
npx playwright test e2e/engine-native-flashback-diagnostics.spec.ts --workers=1 --reporter=line
```

This uses the repository's normal Playwright setup and preview prerequisites.
Passing hosted results remain to be recorded by the integrator.

Only the two new e2e files and this document belong to W06D. No worker, protocol,
main application, rendering, asset, model, off-road or simulation-data files are
changed.
