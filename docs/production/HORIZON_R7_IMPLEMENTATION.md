# Horizon R7 — storefront depth, bonded glazing and slipstream passes

This change develops the original Festival / Solvane Coast mode from `0dd77ce92de69cf4f07cb01a8f44003349eda97c`. It connects the existing aerodynamic wake model to Festival races, adds a manual tow-and-pass challenge, recesses the procedural road cars' glazing, and adds camera-dependent room depth behind the existing building windows.

## Driving: use the tow, then complete a clean pass

Festival race substeps now call the shared `wakeFields` implementation before advancing the cars. Each active entrant receives the existing calibrated drag reduction and downforce wake from the other active cars. The model already accounts for height, heading, speed and spatial overlap. Finished opponents are excluded, and the fields clear when the race ends. This pass does not change the shared aero coefficients.

[`FestivalRacecraft`](../../src/simulation/open-world/racecraft.ts) observes actual post-contact motion and legal route progress. The challenge requires four-wheel cars travelling forward above 20 m/s, loaded front and rear axles, an upright car, and a continuous aerodynamic tow from an eligible rival. Its stages are:

| HUD cue               | Requirement                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| BUILDING THE TOW      | Visible after 0.25 seconds of valid following; the meter measures preparation toward 1.5 seconds.                               |
| SLIPSTREAM READY      | Maintain the run and choose a clear side; the pass has a ten-second completion window.                                          |
| COMPLETE THE PASS     | Spend at least 0.12 seconds alongside with body clearance, then fully clear both bumpers and hold a clean lead for 0.6 seconds. |
| CLEAN SLIPSTREAM PASS | A three-second confirmation names the rival and displays completed passes in this race.                                         |

The Festival contact adapter records every solver touch, including light brushes without visible damage. Contact, route discontinuity, reverse movement, excessive sideways motion, unstable wheels, teleport/reset or invalid height/heading cancels the pending manoeuvre. Each rival can count once per race. A retry starts a fresh challenge; an in-race reset preserves the exclusion for previously completed passes. Turning on autopilot marks the run assisted immediately and disables this challenge for the rest of that run.

In the retained matched force control, the existing model produced 810.905 N of drag in tow versus 906.783 N in clear air, a 10.573% reduction for that specific 45 m/s setup. Separate-deck, opposite-direction and finished-rival controls produced no tow. A scripted full-session pass progressed through following, ready, passing and complete in 8.825 seconds with no contact or reset. These measurements verify the game implementation and reachability; they are not wind-tunnel data or a human playtest. Motorcycles also receive the physical race wake through their existing drag model, with the manual clean-pass challenge remaining car-specific.

This is local race feedback. Existing standings, event stars and career settlement remain the competitive result. The HUD consumes the normal worker status messages; it does not compute aerodynamic forces or manufacture a pass. Its panel clears during pause, map, photo, countdown, results, free roam and assisted driving. Labels, progress and responsive bounds are covered by a browser DOM regression.

To try it, choose **Session → Festival · open world**, enter a road-car race, follow a rival on a sufficiently long straight, and watch for **SLIPSTREAM READY** before moving alongside. Allow room for the car's full length when returning to the racing line.

## Cars: bonded panes with an actual edge

The near and middle Festival body LODs give the glass its own position buffer and move it four millimetres beneath the original body surface. Two continuous bands follow each pane's actual material boundary: a six-millimetre rubber reveal and a twelve-millimetre ceramic border beneath the glass. Shared interior triangle diagonals never become seams. Bounded corner joins and projection onto the curved pane prevent long spikes and floating edges.

The existing transparent glass material still supplies tint and reflections, with the existing cabin visible through the centre. Wipers and rear heater lines follow the revised glass surface. The bands merge into the existing trim and optical material batches. The far LOD and other vehicle families retain their current geometry path.

These construction dimensions are authored choices, not measurements recovered from photographs. The change improves edge separation and attachment; it does not replace the car bodies with scanned models.

Implementation: [`festival-detail.ts`](../../src/rendering/vehicle-bodies/festival-detail.ts) and [`closed-body.ts`](../../src/rendering/vehicle-bodies/closed-body.ts).

## Streets: room depth behind existing windows

[`facade-interiors.ts`](../../src/rendering/open-world/facade-interiors.ts) expresses the view ray in each pane's local frame, derived from its UV and view-position derivatives. Its analytic room box therefore retains metre-scaled depth on rotated walls and differently sized openings. A back wall, floor, ceiling and two bounded furniture volumes provide parallax and occlusion when the camera moves. Shop shelves use filtered carton/bottle silhouettes, mixed colours, variable heights and occasional empty slots. Residential rooms use a sofa, table and framed wall panel.

Some bays remain frosted or curtained. Only occupied rooms receive the room-light treatment, with discrete ceiling lights and warm/cool variation. The glass contribution increases toward glancing views, while dark frames and the real inset wall reveals retain their separation. Fine shelf/floor details filter out with screen size. Room depth fades from 80 to 130 metres; beyond that range the existing distant pane treatment is used.

