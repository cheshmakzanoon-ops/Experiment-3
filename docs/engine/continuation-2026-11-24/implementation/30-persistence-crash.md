# Agent 30 — native save mirror process-crash validation

## Result

**33 integration cases passed**, including **27 actual writer-process SIGKILLs** over real temporary files. No production defect was reproduced, so this agent made no production changes. The new regression suite tests the persistence guarantees added by agent 12 across process boundaries instead of simulating a crash by clearing an in-process timer.

The completion certificate prevents a profile revision from incorrectly certifying a different ghost snapshot. Complete local data repairs every tested interrupted pair. When local storage is absent, recovery deliberately salvages the currently readable profile and ghost values even if they came from different generations, then certifies that recovered snapshot. It does not promise an atomic multi-file transaction or automatically select an older coherent backup pair.

## Added files

- `tests/desktop-mirror-crash-recovery.test.ts`: subprocess orchestration, exact recovery assertions, and renderer reconciliation over the real restarted native service.
- `tests/fixtures/desktop-mirror-process.cjs`: a disposable-directory-only Node fixture that loads the production save service and codec. Its filesystem adapter performs real operations, then terminates its own process at the selected boundary.

The fixture never locates or reads a player's actual save directory. Every case starts with its own `mkdtemp` directory and removes it after completion. The parent invokes Node directly without a shell. Debounce callbacks are not allowed to manufacture a graceful shutdown: the crash writer exits with `signal === 'SIGKILL'` and `status === null`.

## Crash matrix and findings

The core matrix covers two write orders, two target files, and six interruption points: **24 cases**. Both `saves -> ghosts` and `ghosts -> saves` are tested with interruption in either file.

| Interruption point | Actual operation before termination | Expected restart behavior |
| --- | --- | --- |
| `opened` | The target `.tmp` file was opened/truncated | Existing primary remains authoritative |
| `partial-write` | Half of the real serialized payload was written to `.tmp` | Incomplete temporary JSON cannot replace a valid primary |
| `written` | The complete payload was written to `.tmp` | Existing primary remains authoritative before rename |
| `synced` | The temporary file was fsynced | Existing primary remains authoritative before rename |
| `backup` | The prior primary was copied to `.bak` | Prior primary still wins until the new rename |
| `renamed` | The target temporary file was renamed over its primary | That file's new generation is visible on restart |

For every process death, the fixture writes a crash-point witness before delivering SIGKILL. The test checks that witness, termination signal, exact restarted profile and ghost values, `complete`, and revision. A fresh native-service process probes whether an incremental batch accepts the restarted state as a complete predecessor. Incomplete pairs always reject that probe. A new renderer `DesktopMirror` then reconciles against the complete local revision, and a further fresh native process verifies the repaired files.

Across the 24-case matrix, the expected installed-generation combinations are:

| Disk generations after restart | Cases | Certificate | Reconciliation with complete local revision 2 |
| --- | ---: | --- | --- |
| Old profile / old ghosts | 10 | Complete revision 1 | Seed latest data as revision 3 |
| New profile / old ghosts | 6 | Incomplete revision 2 | Seed latest data as revision 3 |
| Old profile / new ghosts | 6 | Incomplete revision 2 | Seed latest data as revision 3 |
| New profile / new ghosts | 2 | Complete revision 2 | Already in sync |

Additional process-crash cases cover:

1. Native memory accepted revision 2, but the process died before either file was written. Restart correctly exposes complete revision 1, and the complete local revision 2 restores the latest data as revision 3.
2. Only the profile rename survived and local storage was empty. Recovery salvages the latest profile and previous ghost value, explicitly recording the existing mixed-generation policy.
3. Only the ghost rename survived and local storage was empty. Recovery salvages the previous profile and latest ghost value under the same policy.

The remaining six cases exercise restart boundaries:

- A valid, recomputed ghost envelope with **the same revision but different ghost contents**. Both primaries parse successfully, but the profile's ghost-content checksum makes the pair incomplete. Complete local data restores it.
- Three malformed completion certificates: checksum mismatch, a negative ghost revision with a recomputed metadata checksum, and an array where a certificate object should be. Each bad profile primary is quarantined, its backup is readable, and the resulting old-profile/new-ghost pair remains incomplete until repaired.
- Two legacy version-1 pairs lacking completion fields, with equal revisions but either matching or different values. Reconciliation verifies values and upgrades to a complete revision 3; equal counters cannot conceal stale content.

