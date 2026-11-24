# Agent 27 — controller replacement ownership

## Scope and outcome

Fixed audit 05, section 1: an established automatically selected controller can no longer be silently replaced by another connected controller whose throttle, brake, steering, clutch, reverse or action buttons are already held.

Owned implementation: `src/input/controller.ts`.

Added regression suite: `tests/controller-replacement.test.ts` (16 cases).

With the coordinating agent's explicit authorization, updated the one obsolete automatic-switch expectation in `tests/input-controller-lifecycle.test.ts`. It now requires a neutral state and `deviceLost` before the replacement is adopted, while retaining the original release/repress assertions for camera and shift edges.

No models, character assets, authored environments, vehicle tuning, input calibration values or rendering code changed. No git staging, commits or pushes performed.

## Defect and repair

Previously, `selectDevice()` could return the next connected standard gamepad immediately after the current one disappeared. Because `update()` checked only for a null result, a replacement's held axes and pedals were accepted without emitting a device-loss event. Merely baselining its buttons did not neutralize its driving inputs.

The controller now compares an established device identity before reading any replacement controls. Identity includes index, ID and physical Gamepad mapping. A missing or different device follows the existing `deviceFault(..., false)` path: reset the retained control state, clear held keyboard/touch/shift state and button ownership, and emit `deviceLost` through the existing application callback. Enabled action-only polling performs the same ownership check, including a missing device or failed gamepad access, so it cannot silently erase the previous owner before the next drive sample.

Disconnect callbacks use the same full identity. The loss resets ownership before notifying the host, so a delayed disconnect event for the old device neither bypasses the transition nor faults the replacement after resume. Reuse of an index by a different ID or mapping is covered.

The implementation tracks the selected settings values separately from the currently observed device. A deliberate settings selection starts a new ownership and button baseline; replacing the settings object without changing selection does not authorize an automatic takeover. Initial automatic acquisition, configured-device selection, keyboard resume and existing calibration fault suppression remain available.

## Existing host lifecycle preserved

Reviewed `src/input/pump.ts`, the input sample callback in `src/main.ts`, and the device-loss handlers in `src/main.ts` and `src/session/free-roam.ts`. The application already handles `deviceLost` synchronously by pausing/disabling driving input. Main-session publishing also rechecks whether the session is still driving after `update()` returns. These paths were not changed.

The regression fixture exercises that public contract by disabling input in the `deviceLost` callback. It checks that repeated disabled update/action polls remain neutral and produce exactly one loss notification. This repair deliberately preserves the same callback-driven pause semantics as a missing device; it does not add a separate controller-internal pause latch.

## Regression coverage

- Two connected controllers; the selected one disappears while the replacement holds steering, throttle, brake, clutch, rear brake, reverse, pause, camera and a shift paddle.
- Ownership loss detected by both drive and enabled action polling; retained state becomes exactly `controls()`.
- Delayed disconnect callbacks before and after paused replacement observation; exactly one `deviceLost` during the paused interval.
- Callback-first disconnect ordering.
- Explicit resume: held analog controls become usable only after resume; held action/shift buttons remain baselines until release and a fresh press.
- Same-slot ID replacement and physical mapping changes; stale old-device disconnect after resume is ignored.
- A newly preferred automatic controller while the prior controller remains connected.
- Initial acquisition without a prior owner.
- Stable identity across fresh browser gamepad objects and unrelated settings edits.
- Unrelated settings cloning cannot conceal an automatic handoff.
- Explicit selection through both in-place and replaced settings objects, including an old disconnect arriving before the next poll.
- Configured-device initial acquisition; selected-device loss does not fall back to another held controller; keyboard Escape/resume and keyboard throttle still work.
- Enabled action polling cannot clear an established owner on missing/inaccessible gamepad data.
- Calibration faults continue suppressing the faulty mapping until it is explicitly replaced.

## Validation

All Vitest and ESLint commands used `/engine-work-4e0075ccccb3/test.lock` and `NODE_OPTIONS=--max-old-space-size=512`; Vitest used `--maxWorkers=1`.

Focused command:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/controller-replacement.test.ts tests/input-controller-lifecycle.test.ts tests/input.test.ts tests/controller-buttons.test.ts tests/input-pump.test.ts tests/gp-input-cadence.test.ts tests/motocross-body-input.test.ts --maxWorkers=1
```

Result: **7 files passed; 89 tests passed**.

ESLint initially identified a test-fixture `prefer-const` issue. After correcting that declaration and formatting the new test file, the final targeted rerun passed **2 files / 32 tests**, and scoped ESLint passed for all three touched source/test files.

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/input/controller.ts tests/controller-replacement.test.ts tests/input-controller-lifecycle.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/controller-replacement.test.ts tests/input-controller-lifecycle.test.ts --maxWorkers=1
```

The new test file passes Prettier checking. Scoped `git diff --check` passed. No full TypeScript build, npm lifecycle hooks or hardware/browser-controller test was run by this agent; broader integration belongs to the coordinator.
