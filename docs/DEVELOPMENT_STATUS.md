# Development checkpoints — historical entries followed by current continuation

This is an incremental implementation checkpoint, **not completion of the master directive**.

## Reconstructed and committed source

The earlier unpublished working directory did not survive; see [RECOVERY.md](RECOVERY.md). The changes below were reconstructed on the verified application baseline, rather than silently treating historical reports as proof of recovered code.

- BVH triangle queries along suspension axes, seam-stable normals, and a separate physical contact ribbon.
- Oriented chassis boxes, sweep-and-prune, separating-axis contact, and rotational normal/friction impulses.
- Contact-localized wheel/suspension damage, punctured tire pressure/radius/grip, graining, blistering, and flat-spot contact variation.
- Bounded physical wing fragments and lost component mass. Fragment presentation and full repair bookkeeping still need integration.
- Physical jack support forces, pit-release and merge prediction, three-rate AI, swept traffic-lane planning, and an executable long-run acceptance harness.

## Validation of this checkpoint

`npm run check`: **62 unit tests, lint, TypeScript and production build passed** locally. Local browser navigation was denied by the environment; no local WebGL pass is claimed. GitHub browser CI is a separate gate.

The source fingerprint for the latest long-run trials was `2f6fc69f7ab257ea84853b38b70d66e7ee6e48c585683e9105271aa6e1a36ff3`.

| Trial | Result | Observed failure |
|---|---|---|
| Ten cars, requested 50 laps, seed 4417, clear | **FAIL** | Minimum 49 laps reached; car 0 remained in service phase 5 for over 100 simulated seconds. |
| Ten cars, requested 100 laps, seed 73021, clear | **FAIL** | Minimum 46 laps reached; car 7 remained in pit approach phase 1 for over 100 simulated seconds, with contact damage. |

These trials substantially outlasted the earlier traffic implementation but do not satisfy either endurance gate. The next repair targets pit-lane service/fast-lane interaction, deadlock-free release, and the physically driven approach. Do not lower acceptance thresholds to make these failures disappear.

The normal GitHub validation workflow remains. Temporary patch-transfer files/workflows are removed in this source checkpoint. Actual readable source files, not an encoded patch, are the delivered application.

## Continuation from 3d62267: measured performance

The requested source of truth remains the 148-section **Pasted markdown(6).md**
master engineering directive, not a different numbered attachment. The recovered
base tree was byte-identical to published commit `3d62267bdcc0365cbc1c8ceecad042c571cfb1dd`,
which added cooperative construction and current dry endurance evidence.

This continuation adds an opt-in bounded real-frame capture/export/comparison
path, corrects GPU timing lifecycle and HUD reporting, and prevents dynamic modal
lookups from returning detached inputs on subsequent openings. Performance
mathematics and CLI failure exits have an executable Node oracle; Vitest and
visible-UI browser cases are included in the publication gates. No simulation
physics module is changed by this batch. Earlier endurance reports remain evidence
for their recorded source fingerprints, not automatic certification of later code.

Full three-pass subsystem certification and the single combined manual
audiovisual scenario remain open. This is an implementation continuation, not a
claim that the complete AAA quality ambition has been attained.

## Continuation from 9eb0a9d: weather and wet-pit braking

The latest recovered published source was the tested camera/object motion-blur
implementation `9eb0a9d`. The exact Pasted markdown(6) is now retained verbatim as
`MASTER_DIRECTIVE.md`, with hash and all 148 ledger headings under test.

This continuation adds an immutable physical weather timeline and storm retreat,
stable water/thermal relaxation, recorded world wind, grounded work-driven effects,
and refresh-independent light-rain emission. It repairs ABS/regeneration coupling
and automatic anti-stall, then addresses the exposed AI pit-entry regression with
wet-slick control margin and a pit-directed traffic merge. Native tests, measured
reports and the required real-GPU browser oracle are described in
`WEATHER_AND_BRAKING.md`; no simulation outcome is substituted by a pose override.

