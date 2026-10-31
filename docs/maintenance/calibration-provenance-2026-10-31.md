# Vehicle calibration source provenance

## Why definition hashes are insufficient

The existing `vehicleHash()` identifies an authored vehicle definition, not the solver or measurement harness. During the 2026-10-31 audit, all 57 definition hashes still matched the historical checked-in report while 202 of 228 measured metric pairs differed. The freshly measured XT1 margin and XF2 fan-fit discrepancies are retained separately; neither is repaired by adding provenance. Historical reports without provenance remain readable and are not relabelled as current measurements.

## Newly generated reports

`scripts/vehicle-calibration.ts` adds root `schemaVersion: 1` and a `provenance` object to each newly generated complete report. The existing fixture, timesteps, vehicles, definitions, measurements and independently authored bands remain unchanged.

The provenance records:

- Real source root resolved from the executing harness URL, independently of the output working directory.
- Git metadata before and after measurement: a verified repository-root match, full commit and dirty flag. Source archives, an archive nested under a different repository, unavailable Git, unborn repositories or failed metadata reads yield `null`, not a guessed parent commit or an invented clean state. A dirty HEAD is context, not proof of exact committed source.
- SHA-256 fingerprints before and after measurement, explicit scope, file count and serialization algorithm. Sorted root-relative paths and each file's SHA-256 are serialized as a JSON array before the aggregate hash. Absolute checkout paths, directory enumeration order and generated output locations do not affect the fingerprint.
- Exact Node and V8 versions, platform, architecture and `SIMULATION_VERSION`.
- Strict-mode flag, requested selection (`null` means the complete registry) and actual measured vehicle IDs.

No credentials, complete environment dump or arbitrary command-line arguments are collected. Only the declared runtime and calibration selection fields are recorded.

## Scope and invalidation

The explicit scope is deliberately broader than the physics files: **all `src/**`**, the vehicle/bike calibration scripts, analytic dynamics fixture, calibration-margin helper, provenance helper, package manifest/lockfile and TypeScript config. This covers runtime dependencies in other source directories and identifies the harness itself. Scoped symlinks are rejected rather than following unknown external bytes or claiming that a link name identifies imported content. Required missing inputs fail closed.

Generated calibration JSON, the generated content-pipeline disclosure, unrelated documentation, build output and dependency-install directories are excluded. This prevents a report from being an input to its own fingerprint. The lockfile identifies intended dependencies; this receipt is not an attestation of every byte in an installed `node_modules` tree.

After all measurements, the script recomputes the fingerprint **before writing either generated output**. If the boundaries differ, it fails and leaves any existing report/disclosure untouched. Equality establishes matching observed source boundaries, not a filesystem lock or proof against a transient edit-and-restore. The existing whole-tree `source-stability.ts` CI guard remains independent and unchanged. Git before/after metadata may differ because of a commit or unrelated evidence file while the explicitly scoped source fingerprint stays identical; both observations are retained rather than conflated.

## Full-registry and selection commands

The full command still generates `docs/vehicle-calibration.json` and the near-edge block under its output working directory. CI can run the source script by absolute path from its temporary evidence directory without changing which repository is identified.

`--only=id,id` retains its **no-write** authoring contract. Both complete and selected runs print one `Calibration provenance: {...}` console receipt after the stability check. A selected run's receipt names its requested and actual IDs; it is not a complete-registry certificate. A one-vehicle smoke check can therefore verify the real harness from an empty temporary output directory without overwriting historical fixtures or inventing a partial committed report.

`--strict` still enforces the existing fine/coarse target bands only. Provenance does not silently add, remove or weaken thresholds, and a strict pass is not a pass of the separate growth-margin or fitted-envelope contracts. Running those unchanged contracts on fresh complete artifacts remains separate work.

## Verification boundary

Focused tests cover deterministic path-independent hashing, source/harness/config edits with unchanged definition bytes, file additions/deletions, missing inputs and symlinks, generated-output exclusion, source archives, nested parent-repository mismatch, unavailable Git, clean/dirty metadata, runtime and selection fields, output-cwd independence, and failure before report replacement. Existing unversioned fixtures remain readable.

This increment does not change physical behavior, authoring coefficients, fixtures, quality margins or acceptance bands. A complete new 57-vehicle run is not required to prove the metadata helper's unit behavior, and is not claimed by a selected smoke run. Final execution receipts identify which checks actually ran.

Final selected smoke: official Node v22.23.4 ran `--only=apx01 --strict` from an empty temporary output directory on physics v20, exit 0. All four strict metric bands passed at both timesteps. The 844-input before/after fingerprint was `412f1a84c9c126b7745e887353eec3bb6de887b9691627068fe43e8012b924f4`; Git correctly identified dirty `652a00f` candidate source. The output directory remained empty and historical reports retained their hashes. This does not clear the known HF-86 failure or qualify the full registry.
