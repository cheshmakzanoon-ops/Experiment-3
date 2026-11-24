# Fourth batch: exact-source native validation

Implementation commit: [`360d3de1d910b77e9bdca933f47df8d5bc99a69a`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/360d3de1d910b77e9bdca933f47df8d5bc99a69a).

Focused workflow: [run 45459759095](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45459759095), job 138678788910. The coordinator retrieved the completed job metadata and logs directly. **Result: success.**

- Locked dependency installation and source-stability checks passed.
- Complete TypeScript compilation and production Vite build passed.
- Mesa Chromium executed **eight browser tests, all passing**, with one worker and no retries.
- The real range-input endpoint test passed, proving exact end/floor recognition after browser decimal serialization.
- The unchanged full recorded-playback test passed its seek, modal, focus and audio ownership assertions (1.8 minutes).
- Native IndexedDB cache/transaction/reopen cases and dedicated-worker transfer ownership cases also passed.

The new endpoint regression plus full playback success resolves the precise failing assertion observed at `61241fd` (recorded 16.600000381469727 versus serialized 16.6000003814697). No assertion was relaxed.

This focused result does not certify hardware audio/controllers, physical GPU performance, or the entire broad CI suite. The four previously recorded content expectation failures remain separate from engine validation. The raw focused-job logs and source/build identities are retained in that workflow's artifact under its configured seven-day retention.
