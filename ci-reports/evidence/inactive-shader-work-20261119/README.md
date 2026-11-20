# Scoped validation evidence

This compact package preserves the original numerical results for the shader candidate and a separate local CI source-transport fixture. It does not claim validation of a later combined source, the wet-path change, or the current working tree.

## Source identity

- Hosted shader candidate: `669a44de6d542abb5010bcc880b08c0b00efe444`.
- Baseline: `54a09a088acc008b23bb2a576ad998da164e3128`.
- Corresponding local shader commit: `d86a787bcf077db3c2b75c6affe1cb72aa59a311`.
- Shared candidate tree: `972a24eed437d1f0b4a46a447ae64097b81bd18c`.
- [Hosted run 44642706691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44642706691).

`validation-receipt.json` records this source identity, original unchanged browser-input Git objects, 179 passing local tests in 11 files, and the corresponding guarded build result. Those results belong to this shader candidate, not subsequent integrations.

## Component proof

Both observed software graphics backends passed all four selected component cases: SwiftShader job **135978222122** and Mesa llvmpipe job **135978222275**.

- All **40 weather candidate/control rows** were byte-identical in RGBA8 output: four material roles through five states on each backend. Held/restored frames and resource counts also matched.
- Disabling local fog preserved exact pixels against the zero-density control and removed four native local-fog uniforms. Repeated toggles reused the same two programs; active fog, aerial perspective, cloud shadows and grounding still changed real channels.
- Original quadrature comparisons were exact in all three views. Original rain reference, held, restored and rewind comparisons were exact, with unchanged resources and source. Negative controls remained effective, and all component reports had zero GL errors.

See `pixel-comparison/summary.json`, both backend numerical summaries, and the eight canonical component reports. Artifact identities, byte counts and verified GitHub SHA-256 digests are retained in the summaries. Their original acquisition paths identify provenance; archives, image attachments and full logs are intentionally outside this compact package. This component evidence does not establish application readiness, race performance or physical-GPU behavior.

## Application startup comparison

The separate `startup-comparison/summary.json` preserves the original application cases and their outcomes on the observed Mesa llvmpipe backend:

| Source | Journey | Job | Result |
| --- | --- | --- | --- |
| Baseline | Low | 135978222245 | 4/4 passed |
| Candidate | Low | 135978222317 | 4/4 passed |
| Baseline | High | 135978222142 | Readiness assertion failed |
| Candidate | High | 135978222325 | Same readiness assertion failed |

Both High cases remained `loading` when the original 90-second assertion required `paused`. The candidate therefore **does not resolve High startup**. The Low suite's reported durations were 2.7 minutes for baseline and 2.2 minutes for candidate in one pair of runs. These are whole-test durations, not a repeated or isolated preparation benchmark. None of these jobs hit its overall setup/job cap.

## Separate CI HTTPS fixture

`ci-ubuntu-https-validation.json` records a local transformation audit of helper SHA-256 `7fa2c610282641ffe507dd08213c00c53cf7e6cbf55b4536901ca4d326315c53`. Its fixtures cover legacy and deb822 sources, the runner's mirror list and metadata, HTTPS/security handling, preservation checks and idempotence. System APT was not modified by that audit. The helper was not part of hosted shader run 44642706691; this receipt does not claim a hosted installation or timing result for it.

## Integrity and use

The 14 supplied JSON files were copied byte-for-byte. `manifest.json` records each payload file's size and SHA-256, its original relative location, source/run/job scope, and the README hash. The manifest excludes its own recursive hash. This package contains no ZIP, PNG or full-log payloads, and assembly performed no repository mutation or publication. Later combined-source regression results should be recorded separately with their own source identity.
