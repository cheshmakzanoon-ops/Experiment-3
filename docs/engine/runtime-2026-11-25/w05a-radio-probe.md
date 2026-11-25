# W05A — Reproducible radio baseline probe

Assignment 25/60. Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.

## Purpose and source boundary

`scripts/engine-runtime-probes/radio-probe.mjs` compares the actual
`RadioArbiter` source at the pinned Git baseline with the candidate checkout.
The baseline is loaded from `git show BASELINE:src/core/radio.ts`; the probe
does not contain a substitute radio implementation or reference algorithm.

Only `src/core/radio.ts` is replaced in the baseline bundle. Protocol constants,
marshal constants, safety-car constants and all other dependencies come from
the same candidate checkout in both variants. This isolates the radio change;
it is not a comparison of two entire application builds.

Source review used candidate
`04b7a6e2516020fb971d5e42a2e33973033361b4`,
[the compact-state regression suite](../../../tests/engine-radio-compact-state.test.ts)
and [the W02A report](./w02a-radio-state.md). The candidate under execution is
identified by its actual Git HEAD and source hashes, not by the source-review
commit above.

## Shared helper contract

`scripts/engine-runtime-probes/support.mjs` exports:

- `BASELINE`: the full pinned commit above.
- `assert`: the default `node:assert/strict` API.
- `async variants(entry, paths)`: returns `{ baseline, candidate, provenance }`;
  `baseline` and `candidate` are separately imported module namespaces.

`entry` is esbuild stdin source whose imports resolve from the repository root.
`paths` is a nonempty array of normalized repository-relative production
TypeScript paths, for example `['src/core/radio.ts']`. It is not an object
mapping. Every declared replacement must actually be loaded by the entry.

The helper resolves the repository from `new URL('../..', import.meta.url)`.
It reads each baseline file with an argument-based Git subprocess, and uses an
esbuild `onLoad` handler filtered to `.ts` files that matches resolved absolute
paths. The handler supplies the exact Git source only to the baseline build.
The candidate uses the normal loader with unmodified checkout content.

Both bundles use `bundle: true`, `platform: 'node'`, `format: 'esm'`,
`target: 'es2022'` and `write: false`. They are imported through unique data
URLs so equal output text cannot accidentally share a module instance. No
temporary source tree, generated bundle file, checkout edit or ref change is
required.

Provenance includes the baseline ref, candidate HEAD, Node version, esbuild
version, SHA-256 of the entry and both bundles, and each declared file's
baseline/candidate SHA-256 and byte length. Candidate target bytes and HEAD are
checked again after bundling; a concurrent change fails the probe. The report
explicitly labels candidate source as working-tree content and records the
targeted-file scope, so a dirty target cannot masquerade as the committed HEAD.

It also records clean/dirty state and porcelain status for tracked changes under
`src`, `scripts/engine-runtime-probes`, `package.json`, `package-lock.json`
and `tsconfig.json`. The tracked status is checked again after bundling.
Untracked files are explicitly excluded from that status claim. Git subprocesses
use `--no-optional-locks` so the status read does not write an index refresh.
The helper does not claim to hash every transitive dependency.

## Differential event coverage

The probe records the complete messages offered through the public `post`
method, their simulation timestamps, and the complete caption after every
operation. Deep equality covers text, keys, speakers, urgency, expiry, hold,
offer order and displayed-message order. The wrapper delegates every offer to
the original method and does not replace arbitration behavior.

The finite scenario set contains 47 cases:

- All 11 observed caption variants with fresh, reused and actually transferred
  snapshot buffers: three safety-car phases, yellow and double yellow, blue,
  penalty, track limits, pit entry, final lap and fuel.
- Simultaneous offers, equal-priority order, holds and expiry; first snapshots
  and changed car counts; caller overwrite followed by actual buffer detach;
  engineer muting; and single-lap finish guards.
- Default and custom cooldown boundaries after expiry and backward time;
  explicit reset of caption, queue, cooldown and comparison history; urgent
  interruption, expired queued messages, queued-key replacement and the exact
  inclusive expiry boundary.
- A fixed-seed, 512-observation mixed trace in each of the three ownership modes.
  Its inputs include changed car counts, all observed fields, changing race
  lengths, rewinds and explicit resets. The seed is included in the report.

Static expected-key checks ensure the named fixtures exercise their intended
events. They are coverage checks; equality of the complete streams is always
checked against the actual imported baseline. Each successful case reports
operation, observation and offer counts plus a SHA-256 of its equal stream.
The scenario set makes 1,620 observations per variant before copy counting.

## Structural copy counter

A separate synchronous pass feeds an ordinary, reused snapshot to each
variant 600 times at `TIME = i / 60`, with track length 3,000, player fuel 50
and a five-lap race. It repeats at 1, 24 and 32 cars.

Only while those observations execute, the probe wraps
`Float32Array.prototype.slice`, calls its original implementation, and counts
calls and the byte length of returned arrays. A second pair of counters
requires the receiver to be the supplied frame and the result to be the full
frame length. The original own-property descriptor is restored in `finally`;
when `slice` was inherited, the temporary own property is deleted.

The executable assertions require, for each car count:

- The actual baseline performs 600 full-frame slices.
- Its measured returned bytes equal `600 * frame.byteLength`.
- The candidate performs zero observed Float32Array slice calls and copies zero
  bytes through that API.
- Both variants remain silent and receive frames of equal byte length.

These are structural copy counts. They do not measure every allocation,
retained heap, garbage collection, elapsed time or whole-game performance.
There is no FPS claim.

## Reproduction and status

Use the repository's supported Node version, install its locked dependencies,
and ensure the baseline object is available before running:

```sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
npm ci
node scripts/engine-runtime-probes/radio-probe.mjs
```

The CLI emits one JSON report on stdout only after every assertion succeeds.
Missing baseline source, bundle errors and mismatches fail nonzero. The report
is runtime evidence for the exact checkout named in its provenance.

This assignment authored and source-reviewed the helper and probe through
GitHub reads. No local Node probe, timing run or hosted execution was available
during authoring. **Execution results remain pending the coordinator's hosted
CI run.** The counts above describe fixture sizes and required assertions, not
a newly executed measurement. Existing W02A measurements remain historical
evidence in their own report.

## Assigned files

- `scripts/engine-runtime-probes/support.mjs`
- `scripts/engine-runtime-probes/radio-probe.mjs`
- `docs/engine/runtime-2026-11-25/w05a-radio-probe.md`

No production, rendering, environment, model or animation file is changed.
