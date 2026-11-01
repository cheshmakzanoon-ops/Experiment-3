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
