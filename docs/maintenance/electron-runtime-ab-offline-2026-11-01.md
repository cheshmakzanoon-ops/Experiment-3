# Official-runtime comparison: offline infrastructure only

This checkpoint adds inert comparison helpers and tests. **No native adapter,
launch command, active workflow, trigger, runtime downgrade or installer is
added.** The shipped package, original smoke/provenance code, V2/V3 trace paths,
renderer and sole authoritative physics remain unchanged.

## Fixed inputs and scope

The proposed comparison is one serial Ubuntu22 x64/Mesa A/B pair, using one
byte-identical application ASAR, fresh private state and the existing full
journeys, graphics flags, security settings and stage deadlines. It is not a
benchmark or required-lane qualification. A failed A remains failed even if B
passes; uncertain source or cleanup blocks B. No automatic retry or bisect.

| Leg | Electron | Chromium       | Node    | Official ZIP bytes | SHA-256                                                            |
| --- | -------- | -------------- | ------- | -----------------: | ------------------------------------------------------------------ |
| A   | 45.2.1   | 156.0.8078.75  | 24.22.1 |        123,777,540 | `616efc1ae4784af1a4f3f0e8774e73e7030e7bd1708da9d09bcf543dfa499beb` |
| B   | 44.10.1  | 152.0.7977.169 | 24.22.1 |        123,103,802 | `2be868b71b0aa71f30e6b5567a106a35a049385e963183c074aad1975ead5167` |

