# Valley Ridge and Arena Nord

The changes in this review cover the two motocross venues, the MX250 and the MX450. The supplied 100-photo reference pack guided the shape of the protective equipment, the exposed earth on jump faces, the trackside fabric and the way dust catches the stadium lights. The images below come from the game's own Three.js models, materials and cameras.

![Valley Ridge and Arena Nord production race cameras](race-cameras.jpg)

## Track and atmosphere

Valley Ridge's raised jump flanks and outer berms now expose the graded earth used to build them. The tyres encounter hardpack there. The legal racing corridor retains its original boundaries. At Arena Nord, graded clay covers the apron around the racing lanes and takes the same overhead light as the rest of the floor.

![Matched views of the outdoor jump and indoor apron](venue-surfaces.jpg)

Tall amber and short pale markers distinguish takeoffs from landings. A ray survey placed all 40 markers within 2 mm of the rendered ground and checked the intended embed of all 404 perimeter blades. Tape follows the actual mounting points and sags between them. Single-ply banners have rolled eyelets, pole lashings, a reinforced hem and a paler reverse print.

The arena's 20 visible light shafts share one draw. Each samples the rear-wheel loading, slip, direction, speed and measured soil moisture of riders crossing its pool. A dry spinning tyre brightens the lower shaft behind the bike. A saturated or airborne tyre contributes no airborne soil. The same recorded input restores the same lighting after a seek.

The eight Valley Ridge service vans sit on flattened tyre contact patches. Each pressed-steel wheel has six open vents, a recessed drum and five lugs. The survey checks 32 tyre contacts against the rendered paddock surface within 2 mm. All eight vans share one material draw. Indexing the assembly reduced its geometry buffers from 938,552 to 368,600 bytes while retaining the same pixels in the full van, wheel and ground-contact views.

![Trackside cloth fittings, a floodlit dust wake and a service van wheel](trackside-light.jpg)

## Bikes and riders

The downshift guard accounts for rear-tyre regrip speed. A rider can still shift up under wheelspin. Successful gear changes drive the selector and left boot from the recorded simulation stroke. A refused request leaves them at rest. Downshifting moves the forefoot over the selector around the loaded peg. The right foot continues to follow its own brake input.

If another rider ends up travelling backwards along the verge, the marshal waits for space and for an approaching hairpin to clear before helping the rider turn. The bike rotates through the push and remount. Riders who have taken the chequered flag ease down the straights and roll the next jump while the rest of the field races.

At the handlebars, the brake hose leaves a bolted eye and crimp on the right master cylinder. Its upper and lower sections meet at the same position and tangent as the fork moves. The clutch cable on the left exits through its adjuster ferrule. Across 288 combinations of steering angle, fork height and detail level, the measured brake-hose join stayed within 0.001 mm and 0.08 degrees. In the close-up model, the maximum distance between the drawn tube and its designed centreline fell from 3.19 to 0.96 mm on the brake and from 2.38 to 0.79 mm on the clutch.

![Earlier and updated brake and clutch connections on the MX450](handlebar-controls.jpg)

The boot has an articulated ankle brace, heel counter, wraparound toe bumper and an instep protector on the gear side. Narrow seams follow their physical width. The complete High-detail MX250 and rider use 139,851 triangles. The MX450 and rider use 138,211. Both fit the existing 140,000-triangle limit.

![Production race boot and gear-selector motion](rider-equipment.jpg)

The MX450 downshift below follows 33 consecutive 120 Hz simulation samples. Playback is at one-quarter speed.

![Slow-motion MX450 downshift showing the boot clearing and pressing the gear selector](gear-selector.webp)

On the MX250 and MX450, a locked wheel keeps its spokes sharp while the other wheel can remain blurred. The spoke material now keeps neighbouring fragments available through lighting before it discards near-transparent pixels. The old ordering made a held close-up change by up to three RGB levels at the same two screen pixels. All four independent brake-lock, reverse and rewind image checks now reproduce the same held pixels.

At Ridge Table, the MX450 spent 1.10 seconds between its first sampled airborne frame and touchdown. The simulation recorded a 4.22 m/s impact speed normal to the landing surface. This trackside replay follows 56 consecutive 30 Hz snapshots from the 120 Hz race simulation at half speed. The readout shows fork and rear suspension travel in millimetres.

![Half-speed MX450 takeoff and landing at Ridge Table with measured suspension travel](ridge-table-landing.webp)

## What the cameras submit

