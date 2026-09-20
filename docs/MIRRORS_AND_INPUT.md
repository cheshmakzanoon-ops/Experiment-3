# Rear-view rendering and manual input — 17 September 2026

## Driver-space steering correction

With the simulation's right-handed Y-up, Z-forward convention, positive local X
is to the driver's left. Human keyboard, touch and gamepad axes had been treated
as right-positive all the way to the left-positive steering model, reversing
manual steering. InputController now converts the sign exactly once. AI already
uses simulation coordinates and is unchanged. Seven regression tests cover both
keyboard directions, arrows, gamepad inversion, touch release and a physical car
whose displacement is projected into the starting camera's right vector.

## Live mirror views

The player's two mirrors now receive independent rear-facing camera render
targets. Their surfaces remain separate from the static-body mesh so each target
can be assigned independently. Both surfaces are hidden during both passes to
prevent recursive feedback. Existing forward-view shadow maps are reused.
Renderer target, viewport, scissor and shadow state are restored in a finally
block even when a render pass throws; the error is not suppressed.

| Quality | Resolution per mirror | Maximum update rate |
|---|---|---|
| Low | 128 by 48 | 10 Hz |
| Medium | 256 by 96 | 15 Hz |
| High | 512 by 192 | 30 Hz |

These are rear-camera approximations to convex mirrors, not an exact planar
optical model. The two targets and owned materials are disposed explicitly.
Four unit tests cover orientation, texture handedness, budgets, exceptional-state
restoration and disposal. A fifth Playwright workflow now drives with manual
controls and checks active mirror passes, in addition to the existing four
browser workflows.

## Validation boundary

At publication, all 75 unit tests, lint, TypeScript and the production build
passed locally. Local browser HTTP navigation is blocked by the runtime's
administrator policy; the GitHub Actions browser job is the rendered-game gate.
No new browser-pass result is claimed in this document. Long-run pit robustness
is separate: the first release fix passes the short weather tests but the 50- and
100-lap multi-car trials still exposed additional pit deadlocks.
