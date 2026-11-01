# Paused preparation handoff · bounded optimization candidate

This change belongs only to `babylon-js`. Main remains frozen. It does not alter
models, simulation, materials, shader preparation, GPU fences or security policy.

## Retained Linux evidence

On `e10eefe`, native run
[41327862050](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41327862050)
failed the unchanged first paused-presentation gate after 30 seconds. The bounded
readiness history gives the following observations, not a complete GPU trace:

- At renderer time 27.271 seconds, the surface owner was complete while frame 3
  remained pending. Gantry preparation 116, begun at 23.372 seconds, was explicitly
  waiting for that earlier frame.
- At 31.330 seconds, frame 3 completed and gantry decode/upload began compiling.
  The gantry's four material preparations finished by 31.573 seconds.
- The final pre-timeout sample at 33.537 seconds showed frame 4 pending and the
  gantry waiting for its presentation receipts; lamps were not constructed yet.
- A separate collection 24.4 seconds after failure showed more progress, not a
  successful original gate. No GPU/context/CSP fault explained this run's timeout.

The Linux preparation event file contains no events; no full preparation timeline
is inferred from that absence. Windows and macOS passed the same source's installed
journeys. This is not proof of physical-hardware performance or driver causation.

## Mechanism and change

`gpu.ready()` publishes a completed frame synchronously. The surface owner's
promise continuation releases its preparation token and constructs the next owner
only in subsequent microtasks. Before those microtasks, the same paused render
callback could submit a third surface-only frame, although two ready completions
had already qualified that owner. The gantry then had to wait for this extra
submission. The source ordering and retained frame-3 wait support this mechanism.
The evidence does **not** establish that the later frame 6 was also redundant.

`pollPresentationForRender` polls readiness once. When paused with a preparation
token held, it compares existing completion counters before and after that poll.
A newly published completion defers only that callback's normal scene submission.
It does not consume a render request or preparation token. Owner continuations
can then release ownership or claim the next compilation lease before the next
animation frame. Restart and resize handling retain their ordering.

This deliberately yields after the first as well as the terminal paused-owner
completion. The next callback is not deferred without another new completion,
so required subsequent ready frames still execute. Active driving and callbacks
without a preparation token retain their old submission behavior. No driver
query, timer, new deadline or mutable game-state injection is introduced.

## Verification and limits

A red-before deterministic test uses actual preparation-owner promises, the
presentation schedule and the GPU ownership/fence facade. The old behavior
submitted three frames while only two had completed; the candidate keeps two
surface submissions and allows the next compiler lease before another draw.
The next owner still needs its own two genuinely completed ready frames.
Focused owner/GPU/schedule/restart checks passed 85 tests, with additional checks
for demand preservation, active/no-token paths, cancellation and failure.

Those CPU checks do not establish native timing. The original 30-second early-
pause gate, two ready completions, every preparation/fence and the application
startup deadline are unchanged. Native and real-GPU qualification of this exact
candidate remain required. Eliminating an observed extra frame may not save
enough time for Linux; the release blocker must remain until the unchanged gate
actually passes.

The complete active native/GPU contract selection subsequently passed **1,212
tests across 94 files**, followed by full TypeScript, focused lint and a serial
Vite production build. Both independent reviews found no blocker. The existing
large-chunk warning remains. The deterministic fences in CPU tests are mocked;
no native latency improvement follows merely from those results.
