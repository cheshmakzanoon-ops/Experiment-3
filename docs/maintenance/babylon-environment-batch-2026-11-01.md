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
