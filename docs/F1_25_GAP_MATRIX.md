# Gameplay baseline and F1 25 reference gap matrix

This is a truthful, gameplay-observed gap assessment against the *sensory qualities*
of F1 25 (EA/Codemasters, 2025). It is not a reproduction target: no F1 25 code,
mesh, texture, livery, logo, sound, font, HUD artwork or shader is used, traced
or copied. References describe qualities (hierarchy, density, response, timing),
not assets. Status values are **Open**, **Improved** (a real change landed and
was inspected, acceptance still open) and **Measured** (numbers only).

## Baseline identity and method

- Source: `3ebfa690cc7172730da4fe19994ca71775416d26` (compact-HUD fix through
  `3ebfa69`). Local `npm run check`: 1,432 unit cases, ESLint, strict TypeScript
  and production build passed. GitHub run `36741434213` for the same SHA
  concluded **success** (validate, scenarios, all eight browser shards,
  wet-presentation and publish), confirming the compact-HUD fix.
- Capture tool: `scripts/gameplay-baseline.ts`. It opens the production build
  through the ordinary menu (8-car Grand Prix, 3 laps), enables the existing AI
  demonstration for the player car, and cycles the real chase, cockpit, T-cam
  and trackside cameras twice while the race runs. Each view stores a moving
  frame plus the renderer's own counters. Dry/day, heavy rain (wet tyres) and
  clear/night were captured at the **High** preset, 1600×900 viewport.
- Renderer: `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`. This is
  a CPU software rasteriser. Its frame times (about 1–10 FPS) say nothing about
  consumer GPUs and are not reported as performance. Draw calls, triangles,
  textures and geometries are renderer-independent counts and are reported.

## Measured render workload at High (baseline)

| View (sim time) | Draw calls | Triangles | Car LODs (0 near … 2 far) |
|---|---:|---:|---|
| Chase (17 s) | 2,791 | 7.71 M | 0,0,0,1,1,1,2,1 |
| Cockpit (44 s) | 3,768 | 11.78 M | 0,0,0,1,1,1,2,2 |
| T-cam (67 s) | 2,966 | 11.85 M | 0,1,0,2,2,2,2,2 |
| Trackside (84 s) | 3,256 | 9.77 M | 0,0,0,1,2,2,2,2 |
| Chase (107 s) | 2,507 | 7.27 M | 0,1,0,1,2,2,2,2 |
| Cockpit (124 s) | 3,274 | 11.67 M | 0,2,1,2,2,2,2,2 |

Night (floodlit, clear) ranged from 2,356 to 3,935 draw calls and 6.3–11.8 M
triangles over the same camera cycle. The wet run's moving frames were kept, but
its counters were lost when the first harness run stopped on a dialog timeout;
wet workload is re-measured on the candidate instead of being reconstructed.

Render buffer at High was 2000×1125 (1.25× resolution scale) with 4× MSAA.
Resident geometries grew from 2,327 to 2,540 over 160 simulated seconds; this
growth is recorded as a defect candidate until attributed.

**Assessment:** 2,300–3,800 WebGL draw submissions per frame are the main risk
to 1080p/60 on representative hardware. In Chrome/ANGLE each submission costs
CPU time before any GPU work, so this budget is likely CPU-bound on mid-range
PCs regardless of GPU. Per-phase attribution (shadow, mirrors, reflection
probe, environment, main scene) was added to renderer diagnostics as
`drawBreakdown` so reductions can be measured instead of guessed.

## Gap matrix

