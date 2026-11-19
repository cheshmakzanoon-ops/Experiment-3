# High fullscreen-owner audit

Source: published cc72bfd8117ccad37180093c8ec45d7656810686, tree-identical to local c5cb136355d5fd7f7ca66d6f5cfa392d6f265ed6. Read-only inspection of that frozen commit and its installed Three r180 source; no production edits made by this audit.

## Exact tested route

The original test selects default High, GP gpr1, Aurel, practice, no opponents, clear weather. The retained diagnostic reports 4 actual MSAA samples, 960×600, default High options, and no pending material-library recipes. The source retains the original 90,000 ms readiness predicate. GP day/sunset circuit views select AgX even though the stored High option is ACES. Photo views in this test use the circuit backdrop and leave depth of field disabled.

| Native owner | Active at first GP chase | Existing preparation | Exact target and state |
| --- | --- | --- | --- |
| SceneAmbient obscurance, blur, composite | Yes | Present | Half-size obscurance / blur targets; composite to post-scene composer buffer. Existing High GTAO slices and heat-haze define must stay selected. |
| AdaptiveExposure meter | Yes | Missing in tested source | Its retained 16×12 UnsignedByte / NoColorSpace target, nearest filtering, no depth/stencil/mipmaps. Native metadata owner is directly evidenced by the failure. Compile without changing adaptation time, identity, pending read, sample count or issuing a readback. |
| LensBloom threshold prefilter | Yes | Missing | Existing levels[0] HalfFloat target. The inactive energy prefilter is a different program and is not needed by default High. |
| LensBloom downsample | Yes | Missing | Existing levels[1] (and same-format coarser targets). One material/program owner shared across levels. |
| LensBloom upsample | Yes | Missing | Existing finer level while accumulating from the coarser level; custom additive blend. One material/program owner shared across levels. |
| LensBloom composite | Yes | Missing | Composer's scene read buffer after SceneAmbient swap, not its write buffer; custom additive blend with existing threshold-bloom parameters. |
| OutputPass | Yes | Missing | Composer write buffer at this stage. The pass populates defines only in its render method: AGX_TONE_MAPPING plus SRGB_TRANSFER for this route. Compiling a constructor-state material or the stored High ACES choice prepares the wrong variant. |
| BroadcastGrade | Yes | Missing | Final screen target null because grade is last enabled. GP AgX sets FILMIC_BLACK before compilation. Authored profile/LUT, including the same wetness selection, must stay unchanged. |
| FXAA ShaderPass | No with measured samples=4 | Missing but inactive | Enable/prep only when g.antialias && scenePass.samples === 0. If enabled with grade, writes the composer write buffer. |
| Subject / photo DepthOfFieldPass | No for tested chase/cockpit and default photos | Missing but inactive | GP trackside only with fov<30°, or actual photo depth-of-field / grid / showroom owner. Preserve selected thin-lens/tap variant and existing depth texture. |
| Temporal AA, SSR, temporal AO, light shafts, CAS, replay DOF | No with exact default High | Not covered by this audit | Their graphics gates are off; compiling them for this route would add unused work. |

## Composer routing and ownership

Before the first composer draw, let its current write buffer be A and read buffer B. SceneAmbient writes A and swaps; exposure reads A without swapping; bloom accumulates into A without swapping; Output writes B and swaps; grade writes the screen. A/B are existing same-format HalfFloat targets. A preparation planner should walk enabled passes and their real needsSwap flags. It must derive last-enabled-pass status; renderToScreen defaults to false before the composer's first render and is not a reliable final-target declaration then.

Use the actual pass material, full-screen mesh and camera. The existing compileFullscreenTarget helper captures the public FullScreenQuad draw owner and awaits retained native metadata without drawing. Output's lazy define selection needs to be reached through its own public owner boundary; merely compiling a copied ShaderMaterial or reproducing a different shader does not establish parity.

Restore target, active cube face, mip, viewport, scissor, scissor-test and any shared quad selection before yielding. Compilation must not draw, advance a simulation/adaptation/temporal clock, issue a readback, manufacture a completed fence, weaken options, or alter the final GPU completion gate. Default High's LensBloom settings are uniform/state changes, not a reason to compile the disabled energy-prefilter program.

The material library has a conditional fullscreen recipe bake in UltraPipeline.prepareFrame on every preset, but this exact diagnostic reports recipes=0, pending=0, bakes=0. It does not explain the observed late program and is outside the bounded repair.

## Evidence distinction

Only AdaptiveExposure is directly identified by the cc72bfd trace's late shader and 16×12 target. The bloom/output/grade findings are source-level missing preparation boundaries. They are not a claim that the failed run reached or stalled in those later owners. No downstream acceptance or physical-hardware performance claim follows from this audit.
