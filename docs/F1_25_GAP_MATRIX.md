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
| Sun/sky/exposure | Strong directional sun, deep sky, crisp contact shadows, clear aerial perspective | Hazy, low-contrast daylight; pale horizon; flat terrain shading | High | Partly improved: the sky was encoded twice (three's Sky applies a display curve, pow(x, 1/2.4), before the pipeline tone-maps and encodes once more), which flattened the dome to a pale grey haze (saturation at 15° elevation 0.40 instead of 0.71). It now renders the linear Preetham radiance, scaled to the same hemispherical luminance so the sky's environment light is unchanged; sunset keeps a warm horizon under a blue upper sky. Horizon depth is improved by landforms. Sun shadows now reach the whole circuit: beyond the 76 m car-following map, a static map of the circuit and 150 m around it (2048², 0.76 m per texel on Aurel) carries the shadows of stands, buildings, barriers and every tree, groves and treelines included, so sunset shadows (the sun is 6° up, so a 10 m tree casts about 94 m) no longer end at the edge of the moving box. It is baked once per lighting or quality change (about 750 draws, then none per frame), leaves out cars, people and particles, and hands over to the near map over its outer 8%; each lit pixel reads it with four taps. It holds about 34 MB (2048² colour and depth targets). Open: key/fill balance, contact-shadow strength, and the adaptive-exposure meter (on hardware it targets mid-grey over mostly dark asphalt, so it is likely to sit at its +0.85 EV ceiling; it never completes a sample on software GL, so this is not measured) |
| Grass and terrain | Mown stripes, verge variation, textured run-off, layered distant terrain | Uniform flat green from 10 m onward; smooth featureless hills | High | Improved: greener irrigated turf tone, filtered mown bands parallel to the circuit edge that fade before the apron edge, and a ridged mountain range (up to ~260 m) beyond 1.15 km with slope/elevation scrub and rock shading. The venue datum inside 680 m is unchanged and tested |
| Trees and vegetation | Dense, varied silhouettes and tree lines | Repeated round-crown "lollipop" trees on thin trunks | High | Improved: the foliage atlas is rebuilt from leaf clumps grouped into lobes, with gaps that show limbs forking from one trunk and ragged leaf fringes, plus a tiered, needled conifer for narrow placements (groves, cypress and upright zones). Every crown card carries its centre, so the vertex shader shapes each tree from a hash of its position: crown base (conifers foliated to the ground, broadleaf crowns low on the trunk, open crowns on a clear trunk), uneven lobes and a crown offset. Inner clump cards show a window of the crown, not a miniature tree, and fade along the leaves; crown occlusion darkens undersides and interiors; five summer-green tints. Colour, depth and point-shadow passes share the shaping; no extra draws or buffers. Procedural runtime geometry, not Blender-authored A51–A54 assets; those rows stay open |
| Asphalt | Aggregate, rubbered line, patch repairs, painted lines readable at speed | Aggregate and joins exist but read as flat grey beyond ~20 m | Medium | Partly improved: race-day rubber is laid along the solved racing line, so the road shader shows a darker rubbered band through each corner rather than down the centre. Tyre marks are laid where a speed profile along that line says cars brake hard (12 m/s or more lost) and spin the rears out of slow corners: pairs of wheel tracks from several passes, densest at the end of each braking zone (Aurel 131 marks in 4 merged meshes, 6,960 triangles; Vellamar 204 marks, 4 meshes, 11,464 triangles). They are original procedural decals and change no grip. The road shader also carries tone at the scale of metres (value noise of about 12 × 40 m and 2 × 8 m scaling albedo by 0.92–1.06 and 0.95–1.04; the finer layer fades where it would alias) and resurfaced repairs: about one 37 m cell in five holds a full-width or lane patch 3–16 m long, darker (fresh) or lighter (faded), with dark sealant along its cut that is dropped once narrower than a pixel (18 patches a lap on Aurel, 22 on Vellamar). Presentation only; the effect is subtle and not reviewed against reference footage. Aggregate contrast at distance remains open |
| Night lighting | Floodlit circuit: racing surface near daylight brightness under a dark sky, crisp multi-source shadows | Track surface dim and blue-grey between lamp pools; cars read as silhouettes | High | Improved: the blue skylight fill no longer outweighs the floodlight key (fill 0.085 vs key 0.30, still below overcast daylight as tested), with a neutral metal-halide key colour; surroundings fall to dark. The bright squares near the player car at night are isolated and fixed. An HDR readback of wet night T-cam frames found single pixels of 250-15,500 linear (the rest of the frame peaks at 25-110): floodlight glints on wheel-rim metal. Three's UnrealBloomPass blurs each mip with a kernel cut off at one sigma, close to a box filter, which turned every glint into nested hard-edged squares. Bloom is now a round-filtered mip pyramid (13-tap downsample, tent upsample). It limits fireflies and drops non-finite values before blurring, so the glints read as small round highlights. Also: mirror feeds render in half-float HDR (8-bit targets clipped floodlit scenery to flat white), and spray puffs dissolve 0.6-3.5 m from the lens. Open: floodlights are point lights, and only the road's water film widens their highlight for the 3.2 × 1.3 m emitter; car metal still shows pinpoint glints |
| Wet track | Mirror-like sky/car reflections, puddles, standing water sheen | Wet road reads as dark matte asphalt; little reflection | High | Improved: planar wet-road reflection. It mirrors cars, sky, floodlights, stands, barriers and terrain about the road under the followed car, into a half-resolution HDR target with an oblique near plane. It is sampled through the existing water-film clearcoat lobe, so the physical wet/puddle masks and Fresnel decide where it shows; it is blurred by film roughness and faded with height and at the frame edge. It costs 230-490 draws (opt-in layer), only while the track is wet, and is off on Low. Puddle geometry and screen-space refinement remain open |
| Spray | Thick, continuous plumes and rooster tails behind every car | Discrete coloured disc sprites; plume does not form | High | Improved: root cause was a 1,200-particle pool recycled in <0.3 s by 8 wet cars. Pool is now 3,600; rear tyres carry 3× the front share (per-car total unchanged); 30% of rear births rise from the diffuser as a rooster tail; larger, fainter puffs overlap into one plume and fade analytically into the road |
| Tyre smoke / launch | Pale grey tyre smoke only on real wheelspin/lock-up | Brown dust-like puffs around the car on the grid launch | Medium | Improved: smoke and dust moved from 120 px-capped GL points to the metre-sized lit quad renderer with ground fading; smoke is neutral grey. Emission still comes only from measured slip work, and now only from wheels sliding past peak grip (slip ratio beyond 0.18 or slip angle beyond 8°). Before, any slip work above 1.8 kW smoked, and with the AI cornering at the limit every fast corner left beige puffs on dry asphalt |
| Chase camera | Close, low car-centred framing | Car occupies ~19% of frame width, high camera | Medium | Improved: 1.95 m height / 5.7 m distance rig (was 2.5 / 6.7), 10 m look-ahead; car ~23% of frame width at 1600 px |
| T-cam | Airbox camera: halo and nose dominate, helmet not filling frame | White helmet occupies the lower centre of the frame | Medium | Improved: camera lifted 9 cm above the authored pod socket with a steeper gaze; the helmet crown now sits at the lower edge |
| Cockpit | Halo pillar, wheel display, readable road over the nose | Composition acceptable; interior very dark, road band narrow | Medium | Partly improved: screen-space obscurance no longer applies within 0.9 m of the eye and ramps to full by 2.2 m. It multiplied the lit colour, direct sunlight included, and its near-field kernel turned the wheel, gloves and cockpit rim near-black; on the same paused frame the wheel region went from 0.012 to 0.038 linear (0.035 with obscurance off). Dark navy bodywork in the car's own shadow stays dark; the road band and P0 framing gate are unchanged; human review open |
| Trackside signage | Boards printed on the track-facing side | Signs, the start gantry banner and the grandstand fascia were double-sided printed planes, so their lettering read mirrored from behind | Low | Fixed: back faces show a plain backing colour in the same draw (unprintedBack) |
| Grid crews | Team crews in kit around every car on the formation grid, leaving before the lights | Grid staff were capsule bodies with separate cylinder limbs and floating helmets | High | Improved: grid staff use the Blender-authored people asset (the pit crew's body and helmet) in team kit, feet on the grid, facing the car and stepping back as the blankets come off. Open: they hold the asset's standing bind pose; no grid animation, umbrellas or tyre-blanket handling |
| Rival cars | Close rivals approach player-car detail | APX01 rivals are simpler than the supplied player car | Medium | Open (A61) |
| Audio | V6 turbo-hybrid tone, turbo whistle, sharp upshift cut, overrun crackle, kerb/scrub, Doppler passes | Procedural bands exist; not evaluated by ear in this environment | Unknown | Improved: player power-unit layer adds turbo whistle (2.6–8 kHz with boost), straight-cut gear whine (41 Hz per m/s), overrun crackle and upshift/downshift cracks, all from recorded state and unit-tested; not yet judged by ear |
| Draw-call budget | 1080p/60 on mid-range PC | 2.3k–3.8k draw calls at High | High | Improved (see below); the local probe now leaves out scenery that cannot cover one texel of its 128 px faces (−37% Aurel, −38% Vellamar probe draws per refresh, headless census). Rival LOD0 (~90 draws per car: about 36 for the four wheel assemblies and 27 for the articulated driver) and cockpit mirrors remain the next targets. The two mirror feeds now alternate (each still 30 Hz at High), so their ~575 draws per update are spread over frames instead of landing on every other frame. Periodic probe refreshes now render one cube face per frame (six frames per refresh) instead of all six in one frame: in a quarter-speed grid replay the worst frame fell from 2,634 to 2,039 draws (−23%) with the median frame unchanged. The cars cast sun shadows through depth-only meshes per rigid part (12.9 MB of merged data): the grid shadow pass fell from 852 to 470 draws (−45%) and the on-track pass from 195 to 62, with pixel-identical chase and trackside frames. With the mirror cameras posed on the car, 92 of the player car's 170 meshes fall inside a mirror view; oriented-box tests would drop only 18 of them |
| Car performance and AI pace | Physically plausible F1 envelope (about 5 g cornering, 4-5 g braking); rivals brake late and carry corner speed | Car envelope not measured against references; AI cornered at about 50% of the car and braked at 0.87 g, several hundred metres early | High | Improved: acceleration, top speed, braking and lateral limits measured against public F1 figures (fast lateral 4.3 g, peak braking 5.9 g; two figures are 2-3% quick, see [PHYSICS_REFERENCE.md](PHYSICS_REFERENCE.md)). The AI plans with the measured envelope, using a friction-circle velocity profile, wake loss and pedal modulation: dry laps are 9% (Aurel) and 7.5% (Vellamar) quicker, and braking reaches 3.3 g. The AI now drives a solved minimum-curvature racing line (outside, apex, outside) instead of the centreline. That opens Aurel's tightest radius from 43.8 to 61.6 m; single-car laps are Aurel 50.1 s and Vellamar 69.6 s. Paths, and rivals' paths, are predicted along the line, with absolute pit corridors and a narrower line and extra reserve in the wet. From a mid-field start the player's car still holds a rival within 18 m for 6-11 s (centreline 9-29 s) with 20-27 on-track passes per 5-lap race (centreline 23-25); cars on one line string out more. The AI still uses only 55-72% of the measured limits, and line tracking averages about 1.2 m; closing those gaps needs racecraft work |
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

Sub-texel probe detail: one texel of a 128 px probe face spans π/256 rad. Static
scenery that cannot cover a texel from the probe position is left out of that
capture only, using upper bounds on its narrowest projected size: compact meshes
by their bounding sphere, painted lines (0.12–0.14 m) and kerbs (1.1 m) as strips
of their measured width (at most width/distance from any direction), and tree
trunks per instance by their thickest section and limb reach. Asphalt, grass,
run-off, terrain, stands and canopies stay unless they are themselves sub-texel.
A headless census over 12 probe positions per lap (same visibility and frustum
tests three.js applies, before the renderer's own exclusions) gives Aurel 1,385 →
871 probe draws per refresh (−37%) and Vellamar 1,526 → 945 (−38%).
In the game (Aurel, dry, High, AI demonstration, Mesa software GL; draw counts
only) the largest probe refresh fell from 1,449–1,508 to 966–987 draws
(−33 to −35%) across chase, trackside and cockpit views, with 721–781 sub-texel
objects left out of each capture. The first capture after loading still draws
everything, so all scenery is uploaded to the GPU before driving; omitting it
there left small props to upload when the main view first reached them.

Spread refreshes: a whole capture in one frame put 884–1,047 extra draws on that
frame every 1.5 s (0.55 s wet), a periodic hitch over an otherwise steady frame.
A periodic refresh now renders one face per frame into the back cube target, from
the eye of its first face, and is published only when all six faces are complete
(mip chain and prefiltered environment once, after the sixth). The first capture,
replay seeks, a change of followed car and lighting or weather changes still
capture all six faces at once. Measured in a quarter-speed replay on the grid
(Mesa software GL, draw counts only; at full speed software GL renders under one
frame per 2 s of race time, which the probe treats as a seek): per-face costs
were 384, 56, 31, 28, 367 and 94 draws (+X, −X, +Y, −Y, +Z, −Z; 960 in total).
The largest frame fell from 2,634 to 2,039 draws (−23%); two faces per frame gave
2,131. The median frame (about 1,650) is unchanged. A refresh in progress advances only
on frames where presentation time advances, so a paused frame does no probe work,
as before.

Sun shadow casters: in the same grid frames the shadow pass drew 852 casters per
frame, more than the main view. A census of the casters by owner (now in the
verbose diagnostics) put 807 of them on the cars: 170 for the supplied player car
and 91 for each rival at full detail, one per mesh and material. The cars' rigid
parts now cast through depth-only meshes, one per part, shadow side and 16-bit
chunk: the rivals' batched bodywork, wings, wheel carriers, rims, brake rotors with
their bells, steering-wheel body, helmet and torso (every LOD), and the player
car's multi-primitive glTF groups (body, wings, DRS, wheels, and the cockpit,
controls, driver and head skinned on their shared skeleton). They hold the same
triangles in the same LOD tier with positions only (plus bone indices and
weights in their source types), so self-shadowing is unchanged. Tyres deformed on
the CPU, instanced controls, gloves, mirror surfaces (their visibility follows the
camera) and anything alpha-tested cast as before. The casters are shown only
inside the shadow pass, after three.js has built each view's draw list, so they
add no draw to any view.

Merging copies vertices to save draws, so sources over 8,192 vertices keep
casting alone (7 of the player car's 172 primitives hold 41% of its vertices), and
identical merged data is pooled by content: all seven rivals share one copy. The
casters hold 12.9 MB of vertex and index data in total; without the cap and the
pooling the same scheme held 62.8 MB.

Measured (Aurel, High, Mesa software GL): a rival casts in 54 draws instead of 91
at full detail and 13 instead of 23 at LOD 1 and 2; the player car in 43 instead of
170. The grid shadow pass fell from 852 to 470 draws (−45%) and the on-track pass,
where usually only the player car is inside the 76 m shadow box, from 195 to 62
(−68%). Paused grid frames (800×450) were pixel-identical to the build before any
casters in chase and trackside views; in the cockpit view 1 of 360,000 pixels
differed, by 1/255 (repeat captures of the baseline were identical). Unit tests
check, on a real rival at all three LODs and on skinned and tier-swapped
sources, that the world-space triangles cast per shadow side are identical.

## Evidence retained

- `docs/baseline/gameplay-dry.jpg`, `gameplay-wet.jpg`, `gameplay-night.jpg`:
  resized contact sheets of the captured moving frames (not retouched).
- `docs/baseline/baseline.json`: the counters above plus per-view renderer diagnostics.

Human art review and the Section 146 combined driving scenario remain open and
are not inferred from these captures.
