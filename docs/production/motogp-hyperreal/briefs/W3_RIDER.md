# W3 — The rider: anatomy, kit and riding body language (worker id: w3-rider)

Read `BRIEF_COMMON.md` first (same folder). This is your workstream.

## Mission
The rider is the most human element in every reference frame and currently the most
doll-like part of ours. Make him an athlete in race leathers who *rides* the bike.

## You own
`src/rendering/rider.ts`, all `src/rendering/gp-rider-*.ts` (garment, gear, glove, motion,
spine, suit, contact) and their tests (`tests/*rider*`, `e2e/gp-rider-*.spec.ts`). You may add
new `src/rendering/gp-rider-*.ts` files. **Not yours**: bike geometry (W2), cameras/post (W1),
simulation (W4). Rider-driving inputs come from the frame (`B.LEAN`, `B.STEER`, `B.RIDER_OFFSET`,
`B.RIDER_X/Y/Z`, `B.TUCK`, `B.PITCH`, `B.FORK`, `F.BRAKE`, `F.THROTTLE`, `F.SPEED`, …). You may read
any of them; if you need a new simulated quantity, compute it render-side from existing
fields (deterministically) rather than editing the simulation.

## Targets (open these references full-size)
1. **Anatomy & scale** — REF_018 (side), REF_056 (PS5 crop), REF_003, 014, 052, 095.
   Adult ~1.72 m, ~68 kg in leathers: broad shoulders + aero back hump, solid thighs and calves,
   forearms that taper to the wrist, real hands (fingers, knuckle armour) — not tubes and
   spheres. Helmet: elongated race shell (not a ball), proportionate to the shoulders, chin bar,
   dark iridium visor that reflects the environment, rear spoiler and vents, glossy paint.
   Compare `docs/production/motogp-race-shell/live-medium-chase.jpg` and
   `after-gpr1-three-quarter.jpg` to see the current toy proportions.
2. **Kit materials** — leathers with panel seams and stitching, perforated zones, accordion
   stretch panels at knees/back/shoulders, knee sliders, elbow sliders, shoulder cups, back
   protector hump; fabric creases where the body bends (normal maps driven by joint angle if
   affordable); leather sheen (MeshPhysical sheen or tuned clearcoat), matte textile panels;
   boots with toe sliders; gloves with carbon knuckles. Fictional brands only.
3. **Riding postures** (all driven by frame state, smoothed with a spring-damper so the body has mass):
   - Straight, high speed: **full tuck** — chin on the tank behind the screen, elbows in, back
     flat, toes on pegs (REF_002, 019, 046, 055, 085).
   - Hard braking: sits up out of the bubble, torso upright, arms braced, head up, body slides
     back on the seat (REF_016, 052, 089).
   - Corner: **hang-off** — hips off the seat to the inside, inside knee out and down so the
     slider skims the asphalt near max lean, inside elbow out and low (REF_003, 004, 030, 031,
     056, 060), head turned and tilted toward the apex, outside knee locked into the tank,
     outside foot on the ball of the peg.
   - Exit: weight forward over the tank as throttle opens (anti-wheelie).
   - Side-to-side flick: hips cross the seat with the right timing (lead the lean).
   - Standstill / grid: **feet down** on the tarmac, upright (REF_014, 052).
   - Knee/elbow slider contact must not penetrate the road; reuse the existing contact helpers.
4. **Onboard** — the rider's gloves on the grips must be visible in the onboard camera
   (REF_074, 088); his head/torso must not intrude into the lens (existing self-culling contract
   in `bike-cockpit.ts`/`gp-rider-contact.ts`). W2 will report the onboard socket position.

## Constraints
Keep total GP bike+rider high LOD within the 110k triangle / 220 draw-call budget
(`e2e/gp-rider-contact.spec.ts` pins totals — update them deliberately). Mid/far LODs must stay
cheap. Studio before/after shots (`e2e/fixtures/motogp-reference-review.ts`, `captureBike`
and `captureBikeSequence` for posture sequences) plus a live chase capture.
