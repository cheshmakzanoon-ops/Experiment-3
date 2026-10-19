# Validation record

This record distinguishes model and simulation checks from application browser
acceptance. The existing MotoGP test deadlines, viewports, GPU completion gates,
110,000-triangle model limit and 220-draw-call limit remain unchanged.

## Local evidence before integration of main `4a8fd57`

- Production TypeScript/Vite build passed under the source-stability guard.
  Its source fingerprint was
  `d837beb4d6f50fc482488dd9a52351b3a517902eda4a82a15b690826e72ccb74`.
  This was a modified worktree build, not a clean committed source receipt.
- The 38-file focused run completed 438 tests: 437 passed and one geometry
  measurement failed. The failure read the new garment's conservative animation
  culling box as physical geometry. The test and review fixture now measure
  actual posed vertices, with every original size and silhouette threshold kept.
  The follow-up geometry/suit/garment run passed all 18 tests in three files.
- The final front-contact dynamics run passed 48 tests in five files, including
  GP traction, braking, the base motorcycle and setup contracts. The separately
  recorded comparison covers both GP bikes at 120 and 240 Hz and verifies 48
  supported-riding profiles against the prior behavior.
- Full lint and content validation passed before the final integration edits;
  changed garment and geometry files also passed scoped lint after the bounds fix.

## Actual local WebGL review

The browser backend was verified SwiftShader software WebGL. It is not evidence
of physical-GPU frame rate.

Five model captures completed before the broad reference sequence reached its
original 300-second timeout: GP-R1 high/mid/far dry, GP-R2 high dry, and GP-R1 high
wet. Their completed resource, model-budget and GL checks passed. GP-R1 high
rendered 100,713 triangles / 193 draw calls, GP-R2 high 93,012 / 191; both reported
zero GL errors. Visual inspection of the GP-R1 dry and wet images found the near
sleeve and cuff connected without a visible tear or flex-joint collapse. These
views do not establish every occluded knee or hip contact.

The complete GP-R1 right-grip browser case passed, including held-frame and
wet/rewind pixel hashes and stable resources. The next case was manually stopped
to move the remaining review to isolated CI. That interruption is not a pass for
the other contact cases. The local broad reference sequence remains a timeout.

An earlier dry/wet application run timed out waiting for the initial menu at its
180-second gate, before GP selection. It used the previous full-circuit startup,
before incoming main `4a8fd57` introduced showroom-only startup. It does not prove
the combined source's menu or riding acceptance.

## Combined-source verification

The work incorporates main `4a8fd57`, preserving its Motocross and showroom
startup changes and assigning the subsequent GP physics update category 11.
Post-integration results and exact-source CI receipts will be recorded here as
they complete. Browser acceptance is pending until those jobs finish.

Two additional focused onboard cases retain one production-camera image and
receipt per GP bike, including clear instrument visibility, resource stability,
zero GL errors and the original model budgets. They supplement the original
broad reference sequence and do not replace its acceptance gate.
