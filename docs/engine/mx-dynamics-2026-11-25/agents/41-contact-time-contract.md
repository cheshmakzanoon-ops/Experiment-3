# Assignment 41 — first-contact interval and impulse contracts

Wave 7; 25 November 2026. This assignment completes the six contact-time
oracle migrations handed off by assignment 39 after assignment 33 replaced
the supported Euler update with bounded midpoint integration.

## Disposition and scope

**All 15 tests in `motocross-contact-time-coherence.test.ts` pass.** The
original 13 cases remain, with two additional real contact-window cases that
exercise several complete physical intervals and prove observer transparency.
The final owned run is source-stable at adapter SHA256 `c3801a23…`, including
assignment 40's then-current ground-frame change and assignment 42's front
flight-inertia correction. Exact fingerprints appear below.

Changed files are the coherence test and this report. No production code,
physical threshold, numerical tolerance, vehicle definition, model, character
asset, material, authored terrain or environment was changed. No children,
git mutations, dependency installation, npm lifecycle hooks or publication
were used.

This is not a declaration that all campaign gates pass. An exploratory joint
run passed **55/56** while integration continued. Its only failure is the
unchanged supported-convergence assertion described under verification;
assignment 40 owns its automatic-downshift investigation.

## Why the six old assertions were invalid

For both motorcycles at 120, 240 and 480 Hz, the old test required:

```text
final vy = incoming vy + (incoming support force / mass − gravity) × remainder
final y  = incoming y + final vy × remainder
```

Those are the replaced semi-implicit Euler equations. They equate the
incoming spring/damper sample with the integral of a force that now changes
inside the supported interval. Assignment 39 measured differences of
3.2965e−6 to 6.5320e−4 m/s against an exact-algebra tolerance of 5e−11 m/s;
the preceding event-time, ballistic, contact-patch and severity checks passed.
Increasing that tolerance would preserve the wrong oracle.

The corrected test separates three observations:

| Observation | Contract retained |
| --- | --- |
| Public update | Its complete physical intervals sum to exactly the requested duration. |
| First swept contact | The free span ends at the recorded event, at an independently sampled tyre footprint and incoming ballistic state. |
| Supported intervals | Their durations sum to the public duration minus the actual free span, with continuous heave state and no extra endpoint update. |

Supported numerical accuracy remains independently checked by the RK4
constitutive references and cadence tests in
`motocross-supported-convergence.test.ts`. The contact-time test does not
replace the Euler equations with a second implementation of midpoint algebra.

## Actual time and incoming-state ledger

A scoped observer records `stepInterval` entry/completion and the actual
supported calls to `vertical`. A free outer `vertical` call can delegate its
swept event to a nested supported remainder; only that remainder contributes
support time. Subsequent complete ground intervals are recorded separately.
The spies restore the original methods in `finally`.

For every contact-containing public call, the test requires:

- Exactly one first-contact event and exactly one landing.
- Positive free time strictly shorter than the public duration.
- The sum of complete durations equals the public duration to 12 decimal
  places.
- The sum of actual supported durations equals public duration minus free
  time to 12 decimal places. Passing the whole public duration to the first
  supported call, or calling support a second time for that span, violates
  this ledger.
- The first supported state equals the captured incoming event state, and
  its duration equals the actual event remainder.
- Event time equals the landing record's time exactly.
- Independent quadratic-drag horizontal motion and the exact vertical
  gravity arc reproduce the incoming event position and velocity at the
  existing precision. Horizontal motion uses each actual interval's mass,
  because fuel may change mass between complete updates.
- At least one actual tyre gap is within 1e−8 m of contact, with no other
  tyre penetrating beyond the existing 1e−8 m allowance.

Historical contact identity now comes from the swept event's actual
front/rear flags. It is not reconstructed from the final public force flags,
which may refer to a later compression or unloading phase. Independently
sampled footprint normals still determine grade, cross-slope and incoming
normal speed. The recorded slope and pitch error retain their original
precision assertions.

## Physical support and endpoint publication

The first contacted interval must have positive real support. Final heave
velocity and position must lie above the independently known unsupported
ballistic continuation over the supported duration. Thus an entirely omitted
support response cannot satisfy the migrated test.