Architecture/recording documentation has also been corrected where old descriptions
still claimed capsules, reflective-only mirrors, missing LOD or an immediate
player-only finish. Earlier dated evidence above is historical, not current
validation or a request to reintroduce superseded recovery logic.

All-source checks and browser publication gates remain required. Full three-pass
certification, the single combined section-146 driving scenario, representative
hardware performance and independent presentation assessment remain separate.

## Instrument follow-up

A review of the presentation path found that the cockpit's upload timer consumed
clamped camera dt and could lag behind the current gear/speed after a slow frame.
It now consumes snapshot simulation time, with immediate first/shift/rewind updates.
The HUD also distinguishes stopped rainfall from water remaining on the circuit.
These are presentation-only changes; the recorded simulation fingerprint and
its dry endurance results are unchanged, while the all-source fingerprint differs.

## Continuation from f0d6801 / playable publishing: connected surface state

Recovered **Pasted markdown(6).md** is still the exact 59,242-byte, 148-section
master directive. Its SHA-256 is
`f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`.
The last application fix was `f0d6801` (cockpit cadence and remaining-water
labels); `be734336` subsequently changed playable-bundle publishing, not
completion of the master specification. The temporary dependency-recovery
workflow used for this continuation was removed after its artifact was recovered.

This continuation closes the previously disconnected marble pickup, tread
condition, local road visualization and full-session surface-history paths.
It corrects stationary/off-road rubber deposition, stale paused-particle GPU
opacity, and the cross-origin worker construction failure for both physics and
CSV export. It preserves the earlier 199 CSV columns and appends four actual
per-wheel cumulative pickup channels.

The new continuous driving harness sends only ordinary driver requests into
production simulation. It covers launch, slip/wake, brake abuse and recovery,
kerb/grass, dirty-tire cleaning, changing weather, physical tire service and
rejoin, real front contact damage, whole-field results, historical replay seeks
and exact-state CSV checks in a single run. Read its declared scope and measured
`integrated-driving.json`; it is not a substitute for the full audiovisual
section-146 scenario or human handling assessment.

See [surface integration and evidence](MARBLES_AND_SURFACE_STATE.md) and refreshed
[endurance evidence](CONSTRUCTION_AND_ENDURANCE.md). The existing full browser
suite and two new browser oracles must pass before the source publication
workflow can commit this candidate. Full three-pass project certification,
representative-device performance and independent visual/audio quality remain
open rather than silently converted into pass marks.

## Continuation from be8e95a: replay presentation, spatial audio and engineering

The source and original 148-section Markdown 6 were recovered byte-for-byte.
This continuation repairs replay-disabled and pause-driven particles, connects
engine selection/stereo/Doppler to the actual camera, and fills the required live
engineering readouts with genuine physics/AI observations. The debug stream is
opt-in, bounded and read-only; it does not change the recorded protocol or physics.
The existing local physics core remains byte-identical to the prior endurance
checkpoint. See [implementation, tests and three subsystem passes](REPLAY_AUDIO_AND_ENGINEERING.md).

New native tests and real browser PCM signal tests supplement the existing full
Chromium/WebGL publication gate, wet replay/CSV checks and physical driving
journey. Full-project three-pass certification, representative-device performance
and the complete combined section-146 acceptance remain separate open obligations.

## Recovery of a18701b: camera, controller and wheel presentation

The last remote head was a failed staged update, not an integrated source release.
This continuation recovered its exact applied source artifact, preserved the original
Markdown 6 byte hash, corrected slow-frame camera lag and completed-frame listener
reporting, implemented saved controller-action mappings with version-6 migration,
and added recorded wheel/suspension interpolation. Pending patch transfer files are
removed from the integrated local source package, not left as its application.