These are triangles issued in controlled draws. The two sides of each comparison use the same camera, mesh population and output size. The terrace rows isolate 128 spectators. The arena rows cover the venue scene. The forest row isolates the fallback tree belt.

| Scene or view | Earlier | Updated | Verification |
| --- | ---: | ---: | --- |
| Valley Ridge terrace, near detail transition | 1,019,392 | 580,140 | Identical colour pixels, two draws |
| Valley Ridge terrace, middle detail transition | 260,096 | 127,696 | Identical colour pixels, two draws |
| Arena Nord start | 1,038,501 | 899,109 | 72 draws |
| Arena Nord berm | 1,071,913 | 961,929 | 95 draws |
| Arena Nord approach | 1,073,971 | 953,299 | 83 draws |
| Arena Nord wide bowl | 1,074,949 | 1,080,133 | 97 draws, now includes chair pedestals |
| Valley Ridge Barn Double tree belt | 156,684 | 83,292 | Eight draws reduced to four |

All 18,408 arena seats now have pedestals. The renderer can skip sections beyond each camera's frustum, including on camera cuts. Four views rendered identically to the new fully populated bowl. On the outdoor terraces, each pass retains the original guest's seat, garment and skin tone. A single volumetric sculpt casts each visible guest's shadow during a detail transition. The closest photographic trees retain detail as the broadcast lens zooms in.

When a dry, stationary race view is late, the renderer reserves more frames for the rider before updating another face of its local reflection cube. The previous cube stays available during the refresh. Movement, a camera cut or a change in the scenery can still request fresh reflections.

## Race verification

The focused suite passed all 957 checks across 97 files, including 916 motocross checks, 35 reflection checks and six spoke-exposure checks. The off-road calibration passed all 20 jump cases and all 11 race scenarios. In the seeded eight-rider races, Valley Ridge recorded one crash and Arena Nord recorded three. Both fields finished with no retirements. The replay-cadence check made 1,520 matrix comparisons per bike and venue pairing, 6,080 total, with zero matrix-element difference.

Three prepared eight-rider camera cuts took 0.77, 0.87 and 0.95 ms for the CPU pose update on the test host. The figure excludes scene preparation and GPU drawing.

The eight-rider gameplay checks completed both venues at 1280 × 800 on Low and High, and at 960 × 600 on High. The gallery uses the 1280 × 800 High captures. The standard 45-second screenshot window expired on High at the larger size. An isolated run completed both venues on SwiftShader with a 180-second screenshot window. The race captures use the production menu, worker, gate, manual controls and race cameras. The isolated before-and-after images use deterministic camera positions for comparison. GPU timings from software rendering cannot establish a console frame rate.

### Twelve-rider races

Both bike classes raced together over a scheduled two laps. All 96 entrants were classified. Across eight races, the simulation recorded 17 falls and the longest stop was 16.01 seconds. Rain was outside the roof at Arena Nord. The [per-rider report](full-grid-results.json) contains finishes, crashes, recoveries and measured rut depth.

| Venue | Weather | Seeds | Classified | Falls | Longest stop |
| --- | --- | --- | ---: | ---: | ---: |
| Valley Ridge | Clear | 60704, 60705 | 24 / 24 | 2 | 10.86 s |
| Valley Ridge | Rain | 60709, 60710 | 24 / 24 | 1 | 15.58 s |
| Arena Nord | Clear | 60724, 60725 | 24 / 24 | 5 | 11.29 s |
| Arena Nord | Rain | 60729, 60730 | 24 / 24 | 9 | 16.01 s |

### Reproduce the checks

Run these commands at the repository root after `npm ci`. The full-grid run writes its per-entrant finish times, incidents, terrain measurements and failures to `test-results/motocross-full-grid.json`.

```sh
npx vitest run tests/motocross tests/reflections.test.ts tests/road-wheel-exposure.test.ts --maxWorkers=2
npm run test:offroad
node --experimental-transform-types scripts/offroad-races.ts --mx-full-grid
npx vite-node --script scripts/bench/motocross-field.ts --cadence
npm run build
npm run check:bundle
npx playwright test --config=playwright.motocross.config.ts e2e/42-motocross-bike.spec.ts e2e/47-motocross-trackside-models.spec.ts --workers=1
APEX_MOTOCROSS_JOURNEY_QUALITY=high npx playwright test --config=playwright.motocross.config.ts e2e/45-motocross-gameplay.spec.ts
```