For multiple supported intervals, the incoming heave position and velocity
must exactly equal the preceding interval's outgoing values. The public
heave position/velocity must exactly equal the final supported endpoint.
The public support-force fields must exactly match the final physical
interval's incoming-force observation. No averaged or first-event force is
substituted for that physical state.

All relevant public heave, pitch, load, travel and rotor values must remain
finite. Existing zero-crash and landing-count assertions remain intact at
the contact-containing public endpoint.

## Rotor and mean-force timing

The original no-double-update requirement is retained at its correct phase.
Every physical interval that starts in flight advances the coasting front
rotor by its existing exponential drag law exactly once, and the coasting
rear rotor by its existing finite decrement exactly once. This includes the
flight interval containing touchdown. Its tyre forces remain exactly zero;
first support does not secretly repeat a tyre impulse.

Later physical ground intervals are allowed to apply real rotor pickup. With
the front brake released, they must satisfy the angular impulse relation:

```text
Ifront × (omega after − omega before) = −Fx front × front radius × interval dt
```

The oracle uses the live front tyre inertia passed to the ground solver.
It does not infer inertia from a differently named generic specification or
weaken the angular-impulse precision. Independently summed front/rear
wheel-frame force impulses must equal the public mean force multiplied by
the public duration, to 11 decimal places.

These checks distinguish an actual later pickup from a duplicated first
touchdown update. They do not claim that a changing local force basis alone
is a complete world-space energy ledger; assignment 37 covers interval
thermal work separately.

## New multi-interval and transparency cases

Both additional cases use the existing real RIDGE TABLE departure. No
airborne pose, support load, contact force or rotor state is prescribed. The
normal 240 Hz flight continues until independently sampled gap/closing speed
places contact within the next update. Only that public update uses 1/30 s.

Each case must select multiple complete physical intervals and multiple
supported intervals. The first contact remainder must be strictly shorter
than the total supported time. This makes the ledger exercise the new
coupled path instead of passing solely on the six original short updates.

An unobserved motorcycle receives every identical public duration and
control. Its physical pose matches after every update through contact. At
landing and over 32 subsequent ordinary updates, the observed and unobserved
machines agree exactly in pose, dynamics, all tyre state, rigid body,
machine motion, fuel, gear, RPM, rider pose and rider pose rate. This checks
both immediate and later effects of the diagnostic hooks.

## Executed verification

Owned suite:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-contact-time-coherence.test.ts --maxWorkers=1
```

- First source-stable run on adapter `4a391a0c…`: **15/15 passed**.
- Final source-stable run on adapter `c3801a23…`: **15/15 passed**, 2.97 s
  Vitest duration. Both source hashes were measured before and after this
  run and were unchanged.
- Focused ESLint on the changed test: passed.
- Strict TypeScript check of the test's imported dependency graph, using a
  512 MB heap and an ignored temporary configuration: passed.
- Whitespace validation: passed.

The overlapping joint run included coherence, final-contact frame,
landing-observability, landing-prediction and supported-convergence:
**55 passed / 1 failed across five files**, 9.94 s. All 15 coherence cases
and all 30 tests in the three assignment-39 suites passed. The one failure
was the unchanged supported-convergence test's **0.1227826256 m/s** maximum
bottom-speed discrepancy against its **0.1 m/s** limit. Root and assignment
40 were notified. The source was still being integrated around this joint
run, so it is an exploratory handoff result, not final source-stable global
acceptance. It is not counted as 55 additional unique tests.

## Final owned-run fingerprints

| File | SHA256 |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `c3801a234a535e25ffb355bf066e4dc9349830267d6762ec5d07405e4d71fb20` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| `tests/motocross-contact-time-coherence.test.ts` | `901a6d85dd1bf7e9254a7deebc5ebcb305d7d6dad892f7d50fecd236ec2bb196` |

The new automatic-downshift predicate under review by assignment 40 is not
included in this source identity. Later campaign acceptance must rerun this
suite after all retained production changes settle. Test and report ownership
are released to root at handoff.
