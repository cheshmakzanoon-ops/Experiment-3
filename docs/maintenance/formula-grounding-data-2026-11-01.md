# Formula grounding: original data/pose boundary

## Scope

This is a renderer-neutral extraction, not Babylon grounding activation or new
visual acceptance. The original Three material hooks, GP tyre projection,
normalization, matrix/motion history, light intensities, road/paint factors and
single authoritative simulation remain unchanged. No Babylon plugin, fixture
wiring, workflow, capture or quality/deadline/security policy is added.

The seven changed code/fixture paths are:

- `src/engine/assets/formula-grounding.ts` (new);
- `src/rendering/studio/car-grounding.ts` (compatibility imports/re-exports);
- `src/rendering/studio/studio-frame.ts` (Formula pose/count delegation);
- `tests/formula-grounding-data.test.ts`;
- `tests/formula-grounding-compatibility.test.ts`;
- `tests/fixtures/formula-grounding-oracle.ts`;
- `tests/fixtures/formula-grounding-source-2041020.json.gz`.

The source oracle base is `2041020089bf2d2164e1f7c7df3e6a3620d71088`.
Capture and extraction occurred on the later docs-only
`42a6bca9d3122dfe3861f624abe642905169b1bf`; it is not relabelled as the oracle base.

## Preserved semantics

- The shared maximum remains 12; count is the original floor/clamp with `value
|| 0`, including NaN-to-zero and Infinity-to-12. Slot clearing and deferred
  `reset()` behavior stay in the original `StudioFrame` owner.
- The new pose writer accepts the already-normalized original quaternion and
  caller-owned output. It does not normalize twice or introduce state/allocations.
  The original Three quaternion normalization, including the zero-quaternion
  identity result, still precedes matrix/history and pose generation.
- Heading uses the original Three r180 scalar rotation order. The mean ground
  height uses the same fixed `FORMULA_APX01.wheelPositions` object as the original
  `WHEEL_POSITIONS`, four contacts in the same order, `length || 0.25`,
  `radius || 0.335`, `mountY - length - radius`, per-contact world-height addition,
  then division by four. This is a yaw-oriented footprint at mean contact height,
  not a fitted banked plane or the newer rigid-wheel hub projection.
- Malformed/negative/nonfinite legacy pose/contact values are not newly
  rejected or sanitized. Any stricter future adapter policy must be separate.
- Original Formula constants and `carGroundingAt` retain compatibility identity;
  the CAR constants/footprint remain **shallow-frozen**, not newly deep immutable.
  The existing fixed mount object remains deeply frozen as before.
- The original formatted GLSL, maximum-overlap and 4 m reach gate, 0.18–0.45 m
  height gate, and distinct indirect/direct diffuse and specular attenuation
  remain in the original hook. No final-color/albedo multiplier is introduced.
  CPU raw constants and the existing three-decimal shader formatting are each
  preserved rather than silently increasing shader precision.
- The scalar Three adaptation carries the installed r180 MIT notice.

## Independent pre-edit oracle

The oracle was captured before any production edit, using the actual original
`StudioFrame`, `surfaceMaterial('asphalt', undefined, false)`, water-film factory,
original paint factory/finish and installed grounding hook. A CPU-only canvas
records real ImageData uploads; it does not replace the factory/hook or claim GPU
execution. Vite SSR uses the same minimal no-watcher/no-listener approach as the
previous independent asphalt capture to resolve original `?raw` shader imports.

It contains 21 scenarios / 40 complete uniform-and-history observations,
885 local-footprint CPU samples, exact constants/formatted GLSL and three actual
composed factory shader snapshots. Coverage includes held frames, advance,
reset, shrink/zero/capped counts, camera cuts, bank/pitch/unequal contacts,
zero/nonunit/NaN quaternion, zero/negative/nonfinite contacts, malformed time,
truncated input, identical overlapping poses and the untouched mixed GP path.

Authoritative compressed fixture: 33,843 bytes, SHA-256
`6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe`.
Uncompressed JSON: 782,169 bytes, SHA-256
`d51aae7375d26497f573f202aab4a80bc5fccef67df099ab26e2c9813a3087a7`.
Capture script SHA-256:
`25192b0e1924097fa577513b0a410a3c3dc638ea0668e6d33eef9073cc476691`.

