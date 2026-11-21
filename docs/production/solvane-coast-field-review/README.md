# Solvane Coast Festival field review

The starting build for these comparisons was `6a37db8950ea1f20d7a90ff4915cb79f4629c510`. The 100 supplied reference images guided the proportions of the road cars, the visibility of the route at speed, the harbour streets and the layering of the landscape. All the geometry, liveries and scenery shown here belong to the original Solvane setting.

## Through the harbour

The two columns use the same cameras. Street trees have matching trunk collision, gratings follow the banked footways, and shops have double-sided projecting signs. At an event the driver can see through the start area. The timing board stands off the road.

![Matched chase and street views in Port Ilse](port-ilse.jpg)

## The wet mountain approach

The builds are `6a37db8` and `a2cab68`. Both frames use the SC-7 chase camera on arrival at the Varda Pass speed zone, 800 × 450 in Low, with the same rain and sunset presets. The replacement for the bright start ring is visible on the right shoulder. Distant tree crowns now follow the near forest. The improved slope lighting keeps the road and hillside distinguishable.

![Same-camera comparison of the SC-7 in rain on Varda Pass](varda-pass.jpg)

## The ten road cars

The RH-3 hatch gained recessed rear glass, an overhanging visor and a roof brake lamp. Raised lower bumpers and reshaped rockers carry the side contour around the rear of each car. The modern noses have recessed intake liners, cooling fins and brake ducts. The SC-7 now has a painted join between its bonnet insert and windscreen. The classic cars retain their distinct chrome bumpers.

![Matched studio views of the hatch, sports car and vintage sports car](road-cars.jpg)

![Front and rear views of all ten Festival road cars](fleet.jpg)

The sum of triangles submitted in **ten individual garage captures** fell from **1,327,825 to 1,242,463**, a 6.43% reduction. The RH-3 fell from 143,821 triangles and 71 draws to 128,263 and 69. The RG-63 fell from 120,005 to 102,381 with the same 66 draws. The RP-6 gained 92 triangles. At racing distance a separate caliper mesh keeps the cast silhouette with at most 500 triangles per wheel, down from 1,104. The per-car counts are in the measurements file.

## Headland and valley

Port Ilse has a stone lighthouse shaft, keeper’s gallery and rotating, paired Fresnel lights. The gallery stills show the same camera at two points in the 16-second revolution. The four valley farms have sliding carriage doors, high working windows and ridge vents. Two farms also have grain elevators.

The Ashvale river now carries ripples in the direction of the channel. Its surface normal follows the downhill grade, its flow slows near the banks and the current eases into the flat tidal reach. The river comparison uses the same valley segment, lighting and camera. Replaying the same time produced the same image bytes.

![Fixed component views of the farms, headland lantern and river material](headland-and-valley.jpg)

[Watch the harbour pennant and rotating lighthouse optic in motion (8 seconds)](harbour-motion.mp4)

The landmark images use production meshes in an isolated daylight or night setup. The river uses the production terrain height field and water mesh with a neutral bank material. The Port Ilse streets and the session images below are full gameplay captures.

Terrain material buffers now use 62.5% fewer bytes for the rock, soil, sand, snow and land-cover weights. The Low terrain streamer used 27,697,056 bytes for these attributes at Varda Pass before the change and 10,386,396 after. Ashvale went from 27,984,096 to 10,494,036 bytes. Both locations produced identical vertex positions and triangle indices. In matched, 800 × 450 terrain-only frames, 8 of 360,000 Varda pixels differed by more than one 8-bit colour step. The largest difference was two steps. Every Ashvale pixel stayed within one step. These figures measure the terrain attributes and their image effect. Total GPU memory and frame times require a separate measurement.

## Driving

| Assisted run | Cars and conditions | Outcome |
| --- | --- | --- |
| Valley Sprint | All ten road cars, clear and rain, four entrants | All 20 finished |
| Port Ilse Loop and Coast-to-Summit | RH-3, SC-7 and RP-6, rain, six entrants | All six finished |
| Coast speed trap and Varda speed zone | RH-3 and SC-7, clear and rain, with traffic | All eight produced valid scores |

The 26 races recorded zero player or rival resets and zero seconds off course. Valley Sprint used seed 41271, the six-entrant races used seed 73021 and the speed and drift diagnostics used seed 713225. Some six-car runs recorded light contact. In separate drift diagnostics, the RM-8 scored 26 points on the dry hairpin. Some assisted attempts returned zero points and the SC-7 left the hairpin zone under aggressive slide control. The original wet quarry run missed the gate because the RM-8 struggled to start uphill on loose ground. The revised run-up crossed the same gate in 27.5 seconds. Both automated driving styles subsequently timed out on the wet quarry climb, with 15 reset presses apiece. Drift control and wet uphill recovery remain open items.

Tyre response at the edge of rural asphalt uses the share of the steered tread on pavement, paint and gravel. This affects wet grip, rolling resistance and the tyre’s response to loose ground. Each wheel leaves a continuous skid ribbon at its own tread width and contact height, including on banked roads and elevated decks.

A wet four-car Valley Sprint replay fed the same recorded SC-7 controls to the production 120 Hz stepper, with clock updates arriving at 30, 60 and 144 Hz. Each run finished in 82.10 seconds. All 110 once-per-second snapshots matched byte for byte across the three runs, including the rivals. Render throughput was outside the scope of this clock test.

![Production session showing the map, photo mode, an active race and the result](festival-session.jpg)

A published Chromium run at `2782f81f` completed all 12 driving-session checks. Keyboard input moved the car 57.38 m and slowed it from 65.63 to 0.54 km/h. The same run exercised map travel, photo orbit, garage changes, live rivals, an assisted race finish, retry and exit. Its water, dust, smoke and night-light reviews all passed. The run used Mesa software rendering at 960 × 540 in Low. Console and competition frame times still require measurements on the target hardware.

[Browser run and downloadable captures](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44851763841) · [Per-car and per-event measurements](measurements.json)
