# Phase 27G closure continuation

Base: `b7d89dac7343d8a5c7f446f1ad0255c93d6ea058` (the fully green first 27G increment).
This continuation changes production presentation and explicit recording, not physics,
AI outcomes, lap classification, the reference images, or the master specification.

## New production behavior

- **Adaptive exposure:** a 16 × 12 linear-scene meter before bloom/output, at most
  four samples per simulation second, one asynchronous GPU read in flight. A
  trimmed log-luminance histogram rejects extreme glints; correction is bounded
  to −0.7/+0.85 stops around authored exposure. Simulation time owns adaptation;
  held photos, pauses, camera changes, rewinds and disabled settings do not
  accumulate wall-clock changes. Low quality defaults off; other presets enable
  it. Individual settings persist. Manual photo exposure remains manual.
- **Low-lying local haze:** three authored height/Gaussian density fields anchored
  to the existing Aurel road. Three-point ray integration uses the actual visible
  fragment depth and recorded cloud/rain. The same shader handles ordinary and
  instanced materials. It adds no geometry or draw calls, and has a true zero-
  density branch. This is bounded analytic attenuation, not volumetric shadowing
  or a measured atmospheric-scattering model.
- **Actual battle composition:** nearby same-direction, same-level rivals supply
  a weighted camera target and a complete-car bounding radius. Join/leave
  hysteresis avoids edge chatter. A group that needs more room can select another
  existing unobstructed physical rig; it cannot silently drop rivals from the
  claimed framing sphere. Pit/retired/opposite-direction/bridge traffic is not
  mislabeled a battle. No simulation state is moved or fabricated.
- **Driver/safety-cell geometry:** distinct upper-arm and forearm section profiles,
  restrained diagonal compression folds, forearm twist, welded UV seam normals,
  closed attachment caps and unchanged IK hardpoints. Halo and padded safety-cell
  attachment ends are sealed at every LOD; cooling openings remain open.
- **PNG ownership:** the completed canvas is synchronously copied into an owned
  buffer before asynchronous encoding. Empty, transparent, uniformly blank and
  lost-context output is rejected. A later resize cannot change the image being
  encoded. The normal Photo Studio route uses this path; it remains canvas-only.
- **Whole-tab audiovisual recording:** Session 146 observations now include a
  separate two-gesture recorder: choose a local WebM file, then share the actual
  game browser tab. It captures the browser-composited HTML HUD, menus, replay,
  telemetry and WebGL, with explicitly requested tab audio. It never requests a
  microphone and rejects monitor/window sharing. It streams ordered chunks to
  disk, with 16 MiB pending-write, 2 GiB total and two-hour bounds. Missing audio,
  failed writes, interrupted sharing and finalization errors are retained.

The tab recorder requires browser support for `showSaveFilePicker`, tab capture
and a WebM encoder. Unsupported browsers retain the existing bounded canvas
recorder and can use an external recorder. Select the current game tab and the
browser's Share audio option when appropriate. The browser does not expose proof
that the selected tab is this origin; the manifest records that limit. Starting
inside an already running application does not record application startup.

## Validation and unchanged contracts

`tests/phase27g-completion.test.ts` checks finite/closed geometry, exposure clocks
and bounds, strict group framing, source-driven fog and pixel integrity.
`tests/tab-evidence.test.ts` checks recorder ownership, rejected screen capture,
missing audio, disk errors, bounded queues and disposal during permission prompts.
These recorder tests use labeled synthetic devices; they are not hardware proof.

`e2e/19-phase27g-completion.spec.ts` runs actual Three.js/WebGL meter and fog paths,
including instancing, canvas pixel ratio, a concurrent synchronous readback,
clear-state restoration, a resize during PNG encoding and responsive capture
controls. Component images are not substituted for full application screenshots.
The original lint, TypeScript, unit, physical scenarios, three full browser shards,
wet-presentation and publication gates are retained without reduced assertions.
A candidate can be published only from the exact tree that passed those jobs.

No dependency or lockfile change is needed. The retained master directive remains
byte-identical. Temporary candidate transport/workflow files are removed from the
final source tree rather than shipped as encoded application patches.

## Acceptance is not inferred from tooling

This is not a human artistic sign-off. The continuous human Section 146 drive,
physical Windows CPU/GPU/VRAM/frame-pacing and controller/wheel measurements,
independent full-image discrepancy review and final car/human/environment art
approval require their actual evidence. The new recorder explicitly keeps human,
hardware, startup and Section 146 acceptance false. It does not create approvals.

The existing all-100 ledger, duplicate relationships, two hardware supplements,
16 unrelated exclusions and reference hashes remain intact. No missing online or
reverse-layout game mode is reclassified as implemented by this continuation.
Additional cars, modes and sixteen distinct playable maps are not claimed here.

The GitHub workflow run for the published commit is the source of truth for its
remote test result; a prior green commit or this document cannot certify a newer
commit automatically.


## Publication recovery and evidence boundaries

The former working directory retained six current runtime modules and selected
logs, not the full checkout. Publication recovers the original candidate from
hash-verified Git blobs and exact source edits on b7d89dac. The six retained
module byte identities are verified before formatting. Native photo-camera,
all-LOD mechanical presentation and validation support are reconstructed and
must pass fresh candidate-specific checks; the historical 864-test log is not
asserted to certify this reconstructed tree. The original master directive,
physics, lockfile, CI assertions and rendering budgets remain unchanged.

This publication does not fix or approve the previously reported cockpit HUD
overlap, distant pit-shot composition, online/reverse leaderboard requirement,
all-image visual quality, physical hardware measurements or human Section 146.
No phase-completion or new live-site deployment is implied by a Git commit.
