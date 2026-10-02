# Race-Day Presentation V2

## Player entry
Normal **ENTER CIRCUIT** in Grand Prix or Endurance now opens a race-day briefing.
It reports the initialized grid position, fitted compound, actual fuel mass,
selected distance and physical weather state. The setup chosen in the garage
is already applied. **WATCH GRID PREPARATION** plays the preparation and hands
control to the start lights automatically. **GO STRAIGHT TO LIGHTS** skips it.

Quick Start is an opt-in saved preference (also under Garage & Settings).
It skips the briefing for subsequent races; old saves default to the full entry.
Practice and qualifying retain their existing entry. Qualifying order is not
overridden by preparation. **PREPARE GRID / START PAUSED** always remains an
explicit inspection route, independent of the preference. Its presentation
retains a scrubber; the normal player-facing sequence hides that review control.

## Crew performance
The 38-second presentation has staggered actor timings, approach, lowering,
blanket grip/gather, rise, two staged turns and two walking legs. Inboard
mechanics go around the nose or tail before traversing the row; inner and
outer wheel teams use separate longitudinal lanes. Parking is outside the
asphalt at 9.5 m from the start straight's centreline on the two current circuits.
A full-grid CPU regression checks every root against conservative car envelopes.

There is no `time < 22` visibility cutoff. The same final transforms are parked
in world space when racing begins, with conservative frustum bounds. They do
not follow the moving car or disappear at a time threshold. Restart/menu reset
the cast. Foot targets maintain a supporting contact through gait and turns;
rendered glove sockets and blanket handles use the same deformation.
The existing dedicated garment, 15-bone rig, helmets, gloves, supplied player
car, cockpit and driver remain unchanged.

The worker stays at tick zero during preparation. No fuel, grip, temperature,
qualifying results, vehicle positions, simulation clock or race-control channels
are rewritten. Skipping the presentation is a presentation-state transition,
not a simulated formation lap. Pausing/hidden-tab behavior remains explicit.
These are original procedural task poses and distance-locked steps, not motion
capture, a cloth solver, certified natural human motion or final character art.

## Racing interface
The same live telemetry nodes now form a lower-right driving cluster (gear,
speed, rev lights/RPM, pedal bars, ERS mode/charge and fuel). Classification and
lap timing are peripheral. On wide screens, VEHICLE opens an adjacent MFD with
Tyres, Energy and Damage tabs. Small screens keep the native RACE INFO drawer.
Every prior tyre/brake/health reading is retained. Puncture, aero damage, low
fuel and excessive brake temperature produce prioritized warnings even when
the MFD is closed. The controls are keyboard accessible; panel navigation does
not leak keydowns into driving, while keyups can release held inputs.
Layout tests deliberately replace the old top-centre-placement assertions but
retain all viewport/scale/camera/data/scroll/keyboard checks.

## Validation and delivery
- Unit tests cover settings migration, briefing data, warning priorities,
  staggered timing, planted feet, reachable limbs, glove grip, full-grid paths,
  persistent parked transforms and unchanged simulation snapshots.
- DOM tests cover lower-corner layout, footprint, compact/wide resize, MFD tabs,
  warnings and input ownership. Their synthetic data is component evidence,
  not a racing or hardware claim.
- Browser test 50 retains explicit inspection, seeking and skip checks.
  Browser test 51 uses normal entry, automatic clock playback, classification,
  replay, saved Quick Start and paused inspection. Existing gameplay tests
  explicitly take the new public skip action where they previously entered
  directly; their race assertions, deadlines and physics are unchanged.
- Browser progress reporting preserves the active case/step and elapsed
  heartbeat. Whole-weekend and new preparation cases receive larger scheduling
  weights; every discovered test still belongs to exactly one shard.
- The menu shows a source fingerprint for uncommitted candidates or an exact
  commit for clean builds. BUILD_IDENTITY.json contains both fields. No staging
  commit is falsely labelled as the patched source.
- Only a complete successful main validation may publish the source-addressed
  release ZIP. A green workflow with skipped publication is not delivery proof.
  No deployment branch is created; this does not redeploy an older web-host URL.

## Still open
Final human art/animation review, representative GPU frame times, authored
motion clips, terrain-conforming foot correction away from the current grid,
full garage briefing/setup editing, a physical formation lap, rival-car A61,
wider career/online scope and automatic deployment to the selected web host
remain separate acceptance work. This milestone does not assert F1 25 parity.
