# Road motorcycle sprung pose and presentation

## Defect and production evidence

The road suspension solver now publishes physical chassis heave and pitch in
`BikeVehicle.body`. The earlier visual rig assumed its root was a wheel-plane
reference and added fork/shock heave and pitch to the sprung child. Composing
those two contracts moved the fairing, cockpit and seated rider a second time.
The new production regression runs `Simulation.step`, applies an external
vertical velocity impulse, records `Simulation.makeFrame`, and poses the actual
Three.js `BikeShells`. Before the correction, the sprung origin differed from
the recorded physical CG by **21.65 mm**. The new path requires agreement within
one micrometre and tests orientation independently.

The old grounding projector also recovered a road plane by inverting the fixed
CG crown/pivot construction. This made its inferred road rise with a physically
airborne chassis. The road plane must be recorded independently of chassis
heave, rather than reconstructed from the height it is supposed to constrain.

## Explicit protocol contract

The road contract uses the otherwise unused motorcycle wheel-contact block,
with no new frame fields or stride changes. Protocol v17 versions this semantic
extension; simulation v26 identifies the changed physical model. Versioned
replay pages reject incompatible older or newer protocol versions explicitly.

| Contact block tag | Meaning |
| --- | --- |
| 0 | Existing synthetic, unmarked motorcycle, placement, MX or service contract |
| 1–15 | Existing measured four-wheel contact mask |
| 16 (`ROAD_BIKE_CONTACT`) | Ridden road motorcycle with authoritative sprung CG and road planes |

For tag 16, records 0 and 2 contain front and rear world contact point XYZ,
vertical free-wheel gap, unit road normal XYZ and measured normal load. Records
1 and 3 remain zero. `BC` names the eight motorcycle values separately from the
car's `C` interpretation. The car contact reader accepts only masks 0–15 and
therefore cannot mistake these road coordinates for tyre strain.

`BikeVehicle.sprungRoadPose` exposes the active road solver state without
changing forces. The writer excludes placement, MX, separated riders and active
pit service. The reader checks the vehicle definition, riding/service state,
finite values, unit upward normals, nonnegative gap/load and reserved records.
Snapshot validation and full-session replay capture/read reject forged tags.
The compact diagnostic recorder now retains motorcycle identity, the bike and
offroad tails and stand fields alongside the measured contact block.

Marker transitions are discrete presentation boundaries. Chassis and contact
interpolation hold the older convention until the new sample's time. Within
one convention, world planes/gaps use the same presentation alpha as the
chassis; interpolated normals are normalized. Raw recorded frames remain
unchanged. Unmarked standalone `BikeModel.pose` callers retain their established
spring-based local transforms. An old unmarked frame is never silently treated
as a new physical CG frame.

The compact multiplayer `CarNetState` wire format does not carry this full
simulation frame, motorcycle joints or contact block. This work does not
claim to extend that separate network presentation format. Verified input
journals continue to use the simulation/content identity and re-simulation.

## Geometry composition

For a marked road pose, the model root and sprung child share the physical CG
transform exactly. `RoadBikeWheelPose` solves the fork lower along its existing
raked steering axis and the rear hub in chassis vertical travel against the
recorded planes. The target clearance includes the measured free-wheel gap, so
a wheelie or airborne wheel is not pulled down to the road. The tyre's rounded
crown and finite shoulder supply the hub-to-road support distance, accounting
for the actual wheel axle direction. Steering and absolute wheel spin retain
their existing geometry. The swingarm, chain and rear suspension linkage are
rebuilt against the resulting rear hub.

The same fixed CPU scratch helper supplies the indirect tyre grounding
projector. Shadow height comes from the recorded plane; support fades from the
actual rendered gap. No new mesh, texture, render target or draw call is added.
The shader's existing fixed uniform slots remain unchanged.

Onboard cameras already use the physical host transform, so their sockets now
stay aligned with the cockpit when the suspension moves. The rider is seated
in that same frame. Its slider/boot clearance uses the mean recorded road
plane transformed into chassis coordinates, including pitch and bank. Helmet
compensation uses physical pitch relative to that plane. During measured road
flight, feet remain on the pegs even at low planar speed. Separated riders keep
their independent recorded world transform.

## Verification and limits

`tests/road-bike-presentation.test.ts` covers GP-R1, GP-R2, SBK-1000 and SS-600
through the production adapter, snapshot writer and actual Three scene graph.
It inspects the actual rubber mesh vertices against the recorded road planes,
not just agreement between two copies of a formula. Other assertions cover
flight, landing, preload, lean, rider hand/boot contacts, camera socket,
interpolation, hold, reverse seek, all three LODs, marker rejection and replay
page eviction/reload. Existing standalone animation, pit service, rider,
cockpit, rear chassis, chain, car contact and legacy grounding tests preserve
their prior contracts. The analytic legacy grounding fixture now implements
the road adapter's vertical cast as well as its sampled plane.

These are geometry and CPU integration tests with a canvas stub. They do not
constitute WebGL screenshot or frame-time evidence. The near tyre support
tolerance is four millimetres, allowing finite polygon sampling; the coarse
far silhouette has a twenty-five-millimetre envelope. The physical solver is
still a reduced sprung heave/pitch model without separate unsprung wheel
masses, tyre carcass deformation or a fully spatial motorcycle suspension.
The visual geometry consumes its measured support and gaps; it does not create
new forces or claim a more detailed physical solver.