Two initial Vite captures are byte-identical; a third repeat additionally guarded
the actual executing Three `build/three.module.js`, `build/three.core.js` and
package metadata. Original data also match a separately retained Node/raw-text
observation. Twenty-one source hashes/copies and the three executing-build hashes
are retained under `pre-edit/`. Each capture guarded application inputs before
and after; the first two Vite captures left all 5,521 inputs unchanged. The third
included the newly written compatibility tests, but still preceded extraction.
The frozen fixture has not been regenerated from the extracted helper.

## Verification so far

- Actual pre-extraction compatibility suite: **25/25**.
- Post-extraction original StudioFrame/GP/grounding/hooks plus compatibility:
  **85/85**.
- Neutral data suite: **37/37**, including exact bytes and renderer-neutral
  transitive runtime dependency checks.
- Formatted final focused suite: **152/152 across eight files**, including the
  existing independent asphalt data and dry/wet/scanned factory compatibility.
- Focused lint and `git diff --check` passed.
- Source-preservation receipt proves 16 extracted/retained declaration token
  identities, unchanged original normalization/matrix/history tokens, 19
  unaffected original hashes and all three executing Three build hashes.

Retained failed attempts: the first Node capture could not load `.frag?raw` and
produced no oracle; the first two neutral test-driver attempts differed from
legacy malformed-input semantics because a Quaternion constructor defaulted
missing values and a plain position object missed Vector3.set's retained z.
Only the test driver was corrected to match the actual original owner; runtime
parity assertions and the frozen oracle were not weakened.

The initial source-only review preceded the aggregate guard; terminal outcomes
are recorded below. No GPU, native, photometric, full-mode migration or Linux
reliability acceptance follows from this CPU/data extraction. The existing
Linux GPU-loss limitation remains open.

## Early aggregate failure and bounded test correction

The first all-input guard stopped at the full TypeScript check with two
compatibility-fixture TS2345 errors, before lint/selectors/build ran. All 5,526
inputs remained unchanged. `failed-types-01/` preserves the log, terminal receipt,
complete input manifest, seven-file owned manifest and failing test source.

The correction is confined to two test lines: the texture hash uses the existing
`arrayBytes(view)` conversion, retaining buffer, byteOffset and byteLength; the
explicit CPU shader fixture uses the same confined Three parameter cast as the
existing original factory compatibility test. No runtime, oracle, shader,
comparison bound or assertion changed. The corrected two-file suite passes
62/62. The unchanged serial aggregate sequence restarted with full types.

## Final guarded result

The renewed guard ran from **2026-11-01 04:08:45.414 UTC to 04:15:52.033 UTC**
on base `42a6bca9d3122dfe3861f624abe642905169b1bf` and passed, with **all 5,526
application inputs unchanged**. Its all-input manifest SHA-256 is
`cf38a1b7d2e003705883031beaeeb66de8e0d439505c619cdd46c77173e849af`;
the seven-file owned manifest SHA-256 is
`8ecff7e496b057dd53d98ef90c11cad6531e056dfa409a35d8c0045b212a1b26`.

- Full TypeScript first, full repository lint and owned-file formatting: pass.
- Unchanged Babylon contract selector: **293/293 across 32 files**.
- Neutral/original frame, grounding, factory, shader-hook and look selector:
  **160/160 across nine files**. The selectors overlap on 30 existing asphalt
  cases; their counts must not be described as 453 unique tests.
- Source-preservation token/hash checks: pass.
- Unchanged `npm run build`, including its original derivative preparation,
  TypeScript and Vite options: pass. Vite's chunk-size warning remains visible;
  no threshold or build-quality option was altered.
- Both existing isolated fixture IIFEs bundle successfully; no fixture was run.
- Content validation: pass.
- Existing journey discovery: **12 tests in five files**; no browser launched.
- Whitespace check and end-of-guard source comparison: pass.

