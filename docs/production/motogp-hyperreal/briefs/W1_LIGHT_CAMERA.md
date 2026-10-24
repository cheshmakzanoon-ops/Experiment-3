# W1 — Photographic light, lens and camera work (worker id: w1-light)

Read `BRIEF_COMMON.md` first (same folder). This is your workstream.

## Mission
Make every GP frame read like a photograph/broadcast camera instead of a game viewport. The
references are lit by one strong, warm sun with deep, crisp shadows and atmospheric depth; the
current game is evenly lit, low-contrast and "clean CG".

## You own (GP-gated changes only)
`src/rendering/renderer.ts` (keep edits small, localised and behind a GP-session switch),
`daylight.ts`, `sky-light.ts`, `broadcast-grade.ts`, `lens-bloom.ts`, `adaptive-exposure.ts`,
`motion-blur.ts`, `camera-dynamics.ts`, `motorcycle-camera.ts`, `broadcast-camera*.ts`,
`camera-detail.ts`, ultra pipeline files, and any new `src/rendering/gp-photographic-*.ts`.
**Not yours**: bike geometry/materials or the onboard camera socket (`bike.ts`, `gp-*.ts` parts → W2),
rider (W3), circuit surfaces/foliage (W5), simulation (W4). If you need a hook in their files,
make it a one-line, clearly commented call and list it in your report.

## Targets (open these references full-size)
1. **Key/fill balance** — REF_001, 002, 003, 006, 019, 027, 046, 056: the sun is the dominant
   light; shadow sides of bike, rider and grandstands fall well below lit sides; the cast shadow
   under the bike is dark and sharp near the contact patch. Audit `hemisphere`, `scene.environmentIntensity`
   (0.7), sun intensity, exposure (`toneMappingExposure`, adaptive exposure) and contact obscurance
   for GP sessions. Aim for a lit:shadowed tarmac luminance ratio near what you measure on the
   references (sample pixels from both; record the numbers).
2. **Tone and grade** — references: rich but not crushed blacks, saturated-but-natural colour,
   warm highlights, slightly cool shadows, gentle highlight roll-off on paint and sky (no clipped
   white sky). Re-tune the broadcast grade for GP: contrast curve, white balance, vibrance,
   a subtle optical vignette and very fine film grain. Consider AgX vs ACES — pick by side-by-side captures.
3. **Aerial perspective** — REF_003, 044, 045, 046: distant hills and tree lines go blue-grey;
   mid-distance grandstands lose contrast. Height/distance haze, GP-gated.
4. **Depth of field** — REF_008, 022, 035, 042, 059: trackside/broadcast/telephoto shots focus on the
   followed bike and soften background (and foreground blockers). Cheap (half-res, single pass,
   reuse the scene pass depth). Off for chase/onboard by default, or very mild.
5. **Motion** — REF_049, 059, 071: at speed the background streaks; wheels show rotational blur.
   Tune the existing `MotionBlur` (shutter angle) for GP chase/trackside; make sure wheel spin
   blur reads (coordinate: wheels belong to W2, but blur is yours).
6. **Chase and broadcast cameras** — compare REF_014, 019, 020, 021, 055, 077, 089 with
   `baseline/live-high/chase-*.jpg`. The rider/bike should sit larger and lower in frame, camera
   lower and closer with a longer lens feel; bounded lag; pull-back under acceleration, slight
   forward pitch under braking; partial horizon roll with lean (`BIKE_CHASE_ROLL`); fine
   high-speed vibration. Trackside cameras: long-lens panning shots (REF_027, 030, 031, 032, 038).
   Respect `reducedMotion`.
7. **Lens character** — sun flare/veil when looking toward the sun (REF_046, 056), bloom only on
   true speculars (already thresholded — keep it subtle).

## Done means
Side-by-side capture panels (yours vs the named references) for chase, trackside and one
onboard frame, at High **and** Medium; no regression to F1/motocross/festival renders (prove by
showing the gate, or a before/after F1 frame if you touched shared code); frame cost noted
(draw calls from `metrics.json`; describe added passes and their resolution).
