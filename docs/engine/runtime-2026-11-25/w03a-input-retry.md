# W03A — controller fault retries

Implemented the repeated calibration-failure finding from W01D in
`src/input/controller.ts`. The actual settings transaction replaces
`input.settings`; its new mapping admits another device sample, but the old
message latch previously suppressed the host's required `deviceLost` callback.
The host therefore remained enabled after the second failed attempt.

`observeButtons()` now clears the fault-message latch only when an unsuppressed
device is acquired after ownership changes. Failed device/mapping pairs are
still rejected before that boundary. Ordinary resets, pause/resume and focus
changes therefore do not unblock a failed mapping or generate repeated fault
notifications. A replaced mapping, different physical device, or newly resumed
action-poll owner can emit its own mandatory pause even when the diagnostic is
identical. Existing held-button baselines and successful-sample recovery remain.

Added `tests/engine-controller-fault-retry.test.ts` with real `InputController`
instances and synchronous host-style callbacks that call `setEnabled(false)`
on device loss and resume through Escape. Eight cases cover missing steering,
mismatched steering/pedal calibration, missing rear brake mapping, two failed
saved-settings retries, no repeated callbacks while suppressed, unchanged
mapping across focus/resume, valid recovery, one-shot action/shift edges,
replacement hardware and a new disconnect before a successful driving sample.

Before the source change, six of the eight new cases failed with the exact
missing second callback (`1` received, `2` required); the two compatibility
cases passed. After the change:

```text
NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/vitest run \
  tests/engine-controller-fault-retry.test.ts \
  tests/controller-replacement.test.ts \
  tests/input-controller-lifecycle.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1

3 files passed; 40 tests passed. Duration: 2.98 s.
```

Only the assigned controller, new test and this report were edited. No mapping
defaults, tuning, authored visuals, host code or protected source changed. No
full compiler/build, installation or git write ran. Browser targets/gamepads
are stand-ins; this verifies controller callback and lifecycle behavior, not
physical device compatibility.
