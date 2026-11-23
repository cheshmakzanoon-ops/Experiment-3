# Valley Ridge and Arena Nord motocross review

The outdoor motocross and indoor supercross modes use the same dirt that the player and rival tyres sample. This pass gives each authored berm two banked lines, a compressed bed and an outer lip. Live rut depth and packing blend under the width of each tyre, including across the lap seam. The chassis contact shadow rests on the local slope or the metal starting pad and fades as the bike clears the ground.

![MX250 brake rotor and MX450 goggles before and after the geometry and material changes](factory-detail.jpg)

The front and rear brake carriers have open arms, staggered cooling slots and a visibly swept pad track. Both rear suspensions have a working rocker and pull rods. The hydraulic hose flexes with the swingarm. The two-stroke MX250 also emits a short exhaust trail from the silencer. A fitted lens reveals the MX450 rider's eyes, the knee guard follows the bend of the leg, and the rider loads the outside peg through a supported turn.

![Eight-rider gates in both venues, with a controlled comparison of prepared and wet Valley Ridge soil](venues-and-surface.jpg)

Valley Ridge gained continuous berm banners, worn crew areas and service tracks in the pasture. Arena Nord's LED displays keep their brightness across small camera movements. The seating, trackside fixtures and replay camera sites share a boundary measured from the full rideable run-off. At the previously intersecting rider position, the inner stadium wall is now 6.41 m away. The nearest chair vertex is 6.77 m away across all 18,408 installed seats.

## Recorded riding motion

![MX250 rider and suspension replaying the Valley Ridge whoops in a fixed side view](rhythm-section.webp)

The side view replays three seconds of a Valley Ridge MX250 run, sampled at 20 Hz from the 120 Hz simulation. It covers course stations 527–565 m. The studio camera follows the bike and the inspection floor represents the local ground height. The recording supplies the chassis pitch and clearance, axle travel, wheel rotation, throttle, steering and rider pose. Twenty-six of the 60 samples are airborne.

## Checks

| Check | Observation |
| --- | --- |
| Riding, graphics and adjacent regression suites | 1,000 tests passed across 100 files. |
| Three-bike jump calibration | All 20 jump runs landed within their acceptance bands. |
| Off-road event regression | All 11 race scenarios passed, including the wet outdoor moto and enclosed supercross. |
| Six-lap replay | Three seeds × two weather conditions × two venues, each run twice with eight riders. All 192 rider entries finished. Each pair matched on finish tick, the sampled riding trace and final terrain. |
| Ridden Sport handling | The actual player contact and flight solver completed two laps of each venue with the course planner supplying ground controls. Both runs met the existing zero-fall and under-one-second stall criteria. |
| High-detail WebGL inspection | The complete MX250 model contained 139,879 triangles and the MX450 contained 138,239. Both brake close-ups reported zero WebGL errors. Returning to the initial front-wheel angle restored the initial pixel hash. |
| Outdoor wet-ground replay | Both riding and venue cameras restored the exact dry image after rewind. Holding the wet state produced the same wet image twice. The 1280 × 800 renders kept stable geometry, texture and shader-program counts. |

During 120 racing seconds per venue on a shared Intel Xeon Platinum 8573C, 95% of physics steps took at most 1.50 ms outdoors and 1.43 ms indoors. This CPU measurement covers the eight-rider simulation. The browser's render loop and display latency need separate measurements. [Timing samples](physics-step-timing.json)

The gate images are from the ordinary race menu at Low quality. The model and soil inspections use High detail in controlled lighting. Browser rendering used Chromium and SwiftShader. A PS5 or comparable physical GPU still needs a frame-time and visual comparison before assigning a console performance rating.

[Jump calibration](../../offroad-calibration.json) · [Race reports](../../offroad-races.json) · [Six-lap traces](six-lap-verification.json)

Run `npm run test:offroad` for the project's calibration and race checks. Run the following command from the repository root to replay one pair and compare it with the included receipt. Omit the three arguments to replay all 12 pairs.

```sh
node --experimental-transform-types docs/production/motocross-racecraft-20261123/check-replay.mjs 61343 clear arena-nord-sx
```
