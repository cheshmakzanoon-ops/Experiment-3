# A12 survey camera validation

Image review of A12 workflow 37401710257 at commit 7c5049d found that the
six labeled chase views were rendered from the preceding cockpit eye.
The original artifacts are retained, including physical-drive-1.png and
physical-drive-31.png in the daylight and sunset reports. Passing the old
assertions was not sufficient visual acceptance.

The survey assigned the mode field directly, then rendered the same snapshot
with zero elapsed time. That left the chase spring initialized at its previous
position. The normal application uses RacingRenderer.changeCamera(), which
resets the camera state for this transition. No application camera, source
asset, physical route or simulation channel is changed by this correction.

The observer now calls the normal camera transaction only when changing views.
Consecutive samples using the same camera retain their continuation state.
Every driven capture records the actual eye in car-local coordinates and a
body-centre point projected through the real camera. Each chase must be behind
the car, above its chassis and looking at its body inside the clip volume.
The validator runs before capture and independently on the returned report.
The old in-cockpit pose, invalid coordinates and offscreen views are rejected.

All six sites, original sample spacing, live frame/water checks, detail tiers,
quality cycles, memory checks, saved images and rendering limits remain.
Four new regressions cover the production transaction, same-view continuity,
rotated/translated measurement and invalid-view controls. All 43 focused
camera/framing tests, changed-file lint and strict TypeScript pass.

The rail/aisle runtime repair remains unchanged. It passed the full local
1910-test aggregate and all targeted hosted rendering workflows. Its older
chase screenshots are not counted as valid chase-camera approval here.

Final exact-commit CI, corrected six-site image review and release publication
remain separate gates. Automated checks do not certify human-driven racing,
consumer hardware performance or final art.

## Production-renderer check

The full renderer reproduced the invalid held-frame camera, then accepted the
normal camera transaction on the same twelve-car snapshot at 1280x720 medium
quality. The measured eye changed from (0, 0.1993, +0.3101) metres to
(0, 1.9942, -5.7957) metres in car-local space. The body centre moved inside
the camera clip volume. Frames and track water remained unchanged, with no
WebGL errors, context loss or page errors. Both images were preserved.

A separate automated UI exercise completed a twelve-car one-lap race using
the explicit AI demonstration toggle, then opened, paused and sought replay
and switched camera. This does not constitute a human-driven lap.