The unchanged simulation/core identity is still
`30c155c669e4af3f1d5b2a40ab0ce9acd44d5dc19ee82777df8f6c6bf2149484`.
See the updated input and replay/audio documents for test scope. A local commit is
not a remote publication: GitHub write actions were unavailable and a direct push
requires a working authenticated network connection. The full navigation-dependent
browser gate and all final section-146/147 acceptance obligations remain open.

Normal source CI now owns the rotation, physical pit and race-classification gates
formerly duplicated by the patch publisher. The old patch/source publisher and
parallel build-only playable publisher are removed. A dependent publication job
requires build, native scenarios and browser success, uses that run's tested
artifact, skips a stale main revision and uses an explicit lease for the derived
playable branch. Three local bare-repository fixtures validate artifact contents,
stale-source exclusion and concurrent-writer protection; they are not remote pushes.
See `continuation-validation.json` for the exact identities and evidence boundaries.

## Concurrent remote candidate reconciled

During this continuation, remote `main` advanced to
`6d4a10dcd8f4c749788975cc10097dcbffaffdc2`. Its exact committed archive and
SHA-verified staged candidate were inspected before integration. The local
candidate preserves that work's canonical action-map field, independent edge
tracking, one-transition-per-poll behavior, malformed-quaternion/camera-cut guards
and browser assertions for actually presented cameras. New settings version 6
migrates its version-5 assignments rather than introducing incompatible version-5
save formats. The original physical core and directive remain unchanged.

The concurrent source publication subsequently passed all its GitHub gates in run
35426415808 and produced `fefe92074a2b456473d17e065fb6c2a3dd8087a2` on main.
That exact committed tree was recovered and verified. It is the parent baseline
for this local version-6 continuation, not evidence that these additional local
changes have been pushed or passed the remote browser gate.

## Directive-6 continuation — per-wheel visual/recording fidelity

Recovered the original directive from `Pasted markdown(6).md`; its exact retained
hash and all 148 headings still match. The starting remote source tree was
`ba53fadd70a5ac9fabdd01b80d65aa321f70ef7a` at `eba897d16956bd0d83ee78bc72ffc7ecbe6ee49c`,
confirming the preceding unpushed-local checkpoint had subsequently reached GitHub.

Implemented real per-wheel Ackermann/toe/camber telemetry and replay articulation,
independent rubber contact-patch geometry without scaling rigid rims/brakes/hubs,
and matching wishbone attachment transforms. Snapshot protocol 8 and 211-column
CSV preserve the first 203 column positions. Added regression/unit/GPU oracles;
complete Playwright coverage is sharded across three independent CI runners,
without reducing assertions or bypassing the publication gates.

See `WHEEL_FIDELITY.md` for exact behavior, validation scope, and remaining limits.
No assertion is made that all 148 sections, all 31 phase gates, representative
hardware performance or the complete human-perceived section-146 scenario are done.


## Continuation from a2195f9: historical replay and playback ownership

The exact tested source artifact for `a2195f928e359f81ffb61664a7c4a9a48d52d228`
was recovered and its Git tree verified before editing. The preceding wheel
alignment/protocol-8 changes are preserved. Original Markdown 6 and all 148
section headings remain unchanged.

This continuation implements independent replay integrity witnesses, incremental
capture checks without a page-seal hashing hitch, cooperatively validated disk
reads, correct weather history across page boundaries/rewinds, exact first-seek
presentation and exclusive dialog/audio/focus ownership. It corrects stale
protocol-7/203-column recording documentation to protocol 8/211 columns. Twenty-two
new unit tests and one real-application browser case extend the existing gates.
See `RECORDING_AND_REPLAY.md` for behavior, regression evidence and limits.

The temporary verification transport workflow is removed from the integrated
source. Main is advanced only by an ordinary fast-forward to the verified source
tree; the normal all-suite CI remains the gate for the derived playable build.
Complete section-146 manual/audiovisual acceptance, representative hardware
measurements and independent final quality audits are not claimed complete.
