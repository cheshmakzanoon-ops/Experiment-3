# Isolated second original A09 braking triplet

The explicit `loadBabylonSecondBrakingTriplet` entry point selects only the
original 150 board at 1020 m (worn), 100 at 1070 m (clean) and 50 at 1120 m
(clean), lateral -18, fixed LOD0. Its six meshes contain 4,994 triangles including
three original two-triangle prints. It uses the unchanged hash-pinned A09 GLB,
original TrackBoardsKit geometry/foot conformation and computed normals, original
256² stroke-label canvases, native atlas/PBR data and production clip-order
plugins. Atlas anisotropy remains 1; print anisotropy remains 8 with offset -1/-1.

Only two private immutable selection profiles exist; callers cannot provide
arbitrary stations, variants, topology budgets or LODs. The existing first
`loadBabylonBrakingTriplet` entry point retains its signature, default dependency
behavior, first selection/error text, six meshes/4,950 triangles and lifecycle.
Both entry points return the existing async kernel's promise directly. Resource
allocation, preparation, synchronous installation, independent two-ready-frame
receipts, cancellation, cleanup and ownership checks use the same pipeline.

Each selected triplet contains three unique labels, so the original three label
identities need no new sharing abstraction. This does not implement a combined
six-board owner or simultaneous live activation. A co-presence CPU test only
proves that retiring the second isolated owner preserves an independently owned
first owner and shared BRDF; it does not qualify that scene for rendering.

The live first-triplet readiness module, main/cohort wiring, diagnostics and
workflows are untouched. In particular the first readiness guard still rejects
the second topology rather than accepting arbitrary counts. Eligibility remains
dry clear, non-flat Aurel Formula. There is no wet, shadow, full-board/sector,
LOD-selection/switching or final PBR parity claim.

Independent CPU tests compare original raw clean/worn accessor/node data and
unchanged original-kit world geometry, normals, UVs, indices, labels and foot
conformation. Synthetic canvas/NullEngine seams are not rasterization evidence.
The isolated second GPU fixed-view, texture/shader/depth and lifecycle checks
must pass separately before any live integration is considered.

## Frozen local validation

The combined owner/oracle/fixture increment passed 162 focused tests in six files,
full TypeScript and canonical lint, then 1,111 workflow-selected CPU tests in 68
files and the production build. The original chunk-size warning remains. All 38
browser cases in 11 files were discovered (six A09 cases); discovery does not
execute rendering. The actual IIFE fixture also bundled successfully.

The initial focused run passed 160 tests and failed two new harness cases: a
missing box-builder registration for foreign test geometry and a seam expecting
an uncomposed parent signal where the real wrapper composes its child signal.
Only those harness assumptions were corrected; the latter now explicitly checks
the real composed signal and unchanged GPU/deadline/mesh inputs. Failed logs were
preserved, and production/original-data contracts were not relaxed. Fresh second-
triplet rendering evidence remains required before live activation.