| Area | F1 25 reference quality | Observed in baseline gameplay | Severity | Status |
|---|---|---|---|---|
| HUD footprint | Small, peripheral clusters: gear/speed/ERS near a lower corner, compact standings, small map; most of the frame is the road | Central 510×135 px instrument slab, full standings, timing and vehicle-state panels and action bar cover roughly a third of a 1600×900 frame in every camera | High | Improved: HUD panels cover 11.0% of a 1600×900 frame (was 18.8%) and 9.4% at 1080p (was 16.2%), measured and bounded below 12% by e2e/49-hud-footprint.spec.ts. Every readout is kept, in a narrower timing tower, a shorter lap clock, a compact telemetry blade and a small car-state block. The tower shows three-letter codes and live race intervals from 10 m timing loops (within 0.03 s of the race's own line-crossing times in a production-simulation test) or best laps in timed sessions. Key hints recede to 30% while driving. Open: the telemetry stays a top-centre band (the tested 27H.6 layout contract), where F1 25 puts it in a lower corner |
| Start sequence | Physical gantry lights over the grid; small HUD echo | Lights drawn as a large central HUD panel over the road | Medium | Improved: the gantry lamps light for real, and the HUD echo is a compact strip (18 px lamps, about half the former panel width) that keeps the road visible. The tested instrument/lights clearances are unchanged |
| Post-processing honesty | Clean image; restrained bloom; no visible grain | Grade pass added unsharp mask (0.26–0.32), film grain (0.022–0.034), lens fringe and 0.30–0.40 vignette; FXAA ran on top of 4× MSAA, softening textures that the sharpen then re-crisped | High | Improved: gameplay grain/fringe/sharpen are zero and tested as zero, vignette ≤ 0.2, FXAA only when MSAA is off. Bloom threshold stays at 3.6 linear (lamps, sun and speculars only); its blur is round, with no box-kernel squares, and limits single-pixel fireflies |
| Specular aliasing | Stable highlights on asphalt, kerbs and bodywork in motion | MSAA covers edges only; normal/bump-mapped highlights can flicker | Medium | Improved: normal-variance specular AA on all physical materials |
| Sun/sky/exposure | Strong directional sun, deep sky, crisp contact shadows, clear aerial perspective | Hazy, low-contrast daylight; pale horizon; flat terrain shading | High | Partly improved: the sky was encoded twice (three's Sky applies a display curve, pow(x, 1/2.4), before the pipeline tone-maps and encodes once more), which flattened the dome to a pale grey haze (saturation at 15° elevation 0.40 instead of 0.71). It now renders the linear Preetham radiance, scaled to the same hemispherical luminance so the sky's environment light is unchanged; sunset keeps a warm horizon under a blue upper sky. Horizon depth is improved by landforms. Open: key/fill balance, contact-shadow strength, and the adaptive-exposure meter (on hardware it targets mid-grey over mostly dark asphalt, so it is likely to sit at its +0.85 EV ceiling; it never completes a sample on software GL, so this is not measured) |
| Grass and terrain | Mown stripes, verge variation, textured run-off, layered distant terrain | Uniform flat green from 10 m onward; smooth featureless hills | High | Improved: greener irrigated turf tone, filtered mown bands parallel to the circuit edge that fade before the apron edge, and a ridged mountain range (up to ~260 m) beyond 1.15 km with slope/elevation scrub and rock shading. The venue datum inside 680 m is unchanged and tested |
| Trees and vegetation | Dense, varied silhouettes and tree lines | Repeated round-crown "lollipop" trees on thin trunks | High | Improved: 1024 px shaded foliage atlas (inner crown mass, lit tops, darker undersides), 15-card crowns, and a separate procedural grove/treeline layer (≈900 clumped broadleaf/conifer trees 90–520 m out plus a broken foothill treeline). Procedural runtime geometry, not Blender-authored A51–A54 assets; those rows stay open |
| Asphalt | Aggregate, rubbered line, patch repairs, painted lines readable at speed | Aggregate and joins exist but read as flat grey beyond ~20 m | Medium | Open |
| Night lighting | Floodlit circuit: racing surface near daylight brightness under a dark sky, crisp multi-source shadows | Track surface dim and blue-grey between lamp pools; cars read as silhouettes | High | Improved: the blue skylight fill no longer outweighs the floodlight key (fill 0.085 vs key 0.30, still below overcast daylight as tested), with a neutral metal-halide key colour; surroundings fall to dark. The bright squares near the player car at night are isolated and fixed. An HDR readback of wet night T-cam frames found single pixels of 250-15,500 linear (the rest of the frame peaks at 25-110): floodlight glints on wheel-rim metal. Three's UnrealBloomPass blurs each mip with a kernel cut off at one sigma, close to a box filter, which turned every glint into nested hard-edged squares. Bloom is now a round-filtered mip pyramid (13-tap downsample, tent upsample). It limits fireflies and drops non-finite values before blurring, so the glints read as small round highlights. Also: mirror feeds render in half-float HDR (8-bit targets clipped floodlit scenery to flat white), and spray puffs dissolve 0.6-3.5 m from the lens. Open: floodlights are point lights, and only the road's water film widens their highlight for the 3.2 × 1.3 m emitter; car metal still shows pinpoint glints |
| Wet track | Mirror-like sky/car reflections, puddles, standing water sheen | Wet road reads as dark matte asphalt; little reflection | High | Improved: planar wet-road reflection. It mirrors cars, sky, floodlights, stands, barriers and terrain about the road under the followed car, into a half-resolution HDR target with an oblique near plane. It is sampled through the existing water-film clearcoat lobe, so the physical wet/puddle masks and Fresnel decide where it shows; it is blurred by film roughness and faded with height and at the frame edge. It costs 230-490 draws (opt-in layer), only while the track is wet, and is off on Low. Puddle geometry and screen-space refinement remain open |
| Spray | Thick, continuous plumes and rooster tails behind every car | Discrete coloured disc sprites; plume does not form | High | Improved: root cause was a 1,200-particle pool recycled in <0.3 s by 8 wet cars. Pool is now 3,600; rear tyres carry 3× the front share (per-car total unchanged); 30% of rear births rise from the diffuser as a rooster tail; larger, fainter puffs overlap into one plume and fade analytically into the road |
| Tyre smoke / launch | Pale grey tyre smoke only on real wheelspin/lock-up | Brown dust-like puffs around the car on the grid launch | Medium | Improved: smoke and dust moved from 120 px-capped GL points to the metre-sized lit quad renderer with ground fading; smoke is neutral grey. Emission still comes only from measured slip work |
| Chase camera | Close, low car-centred framing | Car occupies ~19% of frame width, high camera | Medium | Improved: 1.95 m height / 5.7 m distance rig (was 2.5 / 6.7), 10 m look-ahead; car ~23% of frame width at 1600 px |
| T-cam | Airbox camera: halo and nose dominate, helmet not filling frame | White helmet occupies the lower centre of the frame | Medium | Improved: camera lifted 9 cm above the authored pod socket with a steeper gaze; the helmet crown now sits at the lower edge |
| Cockpit | Halo pillar, wheel display, readable road over the nose | Composition acceptable; interior very dark, road band narrow | Medium | Open (P0 framing gate retained) |
| Trackside signage | Boards printed on the track-facing side | Signs, the start gantry banner and the grandstand fascia were double-sided printed planes, so their lettering read mirrored from behind | Low | Fixed: back faces show a plain backing colour in the same draw (unprintedBack) |
| Grid crews | Team crews in kit around every car on the formation grid, leaving before the lights | Grid staff were capsule bodies with separate cylinder limbs and floating helmets | High | Improved: grid staff use the Blender-authored people asset (the pit crew's body and helmet) in team kit, feet on the grid, facing the car and stepping back as the blankets come off. Open: they hold the asset's standing bind pose; no grid animation, umbrellas or tyre-blanket handling |
| Rival cars | Close rivals approach player-car detail | APX01 rivals are simpler than the supplied player car | Medium | Open (A61) |
| Audio | V6 turbo-hybrid tone, turbo whistle, sharp upshift cut, overrun crackle, kerb/scrub, Doppler passes | Procedural bands exist; not evaluated by ear in this environment | Unknown | Improved: player power-unit layer adds turbo whistle (2.6–8 kHz with boost), straight-cut gear whine (41 Hz per m/s), overrun crackle and upshift/downshift cracks, all from recorded state and unit-tested; not yet judged by ear |
| Draw-call budget | 1080p/60 on mid-range PC | 2.3k–3.8k draw calls at High | High | Improved (see below); rival LOD0 (~93 draws per car) and cockpit mirrors remain the next targets |
| Car performance and AI pace | Physically plausible F1 envelope (about 5 g cornering, 4-5 g braking); rivals brake late and carry corner speed | Car envelope not measured against references; AI cornered at about 50% of the car and braked at 0.87 g, several hundred metres early | High | Improved: acceleration, top speed, braking and lateral limits measured against public F1 figures (fast lateral 4.3 g, peak braking 5.9 g; two figures are 2-3% quick, see [PHYSICS_REFERENCE.md](PHYSICS_REFERENCE.md)). The AI plans with the measured envelope, using a friction-circle velocity profile, wake loss and pedal modulation: dry laps are 9% (Aurel) and 7.5% (Vellamar) quicker, and braking reaches 3.3 g. The AI still uses only 55-72% of the car; closing that gap needs racecraft work |
| Circuits | Many circuits | One (Aurel) | High | Improved: the original Vellamar Coast Circuit (4.00 km, 43 m of climb, banked sweepers, summit hairpin, sea, headland lighthouse, terraced districts) is driven from one circuit definition shared by physics, AI, pit, venue, terrain and minimap. The whole AI field completes clear and changeable races with real wet-tyre stops ([VELLAMAR_CIRCUIT.md](VELLAMAR_CIRCUIT.md)). Only two circuits; Vellamar venue art is procedural and awaits human review |
| Modes | Time Trial with ghosts, qualifying/race weekends, championship, endurance | Grand Prix, Free Practice, Team HQ career layer | High | Improved: Time Trial with a saved per-circuit personal-best ghost and live delta; race weekends (spread-field qualifying sets the race grid); a persistent championship (calendar, 25-18-…-1 points, count-back, saved standings); and endurance (fuel for the distance, mandatory two-compound stop enforced by race control and planned by the AI). All run on the same simulation ([MODES.md](MODES.md)). Not yet: online leaderboards, a custom calendar editor, safety car, or endurance driver swaps |

## Draw-call attribution and first reduction

`drawBreakdown` in the renderer diagnostics attributes every frame's draw
submissions to environment capture, local reflection probe, mirrors, shadow maps
and the composer (main scene plus post). The first attributed capture showed the
**local reflection probe** re-rendering the whole scene into six 128 px cube faces:
about 2,000–2,200 draws on each refresh (every 1.5 s dry, 0.55 s wet), i.e. a
periodic hitch rather than a steady cost. It now omits other cars, people,
particles, debris, grid preparation and small pit kits (the subject car was
already hidden). Mirrors omit spectators, marshals, pit people and small pit
kits but keep rival cars and spray. Near-track tree instancing uses 160 m cells
instead of 80 m.

Same capture method (Mesa software GL, High, 1600×900, dry, AI demonstration):

| View | Baseline candidate (probe unchanged) | After exclusions and coarser cells | Probe share after |
|---|---:|---:|---:|
| Chase | 3,146 | 2,635 | 1,506 |
| Cockpit | 4,854 | 3,674 | 1,466 (mirrors 1,064) |
| T-cam | 2,805 | 2,339 | 1,423 |
| Trackside | 2,766 | 2,046 | 1,425 |

The High preset now renders at native resolution (was 1.25×) with 4× MSAA.
These counts are renderer-independent; GPU/CPU frame times on consumer
hardware remain unmeasured here.

## Evidence retained

- `docs/baseline/gameplay-dry.jpg`, `gameplay-wet.jpg`, `gameplay-night.jpg`:
  resized contact sheets of the captured moving frames (not retouched).
- `docs/baseline/baseline.json`: the counters above plus per-view renderer diagnostics.

Human art review and the Section 146 combined driving scenario remain open and
are not inferred from these captures.
