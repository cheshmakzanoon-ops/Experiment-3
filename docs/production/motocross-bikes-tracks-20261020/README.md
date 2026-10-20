# Motocross bikes, riders and course identity

This pass improves the MX250 and MX450's mechanical construction, gives the rider shaped equipment and connected shoulders, and adds recognisable course landmarks with physical jump-reading boards. All runtime additions are Three.js geometry, material work and code-generated graphics.

Use **OUTDOOR MX** or **STADIUM SX** in the normal menu, select **MX–250** or **MX–450**, then enter the circuit. Existing practice targets and rhythm feedback work alongside the new physical jump boards.

## Bikes

Both motocross machines have irregular split crankcases, shaped clutch and ignition covers, water jackets, inspection plugs and attached fasteners. The curved sump guard has a real inner and outer surface. Tapered swingarms have open axle-adjustment slots, a spindle and retaining hardware; the front axle lugs have actual bores. The silencer has a returned outlet lip and a deep open bore.

The MX250 now matches its two-stroke vehicle definition: a compact cylinder/head replaces the MX450's cam housing, and a continuous expansion chamber runs from the exhaust port through expanding cones, a broad belly, converging cones and a narrow stinger into the silencer. Raised weld seams and restrained heat colour distinguish its sections. The MX450 keeps its narrower four-stroke header. This distinction follows the repository's machine definitions; the reference audit does not attribute a two-stroke expansion chamber to an ambiguous reference image.

The geometry enters the existing material batches and suspension groups. Mud, wheel rotation, chain articulation and cleanup continue through the existing owners. The existing supermoto engine/header branch is preserved.

| Complete bike and rider | High triangles | Medium triangles | Distant triangles |
| --- | ---: | ---: | ---: |
| MX250 | 122,906 | 59,692 | 11,452 |
| MX450 | 119,806 | 58,100 | 11,292 |

These are expanded model triangles measured in the controlled browser fixture, including instanced geometry. The existing high-detail ceiling is 130,000. These counts are not a frame-rate benchmark.

## Rider

The boots now have a continuous calf, ankle, instep and tapered toe, with shaped soles, flex ribs, shin protection, medial grip, closure straps and ankle pivots. The gloves use shaped palms, individual curved fingers, opposing thumbs and a textile back. The helmet has a more compact lower shell, crown creases, a thin ridged peak with actual vent apertures, and supports that meet the shell pivots.

Raised-elbow poses exposed a pinched shoulder junction during the visual review. The upper sleeves now have a broader deltoid and underarm volume tapering toward the elbow. One additional render bone per sleeve keeps its buried armhole inside the jersey. The existing inverse-kinematics targets still control elbow, wrist and boot placement. Onboard mode moves the attachment with the lowered arms and keeps the head and torso out of the view. This shoulder change adds no mesh, triangles or draw calls.

## Tracks and riding cues

Valley Ridge has three original landmarks:

- **Barn Double:** an open-front timber barn with sliding doors, corrugated roof sheets, rafters, fascia and a foundation that follows the sloping ground.
- **Quarry:** fractured stone masses and talus with scanned rock detail mapped at physical metre scale.
- **Sky Triple ridge deck:** an open viewing platform with bracing, grounded feet, a rear stair opening and a supported fabric canopy.

The landmarks give different parts of the lap recognisable silhouettes. Advance jump boards show a feature number, name, its actual height profile, a takeoff marker and its surveyed landing zone. A forgiving feature is labelled **ROLL OR CLEAR**; other boards say **READ THE LANDING**. The profiles are sampled from the same course function used for wheel contact, rather than an invented flight trajectory or guaranteed speed.

| Venue | Boards placed |
| --- | --- |
| Valley Ridge MX | Ridge Table, Barn Double, Creek Kicker, Sky Triple, Summit Table, Valley Double |
| Arena Nord SX | Triple, Tabletop, Finish Triple |

The planner reserves complete horizontal and vertical model envelopes against all course lanes, including neighbouring stadium lanes, existing stands, course furniture, camera supports and sampled broadcast sightlines. It omits a board when a safe approach site is unavailable. The minimum measured lane clearance is approximately 1.00 m outdoors and 1.16 m indoors. Outdoor landmarks and guides total **12 merged draws and 28,976 triangles**, within the added subsystem's 16-draw/42,000-triangle budget.

The gameplay contribution of this pass is course identity and jump readability. The authored riding lanes, jump trajectories, handling and race rules retain their existing definitions.

## Reference provenance

