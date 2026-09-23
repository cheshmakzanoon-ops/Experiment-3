# Phase 27H.1–27H.2 — coupled APX-01 car, cockpit and driver

Source baseline: `50d13c9b54700ca283c3e2ae1af5e32baf6dd105`.
Controlling work package: **Pasted markdown(10), 27H.1 and 27H.2**;
original requirements: `MASTER_DIRECTIVE.md` sections 123–126.

## Delivered implementation

| Required area | Implementation and regression |
| --- | --- |
| Whole-car construction and mechanical state | Retains the existing Blender-authored 41-role APX-01, actual wheel hardpoints, aerofoil suspension, hollow brake ducts, forged wheels, deformable tyres, floor/diffuser, seat and separate material roles. `22-apx01-assembly.spec.ts` now exercises this exact car with the new skinned driver: 68 poses, 2,176 physical suspension endpoints, all LODs, wheel removal, brake heat, damage, mirrors, paint and replay. Simulation source is unchanged. |
| Front/rear/side/three-quarter inspection | `23-apx01-views.spec.ts` drives the normal application and PNG exporter, now including **both** side views. Opaque showroom softboxes are reflection-only so they cannot occlude a side camera. The content/blank-image rejection remains intact; cube-probe cameras still see the cards. |
| Body, suit and elbows | `author-driver.py` authors a reclined, panelled torso and two continuous closed sleeves in Blender, with tailored cross-sections, deltoid transitions, modelled compression folds and UV seams. Nine named bones follow the existing analytic IK and wheel cuff frames. No three-piece arm or elbow bridge is substituted in the normal startup path. |
| Asset integrity and ownership | `driver-asset.ts` is separate from the static car loader: exact raw/compressed SHA-256, bounded roles, nine joints, normalized weights, finite geometry, one embedded buffer, cancellation and owned instance geometry/skeletons. No external resources or imported animations. A missing/corrupt driver fails visibly; it does not claim the legacy fixture model is the authored asset. |
| Gloves, wheel and paddles | Preserves the manufactured wheel, grip centreline, live canvas, controls and wheel thickness. Replaces circular cuffs and segmented thumbs with fitted gauntlets and continuous thumbs. Broad radiused paddles meet the index pads within one millimetre. The distal index follows the same physical paddle pivot; its base and the other three grip fingers stay attached. |
| Seat, restraints and helmet | Preserves the bucket seat and articulated helmet shell, visor/gasket/hinges. Adds a moulded flat neck yoke, a shaped neck, six surface-fitted solid harness straps, edge seams, adjusters, central buckle and seat-side anchors. Both helmet posts and their moving webbing use the same endpoint calculation. |
| State-driven animation | Retains seat-restrained shoulders, load-driven head motion, steering-wheel transforms, actual shift/ERS events and discontinuity resets. No free-running decorative suspension or character animation is introduced. Full lock/countersteering and load tests exercise the actual skin, not only analytic joint numbers. |
| Normal application and replay | `24-coupled-driver.spec.ts` records startup, both steering locks, countersteering, pod/broadcast/chase movement and replay rewind through ordinary controls. Images, video and diagnostic frames are retained by the browser runner. |

## Reproduction

Use the locked Node dependencies. Blender authoring is pinned to **5.2.2 LTS**:

```sh
blender --background --python-exit-code 1 --python scripts/author-driver.py
npm run check
npm run test:physics
npm run test:e2e -- e2e/20-phase27h.spec.ts e2e/22-apx01-assembly.spec.ts e2e/23-apx01-views.spec.ts e2e/24-coupled-driver.spec.ts
```

The native editable source is `scripts/apx01-driver.blend`; the runtime file and
identity contract are `src/rendering/apx01-driver.glb.gz` and its manifest. The
skin adds **14,432 triangles** and **208,511 compressed bytes**. The measured
complete high-detail car/driver has **216,516 visible triangles** and **19,427,768
bytes of geometry buffers** in the CPU component test. This is a component
budget, **not** a target-hardware frame-rate claim.

