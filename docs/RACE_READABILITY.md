# Aurel race-readability increment

Base: `610e21a090b0094ff69129f1d490b5389272972f`, exact tree
`ba43c4065728f0caa43ddc6e6bd22026c92347e2`.

This is a scoped implementation candidate, not closure of Phase 27, final-art
approval, a complete human-driven race assessment, or Steam readiness. Publication,
current-commit hosted CI and deployment must be checked independently. The source
was recovered from that revision's `apex-source` artifact, not an older demo.

## Compact racing HUD

At desktop widths of at least 1280px and heights of at least 680px, all four
racing cameras use a top telemetry band. Its actual layout width reserves the
side panels before allocating the centre. Gear, speed, RPM, pedals, energy,
fuel, guidance and grid lights remain present; the player's interface scale
is not reduced to conceal a collision. The existing smaller/touch layouts remain.

The twelve-car classification reserves the minimap's scaled height and scrolls
natively instead of reducing row height to fit. Its heading stays visible while
scrolling. The existing input ownership is retained: scrolling keydowns remain
inside classification, keyup can release a held driving input, and Escape can
reach the normal session handler. No input or simulation module was changed.

The existing DOM test now covers 168 combinations: seven viewport sizes,
four cameras, three scales and guidance on/off. It also resizes the same mounted
UI after native keyboard scrolling. These are production Interface/CSS component
checks, not proof of complete gameplay or physical controller handling.

## Pit-service camera visibility

The existing recorded-state composition now supplies its centre and eight
rotated world-space boundary probes during actual stopped service. Probe storage
is reused. The box and sphere enclose the actual skinned clothing, helmets,
gloves, carried tyres and machinery over the retained 24 service/contact states.
Projection checks additionally exercise twelve real bay positions at four aspects.

The director considers only existing fixed camera rigs. It first preserves the
car-centre sightline, then prefers more visible boundary probes. An already
suitable service lens remains selected to avoid sector-boundary oscillation.
Candidates must frame the complete subject and remain inside the unchanged
160-metre crew visibility limit, measured from the actual actor anchor. A
visibility-qualified subject cannot silently shrink to a car-only sphere.

The bound is nine sightline queries for a clear held lens, or at most 180 across
all twenty rigs during a search. This is a work bound, not a target-machine FPS
measurement. No mechanics, equipment or scenery are hidden to obtain a clear
shot. New diagnostics expose the sample count, visible samples and range result.
Clear probes are not a certificate of every actor's pixel visibility or anatomy.

## Wet floodlight reflections

The existing four point lights approximate luminous boards measuring 3.2 by
1.3 metres. The road and pit-road water coat now account for a bounded emitter
footprint, using an equal-area disc radius. This is an artistic angular-variance
approximation, not a calibrated rectangular area light or complete light transport.

Only each point light's water-coat roughness is broadened; the previous material
value is restored before subsequent lighting. Dry asphalt, sun/spot/environment
contributions, diffuse material, exposure and the physical water/grip equations
are preserved. Other users of the road hook retain a zero-radius default. There
are no additional lights, textures, geometry, particles or render passes.

The retained material GPU fixture now compiles four point lights, compares dry
and wet zero/finite-footprint controls, reads the actual per-light roughness and
checks its restoration. These new pixel assertions require WebGL execution;
native shader compilation is not relabelled as their success.

## Validation and remaining gates

See `RACE_READABILITY_VALIDATION.json` for the executed check counts, source
identity, artifact hashes and limitations. The delivery contains the raw local
logs, numerical reports, explicitly labelled DOM captures and the shader-compiler
reproduction helpers. Historical numerical reports in `docs/` are preserved;
new run outputs are retained separately.

Ordinary application navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`, and
local Chromium could not create WebGL2. No navigation-policy bypass was used.
Consequently there is no fresh candidate full-race recording, browser GPU-pixel
pass, deployed-site smoke test, human driving acceptance or consumer-GPU result.
The native Mesa checks compile the actual expanded material shaders; they do not
establish browser image quality or physical-hardware performance.

Original Blender/GLB assets, simulation, audio, input, worker and storage code,
locked dependencies, workflows and the 148-section master directive are retained.
The existing acceptance matrix refreshes source locations/identity only, retaining
0 PASS / 230 PARTIAL / 2 FAIL required rows and 16 excluded references. The tracked
`playable/` remains its historical build; the delivery's separate `web-build/`
contains the new compiled candidate and its manifest, not a verified deployment.

Reproduce the normal gates with the locked toolchain:

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/phase27h6-racing.ts
node --experimental-transform-types scripts/phase27h-matrix.ts --check
npm run test:e2e
```

Full-game pit footage and matched dry/sunset/wet-day/wet-night views must still
be reviewed on the published candidate before final visual approval. Complete
manual race, target-machine frame-time, controller/wheel and later racing-quality
work remain independent gates.
