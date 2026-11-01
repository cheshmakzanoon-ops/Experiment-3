# Batched original environment and independent stripe startup

Work belongs only to `babylon-js`; main remains frozen. This checkpoint changes
startup ownership/presentation scheduling, not original models, materials,
geometry, physics, input semantics or security policy. Its exact-source combined
GPU/native qualification remains pending.

## Startup sequence

1. Prepare and present the original surfaces, retaining their two completed ready
   frames.
2. Prepare gantry, lamps and banner sequentially on the existing exclusive GPU
   lane. No concurrent compiler or skipped material variant is introduced.
3. Install all three and start their independent future-frame subscriptions in
   one synchronous turn before allowing a normal scene draw. Each owner still
   requires two consecutive ready, completed frames and validates its actual
   bindings. The same pair can qualify them because all were installed before
   either submission; no surface receipt is reused or synthesized.
4. Only after the batch completes, prepare/install the original start/finish
   stripe independently. It requires two fresh ready completions after its own
   subscription. Stripe is not part of the shared three-owner batch.
5. Retain the final paused presentation request and strict optional-car guard.

The deterministic combined CPU test observes surface frames 1–2, shared props
3–4, stripe 5–6 and final paused presentation 7. It also verifies the stripe's
compiler sees 4/4 completed frames rather than waiting behind a surplus prop-only
draw. These are controlled CPU/fence receipts, not a guaranteed actual draw count
or measured startup time. Nonready frames and invalidations can require more.

## Ownership and failure behavior

Existing wrappers preserve their automatic default. Explicit `{ staged: true }`
exposes preparation separately from synchronous-start installation. A resolved
`prepared` promise is not readiness and publishes no completed resource receipt.
A batch draw gate stays closed through all preparation yields and installations.
Lamps receive the latest authoritative snapshot before installation and on normal
frames; no new light timer or simulation write exists.

Preparation, upload, material variants, fences and original receipt validation
remain intact. Cancellation closes drawing, invalidates the batch and drains
coordinator-owned compilation before disposing staged siblings. Partial install
failure rolls back all owners and settles their installation promises. Primary
errors, including falsy values, survive cleanup and diagnostic-logging failures.
Restart, old-scene receipts, context loss and one ready completion cannot qualify
an abandoned or incomplete owner.

The drain guarantee is for coordinator-owned cancellation. Terminal main teardown
still invalidates the GPU and disposes scene/engine as before; this is not a new
asynchronous terminal-shutdown guarantee. The original absolute 120-second
startup deadline and first paused 30-second native gate remain unchanged.

Actual gantry/lamp/banner receipts and the stripe's 1/1/1 resources, two triangles,
128×32 texture and hardware-sRGB allocation are required. Both detached readiness
whitelists include the stripe. Native observations keep CSP-safe function
callbacks and existing polling/error semantics. Restart/loss clears stale fields;
asset inspection stays disabled until the complete environment is ready.

## Verification and limits

The batch-only candidate passed 1,259 tests/96 files; the separate sequential
stripe candidate passed 1,258/96. The combined source passed **1,285 tests across
97 files**, including a meaningful fresh-receipt handoff case, plus 146 focused
checks. Independent review confirmed the resolved main/observation contexts and
unchanged protected source/adapter/fixture boundaries. CPU tests use controlled
owners and synthetic GPU fence completions; they do not certify real rendering.

The isolated stripe passed its corrected GPU gate on `e5609e7`; see
[the exact qualification and original occlusion](babylon-start-finish-stripe-2026-11-01.md).
That does not qualify this new live scheduling path. Exact combined GPU/native
runs, unchanged deadlines and visual review are required before acceptance.
Native Linux startup was inconsistent on earlier sources; neither batched frame
counts nor a single successful run establish a universal repair or physical-GPU
performance. Holding prepared resources together delays intermediate prop display
and retains staged resources together; these are explicit tradeoffs.

Final combined local validation also passed full TypeScript, the project's full
lint command and Vite production build, retaining the normal chunk-size warning.
All 28 required workflow cases were discovered offline; none was run locally.
The new preparation tests are included by the existing `tests/babylon-*.test.ts`
selectors and path filters on both GPU/native workflows. No workflow gate, case
selection or timeout was changed for this combined implementation.

## Combined runtime result: `f0ca199`

[GPU run 41338152814](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41338152814)
passed all **28 cases**, all four shards and aggregate 124946777005, without
flaky/skipped results. Early pause held tick 696 through readiness (frames 3→8)
and resumed to 699. The live stripe, banner, gantry and dark lamps had their
required resource receipts; loss/restart invalidated readiness correctly. Live
screenshots show the original checker, printed banner and Formula car. All 280
isolated lamp/banner/stripe PNGs match the preceding qualified run byte-for-byte.
This is SwiftShader functional evidence, not physical-GPU timing or final PBR.

SHA-verified artifacts:
- Retained 13097230390: `fce8c599a4adf26540820341ec3f0df144046bf25decd7d19a17d57c3b328503`.
- Stripe 13096845303: `82c7fabe75a1ba559383bc33bed1b1b40eb98e7ad85695b713c9833b2cce8223`.
- Banner 13096600888: `ecf2a6c0b0135f2d7a8ad863f94b4e03bf08d0886155a5990b66530fe88b4436`.
- Lamps 13096406562: `03f719e47cd5b7db4b91d54850e99e1c62e4de549601f1d1182c47570360c13a`.

[Native run 41338152768](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41338152768)
passed Windows and Apple Silicon macOS, including all four compatibility journeys.
Windows recorded 37/37 draws, macOS 24/24; both completed 443 preparations. Stripe
receipts are 1/1/1 resources, two triangles, 128×32 and hardware-sRGB; earlier
assets remain intact. Inspected screenshots show stripe, banner and original car.

Linux still failed the **unchanged 30-second first-pause gate** after 288 polls.
The last sample, 19 ms before failure, had all owners complete and sceneReady=true,
135 preparations, but 7 submissions/6 completions; the pending GPU frame was
970.8 ms old. No graphics fault or context loss was recorded. Final collection
3.371 seconds later reached 7/7; that is not a pre-deadline pass. The intermediate
samples bracket completion6 between renderer32,338.6–32,446.2ms, followed by pending
frame7. This identifies the boundary, not a universal timing improvement.

Native evidence: Linux 13097065312, macOS 13097105640, Windows 13097100690.
All identify fingerprint
`a4a13b6309c7a516d9a0591d2dfe1a4e1181e2172e1eb235af7c376e8d4a4401`.
The final paused redraw is being investigated separately; no fence, deadline or
owner completion requirement is weakened to count this failed run as success.
