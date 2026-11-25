# Assignment 55 — final engine architecture and contracts

## Completed deliverable

Rewrote [ARCHITECTURE.md](../ARCHITECTURE.md) into a **4,237-word technical handoff** for the final frozen source. This assignment owns only that document and this report. It did not change production code, tests, benchmarks, models, materials, assets, environments, terrain, specifications, the index or refs. No child agent or heavy validation job was started.

The architecture is organized by state ownership and engine contracts, rather than development chronology. Its module map identifies all **18 runtime paths** and distinguishes model construction from the permitted three animation-reader bindings in bike.ts.

## Direct source review

The review read the actual staged changes and current implementations, including the adapter's firstFlightContact/vertical/updateSuspensionAndTyres/posture paths; the complete coupled impulse and analytic drag helpers; posture, rider-weight and gear controllers; machine, foot and posture reconstruction; snapshot writer/layout; PresentedFrame integration; camera ramp and flight-origin changes; and the narrow AI guard patch.

It also read the evidence and qualifications in assignments 25, 26, 28, 30, 43, 44, 45, 46, 47 and 51, with the existing architecture as the starting document. No new runtime defect was identified and no speculative correction was introduced.

The resulting document makes the following boundaries explicit:

- Incoming force/compression observations remain distinct from outgoing visual fork/shock travel. Internal force refresh does not relabel those outer observations.
- Coupled hard-stop passivity concerns the velocity impulse. Position projection, subsequent compliant work and the forward-only speed clamp are separate.
- Analytic gravity/drag translation does not make the existing angular rule exact.
- The first-contact search is ridden-player-only and endpoint-bracketed; its 32 bisections do not guarantee detection of an interior feature with positive gaps at both endpoints.
- Supported refinement refreshes only local heave/pitch on held terrain/control inputs, with a 16-stage work cap rather than an unconditional error bound.
- Automatic stance/body axes advance once under their correct ground/flight owner. The C1 manual pose join does not replace finite physical rider momentum.
- The final gear repair holds distant-target movement on its original duration while bounding only the incoming tangent's local continuation.
- All 33 tail offsets, markers, units and eligibility predicates are documented. Protocol remains 17, header 24, stride 331, simulation identity 40.
- Foot seeds encode an evaluator contract; a future incompatible evaluator requires an explicit decoder decision even without a stride change.
- Recorded reconstruction is pure and source-preserving. Interior foot presentation clears copied seed metadata; malformed optional machine data uses a consistent fallback at endpoints and interpolated poses.
- The camera observes presentation time and the current flight origin. Its stateful lifecycle is not certified by the CPU rig cadence benchmark.
- The original spring-work/Jacobian limitation, reverse-speed constraint, sampled terrain/model geometry and global Float32 header precision remain visible.
- Non-MX compatibility is stated with the actual MX road-practice placement/metadata exceptions, rather than claiming every record byte is unchanged.

## Verification and exact source

Before and after documentation work, all **59 staged source/test/benchmark paths** were byte-compared with their staged blobs. None differed. The staged tree remained:

**b7f379a7aaea0f807b5623b2c981190c6d1a3a17**

For this check, SHA-256 of sorted entries formed as path + NUL + file-SHA-256 + newline is:

**a336f6f8b6750b9965a0a78ad39b24aa9f9956a1833b0f29b9091aaffd32feef**

This is a 59-path inventory digest; it is not the complete source digest or build fingerprint.

All **45 relative document links** resolve. The document has balanced display-math delimiters and no trailing whitespace. Its final SHA-256 is:

**c469c6c079be48f471e829ecd17362ebaccc586f2f74b374122815d0d0bb5d08**

No unit suite, build, race matrix or browser journey was rerun for this documentation-only assignment. The architecture references the source-specific final acceptance reports rather than copying pending browser/race states into permanent architecture claims. A49 and A54 own the completed combined-unit and dense-cadence results; the browser and race reports own their separate acceptance.

The new document does not claim physical-GPU frame rate, real-bike calibration, whole-model energy conservation or subjective fluidity on all devices. All assignment work is complete and no validation process remains running.