The optional `scripts/apx01-inspect.mjs` / `.py` path bakes the actual posed runtime
skin into an explicitly labelled Blender CPU inspection. It now correctly
normalizes vertex colours. These views do not reproduce the Three.js shaders or
replace the normal-application browser evidence.

## Acceptance boundaries

The global 248-row matrix retains its existing acceptance states. This work does
not approve all 148 directive sections, all 100 references, later 27H.3–27H.6,
physical Windows hardware/controllers, Steam release or proprietary F1 visual
parity. `finalArtApproved` remains `false`. A successful asset decode or CPU pose
test is not aesthetic approval. Hosted test results and the inspected normal-game
captures must accompany any completion statement for this implementation.


## Recovery of the retained candidate (23 September 2026)

Recovered from Actions run `35902628261`, artifact `phase27h12-source`
(ID `10770071499`), candidate tree `dde0af3df3a09dcb4ddc83a376e88ad245e7250c`.
The candidate archive, its tree, both authored-driver artifacts, and the unchanged
master directive and dependency lock were checked before editing. The editable
Blender driver and exported runtime asset are retained byte-for-byte; no model
was recreated. The compressed-byte count above now reflects that exact hosted
export rather than a different CPU's export.

The retained browser traces and accessibility snapshots confirm both blockers:

- The primary submit button's name included the decorative arrow. Its span now
  has `aria-hidden="true"`; the exact `ENTER CIRCUIT` role locator is preserved,
  with explicit accessible-name and enabled assertions before the real click.
- The opposite-side test wrote 270 degrees into a -180..180 native range control.
  It now uses the equivalent -90 degrees. All five views and PNG content gates
  remain; native slider bounds and round-trip values are asserted explicitly.

The three driver transport parts are retired in this local integration. The
concurrent recovery workflow, updated through remote commit `a8bddb5`, is preserved unchanged;
this work does not replace another writer's workflow. Actual implementation files live in the ordinary
source tree. The existing `ci.yml` remains unchanged and runs the complete suite,
including these tests. The separate Aurel landmark candidate is preserved without
activation. Runtime-source identity continues to be embedded by Vite.

An isolated Chromium DOM check reproduces the original mismatches and validates
both corrections. That check is not a gameplay, rendering, or animation pass.
Full browser and deployment acceptance must still use this repaired revision;
the historical candidate's four retained car images are not new evidence.

### Follow-on driver trace

Run `35907335064`, driver job `107339138912`, progressed through actual application
startup after the button correction, then failed the retained `steer > 0.3`
assertion at 0.26032936573028564. Its detailed diagnostic calls took approximately
15–30 seconds. `apexDiagnostics(true)` includes synchronous mirror-pixel readback,
so using it for each input/state poll can stall the main thread and interfere
with the independent input pump. The driver test now uses ordinary, nonvisual
diagnostics for polling and requests visual diagnostics only for the required
pose/camera/replay snapshots. The steering threshold, all four lock directions,
three moving cameras, replay comparisons, graphics settings and timeouts are
unchanged. This removes the unnecessary readback from polling; a hosted rerun
is still needed to establish whether the entire driver case passes.


### Local delivery checkpoint

The final local `npm run check` passed: lint, 941 tests in 94 files, strict TypeScript and the production build. All eight existing native scenario/integration scripts passed. Input hashes were checked after the final run. An independent hosted recovery run (35907335064) passed all five whole-car views; the local emitted runtime files match that hosted web artifact byte-for-byte. Its driver run still failed before the later polling-only repair. The local seven-case normal-application attempt failed at navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`, before application startup; no graphics or browser-policy bypass was used. These are not seven successful driver/view tests.

`playable/` now retains the local built candidate and its source-fingerprint/hash manifest (debug source maps excluded, as in the existing release workflow). This is an offline candidate payload, not a public deployment or a fully accepted release. The final report outside the source archive records the local commit and remote observation separately. All full-driver, complete browser, public deployment, human art/reference and physical-hardware gates remain open.
