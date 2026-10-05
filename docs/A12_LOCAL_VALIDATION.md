# A12 local validation and supplemental macOS build correction

## Frozen feature source

Feature commit: `aa98c193bec21e205d6aec4d661b716ad3c9a865`  
Tree: `6cbbb5a84ef7e97ed7172158e5a45bf612671e17`

The source-stability guarded aggregate `npm run check:stable` completed with
exit 0: ESLint, **1,894 tests in 214 files**, strict TypeScript and production
build. The source inputs stayed unchanged. The integration commit was created
before this aggregate run finished; its in-progress statement is historical.
The 25 new A12 tests also passed independently on the macOS ARM runner in
workflow **37377140013**, including complete dry/rain six-site traversals.

Local Blender 5.2.2 reopened the retained hosted native source and reproduced
both GLB and runtime accessors byte-for-byte. Four isolated Mesa component
renders (450 m / 780 m, front and close views) returned no console/page errors,
WebGL error 0 and no context loss. Front/close images were inspected. Those
component views do not certify full-game presentation or consumer-hardware
performance. The local full-game browser attempt was blocked at ordinary HTTP
navigation with `ERR_BLOCKED_BY_ADMINISTRATOR` and remains a failed attempt.

## Supplemental macOS build correction

The first hosted A12 run passed all new tests but stopped in the existing player
LOD prebuild, before installing or running its browser. ARM macOS regeneration
did not match the retained, Linux-generated derivative manifest. The exact
cause of that cross-platform byte difference has not been isolated.

Only the supplemental workflow is changed: it retrieves the already-validated
A71 release, verifies the complete ZIP size and SHA-256, its source-commit
identity, and the player's current source/derivative manifest relationship.
It then checks the compressed and decompressed derivative lengths/hashes and
writes only the existing ignored `public/models/supplied-player-lods.bin.gz`
cache. No old application bundle, source mesh, manifest or rendering code is
copied. Ordinary source-guarded installation/build and the existing prebuild
verification still run; full CI, browser assertions and release gates remain
unchanged. A changed player manifest or altered release fails closed.

A71's complete run **37355013514**, including eight browser partitions and wet
presentation, passed and published `playable-67e3af529e09a52028cacf77a93f1066e2ca6f2c`.
A12's exact-commit hosted full-game results, publication, continuous human race,
representative hardware and final-art approval are separate open gates.