The final image review caught a scanline artifact caused by hashing an interpolated room seed. Quantizing that seed before product selection removes the spurious stripes; the final five-view capture uses the corrected shader.

All of this runs in the existing merged building material. There are no room meshes, added textures, point lights or render passes. The rooms are a facade rendering illusion and are not enterable spaces. Their shading is designed for the current game material/light system; it is not a ray-traced indoor lighting simulation.

## Original 100-image review

The [new individual reference record](HORIZON_R7_REFERENCE_REVIEW.json) retains every image ID, compressed image hash, observation and relationship to this pass. The original 27,428,348-byte review archive was recovered. All 100 compressed JPGs matched both its manifest and the existing R4 ledger, with no missing IDs or hash mismatches. All 100 images were freshly viewed in ten labelled contact sheets; nine were also opened at their full available 1920 × 1080 resolution.

| Reference IDs               | Observed cue and selective transfer                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 023, 074                    | Separate reflective glass, bonded dark borders and visible cabin/parcel-shelf detail guide the car glazing treatment.                                  |
| 014, 038                    | Visible ceiling/back-wall planes, recessed commercial displays and darker spaces beneath awnings guide room depth and occlusion.                       |
| 080–083                     | Shelves at different depths, ceiling lights, dark dividers and frosted neighbouring shop bays guide storefront variation and restrained lighting.      |
| 044–045, 049, 053, 071, 078 | Close multi-car compositions inform the emphasis on readable racing interactions; the stills do not establish aerodynamic forces or driving behaviour. |

The original photographs remain reference inputs. The complete review is not a claim that every photographed scene was reproduced, or that this game matches commercial Forza image quality.

## Reproduction and evidence

The [R7 validation record](HORIZON_R7_VALIDATION.json) records executed gates, source hashes, raw report paths and remaining limits. Isolated car comparisons freeze one source snapshot and substitute exactly the two original vehicle modules for the baseline. Storefront comparisons render depth off/on/off with the same geometry, lighting and camera, checking exact repeated-control pixels and unchanged resource counts. The driving journey uses the real Festival session, worker, controls and renderer.

### Retained visual comparisons

These are rendered views of this repository's production geometry and materials. The facade comparisons toggle only room depth; the car comparisons replace only the two identified vehicle modules. They are isolated diagnostic views with fixed lighting, rather than whole-world gameplay screenshots.

| View                  | Before                                                             | After                                                                                       |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Daytime shop window   | [Depth off](horizon-r7-evidence/rooms/day-front-before.png)        | [Depth on](horizon-r7-evidence/rooms/day-front-after.png)                                   |
| Nighttime shop window | [Depth off](horizon-r7-evidence/rooms/night-front-before.png)      | [Depth on](horizon-r7-evidence/rooms/night-front-after.png)                                 |
| RH3 side glazing      | [Original](horizon-r7-evidence/vehicles/before-rh3-side-glass.png) | [Bonded perimeter](horizon-r7-evidence/vehicles/after-rh3-side-glass.png)                   |
| RH3 windscreen        | [Original](horizon-r7-evidence/vehicles/before-rh3-windscreen.png) | [Recessed pane](horizon-r7-evidence/vehicles/after-rh3-windscreen.png)                      |
| SC7 rear glazing      | [Original](horizon-r7-evidence/vehicles/before-sc7-rear-glass.png) | [Bonded perimeter and heater traces](horizon-r7-evidence/vehicles/after-sc7-rear-glass.png) |

The complete [room report](horizon-r7-evidence/rooms/review.json) contains five views; the [vehicle report](horizon-r7-evidence/vehicles/review.json) contains four paired views. Every repeated control frame is pixel-identical. Room depth adds no draws, triangles, textures or geometry resources. The car change adds 1,864 visible near-LOD triangles for RH3 and 1,192 for SC7 in these views, while draw calls, materials and texture counts remain unchanged. Those resource counts do not measure shader execution cost or hardware frame rate.

```bash
npm ci
npm run build
npm run lint
npm run validate:content
npx vitest run tests/festival-racecraft.test.ts tests/festival-vehicle-glazing.test.ts --maxWorkers=1
node --experimental-transform-types scripts/horizon-r7-racecraft-review.mjs
HORIZON_REVIEW_PORT=5188 node scripts/solvane-review-server.mjs
```

With the local server running and Playwright Chromium installed:

```bash
node --experimental-transform-types scripts/horizon-r7-room-review.mjs
HORIZON_R7_VEHICLE_BASELINE_REF=0dd77ce92de69cf4f07cb01a8f44003349eda97c \
  node --experimental-transform-types scripts/horizon-r7-vehicle-review.mjs
HORIZON_REVIEW_URL=http://127.0.0.1:5188 HORIZON_REVIEW_QUALITY=low \
  node --experimental-transform-types scripts/horizon-browser-review.mjs
```

Browser captures use a declared software graphics backend. They establish rendered behaviour and bounded resource counts, not physical-device frame rate. Human judgement of driving enjoyment and long-session hardware profiling remain separate acceptance work. The wider world still has repeated architecture and simplified forms; these changes address specific depth and race-interaction gaps.
