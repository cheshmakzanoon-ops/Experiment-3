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

## Exact-source qualification: `6c1ded7`

[GPU run 41330696576](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41330696576)
passed all **25 cases** and the required aggregate. The retained early-pause case
held physics tick 700 through readiness (ten frames, original banner/gantry/lamps
ready), then resumed to tick 743. Loss/restart correctly cleared readiness and
disabled loading until rebuilt. All isolated banner/lamp checks still passed;
inspected preview and original-car images retain the original road and artwork.
This is functional SwiftShader evidence, not a timing comparison or physical-GPU
benchmark. Retained artifact 13094071397 has SHA-256
`56fa26c4555fe0390ed6eca14467fdcf56c63262f7014ef780b919f0a0ee05aa`.

[Native run 41330696588](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41330696588)
passed on **Linux x64, Windows x64 and Apple Silicon macOS**, including all four
existing-content compatibility journeys on each target. Linux and macOS recorded
27/27 draws, Windows 43/43; all completed 439 preparations with correct banner,
gantry and lamp bindings. Screenshots show the printed banner and original car.
Linux's first presentation receipt is 9/9 and settled with every required asset
ready: the original first-pause gate passed in this run without a deadline change.

The bounded Linux history received 535 observations and evicted 471. Its first-
gate polls are no longer present in final/partial evidence, so exact first-gate
duration and owner transitions cannot be reconstructed. Later false-to-true
polling is retained. Lifecycle completion at 34.059 seconds is not the duration
of that gate. No precise speedup, universal reliability or general driver repair
is claimed from this single successful CI run.

Native evidence artifacts: Linux 13093272166, macOS 13093661436,
Windows 13093008007. All identify production fingerprint
`8e0537ded4d228fb8ae04ec7e712fe694bdaea3765eb84271b6d1c4ce27aaad8`.
Prior timeouts and GPU-loss failures remain historical evidence; physical-device
performance, full Babylon presentation across disciplines and retail readiness
remain separate work. This branch's workflow uploads unsigned development
artifacts; it does not publish a release or modify main.

## Subsequent native repeat: `a68a1ba`

[Run 41332598104](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41332598104)
again failed Linux's unchanged first-pause gate. The new stripe is not imported
by live startup; no causal attribution to it is established. The configured
30-second gate lasted 30,014 ms with 288 received polls. The final pre-error poll
was received 68 ms before failure: 7/6 draws, 133/133 preparations, surface/gantry/
lamps complete and the banner still drawable but incomplete; a GPU submission
was pending for 1.85 seconds. No graphics fault or context loss was recorded.
Later collection approximately 6.5 seconds after failure showed 9/8 draws and all
owners complete, but presentation still unsettled. That is not a pre-timeout pass.

Thus the successful `6c1ded7` run is retained as evidence of one pass, not stable
Linux performance. Startup headroom remains open. Existing deadlines, original
geometry, shader preparation and two-ready-completion requirements are preserved.

The `a68a1ba` native run finished with Windows and macOS passing all four
compatibility journeys, respectively 43/43 and 30/30 draws, both 439 preparations.
Retained live banner/gantry/lamp receipts and screenshots were correct. Linux
remained failed as recorded above. Evidence artifacts: Linux 13094197742,
macOS 13093779825, Windows 13093329557. All reports identify fingerprint
`e9cf8284f8ef62dfd955a08aa64d64be04f3c45500b9d414912e3bd470d967ba`;
it differs from `6c1ded7`, so binary identity is not assumed.
