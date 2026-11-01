# Bounded native submission observation

This branch-only diagnostic follows the unresolved Linux Restart failure on
`ccb5fbe`. It is not a scheduling, driver, readiness or gameplay fix.

An explicit graphics-query opt-in enables at most eight scalar receipts for real
new fenced draw submissions. Separate component and scene epochs describe the
Restart interval where simulation has changed but old graphics work is draining.
Records identify paused/tick/input state, existing readiness observations and
preparation state. They do not claim GPU completion. Renderer timestamps describe
after-render/before-fence capture, not exact fence insertion. Historical and
pre-loss provenance remains explicit; stale records cannot become current
readiness. Skipped draws and preparation fences cannot create draw receipts.

The normal graphics payload remains unchanged. No canonical visual-state strings,
additional GL queries or off-lane scene-readiness calls are added. Native test
observation explicitly opts in; its scalar whitelist, eight-record limit and
bounded sample/history sizes remain enforced. Only opted-in graphics snapshots
have a 12 KiB cap instead of 4 KiB, inside the unchanged 16 KiB sample limit.

A capped 64-entry host command log brackets the existing Restart, input, Pause
and readiness-wait operations. It does not add sleeps, retries or new waits.
Host/renderer clock brackets are not exact event-delivery timestamps. Original
predicates, budgets and errors, including falsy thrown values, remain authoritative;
diagnostic failures cannot replace them or convert failure into success.

The frozen CPU selection passed 1,393 tests across 100 files and TypeScript.
An earlier source-extraction test failure is retained: it expected only the old
health option. The corrected test requires the exact new explicit opt-in and
continues checking pinned wire/CSP semantics. Exact-source GPU and native runs
remain required; no Linux repair is claimed by these tests.

Final frozen verification also passed canonical project ESLint, production Vite
build and discovery of all 28 existing GPU cases in nine files. The normal large
chunk warning remains. Independent review verified the exact source. An accidental
broader lint command scanned archived/scratch/vendor files; that failed log is
retained separately and is not the canonical project-lint result.

## Native result: `6c0cc646`

[Run 41351751806](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41351751806)
passed Windows/macOS model import, wheel motion and all four compatibility
journeys: 36/36 and 26/26 draws respectively, both 443 preparations. Linux passed
initial pause (6/6), lifecycle (28.187 s) and keyboard (31.761 s), then failed the
second paused-presentation gate at 62.019 s before model import. The unchanged
30-second gate retained 289 polls over 30.006 s.

Records 10 and 11 belong to component/scene epochs 2/2, paused at tick 30 with
zero throttle, surface preparation count one and no wheel adapter. Both existing
readiness observations were true. They are required rebuilt-surface frames, not
a surplus final request or model/moving frame. Their capture times differ by
21.682 seconds; timestamps are not exact fence-insertion times.

The final poll, 55 ms before timeout, recorded 11 submitted/10 completed,
250 preparations complete, rebuilt surface incomplete but drawable and pending
age 5.935 s. GPU exit 512 followed the timeout by 13.380 s. The final loss age
19.374 s is a later measurement, not the gate-time age. Final records explicitly
retain pre-loss provenance. No synchronous ownership defect or driver cause is
proven. Old epoch-1 records cannot qualify rebuilt resources.

SHA-verified artifacts: Windows 13102525108, macOS 13101484567, Linux 13101668677.
Shared fingerprint:
`7777ff16732e4fcaaaf3a35ec9bf937b8bd3519e976391df0b82073c9ffccf6c`.
These observations justify examining a bounded completed-scene restart reuse
path, not skipping required fresh frames or changing deadlines.

[GPU run 41351751860](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41351751860)
passed all 28 cases without flaky/skipped cases. The actual completed-image reuse
branch ran; tick 705 remained fixed, completion sequences advanced 7 → 8 → 9
through the viewport round trip, canonical state matched and rejection was null.
Unmasked 1440×900 RGBA had zero changed pixels/channels and maximum delta zero;
both hashes were `62492962ed0a70363462b0988ec04cca2fe1631e712ad93c07e458d3e95530c0`.
Resume reached tick 748. All 280 isolated PNGs remained identical to `ccb5fbe`.
Retained artifact 13102495512 SHA-256:
`1cf81586be4e6db443a6854df33c1408852ba9322d579c0d99532c81515909b4`.
This is SwiftShader evidence, not a physical-device performance claim.