The original archive was recovered and all **100 image hashes** matched the repository's source index. Every image was reviewed on labelled contact sheets, and 13 distinct originals were also opened individually across the team. The supplied material consists of commercial motocross game screenshots and promotional images; it is visual guidance, not a set of real-world measurements.

[REFERENCE_REVIEW.md](REFERENCE_REVIEW.md) maps reference observations to the implementation. [reference-audit.json](reference-audit.json) contains the complete portable ledger. The barn is an original design choice. Source-image pixels and sponsor artwork were not imported into the runtime.

## Verification and evidence

**Source checks and focused component validation succeeded; the full-application gameplay journey failed during loading.** [validation.json](validation.json) records the outcomes and their limits. The frozen rendering source fingerprint is `3ab53fd367f375c3ed08769e38f4871b13cc295cf8aaf2ee46b1e4c7ef133037`.

The final TypeScript check, Vite build, lint and content validation passed. Across the incremental unit-test runs, **111 distinct tests in 13 files passed**. This is the union of 66 bike, 33 rider and 21 course tests, with the nine shared equipment-surface tests counted once; it is not a single final 111-test invocation.

The bike browser test now separates its 29 captures into 12 bounded contracts while preserving the original samples and assertion thresholds. The combined run advanced through all 12 bike cases without reported failures, and [all 29 capture metrics](bike/metrics.json) were saved with zero GL errors. The runner did not write its final JSON report, so that report is unavailable. The final course browser check passed its one case and saved five component captures.

The focused checks cover open bores, connected pipe topology, silencer alignment, garment contact through riding poses, level-of-detail budgets, course envelopes, faithful profile diagrams, resource disposal and terrain immutability. The saved [contact probe](geometry-contact-verification.json) additionally checks 750 barn-foundation rays and actual triangulated canopy contact.

### Full-application loading failure

The final gameplay test used the actual Valley Ridge menu at **Low quality on a software GPU**. It failed at `e2e/45-motocross-gameplay.spec.ts:82` after waiting **300,000 ms** for `#raceBriefing` to become visible. The failure DOM snapshot remained at **90% — Readying the pit crew**. A completed ride, in-race camera/pause journey and the subsequent stadium venue switch were **not verified**.

The [failure receipt](gameplay/failure-receipt.json) includes the original trace hash, the [actual menu capture](gameplay/actual-menu.jpg), the [failure DOM snapshot](gameplay/error-context.md) and a [portable run log](gameplay/run-log.txt). The [last recorded trace frame](gameplay/last-recorded-loading-frame.jpg) shows the earlier **90% — Setting up cameras** stage; it is not presented as the later failure DOM state. No page-error or console-error events were found in the trace. Retried polling-assertion mismatches are test-runner events, not application errors. The 29 MB trace archive is represented by its hash and these compact original artifacts.

During the stall, the shared cgroup was using **8,589,828,096 of 8,589,934,592 bytes**. Its cumulative memory-event counters were `max=506727`, `oom=0`, `oom_kill=0`; after exit, recorded usage was 6,780,727,296 bytes and no browsers from this run remained alive. Shared memory pressure was observed, but these measurements do not establish the sole cause of the loading failure.

### Capture scope

The `bike` images are controlled production-model inspections. The `course` images are controlled `OffroadScene` inspections; their outdoor substrate consists of local sampled patches, so distant gaps are part of that fixture. The `gameplay` folder records menu/loading evidence and a failed journey, not successful riding. JPEG previews preserve their source image's framing and dimensions; manifests and the failure receipt retain original hashes. The loading frame is an unchanged encoded trace JPEG, smaller than the browser viewport.

This is a substantial procedural realism pass. Some close-up equipment and rock forms still read as procedural assets. The evidence does not establish photographic parity with the reference games or hardware-GPU performance at high quality.

## Main implementation files

- [Bike model](../../../src/rendering/offroad/dirt-bike-model.ts) and [castings/expansion chamber](../../../src/rendering/offroad/motocross-castings.ts)
- [Rider](../../../src/rendering/rider.ts), [garments/helmet](../../../src/rendering/offroad/motocross-gear.ts) and [boots/gloves](../../../src/rendering/offroad/motocross-rider-equipment.ts)
- [Landmark/guide builder](../../../src/rendering/offroad/mx-course-landmarks.ts), [site planner](../../../src/rendering/offroad/mx-course-sites.ts) and [production scene ownership](../../../src/rendering/offroad/index.ts)
- [Bike browser contracts](../../../e2e/42-motocross-bike.spec.ts) and [course browser check](../../../e2e/53-motocross-course-landmarks.spec.ts)
