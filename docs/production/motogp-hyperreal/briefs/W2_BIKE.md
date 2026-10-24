# W2 — The motorcycle: form, materials and the onboard view (worker id: w2-bike)

Read `BRIEF_COMMON.md` first (same folder). This is your workstream.

## Mission
Make GP-R1/GP-R2 look like real carbon-and-paint prototype race machines with mass and
mechanical depth, not a smooth toy. Then make the onboard view look like REF_017/074/088.

## You own
`src/rendering/bike.ts` (GP paths; it also hosts the onboard camera socket/FOV for bikes),
`bike-cockpit.ts`, `bike-livery.ts`, `bike-surface-detail.ts`, `bike-sheet.ts`, `paint-finish.ts`
(GP-gated) and the bike parts: `gp-race-bodywork.ts`, `gp-race-shell.ts`, `gp-r3-*.ts`,
`gp-appearance.ts`, `gp-forged-wheel.ts`, `gp-tyre-finish.ts`, `gp-tyre-contacts.ts`,
`gp-brake-*.ts`, `gp-radial-caliper.ts`, `gp-front-*.ts`, `gp-fork-crown.ts`, `gp-main-frame.ts`,
`gp-rear-chassis.ts`, `gp-rearsets.ts`, `gp-chain-drive.ts`, `gp-radiator.ts`, `gp-disc-glow.ts`,
plus their tests. **Not yours**: anything `gp-rider-*` / `rider.ts` (W3), renderer post/cameras
other than the bike onboard socket (W1), simulation (W4).

## Targets (open these references full-size)
1. **Form & layering** — REF_018 (side), REF_028, 047 (front three-quarter), REF_046, REF_022,
   REF_056/REF_060 (PS5 detail crops), REF_086, REF_073. Compare with
   `docs/production/motogp-race-shell/track-entrant-white.jpg`: our side view is one slab. Real
   bikes read as **overlapping moulded panels with shadow gaps**: upper fairing, side panel with
   duct exits, deep lower/belly with ground-effect scoop, and through the gaps the dark
   aluminium frame spar, engine cases and radiator. The tail is high, narrow and sculpted with
   a seat hump; the screen is a tall smoked bubble. Fix proportions where they're off (the rider
   must look big on the bike as in REF_018 — check seat height/tank length with W3's rider in mind).
2. **Materials** — the biggest single cartoon tell.
   - Paint: true clearcoat (`MeshPhysicalMaterial`, clearcoat ≈1, low clearcoat roughness),
     faint orange-peel normal, reflections of sky/environment visible; satin and matte zones
     from the finish atlas; decals sit *under* clearcoat.
   - Carbon: 2×2 twill weave (normal + roughness + subtle anisotropic sheen), clearcoated on
     visible covers (REF_056 tank cover, REF_073), raw/matte on structural parts.
   - Metals: brushed/anodised aluminium frame and swingarm, titanium exhaust with blue/gold heat
     tint toward the headers, gold/black fork tubes with hard-anodised sliders, steel/carbon discs
     (large 340–355 mm, ventilated) with **heat glow under heavy braking** (`gp-disc-glow.ts`).
   - Tyres: slick rubber with a scuffed band on the shoulders whose width follows lean,
     sidewall lettering and a compound colour stripe (fictional brand), black forged rims with
     machined edges (REF_003, 018, 046, 096 detail crop).
3. **Livery** — sponsor density, typography hierarchy and sharpness close to REF_001/006/018/056
   (fictional brands only). Check mip/anisotropy so decals stay crisp at grazing angles.
4. **Onboard view** — compare REF_017, 050, 061, 074, 076, 088 with
   `baseline/live-high/cockpit-*.jpg`. Remove the giant gold toy fork caps from the
   camera's face. Camera socket low behind the screen at rider-eye level when tucked; visible:
   inner carbon upper fairing and screen edge, a realistic TFT dash (rev-light bar, small gear
   digit, mode readouts), top yoke with *small* fork caps/adjusters, clip-ons and levers.
   The rider's gloves on the grips belong to W3 — keep them unoccluded and mention the socket
   position in your report. FOV and lens math for the onboard socket is yours; W1 does blur/grade.
5. **Mechanical life** — fork/shock compression from FORK/SHOCK frame values must be visible;
   chain and sprockets move; brake disc glow follows brake energy.

## Constraints
High LOD ≤110k triangles, ≤220 draw calls per bike (`tests/gp-race-shell.test.ts`, LOD tests in
`e2e/41-motogp-reference.spec.ts`); clearance test against the steering assembly must still pass.
Use the isolated studio (`e2e/fixtures/motogp-reference-review.ts`) for side/front/three-quarter
before/after shots and the live capture for the onboard.