Typed ghost samples are compared exactly, including preservation of signed zero in the `Float32Array` round trip.

## Verification

All resource-intensive commands used the shared test lock with a 512 MiB parent heap. Spawned fixture processes use `--max-old-space-size=128`.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock \
  node_modules/.bin/vitest run tests/desktop-mirror-crash-recovery.test.ts --maxWorkers=1
```

Result: **1 file, 33 tests passed**; test execution 12.71 seconds, total 13.01 seconds. Subsequent edits only added explicit TypeScript envelope types and applied formatting; the scoped compiler and linter validated the resulting files.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock \
  node_modules/.bin/eslint tests/desktop-mirror-crash-recovery.test.ts

NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock \
  node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module ESNext --moduleResolution Bundler --allowImportingTsExtensions \
  --types node tests/desktop-mirror-crash-recovery.test.ts

node --check tests/fixtures/desktop-mirror-process.cjs
```

All three checks exited 0. Prettier formatted the test and accepted the subprocess fixture. No npm lifecycle hooks, asset generation, or production saves were invoked. Full-project compilation and combined release gates remain root's integration responsibility.

## Provenance

Observed checkout HEAD after checks: `360d3de1d910b77e9bdca933f47df8d5bc99a69a`. Other agents worked concurrently in disjoint files, so the exact source fingerprints below identify the persistence implementation tested:

| File | SHA-256 |
| --- | --- |
| `src/storage/desktop-mirror.ts` | `97230dd593bcbe5f8ee588bf4cfe4afbbb1fb9ff343ebcf1e67f29db11633127` |
| `src/desktop/bridge.ts` | `20b06ddc31e93515a888854175e696c5619eb3451c312ca6c7fdd46181a3286f` |
| `desktop/src/save-mirror.cjs` | `5c2b5be77d535407f51bc613ea98a134d1a8f3cae47fd634b7eff3cc0d553ad7` |
| `desktop/src/codec.cjs` | `2c6f3cf7d298669175e84984e349bb9a422e134b3d66df0b35aa0079fde2ba66` |
| `tests/desktop-mirror-crash-recovery.test.ts` | `4ed16729467957faece7af12f62860cda4d1862ae9255e0253c7eeca4ee8402d` |
| `tests/fixtures/desktop-mirror-process.cjs` | `e577680002c73dbdf8dd135d99adb7caee7b9dd858c91498cf2986cab633301d` |

## Limits and scope

- These are real Node process crashes on the current Linux filesystem. They do not emulate a host power outage, storage-controller cache loss, Windows file-sharing behavior, or Steam Cloud conflict resolution. A successful `fsync`/rename process-crash test does not establish whole-directory durability under power loss.
- The renderer uses the production reconciliation implementation and real restarted native service through a test bridge. The local key/value adapter models committed IndexedDB snapshots; this suite does not launch Electron or real IndexedDB. Agent 12's transaction tests cover the IndexedDB transaction behavior separately.
- The half-write injection stops a real write partway through the serialized temporary payload. It tests an interrupted temporary file, not ordinary partial-write handling after a successful syscall return.
- No atomic cross-file durability claim is made. Without local storage, mixed-generation salvage is the existing explicit policy.
- No model, character, environment, track geometry, vehicle tuning, sound profile, asset, dependency, or production code was changed by this agent. No staging, commit, or push was performed.

File ownership released after validation.

## Coordinator integration correction

The broad validate job at `54506ca` caught four `no-require-imports` errors in the CommonJS subprocess fixture. The agent's scoped ESLint command covered the TypeScript suite but did not cover this helper; the native/compiler gate passed independently. This was a test-helper lint failure, not a save-recovery assertion failure.

The coordinator converted the helper's module loading to supported dynamic imports inside an async entry function, retaining the CommonJS desktop module default exports, actual filesystem operations, crash points and explicit nonzero error exit. No lint rule or test assertion was disabled. ESLint then passed for both the test and helper, and all **33 crash/restart cases passed again** (12.78 seconds total). These are the same cases, not additional unique coverage.

Updated helper SHA-256: `020e706dd6c956e541621ac8d3a90c79840bdc85a02867b0441c613d6cb7992b`. Production persistence code remains unchanged. The prior source fingerprints describe the original agent handoff.
