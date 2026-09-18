# Weather, contact effects and wet-pit braking

## Recovered specification and checkpoint

The source of truth is the exact **Pasted markdown(6).md** supplied by the user,
now preserved verbatim as [MASTER_DIRECTIVE.md](MASTER_DIRECTIVE.md).
Its SHA-256 is `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`. It contains 148 numbered sections;
`tests/directive.test.ts` guards the source bytes and one-to-one ledger headings.
That test proves traceability, not feature completion. This work continues the
published motion-blur checkpoint `9eb0a9d3833d836d85f807fec8c7b55ecb6f3934`.

## Physical weather and presentation

`WeatherTimeline` validates 1–256 immutable keyframes with explicit seconds,
cloud coverage, mm/hour rainfall, Celsius, wind m/s and radians. A bounded smooth
interpolation, binary lookup and shortest-direction arc make arbitrary sampling
and backward seeking independent of invocation history. The changing preset now
advances through cloud, rain, stronger changing wind and eventual retreat, rather
than permanently saturating a hard-coded rain ramp. Constant clear/rain presets
retain their previous atmosphere. This is an authored original scenario, not a
weather forecast, a meteorological model or a user-facing weather editor.

The worker samples weather on simulation time. Per-cell water integrates rainfall,
drainage and evaporation using an exact constant-input first-order step; surface
temperature uses exponential relaxation. Water is not cleared when rain stops.
Cloud, wind and ambient temperature alter the real surface/aerodynamics and the
presentation. Protocol 6 carries wind in the two formerly unused header slots;
199-channel telemetry appends `wind_x_mps` and `wind_z_mps` without moving earlier
channels. Saved replay snapshots carry the same values.

The fixed 1,800-particle pool uses loaded-wheel contact, water, speed and compound
for spray; dissipated slip watts for smoke; bottom-contact watts for sparks.
Airborne wheels cannot generate ground-contact effects. Rain has fractional
emission accumulation so light rainfall does not disappear at high refresh rates.
Rain and entrained contact particles use actual world wind. These are bounded
visual approximations, not simulated fluid parcels or a tire-smoke chemistry model.

## Coupled brake repair and AI response

Review found two braking defects. Sport ABS reduced friction but left regenerative
braking untouched, allowing a generator to hold the rear wheel locked. Also, the
automatic idle governor could drive through a light brake pedal until the old
3 m/s clutch threshold. ABS now releases both sources; battery recovery is limited
by actual generator work. Automatic anti-stall opens the clutch below coupled
idle speed while braking. Manual clutch and high-speed engine braking remain.
No intervention writes chassis velocity, grants extra grip or teleports a car.

That changed response exposed a real AI pit-entry failure. Wet slicks now reserve
control margin for simultaneous turning/braking/lane changes. A requested pit
approach is treated as a merge: traffic candidates cannot move farther from entry
merely to pass another car. If occupied, existing longitudinal following yields.
An attempted stop-until-aligned policy was rejected because a stopped car cannot
steer itself laterally and caused queues; it is not present in the delivered code.

## Executable evidence

`npm run test:weather` runs fourteen assertions against production code: immutable
weather validation, endpoint/short-arc sampling, storm retreat, water stability,
spatial state, wind-sensitive drag, protocol/CSV values, 24–144 FPS light-rain
emission, airborne and clean-braking guards, real effect triggers, bounded pools,
ABS/regeneration work, automatic anti-stall and manual/full-battery controls.
Vitest wraps these same oracles. Separate AI tests cover wet-slick pace margin
and pit-directed lane candidates. The browser suite renders particles from an
actual wet simulation snapshot and checks changed/cleared GPU pixels and wind.
Native mathematical tests alone are not presented as a passed WebGL shader test.

`npm run test:wet-pits` is part of the ordinary physics gate. Ten real cars start
in 24 mm/hour rain on wet tires, then a separate ten-car fixture starts on medium
slicks. Every car must reach service, replace the four tire objects, fit wets and
exit within 420 simulated seconds, with finite state and bounded battery. The
impact threshold is the existing dry-pit threshold (0.05); it was not lowered
or made cosmetic to accommodate a failure. Minimum component health is sampled
throughout, including before repairs. These runs contain **minor contact**, not
zero contact: read `wet-pit-results.json` for individual values and source identity.

The dry 50/100-lap gates, whole-field clear/changing races, dynamics, angular
conservation and marshal regressions are rerun after physical changes. Current
long-run scope is recorded in [construction/endurance](CONSTRUCTION_AND_ENDURANCE.md).
None of these fixtures constitutes every adversarial race or the full combined
manual scenario in section 146.

## Validation infrastructure

The standard browser job had been cancelled at its 15-minute job budget while the
complete sequential software-rendered suite took about 17 minutes in the publisher.
Commit `2791b0e` extends that one job budget to 25 minutes; no assertion, per-test
timeout or failure was removed. The source publisher separately requires lint,
unit tests, strict TypeScript, production build, physics, pit/race and real Chromium
browser checks before fast-forwarding readable source onto `main`.
