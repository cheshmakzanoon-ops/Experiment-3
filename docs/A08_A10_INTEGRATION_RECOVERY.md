# A08–A10: ordinary-source integration and build stability

## Defect and retained implementation

The `974e1145` validation job failed in `npm ci`, before tests or Blender authoring.
Its preinstall materializer compared a locally staged source payload with six
expected document/manifest hashes from a different export state. The subsequent
Windows-path correction did not address that failure. Retrying that materializer
also made legitimate future edits to shared renderer files look like corruption.

The integrated implementation is recovered from the existing corrected hosted
candidate, not rewritten or regenerated from a different asset pack:

- Original application baseline: `f952d587fa9a3ccfae562611371bb18cea2987a4`.
- Candidate run: `37163800021`; source artifact: `11292312192` (`operations-source`).
- Source archive SHA-256: `4620825165833cec5fa18cc658cd8551fc6f9be41578fa6e2ece133f2e1b1602`.
- Original archive tree: `207f104a3399afac9838ec0234a23bdba2a78d07`.

All 40 receipt-listed files are verified before integration. Retained GLBs and
editable Blender sources stay paired with their matching manifests and authoring
receipt. Host-dependent binary differences are not silently mixed with local
exports. The recovered draw-phase accounting is retained; no render-budget or
physics assertion is relaxed. The baseline's full CI result does not certify
this newer integration.

## Normal development

A checkout contains the actual A08 signal hardware, A09 boards, A10 broadcast
installations, recorded-display implementation, tests, and authored assets.
`npm ci`, `npm test`, `npm run dev`, and `npm run build` no longer decompress
application source, run `git apply`, download Blender, or regenerate these assets.
The obsolete operations transport and materializer are removed.

The existing player-LOD generator is preserved. Normal invocation writes only its
ignored, manifest-verified `public/models/supplied-player-lods.bin.gz` derivative;
changing its source manifest still requires its explicit authoring option.

Run `npm run check:stable` for lint, the complete unit suite, TypeScript, and the
production build while checking that application inputs remain unchanged. The
source-stability guard snapshots the invocation's actual inputs, so deliberate
edits made *before* the command are valid. It rejects additions, deletions, content
changes and executable-mode changes in source, authored assets, tests, scripts,
documentation, workflow files and root configuration. It also propagates command
failures. It neither restores files nor masks a failing command.

CI guards ordinary dependency installation and runs this stable check. Numerical
scenario report generation remains an explicit separate job. Existing browser
shards, wet-presentation tests and publication dependencies remain required.

## Explicit asset authoring

Blender is an authoring dependency, not an installation/build dependency. To
re-export the three families, use the retained rebuild tool and an external
output directory, then review the outputs and matching manifests together:

```sh
python3 scripts/rebuild-trackside-operations.py \
  --blender /absolute/path/to/blender \
  --output-root /absolute/path/outside/the/repository
```

The tool checks pinned Blender 5.2.2 LTS and editable-source round trips. Do not
replace an export merely because another host serialized it differently. Actual
geometry/material/source validation and in-game inspection remain authoritative.

## Release identity and boundaries

The existing branchless publisher now rejects an absent or mismatched
`BUILD_IDENTITY.json` and verifies the bytes, paths and SHA-256 hashes of all three
A08–A10 runtime GLBs, in addition to both supplied-player assets, before contacting
release APIs. Negative tests cover missing models, equal-length corruption and
wrong build identities. It still consumes the exact gated build, checks that main
has not advanced, never overwrites an existing release asset, and never creates a
hosting branch.

A source commit, a passing unit suite and a published playable release are distinct
gates. Only successful full CI on the final commit authorizes its playable release.
Final-art approval, a continuous human lap, representative-hardware performance,
Vellamar propagation and mechanical broadcast-camera tracking remain open. The
A51–A54 vegetation programme is a subsequent content milestone, not part of this
integration recovery.

## Inspection-camera lifecycle correction

The earlier corrected candidate still failed the direct-scene budget in its
A09 rear-board and A10 platform views. The fixed-camera observer moved away from
the cockpit without updating garage/equipment or opponent-car LODs. The observer
now applies the existing production distance/lens rules to the new camera before
posing those cars, preserves the followed car's near representation, and updates
all authored garage/pit-wall equipment. External views restore the driver hidden
by cockpit mode. Frozen snapshots and zero animation delta preserve recorded
state. No objects, shadows, traffic or assertions are removed; the 1,800-call
per-phase inspection limit and normal cockpit budget remain unchanged.

This correction requires actual browser measurement on the new commit. The local
Mesa adapter probe works, but this executor blocks HTTP page navigation with
`ERR_BLOCKED_BY_ADMINISTRATOR`; that attempted browser run is not a pass.

## Local validation record

All ten existing native scenarios passed on the recovered implementation:
validation, dynamics, race control, wet pit service, integrated driving, rotation,
pit integration, classification, Vellamar clear/changeable and reference targets.
The original simulator and physical track modules are unchanged. Focused source
stability and branchless-release tests also passed. The full local check passed
1,740 tests in 196 files, lint, TypeScript and the production build. Exact-commit
browser/release outcomes must be read from their own run, not inherited from
these results or historical candidate artifacts.

## Closed-camera-cycle regression correction

The full hosted run `37190130663` passed installation, stable lint/unit/build,
all numerical scenarios, the independent wet GPU gate and seven browser shards.
The remaining shard passed A08–A10 night but failed the existing view-continuity
observer: GPU geometry count changed from 1,157 to 1,158 after its open warm-up.

The retained A10 geometry reproduces the cause without a GPU: rig 0 is about
67.59 lens-adjusted metres from the first chase view. Initial far-LOD hysteresis
keeps level 2; the long lens selects level 0; returning to the same chase view
selects level 1. That middle representation already exists, but the old three-view
warm-up never submitted it. This is not evidence of continuing allocation growth.
A source-preserving CPU regression includes that omitted-transition negative
control, exercises repeated closed cycles and verifies geometry/index/position
attribute identities are unchanged.

The full-renderer observer now warms the explicit four-cut closed path once,
then requires exact memory equality on every original measured frame and eight
additional repeated-cycle frames, as well as unchanged scene geometry identities.
It does not warm until a test happens to pass, allow a +1 tolerance, disable
hysteresis, hide camera hardware or alter production rendering. All original
camera, wheel, source, error and image assertions remain. The new commit still
requires its own complete CI before release; the preceding failed run is retained
as failure evidence, not retried into an approval.