The independent source review (`independent-grounding-extraction-review.*`),
two-line fixture typing addendum (`independent-grounding-type-addendum.json`)
and application-count clarification (`independent-grounding-count-clarification.json`)
are retained separately. The reviewer made no edits and did not rerun tests.
The extra three inputs in the third pre-edit capture were the compatibility
file/helper/gzip; the executing Three build files were guarded separately.

All seven owned hashes remain unchanged at handoff. Documentation
and the separate unaccepted physics archive began changing only after this
aggregate guard ended; those later additions are not misrepresented as inputs
executed by this guard and are excluded from this owned manifest.

Exact published-source CI/native outcomes remain a separate qualification
boundary. Babylon grounding implementation, isolated real-GPU factors and
lighting-term acceptance, and any later eligible live wiring require separate
authorization and evidence. This increment alone intentionally has no new
player-visible effect.

## Changed code and fixture hashes

SHA-256 of the reviewed seven-file increment, excluding later documentation:

- `src/engine/assets/formula-grounding.ts`: `fc943986f9ee11c2aa2613d91882c34486b83157202dc46210a8386f1e2a8c16`.
- `src/rendering/studio/car-grounding.ts`: `327771f615127caded76c61f7b0278d673c8522c3a4e42d5cadf1b63f4faa096`.
- `src/rendering/studio/studio-frame.ts`: `757c60b0d4f9581b8e55a72eab1e269fca6b68a6680a9920f77acd44fa3e9efa`.
- `tests/formula-grounding-data.test.ts`: `4be4fa1555a1a3d61d1166ac28dc6eb9bbadb9dc1c74be6cf6c82c551e8d9ba1`.
- `tests/formula-grounding-compatibility.test.ts`: `4e54cee4e63031d11503401c71ba1958d1eb26c75c09baba1df4f72f25be4aa7`.
- `tests/fixtures/formula-grounding-oracle.ts`: `dcaa58caa37ec103dfeed507553424185bd99e3f1220cd498e7bf4392e45636e`.
- `tests/fixtures/formula-grounding-source-2041020.json.gz`: `6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe`.

## Published-source regression qualification

Exact source `0076e3cc08ff3d133558315d4e8271bb450b2a9e` passed
[all 12 real-WebGL journeys and 293 contracts](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41272683640),
with no retries, skips or flaky cases. Full Aurel/Vellamar retained their
115/151 prepared variants, 38/50 asphalt chunks, zero paint contamination and
zero resources after disposal. Context restoration still requires explicit
rebuild. All 170 inspected GL/shader/failure/loss fields were clear.

Artifact **13070685750**, 7,926,049 bytes, SHA-256
`eaf2039b25564471e27fcb2900ba81cf54f66bde4ab298b9ad8a1ccb9dba3bf0`.
Of 87 image attachments / 56 unique images, 85 attachments / 54 unique images
are byte-identical to the previously individually inspected f2cf877 set.
The two changed actual-route images were freshly viewed, alongside three
unchanged full/banked views. This is inherited exact-image review plus changed
image inspection, not a claim of reopening every image. Original factor
repeats, negative controls and candidate pixel comparisons remained unchanged.

[Required native run 41272683767](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41272683767)
passed Windows and Apple Silicon (855 contracts and all four journeys each).
Mesa completed 403 preparation leases, model and wheel acceptance, then failed
Formula readiness with a 45.0045-second GPU-preparation fence error and final
GPU512/context loss. CPU draw returned in 126.2 ms; queue 5/4 is not GPU
completion. Publication job 124754910748 was skipped. A later failure phase
than f2cf877 is neither repair nor cause isolation.

The same-source [driver run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41272683625)
passed SwiftShader's four journeys. Compatibility Mesa completed Formula/GP/MX
but Festival capture timed out before return, with final GPU loss. V2 retained
valid numeric evidence while gameplay failed; the final fault was observed
after its trace window and is not explained by that capture. Raw deletion was
scheduled, not independently verified; no raw trace was retrieved. Ubuntu24
remained blocked before connection on its unchanged sandbox-helper requirement.
Seven compact archives/member hashes and 23 native PNGs were reviewed.

These are source-qualified regression observations, not physical-hardware,
retail, complete four-mode Babylon or new grounding-lighting acceptance.
