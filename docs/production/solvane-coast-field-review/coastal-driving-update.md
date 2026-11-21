# Driving Solvane Coast

The photographs in the supplied 100-image reference pack guided three decisions visible from the driver’s seat. The instruments and mirrors have to be readable at speed, roadside objects need to meet the road at the right height, and the distant skyline needs a recognisable shape. The captures below show the original Solvane cars and landscape in the running Three.js game.

![Earlier and updated views of the Harbour Front crossing, the Varda Pass approach, Kestrel control tower and Port Ilse tidal wall](festival-before-after.webp)

On Harbour Front, the zebra bars lead into dropped kerbs with tactile paving. Stop lines, wet cast iron and the crossing paint each share their footprint with the tyre-contact sampler. At Varda, nine bedded rock spurs change the skyline, the road cuts and the ground the car can actually drive on. At Kestrel, the control tower has a glazed, raked cab with eight panes, a wraparound gallery and a recessed ground entrance. Runway 09/27 has a marking at each end, directional threshold lights and touchdown rubber that changes grip with the weather.

## From the cockpit

Each of the ten road cars carries two convex wing mirrors and a flat interior mirror. Their views are rendered from the seated eye through the individual glass planes. The centre display follows the car along the road network and shows the current street and speed limit. The reversing lights follow the selected gear, including when the car is rolling in the opposite direction. The camera follows the sprung car and respects the reduced-motion setting.

![All ten original Solvane road cars, with forward- and reverse-gear close-ups of the hatchback, pickup and supercar](festival-road-cars.webp)

The car plate uses the highest-detail production bodies under one studio light rig. The lower pairs keep the camera fixed and change the gearbox snapshot. The white reverse cells brighten independently of the red brake circuits. The geometry check also covers the intermediate and distant bodies for all ten cars.

![Gameplay captures of the cockpit, Saltmarsh fields, Kestrel runway and Port Ilse harbour](festival-gameplay.webp)

At Saltmarsh, planted rows, cut stubble, headlands and tractor wheelways sit on the same terrain sampled by the wheels. The distant rows follow the same bearings as the individual plants. At Port Ilse, three working launches follow the harbour swell. Each boat swings from its bow eye to a moving buoy on a 3.87 m line. A three-minute test checks both ends, rope length and the pose after seeking backward in time. On the steep quay bank, masonry courses run horizontally from the sea-level datum. The tide band stays damp above the waterline.

## Driving and rendering checks

| Check | Measurement |
| --- | --- |
| Junctions | Drove all 76 directed junction turns, including left and right turns. Each run stayed on the carriageway and cleared its indicator. |
| Traffic cruise | Six minutes per car, repeated with the same seed and 24 ambient vehicles at peak. The RH3 covered 7.23 km in clear weather, the RP6 covered 2.97 km in rain and the SC7 covered 1.74 km in clear weather. Each pair reproduced its movement digest with zero recoveries. |
| Motorcycle cruise | An earlier drive sent the SBK1000 and NR900 wide at the right-angle turn from Chandlers Row onto Market Street. After reserving braking distance before lean-in, the SBK1000, NR900 and SM450 each cleared the junction and rode for four minutes without a fall or reset. Their distances were 4.18, 3.82 and 3.44 km. |
| Road markings | White and yellow road paint fell from 212,270 to 77,694 triangles. Across six paved road classes, more than 200,000 independent probes put the horizontal edge error below 9.5 mm and vertical error below 2.6 mm. |
| Port Ilse lighting | From the Harbour Front starting street on Low, five luminaires keep their full castings and 235 retain their distant silhouette. Across the network this takes 25,600 triangles, down from 123,360 with all castings at full detail. All 240 light sources retain their position. Counts are before camera culling and exclude other lighting. |
| Street ironwork | The town contains 82 access covers and 322 kerb drains. Each uses two surface triangles with engraved relief and a wet response. Placement and tyre overlaps are checked against the actual street geometry. |
| Mirrors | Captured each of the three live reflection textures on Low. The two wing images were 128 × 73 and the interior image was 128 × 28. They contained different, non-blank scene images. |

Across development builds, the event drivers covered **506.34 km** in 158 attempts at 120 simulation steps per second. They returned 156 scored finishes with zero recorded off-route time or recoveries. Two early Port Ilse runs reached the harness’s 530-second ceiling. The same car and weather finished once the ceiling was raised to 850 simulated seconds. Free-roam traffic was measured separately in the table above.

During guardrail packing, changing when the road builders release their buffers reduced the live JavaScript heap and typed-array storage from 129.8 to 95.4 MiB in two Node runs per build. All 609 road meshes and point systems produced the same geometry digest. This measures memory at that construction stage. The renderer still has to upload the finished geometry.

The project’s open-world acceptance command is `npm run test:open-world`. It checks the 74.46 km road network, all 18 event routes, deterministic traffic, free-roam motorcycles and two motorcycle races. The geometry and driving results above are recorded in the [measurement file](coastal-measurements.json).

The before-and-after plate uses matching camera views and daylight settings. The Varda chase views are both 800 × 450. Both tidal-wall images use the same harbour camera and 599 × 337 native capture. The crossing and tower pairs have different native render sizes and are resized for comparison. Scenery details use the inspection camera inside the live session. The cockpit and chase captures use the driving cameras. The rigs ran Chromium with ANGLE SwiftShader. Console-equivalent image quality, sustained hardware frame times and competitive input latency still require a physical target run.