Both fixed official archives were downloaded, byte-hashed and boundedly
extracted: 72 regular files each, 286,782,319 / 296,576,798 expanded bytes.
Ownership, single links, no symlinks and no privileged mode bits were checked.
**No downloaded executable was run.** Embedded version text is not an actual
process-runtime observation. Mutable release labels and unsigned annotated tags
are not substituted for exact asset digests. Official sources:
[45.2.1](https://releases.electronjs.org/release/v45.2.1),
[44.10.1](https://releases.electronjs.org/release/v44.10.1),
[support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#version-support-policy).
Support does not establish equal security or a known fix for this game's failure.

## Implemented boundaries

- `scripts/electron-runtime-ab-contract.mjs`: fixed host/runtime/source and
  comparison-only schema, environment and outcome contracts. The original
  declared source remains Electron 45.2.1; each leg's actual runtime must match
  its separate exact pin. Missing identity is unqualified. B is never exported
  as a normal 45.2.1 native report or release pass.
- `electron-runtime-ab-payload.mjs`: clean source/protected-file/imported
  toolchain seals, generated `desktop-dist` equality, one immutable ASAR and
  exclusive copies in both runtime envelopes. Verification runs before/after
  each leg through explicit adapters. A real clean production build has **not**
  yet qualified this path; current payload tests use a tiny synthetic build.
- `electron-runtime-ab-coordinator.mjs`: sequential state machine with explicit
  trusted adapters, positive immutable/quiescence prerequisites, distinct
  execution-unknown versus positive spawn-failure outcomes, strict retained-set
  and digest binding, and transactional fixed-folder export. There is no default
  native execution adapter. Generic Protocol/JavaScript errors are not treated
  as proof of API incompatibility; missing entry/backend observations are
  unverified, and recorded graphics faults remain separate from cause claims.
- `electron-runtime-ab-archive.py`: fixed-pin, bounded, exclusive ZIP extraction
  without executing binaries or applying privileged modes.
- `electron-runtime-ab-process.py`: bounded Linux PIDfd identity checks and
  cleanup of only positively owned processes. Exact executable identity, UID,
  private token, start time and stable process visibility are required. It does
  not kill bare PIDs/groups or unrelated same-UID processes. Private state is
  removed only after verified closure. Actual Chromium trees and Ubuntu22's
  Python 3.10 have **not** yet qualified this helper; local benign-process tests
  ran under Python 3.12.

The future adapter must reject root (pinned Playwright otherwise adds
`--no-sandbox`), retain the original launch ownership, await process close and
bound output/cancellation. No security bypass is included. Filesystem/process
checks assume a trusted caller and nonhostile same-UID workspace; they are not a
sandbox against hostile concurrent writers or namespace changes.

## Evidence and limits

Only fixed comparison JSON envelopes and named PNGs can reach the final export
folder. Original bounded console/process-log arrays remain nested inside those
comparison envelopes; no separate raw log/trace, private profile/cache, runtime
archive or executable is exported. Owner tokens are rejected from retained
bytes. Summary and leg/source/runtime/evidence digests are bound before atomic
export. PNG checks validate headers, dimensions and hashes, not full image
content; actual terminal images still require inspection.

Source input trees and the payload are each bounded at 512 MiB; source files
are bounded at 256 MiB with at most 20,000 entries. Retained members are at most 8 MiB; evidence is at most 32 MiB per leg,
with a 16 KiB summary. ZIP extraction allows at most 4,096 entries, 256 MiB per
member and 512 MiB expanded, with a 60-second helper alarm. Process-helper
request/output limits are 16 KiB/4 KiB and a five-second work budget. These are
not RSS/address-space caps or a guaranteed end-to-end settlement deadline.

The existing 50-minute job ceiling must not silently grow; preserving per-stage
budgets does not guarantee both legs finish before external cancellation.
Fresh profiles/caches do not reset host/driver state or remove A→B order effects.
A-fails/B-passes would indicate sensitivity to the complete runtime bundle in
that observation, not isolate Electron/Chromium/ANGLE/Mesa cause, establish
repeatability, approve a downgrade or qualify a release.

## Verification

The final 18-file increment passed **79 top-level Vitest tests in five files**:
41 contract, 18 coordinator, 17 payload, two process wrappers and one archive
wrapper. The wrappers execute **42 process-helper and 11 archive Python cases**;
these are nested, not 53 additional Vitest tests. Scoped strict types, ESLint and
formatting passed. The initial snapshot and first integration repeat passed 75/75. After the
test-only portability correction below, snapshot and current-checkout runs each
passed **79/79**; all 14 protected inputs and all 18 copied hashes were verified.

The initial archive fixture incorrectly used an anonymous, zero-link temporary
file. It was replaced with a named fixture; the production single-link guard
was retained. Independent review and negative tests also closed export binding,
generated/imported toolchain sealing, bounded reads, impossible cross-leg
histories, unknown-spawn handling and false incompatibility classifications.
Failed attempts remain retained; there has been no native comparison to retry.

The process-helper wrapper lacked its Linux-only guard (archive/payload already
had theirs). A retained red test showed two intercepted spawn attempts on each
of three unsupported host stubs. The corrected wrapper skips only those Linux
process bodies off Linux. Four contract cases execute its actual registration
code under isolated host stubs, including a Linux positive control. The first
78-case model incorrectly skipped suite collection; it was strengthened to
match Vitest collecting both bodies but executing neither on unsupported hosts.
Those prior sources/logs remain retained. No real host identity was mutated and
no Python was launched by the simulated-host cases. Runtime/helper/policy bytes
are unchanged; scoped types/lint/format and independent review passed again.

Final copied-file manifest SHA-256:
`7ab03ad03721a10050a9a14e88b4ad7f58aeba780759e4f271f26ab39bc3d444`.
Final portability verification receipt:
`c45ebad5e4fde963aacdb83dc1c989f1570444327afb02c377efc815c4fcc113`.
The original 75-test snapshot manifest remains:
`d46c018ed3466dc8d5966b9e887c445ad84813282b80d57469b36ffac2421dc7`.
Actual ZIP/layout receipt:
`8e0b2ebe79db41ea6543cd32999934584b21dbf6263af6b31e551fa132821746`.

Next gates are a real immutable production payload, reviewed native close/drain
adapter, actual host/helper compatibility and separately authorized scheduling.
No launch or four-journey acceptance is implied by these offline tests.
