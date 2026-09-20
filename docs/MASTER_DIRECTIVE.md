# MASTER ENGINEERING DIRECTIVE

You are not acting as a normal coding assistant.

You are acting simultaneously as:

- principal game-engine architect
- senior TypeScript engineer
- Three.js rendering engineer
- vehicle-dynamics engineer
- motorsport simulation engineer
- real-time graphics programmer
- shader engineer
- technical artist
- gameplay programmer
- AI/racecraft engineer
- audio programmer
- UI engineer
- optimization engineer
- numerical-methods engineer
- automated-testing engineer
- QA lead

Your task is to engineer an exceptionally sophisticated browser-based Formula racing simulator using Three.js.

The experience should target the **simulation depth, visual density, responsiveness, polish, audiovisual intensity, and systemic integration expected from modern AAA Formula racing games**, while remaining an original implementation.

Do NOT rip, extract, reproduce, trace, redistribute, or reverse-engineer proprietary F1 25:

- code
- car models
- track meshes
- textures
- liveries
- logos
- sound samples
- fonts
- menus
- HUD artwork
- shaders
- game files
- animation data
- proprietary telemetry formats

Do not build a pixel-for-pixel reproduction of copyrighted presentation.

Instead, reproduce the *engineering sophistication and sensory qualities* expected from a premium Formula racing simulation through original systems and assets.

The result must not feel like:

- a Three.js demo
- an arcade prototype
- a tutorial project
- a physics sandbox
- a tech demo with a car
- a pretty scene with fake racing systems

It must behave as one integrated racing simulator.

---

# 1. NON-NEGOTIABLE ENGINEERING PHILOSOPHY

Never implement a subsystem purely visually if it is supposed to affect simulation.

Examples:

Tire temperature must affect grip.

Brake temperature must affect braking.

Damage must affect physics.

Fuel mass must affect vehicle mass.

Aero setup must affect downforce and drag.

Ride height must affect floor performance.

Rain must alter actual track-water state.

Standing water must influence tire behavior.

Dirty air must affect downforce.

ERS must modify drivetrain output.

Brake bias must affect front/rear wheel lock tendency.

Differential settings must affect rear axle dynamics.

Surface contamination must affect tires.

Pit stops must actually replace tire-state objects.

Race strategy must use actual simulation variables.

Telemetry must expose real internal state.

AI must operate under substantially the same vehicle constraints as the player.

Do not fake systems merely because a fake version looks convincing.

---

# 2. THREE-PASS RULE

Every meaningful subsystem receives THREE separate implementation passes.

## PASS A — FUNCTIONAL

Make the complete system work.

## PASS B — ENGINEERING VALIDATION

Measure it.

Instrument it.

Stress it.

Find instability.

Test edge cases.

Verify physical relationships.

## PASS C — POLISH

Improve:

- transitions
- feedback
- graphics
- sound
- tuning
- interactions
- numerical stability
- performance
- usability

Never treat first implementation as final.

---

# 3. REQUIRED TECH STACK

Use:

- TypeScript
- Three.js
- Vite
- WebGL2 baseline
- optional WebGPU renderer enhancement if feature detection succeeds
- GLSL shaders where custom rendering is necessary
- Web Audio API
- Web Workers
- Gamepad API
- Pointer Lock API
- IndexedDB
- Vitest
- Playwright
- ESLint
- Prettier

Prefer native browser APIs over unnecessary dependencies.

Potential dependencies:

- three
- three-mesh-bvh
- gl-matrix only if genuinely useful
- zustand or equivalent only for UI application state if needed
- comlink only if worker RPC complexity justifies it
- zod for configuration validation
- uplot or another lightweight graph library for telemetry

Do NOT introduce a heavyweight game engine underneath Three.js.

Do not use Unity.

Do not use Unreal.

Do not use Babylon as the runtime.

Three.js remains the primary renderer/runtime foundation.

---

# 4. REPOSITORY STRUCTURE

Use a deliberate structure similar to:

```text
/
├─ public/
│  ├─ assets/
│  │  ├─ cars/
│  │  ├─ tracks/
│  │  ├─ environments/
│  │  ├─ audio/
│  │  ├─ textures/
│  │  ├─ fonts/
│  │  └─ ui/
│  └─ config/
│
├─ src/
│  ├─ main.ts
│  ├─ app/
│  │  ├─ GameApp.ts
│  │  ├─ GameBootstrap.ts
│  │  ├─ GameState.ts
│  │  └─ RuntimeConfig.ts
│  │
│  ├─ core/
│  │  ├─ Clock.ts
│  │  ├─ FixedStepper.ts
│  │  ├─ EventBus.ts
│  │  ├─ ObjectPool.ts
│  │  ├─ RingBuffer.ts
│  │  ├─ MathUtil.ts
│  │  ├─ Units.ts
│  │  └─ Diagnostics.ts
│  │
│  ├─ physics/
│  │  ├─ PhysicsWorld.ts
│  │  ├─ RigidBody.ts
│  │  ├─ Integrator.ts
│  │  ├─ ForceAccumulator.ts
│  │  ├─ CollisionWorld.ts
│  │  ├─ ContactSolver.ts
│  │  └─ SurfaceQuery.ts
│  │
│  ├─ vehicle/
│  │  ├─ Vehicle.ts
│  │  ├─ VehicleState.ts
│  │  ├─ VehicleConfig.ts
│  │  ├─ VehicleFactory.ts
│  │  ├─ VehicleController.ts
│  │  └─ VehicleTelemetry.ts
│  │
│  ├─ tires/
│  │  ├─ TireModel.ts
│  │  ├─ TireState.ts
│  │  ├─ TireCompound.ts
│  │  ├─ TireThermalModel.ts
│  │  ├─ TireWearModel.ts
│  │  └─ CombinedSlip.ts
│  │
│  ├─ suspension/
│  │  ├─ SuspensionCorner.ts
│  │  ├─ SuspensionGeometry.ts
│  │  ├─ SpringDamper.ts
│  │  └─ AntiRollSystem.ts
│  │
│  ├─ drivetrain/
│  │  ├─ PowerUnit.ts
│  │  ├─ ICEModel.ts
│  │  ├─ HybridSystem.ts
│  │  ├─ Gearbox.ts
│  │  ├─ Differential.ts
│  │  ├─ Clutch.ts
│  │  └─ DrivetrainState.ts
│  │
│  ├─ brakes/
│  │  ├─ BrakeSystem.ts
│  │  ├─ BrakeDisc.ts
│  │  ├─ BrakeThermalModel.ts
│  │  └─ BrakeBias.ts
│  │
│  ├─ aero/
│  │  ├─ AeroModel.ts
│  │  ├─ GroundEffect.ts
│  │  ├─ AeroMap.ts
│  │  └─ WakeField.ts
│  │
│  ├─ track/
│  │  ├─ Track.ts
│  │  ├─ TrackSpline.ts
│  │  ├─ TrackSurface.ts
│  │  ├─ TrackLimits.ts
│  │  ├─ RacingLine.ts
│  │  ├─ TrackEvolution.ts
│  │  └─ SpatialTrackIndex.ts
│  │
│  ├─ weather/
│  │  ├─ WeatherSystem.ts
│  │  ├─ RainSystem.ts
│  │  ├─ SurfaceWater.ts
│  │  ├─ TrackTemperature.ts
│  │  └─ WeatherTimeline.ts
│  │
│  ├─ race/
│  │  ├─ RaceDirector.ts
│  │  ├─ Session.ts
│  │  ├─ LapCounter.ts
│  │  ├─ TimingSystem.ts
│  │  ├─ SectorSystem.ts
│  │  ├─ FlagSystem.ts
│  │  ├─ PenaltySystem.ts
│  │  ├─ PitSystem.ts
│  │  └─ RaceStart.ts
│  │
│  ├─ ai/
│  │  ├─ AIDriver.ts
│  │  ├─ AIPlanner.ts
│  │  ├─ AISpeedPlanner.ts
│  │  ├─ AISteering.ts
│  │  ├─ OvertakePlanner.ts
│  │  ├─ DefensePlanner.ts
│  │  ├─ CollisionPrediction.ts
│  │  ├─ AIStrategy.ts
│  │  └─ AIPersonality.ts
│  │
│  ├─ damage/
│  │  ├─ DamageModel.ts
│  │  ├─ AeroDamage.ts
│  │  ├─ SuspensionDamage.ts
│  │  ├─ TireDamage.ts
│  │  └─ DebrisSystem.ts
│  │
│  ├─ rendering/
│  │  ├─ Renderer.ts
│  │  ├─ RenderPipeline.ts
│  │  ├─ SceneManager.ts
│  │  ├─ LightingSystem.ts
│  │  ├─ ShadowManager.ts
│  │  ├─ ReflectionSystem.ts
│  │  ├─ MaterialLibrary.ts
│  │  └─ LODManager.ts
│  │
│  ├─ shaders/
│  │  ├─ wetRoad.vert
│  │  ├─ wetRoad.frag
│  │  ├─ carbon.frag
│  │  ├─ spray.vert
│  │  ├─ spray.frag
│  │  ├─ tireMarks.frag
│  │  └─ atmospheric.frag
│  │
│  ├─ effects/
│  │  ├─ ParticleSystem.ts
│  │  ├─ SpraySystem.ts
│  │  ├─ SmokeSystem.ts
│  │  ├─ SparkSystem.ts
│  │  ├─ DustSystem.ts
│  │  └─ TireMarkSystem.ts
│  │
│  ├─ cameras/
│  │  ├─ CameraManager.ts
│  │  ├─ CockpitCamera.ts
│  │  ├─ ChaseCamera.ts
│  │  ├─ TVPodCamera.ts
│  │  ├─ TracksideCamera.ts
│  │  └─ CameraDynamics.ts
│  │
│  ├─ audio/
│  │  ├─ AudioEngine.ts
│  │  ├─ VehicleAudio.ts
│  │  ├─ EngineSynth.ts
│  │  ├─ TireAudio.ts
│  │  ├─ EnvironmentAudio.ts
│  │  └─ CollisionAudio.ts
│  │
│  ├─ input/
│  │  ├─ InputManager.ts
│  │  ├─ KeyboardInput.ts
│  │  ├─ GamepadInput.ts
│  │  ├─ WheelInput.ts
│  │  ├─ InputFilter.ts
│  │  └─ InputBindings.ts
│  │
│  ├─ telemetry/
│  │  ├─ TelemetryRecorder.ts
│  │  ├─ TelemetryChannel.ts
│  │  ├─ LapTelemetry.ts
│  │  └─ TelemetryExport.ts
│  │
│  ├─ replay/
│  │  ├─ ReplayRecorder.ts
│  │  ├─ ReplayPlayer.ts
│  │  └─ ReplayCameraDirector.ts
│  │
│  ├─ ui/
│  │  ├─ HUD.ts
│  │  ├─ TimingTower.ts
│  │  ├─ SteeringDisplay.ts
│  │  ├─ SetupMenu.ts
│  │  ├─ GraphicsMenu.ts
│  │  └─ TelemetryScreen.ts
│  │
│  ├─ workers/
│  │  ├─ physics.worker.ts
│  │  ├─ ai.worker.ts
│  │  └─ telemetry.worker.ts
│  │
│  └─ tests/
│     ├─ physics/
│     ├─ tires/
│     ├─ aero/
│     ├─ drivetrain/
│     ├─ race/
│     ├─ ai/
│     └─ integration/
│
├─ e2e/
├─ scripts/
├─ vite.config.ts
├─ tsconfig.json
└─ package.json

```

This structure is guidance, not an excuse to create empty files.

Never create placeholder modules merely to satisfy a directory tree.

---

# 5. GAME LOOP

Implement explicitly separated loops.

Rendering must NEVER drive simulation timing.

Use:

```ts
const PHYSICS_HZ = 120;
const PHYSICS_DT = 1 / PHYSICS_HZ;

```

Potential optional tire/contact substep:

```ts
const TIRE_SUBSTEPS = 2;

```

Resulting tire solve:

240 Hz.

Main pattern:

```ts
accumulator += Math.min(frameDelta, MAX_FRAME_DELTA);

while (accumulator >= PHYSICS_DT) {
    previousState.copy(currentState);

    simulation.step(PHYSICS_DT);

    accumulator -= PHYSICS_DT;
}

const alpha = accumulator / PHYSICS_DT;

renderer.renderInterpolated(previousState, currentState, alpha);

```

Never perform important physics using `requestAnimationFrame()` delta directly.

Test simulation under artificial render limits:

- 24 FPS
- 30 FPS
- 60 FPS
- 90 FPS
- 120 FPS
- 144 FPS

Lap time and trajectory should remain materially consistent.

---

# 6. PHYSICS COORDINATE SYSTEM

Define a single canonical system.

Example:

+X = vehicle right
+Y = up
+Z = vehicle forward

Or choose another convention.

Document it.

Use it everywhere.

Never mix Three.js conventions and vehicle-local conventions silently.

Provide explicit helpers:

```ts
worldToVehicleVector()
vehicleToWorldVector()
worldToWheelVector()
wheelToWorldVector()

```

Maintain SI units internally:

- metres
- seconds
- kilograms
- Newtons
- Newton-metres
- radians
- Kelvin/Celsius where explicit
- Pascals where necessary

Never internally mix km/h with m/s.

---

# 7. RIGID BODY STATE

Vehicle state must contain at least:

```ts
interface VehicleRigidState {
    position: Vector3;
    orientation: Quaternion;

    linearVelocity: Vector3;
    angularVelocity: Vector3;

    linearAcceleration: Vector3;
    angularAcceleration: Vector3;

    totalForce: Vector3;
    totalTorque: Vector3;
}

```

Vehicle configuration:

```ts
interface ChassisConfig {
    massKg: number;
    inertiaTensor: Matrix3;
    cgOffset: Vector3;

    wheelbaseM: number;
    frontTrackM: number;
    rearTrackM: number;

    referenceAreaM2: number;
}

```

Mass must update with:

- fuel quantity
- damage/lost body parts if modeled materially

---

# 8. FORCE ACCUMULATION

Every physics step:

1. clear force accumulator
2. calculate gravity
3. query suspension contacts
4. calculate suspension forces
5. calculate tire forces
6. calculate drivetrain forces
7. calculate brake torques
8. calculate aero forces
9. calculate floor forces
10. calculate collision impulses
11. integrate rigid body
12. update thermal systems
13. update wear
14. update damage
15. emit telemetry

Apply forces at actual application points.

Use:

```ts
torque += r.cross(force);

```

Do NOT collapse everything into force through center of mass.

---

# 9. INTEGRATOR

Use a stable integrator.

Prefer semi-implicit Euler initially:

```text
v += a * dt
x += v * dt
ω += α * dt
q += quaternionDerivative(ω) * dt
normalize(q)

```

If necessary, improve angular integration.

Never allow quaternion drift.

Add debug assertions for:

- non-finite vectors
- invalid quaternion magnitude
- impossible velocities
- impossible wheel speeds

---

# 10. WHEEL CONTACT MODEL

Avoid simplistic chassis raycasts only at visual wheel centres without suspension geometry.

Each wheel requires:

```ts
interface WheelContact {
    grounded: boolean;
    pointWorld: Vector3;
    normalWorld: Vector3;
    distance: number;
    surfaceId: number;
    surfaceVelocity: Vector3;
}

```

Use BVH-accelerated track queries.

Use `three-mesh-bvh` or equivalent.

Collision mesh must be distinct from graphics mesh when necessary.

Ensure smooth contact over triangle seams.

If raycast instability becomes visible, evaluate sphere cast / multi-ray contact approximation.

---

# 11. SUSPENSION CORNER

Each wheel has:

```ts
interface SuspensionState {
    lengthM: number;
    previousLengthM: number;
    compressionM: number;
    velocityMS: number;
    normalLoadN: number;
}

```

Force:

```text
Fspring = k * compression
Fdamper = c * compressionVelocity

```

Support separate:

- bump damping
- rebound damping

Add progressive bump-stop force near minimum travel.

Example:

```text
FbumpStop = kBump * penetration²

```

Prevent negative attractive suspension force when wheel becomes unloaded unless geometry explicitly demands it.

Implement anti-roll bars through axle compression difference.

---

# 12. TIRE MODEL

This system receives more engineering time than almost anything else.

Each tire state:

```ts
interface TireState {
    angularVelocity: number;

    slipRatio: number;
    slipAngle: number;

    verticalLoadN: number;

    longitudinalForceN: number;
    lateralForceN: number;

    surfaceTempC: number;
    carcassTempC: number;

    pressureKPa: number;

    wear01: number;
    dirt01: number;
    blistering01: number;
    graining01: number;
    flatSpot01: number;

    compound: TireCompound;
}

```

---

# 13. SLIP RATIO

Use a numerically safe definition.

Example:

```text
Vwheel = omega * effectiveRadius

kappa =
(Vwheel - Vx) /
max(abs(Vx), Vregularization)

```

Use low-speed blending near zero vehicle velocity.

Do not permit slip ratio to explode at 0.1 km/h.

---

# 14. SLIP ANGLE

Wheel local velocity:

```text
Vlocal = Rwheel^-1 * Vcontact

```

Then:

```text
alpha = atan2(Vlateral, abs(Vlongitudinal) + epsilon)

```

Correct sign consistently.

Steering must change wheel basis before slip calculation.

---

# 15. PACEJKA-LIKE FORCE CURVES

Implement a physically motivated nonlinear tire-force curve.

Do not blindly paste arbitrary Magic Formula constants.

Provide tuned parameter sets for each compound.

General form:

```text
F = D * sin(C * atan(Bx - E(Bx - atan(Bx))))

```

Where:

B = stiffness
C = shape
D = peak
E = curvature

Use separate longitudinal/lateral parameterization.

Normalize force based on current vertical load and grip modifiers.

---

# 16. LOAD SENSITIVITY

Tire grip must exhibit load sensitivity.

A simplified model:

```text
mu(Fz) = muRef * (Fz / FzRef)^loadExponent

```

with exponent below zero or equivalent formulation.

Then:

```text
Fpeak = mu(Fz) * Fz

```

Result:

Two tires each carrying 3000 N should collectively have somewhat more usable grip than one tire carrying 6000 N.

This is crucial to realistic weight-transfer behavior.

---

# 17. COMBINED SLIP

Use friction ellipse.

Calculate provisional:

```text
Fx0
Fy0

```

Then normalize:

```text
usage =
sqrt(
  (Fx0 / FxMax)^2 +
  (Fy0 / FyMax)^2
)

```

If usage > 1:

```text
Fx = Fx0 / usage
Fy = Fy0 / usage

```

A more sophisticated weighting function is preferable later.

Braking while cornering must reduce available lateral force.

---

# 18. TIRE TEMPERATURE

Use at least two thermal masses:

- surface
- carcass

Surface heats quickly.

Carcass heats slowly.

Heat sources:

- longitudinal slip
- lateral slip
- hysteresis/load
- braking transfer where physically defensible

Cooling:

- ambient air
- speed-dependent convection
- rain/water
- conduction between surface and carcass

Example conceptual equations:

```text
Qslip = abs(Fx * VslipLong) + abs(Fy * VslipLat)

```

Temperature evolution:

```text
dTsurface/dt =
(Qslip
 - convection
 - waterCooling
 - conductionToCarcass)
 / thermalCapacitySurface

```

Do not globally change temperature with arbitrary timers.

---

# 19. TEMPERATURE GRIP CURVE

Compound defines:

```ts
interface TireCompoundConfig {
    idealTempMinC: number;
    idealTempMaxC: number;
    coldGripPenalty: number;
    hotGripPenalty: number;
    wearRate: number;
    wetPerformance: number;
}

```

Grip modifier should follow smooth curves.

No sudden cliff exactly at one temperature.

---

# 20. TIRE WEAR

Calculate wear from accumulated energy:

```text
wearEnergy +=
abs(Fx * slipVelocityLong) * dt +
abs(Fy * slipVelocityLat) * dt

```

Scale by:

- compound
- temperature
- surface type
- excessive slide
- wheel lock
- wheelspin

Wear changes:

- peak friction
- temperature behavior
- consistency
- puncture likelihood at extreme wear

---

# 21. FLAT SPOTS

If wheel remains significantly locked under high load/speed:

increase local flat-spot severity.

Consequences:

- periodic vibration
- reduced tire smoothness
- cockpit feedback
- audible thumping
- possible performance loss

Do not implement as UI only.

---

# 22. TIRE CONTAMINATION

Off-track surfaces increase contamination:

```text
dirt += contaminationRate * dt

```

Returning to asphalt cleans over:

- wheel rotations
- distance
- temperature

Dirt temporarily reduces available friction.

---

# 23. BRAKE SYSTEM

Each axle/wheel receives brake torque.

Input:

```text
0..1 brake pedal

```

Total requested braking torque distributed using brake bias.

Example:

```text
frontTorque =
totalTorque * frontBias

rearTorque =
totalTorque * (1-frontBias)

```

But include:

- hydraulic pressure approximation
- brake disc temperature
- friction-temperature relationship
- regen interaction

---

# 24. BRAKE THERMALS

Brake discs:

```ts
interface BrakeDiscState {
    tempC: number;
    energyJ: number;
}

```

Heat from:

```text
Q = brakeTorque * wheelAngularVelocity

```

Cooling increases with speed.

Model reduced performance when:

- extremely cold
- overheated

Do not exaggerate unless tuning supports it.

---

# 25. LOCKUP

Lockup emerges naturally when requested brake torque exceeds tire-road capacity.

Do not trigger lockup through a random threshold.

Detect:

- very low wheel angular velocity
- substantial forward vehicle velocity
- high negative slip ratio

Feed lockup into:

- tire force model
- tire temperature
- flat spot
- smoke
- audio
- steering feedback

---

# 26. ENGINE MODEL

Define torque curve as sampled data.

Example:

```ts
interface TorqueCurvePoint {
    rpm: number;
    torqueNm: number;
}

```

Interpolate between points.

Engine state:

```ts
interface EngineState {
    rpm: number;
    throttle: number;
    torqueNm: number;
    limiterActive: boolean;
}

```

Output depends on:

- RPM
- throttle
- engine condition
- fuel availability
- hybrid contribution

Do not set acceleration directly.

---

# 27. GEARBOX

Implement:

- neutral
- reverse
- gears 1–8
- gear ratios
- final drive
- shift duration
- shift torque cut
- rev limiter
- invalid downshift rejection/over-rev handling

Wheel torque:

```text
Twheel =
(Tengine + Tmotor)
* currentGearRatio
* finalDrive
* efficiency

```

---

# 28. DIFFERENTIAL

Model driven-wheel speed difference.

Support setup values:

```ts
diffOnThrottle01
diffOffThrottle01

```

Higher locking reduces left/right speed difference.

It must affect:

- rotation
- exit traction
- inside-wheel spin
- stability

Do not implement as simple steering multiplier.

---

# 29. HYBRID SYSTEM

Track:

```ts
batteryEnergyJ
maxBatteryEnergyJ
motorPowerW
regenPowerW
deploymentMode

```

Deployment strategies:

- harvest
- balanced
- attack

Motor torque:

```text
Tmotor = Power / angularVelocity

```

with safe limits at low RPM.

ERS consumption must physically reduce stored energy.

Regeneration adds stored energy subject to:

- power cap
- battery cap
- braking conditions

---

# 30. AERODYNAMICS

Base equation:

```text
F = 0.5 * rho * v² * C * A

```

Separate:

- front wing
- rear wing
- floor
- drag

Apply front and rear forces at distinct centers of pressure.

This creates pitch/yaw torque naturally.

---

# 31. AERO MAP

Do not use one static downforce coefficient.

Aero coefficients should respond to:

- speed
- ride height front
- ride height rear
- pitch
- yaw
- wing settings
- damage

Use sampled/interpolated aero maps.

Example:

```ts
interface AeroSample {
    frontRideHeight: number;
    rearRideHeight: number;
    pitchRad: number;
    clFront: number;
    clRear: number;
    cd: number;
}

```

Interpolate between points.

---

# 32. GROUND EFFECT

Floor downforce should have an optimal ride-height region.

Too high:
reduced floor suction.

Optimal:
strong downforce.

Too low:
partial choking/stall/bottoming.

Create a smooth nonlinear response.

Do NOT instantly remove all floor grip below arbitrary threshold.

---

# 33. BOTTOMING

When floor/skid region contacts track:

- calculate contact
- produce sparks
- add vibration
- temporarily modify aero
- optionally induce instability

Frequency and severity based on actual contact energy.

---

# 34. WAKE / DIRTY AIR

Each car emits an approximate aerodynamic wake.

Represent efficiently as one or more downstream volumes.

Wake data:

```ts
interface WakeSample {
    center: Vector3;
    direction: Vector3;
    length: number;
    radiusNear: number;
    radiusFar: number;
    downforceLoss: number;
    dragReduction: number;
}

```

Following car computes overlap.

Effects depend on:

- longitudinal distance
- lateral offset
- relative yaw
- speed

Primarily reduce front aero when close behind.

Straight-line drag reduction should permit slipstream effect.

---

# 35. SURFACE TYPES

Create enum:

```ts
enum SurfaceType {
    Asphalt,
    PaintedAsphalt,
    Kerb,
    Concrete,
    Grass,
    Gravel,
    WetAsphalt,
    StandingWater
}

```

Each surface config:

```ts
interface SurfacePhysics {
    dryGrip: number;
    wetGrip: number;
    rollingResistance: number;
    roughness: number;
    contaminationRate: number;
}

```

Rendering material is separate from physics surface.

---

# 36. TRACK SPLINE

Represent circuit centerline with a high-resolution spline.

Each sampled point stores:

```ts
interface TrackSample {
    s: number;
    position: Vector3;
    tangent: Vector3;
    normal: Vector3;
    binormal: Vector3;

    leftWidth: number;
    rightWidth: number;

    curvature: number;
    camber: number;
    gradient: number;
}

```

`s` is distance around lap.

Use this system for:

- timing
- AI
- track limits
- telemetry position
- replay
- racing line
- pit detection

---

# 37. TRACK SURFACE STATE GRID

Track must possess dynamic surface state.

Sample track into longitudinal/lateral cells.

Example:

```ts
interface TrackCell {
    rubber01: number;
    waterMm: number;
    tempC: number;
    marbles01: number;
    dirt01: number;
}

```

Do NOT update every cell every physics tick.

Use scheduled updates.

Vehicle interaction updates nearby cells.

---

# 38. RUBBERING

Each tire deposits rubber based on:

- tire load
- slip
- tire type
- current rubber

Dry rubber improves dry grip up to a sensible limit.

Heavy rain can reduce or alter that advantage.

Racing line should visibly darken over session duration.

---

# 39. MARBLES

Generate marbles primarily outside high-usage racing zones.

Driving through marbles:

- reduces grip
- contaminates tire
- produces particles

---

# 40. WATER MODEL

Rain adds water spatially.

Drainage removes it.

Cars displace it.

Evaporation removes it.

Track slope can influence approximate drainage.

Do NOT maintain a single global wetness scalar.

---

# 41. AQUAPLANING

Probability/severity depends on:

- water depth
- speed
- tire compound
- tread suitability
- tire load

Modify effective vertical/grip behavior smoothly.

Avoid binary aquaplaning trigger.

---

# 42. WEATHER TIMELINE

Represent:

```ts
interface WeatherKeyframe {
    timeSec: number;
    cloudCover01: number;
    rainRateMmHr: number;
    ambientTempC: number;
    windSpeedMS: number;
    windDirection: number;
}

```

Interpolate over time.

Weather must affect:

- light
- track temperature
- rain particles
- surface water
- visibility
- tire temperatures
- strategy
- AI

---

# 43. AI ARCHITECTURE

AI has three layers.

## Layer 1 — Strategic

Runs around 1–5 Hz.

Determines:

- pit strategy
- tire selection
- ERS plan
- risk level

## Layer 2 — Tactical

Runs 10–20 Hz.

Determines:

- racing line
- overtaking
- defending
- traffic response
- yellow flag behavior

## Layer 3 — Control

Runs at physics rate or 60–120 Hz.

Produces:

- steering
- throttle
- brake
- gear command

---

# 44. AI SPEED PLANNING

Calculate target speed from upcoming curvature.

Approximation:

```text
vMax ≈ sqrt(mu * g / curvature)

```

Then improve using:

- downforce
- tire state
- fuel mass
- wetness
- vehicle setup

Look ahead multiple seconds.

Solve backward braking profile.

Do not simply brake when within fixed metres of corner waypoint.

---

# 45. AI RACING LINE

Represent racing line separately from track centerline.

Generate or author line offsets along track.

AI target point:

```text
targetS = currentS + lookAheadDistance

```

Lookahead changes with speed.

Use smooth lateral offset interpolation.

Never drive from discrete waypoint to waypoint with visible oscillation.

---

# 46. AI OVERTAKING

Implement relative-state prediction.

For nearby cars calculate:

- distance
- closing speed
- projected overlap
- braking-zone arrival
- side availability
- track edge
- collision risk

Overtake options:

- remain behind
- move left
- move right
- late-brake attempt
- crossover
- abort

Score each option.

Do not force an overtake merely because AI is faster.

---

# 47. AI DEFENSE

Defending car may:

- hold racing line
- cover inside
- return toward optimal line before braking where legal logic allows
- conserve tires
- prioritize exit

Avoid zigzag blocking.

---

# 48. COLLISION PREDICTION

Predict short-horizon trajectories.

Use oriented bounding boxes or swept approximations.

AI must react before collision, not only after touching.

---

# 49. AI PERSONALITIES

Each driver:

```ts
interface DriverPersonality {
    aggression: number;
    consistency: number;
    wetSkill: number;
    overtakingSkill: number;
    tireManagement: number;
    defensiveBias: number;
    errorRate: number;
}

```

Personality modifies decisions, not physical grip.

---

# 50. AI ERROR MODEL

Occasional mistakes may occur from:

- braking variance
- throttle variance
- line deviation
- reaction delay

Probability increases under:

- pressure
- worn tires
- wet conditions
- overheating

Do not randomly spin cars without physical cause.

---

# 51. COLLISION SYSTEM

Broad phase:

- spatial hash
- BVH
- sweep-and-prune

Narrow phase:

- chassis primitive/convex hull
- barriers
- wheels where necessary

Resolve impulse:

```text
j =
-(1 + restitution) * relativeNormalVelocity
/
(invMassA + invMassB + rotationalTerms)

```

Include friction impulse.

Avoid excessive restitution.

---

# 52. DAMAGE ENERGY

Impact severity should derive from:

- relative velocity
- impulse
- contact location
- angle

Map impact to:

- front wing
- suspension
- floor
- sidepod
- rear wing

No arbitrary damage solely based on speed.

---

# 53. DAMAGE PHYSICS

Examples:

Front-wing damage:

```text
frontCL *= damageMultiplier
frontDrag += damageDrag

```

Floor damage:

```text
floorCL *= floorHealth

```

Suspension damage:

- toe offset
- camber offset
- spring/damper alteration
- steering misalignment

Tire puncture:

- loss of stiffness
- effective radius changes
- huge drag
- severe vibration

---

# 54. RENDER PIPELINE

Create explicit rendering stages.

Example:

1. shadow maps
2. main opaque scene
3. transparent effects
4. wet/reflection contributions
5. post processing
6. HUD

Keep renderer abstraction separate from gameplay.

---

# 55. PBR

Use:

`MeshStandardMaterial`

or:

`MeshPhysicalMaterial`

where appropriate.

Cars require:

- clearcoat
- metallic paint
- carbon
- rubber
- glass
- anodized metal

Do not make entire car equally glossy.

---

# 56. CARBON FIBER SHADER

Carbon should have:

- micro-normal weave
- angle-dependent highlight
- roughness variation

Avoid giant obvious checkerboard weave.

Mip-map or frequency-limit procedural pattern to prevent shimmer.

---

# 57. WET ROAD SHADER

Road wetness depends on `waterMm`.

Shader should blend:

- darker albedo
- reduced roughness
- reflection strength
- normal response

Concept:

```text
wetness = saturate(waterMm / WET_MAX)
roughness = mix(dryRoughness, wetRoughness, wetness)
albedo = mix(dryAlbedo, dryAlbedo * 0.6, wetness)

```

Add shallow puddle behavior selectively.

---

# 58. REFLECTIONS

Use appropriate combination of:

- environment maps
- reflection probes
- planar-ish local techniques where justified
- screen-space approximation if stable

Do not attempt expensive perfect reflections everywhere.

Prioritize:

- wet track
- car body
- cockpit reflective materials

---

# 59. SHADOWS

Use high-quality directional shadows around player.

Possible cascaded shadow mapping.

Far objects may use reduced quality.

Prevent:

- acne
- peter-panning
- flicker

---

# 60. LIGHTING

At minimum:

- sun directional light
- sky/environment illumination
- physically plausible exposure
- atmospheric haze

Lighting should change with weather.

Cloudiness should:

- soften sun
- reduce contrast
- alter ambient illumination

---

# 61. ATMOSPHERE

Implement distance haze.

Use depth-aware fog rather than flat opaque fog where possible.

Track should possess readable distant geography.

---

# 62. MOTION BLUR

If implemented, use velocity-aware or camera-aware approximation.

Do not smear HUD.

Do not use excessive blur to fake speed.

---

# 63. SPEED PERCEPTION

Use:

- environment parallax
- restrained dynamic FOV
- cockpit vibration
- wind volume
- suspension movement
- peripheral blur where tasteful
- trackside density

At 300 km/h, speed must feel violent but controllable.

---

# 64. CAMERA DYNAMICS

Do not rigidly parent camera directly to chassis orientation.

Maintain filtered camera transform.

Inputs:

- longitudinal acceleration
- lateral acceleration
- vertical acceleration
- yaw rate
- suspension impact

Use spring-damper camera dynamics.

Example:

```text
cameraOffsetAcceleration =
k*(targetOffset-currentOffset)
-c*offsetVelocity

```

---

# 65. COCKPIT CAMERA

Cockpit should provide:

- small inertial lag
- braking compression
- lateral G response
- kerb vibration
- crash shock

Do not overdo head movement.

Driver still needs visual precision.

---

# 66. TRACKSIDE CAMERAS

Trackside cameras contain:

```ts
position
lookTargetRegion
startS
endS
fov
trackingSpeed

```

Replay director chooses best camera based on player position.

Camera should pan predictively.

---

# 67. PARTICLES

Use pooled GPU-friendly particles.

Separate systems:

- sparks
- smoke
- spray
- dust
- grass/debris

Never instantiate thousands of Three.js objects per frame.

---

# 68. RAIN SPRAY

Spray emission rate depends on:

```text
speed * wheelWaterDepth * tireFactor

```

Spawn from rear-wheel region.

Particle:

- velocity aligned behind car
- turbulence
- opacity decay
- size growth

Heavy spray should impair visibility.

---

# 69. TIRE SMOKE

Smoke emitted from actual excessive slip.

Intensity approximately related to sliding energy.

Do not emit smoke whenever braking.

---

# 70. SPARKS

Sparks emit only when underside contact energy exceeds threshold.

Direction influenced by vehicle velocity and track normal.

---

# 71. AUDIO ARCHITECTURE

Use AudioContext graph.

Vehicle audio consists of layers.

Example:

```text
masterVehicleGain
 ├── engineLow
 ├── engineMid
 ├── engineHigh
 ├── intake
 ├── exhaust
 ├── gearbox
 ├── hybrid
 ├── wind
 ├── tire
 └── impacts

```

---

# 72. ENGINE SOUND

Do NOT use one sample with extreme playbackRate.

Use multiple RPM bands.

Crossfade bands.

Modulate with:

- RPM
- throttle
- engine load
- camera position

Cockpit sound differs from external sound.

---

# 73. TIRE AUDIO

Tire scrub volume derived from:

```text
abs(lateralSlipEnergy) + abs(longitudinalSlipEnergy)

```

Change spectral quality across:

- mild scrub
- heavy slide
- lockup
- wheelspin

---

# 74. SURFACE AUDIO

Different loops/impulses for:

- asphalt
- kerb
- grass
- gravel

Kerb frequency comes from actual contact sequence.

---

# 75. DOPPLER

External cars should use physically sensible Doppler.

Avoid exaggerated science-fiction pitch shifts.

---

# 76. INPUT PIPELINE

Raw device input:

```text
device
→ deadzone
→ calibration
→ response curve
→ assist
→ vehicle controller
→ simulation

```

Never bypass this architecture.

---

# 77. GAMEPAD STEERING

Support:

- deadzone
- saturation
- exponent
- speed-sensitive assistance OPTIONAL

Formula:

```text
output =
sign(x) * pow(abs(normalizedX), exponent)

```

Provide user tuning.

---

# 78. KEYBOARD STEERING

Keyboard must ramp steering.

Track:

```text
currentSteering
targetSteering

```

Use velocity-limited convergence.

Recentering may use different rate from turn-in.

---

# 79. WHEEL INPUT

If browser recognizes wheel as gamepad/HID-compatible device:

allow calibration.

Support:

- steering axis
- throttle
- brake
- clutch
- paddles

Never assume Xbox mapping.

---

# 80. TELEMETRY DATA

Record at 60–120 Hz.

Suggested record:

```ts
interface TelemetryFrame {
    time: number;
    lapDistance: number;

    speedMS: number;

    throttle: number;
    brake: number;
    steering: number;

    gear: number;
    rpm: number;

    gLong: number;
    gLat: number;

    tireSlipRatio: Float32Array;
    tireSlipAngle: Float32Array;
    tireLoads: Float32Array;
    tireTemps: Float32Array;
    tireWear: Float32Array;

    rideHeights: Float32Array;

    aeroFrontN: number;
    aeroRearN: number;

    batteryEnergy: number;
}

```

Use typed arrays/ring buffers to avoid garbage.

---

# 81. TELEMETRY UI

Display:

- speed
- throttle
- brake
- steering
- gear
- RPM
- lateral G
- longitudinal G
- tire temps
- tire slip
- ride height
- aero balance

Allow comparison between laps.

Overlay traces by lap distance, not merely timestamp.

---

# 82. REPLAY SYSTEM

Do not record enormous full scene snapshots.

Record compact car state.

For each frame:

- position
- quaternion
- wheel rotations
- steering angle
- suspension travel
- animation state
- important effects flags

Interpolate playback.

For precise deterministic re-sim, optionally record inputs plus random seed.

---

# 83. RACE DIRECTOR

Use explicit state machine.

Possible session states:

```text
Loading
Grid
Formation
StartSequence
Racing
SafetyState
Finished
Results

```

Flags and penalties are event-driven.

---

# 84. START LIGHTS

Implement real sequence timing.

AI reaction times vary.

Player jump-start can be detected if wheels/car move before valid start.

---

# 85. LAP DETECTION

Do not detect lap simply through collision with finish plane.

Require:

- proper progression along track spline
- crossing start/finish in correct direction
- checkpoint progression

Prevent shortcut exploit.

---

# 86. TRACK LIMITS

Determine each tire's lateral position relative to valid track boundary.

Implement accurate line/kerb policy.

Record violations.

Avoid false penalties from chassis center point.

---

# 87. PIT LANE

Pit lane must have separate spline.

Detect:

- entry
- limiter line
- pit boxes
- exit line

Pit limiter clamps requested drivetrain output, not vehicle velocity teleport.

---

# 88. PIT STOP

When stopped correctly:

state machine:

```text
ApproachingBox
Stopping
Jacked
WheelRemoval
WheelInstall
Repair
Release

```

Visual timing should correspond to functional tire replacement.

---

# 89. SETUP SYSTEM

Store:

```ts
interface CarSetup {
    frontWing: number;
    rearWing: number;

    brakeBias: number;

    diffOnThrottle: number;
    diffOffThrottle: number;

    frontSpring: number;
    rearSpring: number;

    frontARB: number;
    rearARB: number;

    frontRideHeight: number;
    rearRideHeight: number;

    frontPressure: number;
    rearPressure: number;

    frontCamber: number;
    rearCamber: number;

    frontToe: number;
    rearToe: number;
}

```

Each field must map into actual simulation parameter.

---

# 90. HUD DESIGN

Create original motorsport UI.

HUD data:

- speed
- RPM
- gear
- throttle
- brake
- ERS
- battery
- fuel
- lap
- position
- delta
- flags
- tire state
- brake state

Do not reproduce an existing game's exact layout.

---

# 91. STEERING-WHEEL DISPLAY

Cockpit wheel display should use actual simulation state.

Render to texture/canvas if useful.

Include:

- gear
- speed
- RPM lights
- ERS
- lap delta
- brake bias
- differential setting

---

# 92. GRAPHICS SETTINGS

Provide:

Resolution scale

Texture quality

Shadow quality

Reflection quality

Particles

Crowd

Environment

Post-processing

Motion blur

Anti-aliasing

Anisotropic filtering

---

# 93. PERFORMANCE BUDGET

Normal target:

60 FPS.

Physics:

prefer < 3 ms/frame amortized.

AI:

prefer < 2–4 ms for full field where possible.

Rendering CPU:

prefer < 5 ms.

GPU:

target < 16.6 ms total at selected quality.

These are targets, not reasons to falsify profiling.

---

# 94. OBJECT ALLOCATION

Hot loops must avoid garbage.

Avoid:

```ts
new Vector3()
new Quaternion()
new Array()

```

inside physics loops.

Reuse scratch objects.

Use typed arrays where high frequency demands it.

---

# 95. LOD

Cars:

LOD0 close
LOD1 medium
LOD2 distant

Trackside props similarly.

Avoid visual popping.

Use hysteresis.

---

# 96. INSTANCING

Use `InstancedMesh` for repeated:

- crowd elements
- fencing sections
- vegetation
- bollards
- trackside props
- lights where practical

---

# 97. TEXTURE MANAGEMENT

Use:

- KTX2/Basis where supported
- mipmaps
- anisotropic filtering
- proper texture color spaces

Do not load uncompressed giant PNGs everywhere.

---

# 98. ASSET STREAMING

Critical assets first.

Load:

1. basic track
2. player car
3. essential UI
4. nearby scenery
5. distant detail

Provide loading progress.

---

# 99. PHYSICS WORKER

Move physics to Worker if synchronization architecture remains reliable.

Use SharedArrayBuffer only if deployment headers support it.

Otherwise use efficient transferable state buffers.

Do not create a complicated worker design that introduces input latency or one-frame inconsistency without measurable benefit.

---

# 100. AI WORKER

Strategic/tactical AI is ideal worker candidate.

Keep high-frequency control predictable.

---

# 101. DEBUG OVERLAY

Toggle with developer key.

Show:

```text
FPS
frame time
physics time
GPU estimate
draw calls
triangles

speed
yaw rate
pitch
roll
G forces

wheel:
 Fz
 Fx
 Fy
 slip
 temp
 wear

aero:
 front
 rear
 drag
 balance

surface:
 material
 water
 rubber

AI:
 target speed
 target path
 decision

```

---

# 102. VISUAL DEBUGGING

Optional overlays:

- contact points
- tire force vectors
- suspension rays
- racing line
- AI target
- track spline
- wake volumes
- collision bounds
- track cells

These are engineering tools, not player UI.

---

# 103. UNIT TESTS

Use Vitest.

Test:

- interpolation
- curve sampling
- slip computation
- friction ellipse
- aero equations
- drivetrain ratio
- brake distribution
- track progress
- race state
- setup serialization

---

# 104. PHYSICS PROPERTY TESTS

Required tests:

## Aero

At identical configuration:

```text
F(200 km/h) ≈ 4 * F(100 km/h)

```

within tolerance.

## Mass

Heavier car should accelerate slower for same net force.

## Grip

Wet slick grip < dry slick grip.

## Load sensitivity

2x vertical load must produce <2x peak lateral force.

## Brake bias

Increasing front bias increases front lock tendency.

---

# 105. DETERMINISM TEST

Run same:

- initial state
- input sequence
- weather
- seed

multiple times.

Trajectory differences must remain extremely small.

Record hash/checksum periodically.

---

# 106. FRAME-INDEPENDENCE TEST

Run simulation under render FPS:

30
60
120

Same input script.

Compare:

- lap time
- path
- max speed
- tire wear
- fuel usage

Differences must be negligible.

---

# 107. STRAIGHT-LINE TEST

Automated car:

full throttle.

Validate:

- no steering drift
- sensible wheelspin
- gear shifts
- speed progression
- top speed

---

# 108. SKIDPAD TEST

Circular test environment.

Measure steady-state lateral G against speed/radius.

Use this to tune tires.

---

# 109. BRAKING TEST

From defined speeds:

100 km/h
200 km/h
300 km/h

Full braking.

Measure:

- stopping distance
- wheel slips
- temperatures
- stability

---

# 110. SLALOM TEST

Repeated steering sequence.

Look for:

- excessive oscillation
- nonphysical yaw amplification
- instability
- input latency

---

# 111. KERB TEST

Automated traversal over:

- low kerb
- high kerb
- sausage kerb

Observe:

- suspension
- contact
- chassis motion
- tire load
- floor strike

---

# 112. WET TEST

Repeat dry benchmark on:

- damp
- wet
- standing water

Performance should degrade coherently.

---

# 113. DAMAGE TEST

Damage front wing.

Repeat corner test.

Front grip must decrease measurably.

---

# 114. WAKE TEST

Two cars.

Leader constant speed.

Follower:

far behind
medium distance
close distance
offset laterally

Measure:

- downforce loss
- drag change

Ensure smooth transition.

---

# 115. AI TESTS

AI must complete:

100 consecutive laps

without:

- unexplained crashes
- leaving track systematically
- deadlocks
- pit-loop failures
- numerical instability

Run multi-car simulation.

---

# 116. RACE TEST

Automated full race including:

- start
- traffic
- overtakes
- pit stops
- tire degradation
- flags
- finish

Zero fatal errors.

---

# 117. PLAYWRIGHT TESTS

Automate:

- game loads
- menu navigation
- session start
- pause
- settings
- graphics changes
- reset
- results screen

Check browser console.

No unhandled exceptions.

---

# 118. PERFORMANCE REGRESSION

Record benchmark.

Store:

- mean FPS
- p1 FPS
- CPU frame time
- draw calls
- triangle count

Reject major unexplained regressions.

---

# 119. ERROR POLICY

Never suppress errors merely to make console clean.

Fix cause.

Do not use:

```ts
try { ... } catch {}

```

around broken logic.

---

# 120. NUMERICAL SAFETY

Every critical subsystem must guard:

```text
Number.isFinite()

```

during debug builds.

Clamp only when physically justified.

Do not use giant arbitrary clamps to hide instability.

---

# 121. PHYSICS TUNING

Tune in this order:

1. mass/inertia
2. suspension
3. tire vertical load
4. longitudinal tire
5. lateral tire
6. combined slip
7. braking
8. drivetrain
9. aero
10. ground effect
11. setup sensitivity
12. controller filtering

Never compensate for wrong tires by adding fake steering yaw.

---

# 122. VISUAL QUALITY PASSES

After functionality, perform distinct passes.

## Geometry pass

Find:

- blocky assets
- visibly low-poly curves
- empty environments
- repeated obvious props

Fix.

## Material pass

Find:

- uniform roughness
- plastic-looking carbon
- incorrect metallic surfaces
- flat road

Fix.

## Lighting pass

Find:

- washed highlights
- dead shadows
- flat scene
- unrealistic exposure

Fix.

## Motion pass

Find:

- static suspension
- wheel jitter
- rigid driver hands
- dead environment

Fix.

---

# 123. CAR MODEL REQUIREMENTS

Original Formula car must visually include:

- multi-element front wing
- nose
- front suspension
- wheel uprights
- brake ducts
- detailed rims
- physically convincing tires
- mirrors
- halo
- sidepods
- floor edge detail
- diffuser
- rear suspension
- beam wing
- rear wing
- airbox
- engine cover
- rain light
- antenna
- cockpit

No rectangular toy-car body.

---

# 124. COCKPIT QUALITY

At cockpit camera distance, player must see:

- stitching/material variation
- wheel buttons
- paddles
- display
- LEDs
- gloves
- hand animation
- halo detail
- carbon weave
- mirror surfaces

Cockpit must withstand close inspection.

---

# 125. DRIVER ANIMATION

Map steering input to hands.

Use appropriate steering-wheel rotation.

Hands remain attached.

Animate:

- shift paddles
- button input where visible
- steering recovery

Avoid robotic clipping.

---

# 126. VISUAL SUSPENSION

Wheel transform must derive from physical suspension state.

Do not create separate decorative suspension animation.

---

# 127. TIRE DEFORMATION

Optional advanced feature:

Use subtle shader/mesh deformation from:

- load
- centrifugal expansion
- contact

Do not make tires visibly cartoon-squishy.

---

# 128. TRACK DETAIL DENSITY

Each environment should contain realistic layered density:

Near track:

- drainage
- seams
- rubber
- skid marks
- bolts
- fences
- barrier joins
- marshal posts
- signs
- cables
- tire stacks where appropriate
- access gates

Midground:

- stands
- service roads
- trucks
- buildings
- infrastructure

Background:

- terrain
- skyline
- vegetation
- city/mountain context

---

# 129. NO PROCEDURAL SLOP

Procedural generation must not create:

- random poles in nonsensical locations
- impossible roads
- repeated identical crowd blocks
- floating barriers
- inconsistent fencing
- giant texture repetition

Procedural systems require design rules.

---

# 130. CIRCUIT PHYSICS FIDELITY

Track physical mesh must preserve:

- camber
- banking
- gradient
- kerb height
- surface transition

High-speed car should react to actual geometry.

---

# 131. UI PRINCIPLE

Build original UI inspired by professional motorsport data systems.

Avoid generic AI aesthetics:

- enormous gradient blobs
- excessive rounded cards
- neon everywhere
- meaningless glass panels

Prefer:

- compact typography
- grid alignment
- telemetry density
- restrained accent colors
- strong hierarchy

---

# 132. MENU PERFORMANCE

Menus should respond instantly.

Do not pause rendering with large synchronous operations.

---

# 133. ACCESSIBILITY

Include:

- scalable UI
- colorblind-friendly flag modes
- subtitle/radio text
- configurable camera shake
- configurable motion blur
- controller remapping

---

# 134. AUDIO/VISUAL CONNECTION

Every major simulated event should have matching sensory feedback.

Examples:

Lockup:

physics slip

- smoke
- tire sound
- steering degradation
- vibration

Bottoming:

physical contact

- sparks
- sound
- camera impulse

Wet patch:

grip loss

- spray
- wet shader
- tire audio

Damage:

physics parameter change

- visual change
- impact sound

---

# 135. NO DISCONNECTED EFFECTS

Do not trigger effects through arbitrary timers.

Effects should consume simulation events.

Example event:

```ts
interface TireSlipEvent {
    wheelIndex: number;
    energy: number;
    surface: SurfaceType;
}

```

Particle/audio systems subscribe.

---

# 136. EVENT BUS

Use event bus only for low/medium-frequency events.

Do NOT send every physics force through general event emitter.

High-frequency state remains direct data.

---

# 137. CONFIGURATION DATA

Vehicle characteristics belong in typed config files.

Example:

```text
/config/vehicle/formula-default.json
/config/tire/soft.json
/config/tire/medium.json
/config/tire/hard.json
/config/tire/intermediate.json
/config/tire/wet.json

```

Validate with schema.

---

# 138. NO MAGIC NUMBERS

Important constants need names and documentation.

Bad:

```ts
force *= 1.37;

```

Good:

```ts
force *= tireConfig.temperatureGripMultiplier;

```

---

# 139. VERSIONED SAVES

Persist data with version:

```ts
{
  version: 3,
  settings: ...
}

```

Implement migration if schema changes.

---

# 140. DEVELOPMENT PHASES

Follow this order strictly unless a dependency requires adjustment.

---

## PHASE 00 — FOUNDATION

Create:

- Vite
- TypeScript
- Three.js
- tests
- lint
- game bootstrap
- main render loop
- fixed timestep
- diagnostics

Gate:

empty environment loads.

No console error.

Fixed-step unit tests pass.

---

## PHASE 01 — TRACK FOUNDATION

Implement:

- track mesh
- physics mesh
- spline
- surface query
- track progress
- start/finish
- sectors

Gate:

debug vehicle/object can traverse circuit coordinates.

Surface queries stable.

---

## PHASE 02 — RIGID CHASSIS

Implement:

- mass
- inertia
- forces
- torque
- integration

Gate:

rigid body responds predictably to controlled force tests.

---

## PHASE 03 — SUSPENSION

Implement all four corners.

Gate:

vehicle can sit statically under gravity.

Ride heights converge.

No perpetual bouncing.

---

## PHASE 04 — TIRES

Implement:

- contact velocity
- slip ratio
- slip angle
- nonlinear forces
- combined slip
- load sensitivity

Gate:

skidpad/braking tests pass.

---

## PHASE 05 — DRIVETRAIN

Implement:

- engine
- gears
- differential
- clutch behavior
- driven wheel torque

Gate:

vehicle accelerates from rest and shifts correctly.

---

## PHASE 06 — BRAKES

Implement:

- brake torque
- bias
- lockup
- brake thermal model

Gate:

300→0 braking test stable.

---

## PHASE 07 — AERO

Implement:

- wings
- floor
- drag
- ride-height map

Gate:

force-v² relationship validated.

---

## PHASE 08 — BASIC PLAYER EXPERIENCE

Implement:

- input
- chase camera
- cockpit camera
- lap timing

Gate:

complete clean laps possible.

---

## PHASE 09 — THERMAL/WEAR

Implement:

- tire temps
- tire wear
- contamination
- brake temps

Gate:

long runs exhibit measurable evolution.

---

## PHASE 10 — HIGH-FIDELITY CAR GRAPHICS

Replace prototype geometry.

Gate:

car no longer visually resembles primitive/blockout.

---

## PHASE 11 — ENVIRONMENT

Build detailed circuit surroundings.

Gate:

full lap has no major visually empty sections.

---

## PHASE 12 — LIGHTING/MATERIALS

Implement:

- PBR
- shadows
- environment
- carbon
- wet-capable road material

Gate:

screenshots hold up from cockpit and external views.

---

## PHASE 13 — AUDIO

Implement layered powertrain/environment/tire audio.

Gate:

vehicle state can largely be inferred from sound.

---

## PHASE 14 — AI BASELINE

AI must complete laps.

Gate:

10 AI × 50 laps without systematic crashes.

---

## PHASE 15 — RACECRAFT AI

Add:

- traffic
- overtaking
- defense
- collision prediction

Gate:

AI races without obvious waypoint-train behavior.

---

## PHASE 16 — RACE SYSTEM

Implement:

- grid
- start
- positions
- flags
- penalties
- finish

Gate:

full race completes correctly.

---

## PHASE 17 — PITS/STRATEGY

Gate:

AI and player can perform legitimate stops.

---

## PHASE 18 — WEATHER

Implement:

- weather timeline
- track water
- wet tires
- rain graphics
- spray

Gate:

dry-to-wet race completes with coherent handling transition.

---

## PHASE 19 — TRACK EVOLUTION

Rubber/marbles/water evolution.

Gate:

session state visibly/physically evolves.

---

## PHASE 20 — DAMAGE

Implement physical consequences.

Gate:

specific damage tests produce predictable handling changes.

---

## PHASE 21 — ADVANCED AERO

Implement wake/dirty air.

Gate:

two-car aero tests verified.

---

## PHASE 22 — HUD/UI

Implement original polished interface.

Gate:

all displayed values connected to simulation.

---

## PHASE 23 — TELEMETRY

Gate:

lap analysis accurately reproduces recorded inputs/state.

---

## PHASE 24 — REPLAY

Gate:

entire race can be replayed smoothly.

---

## PHASE 25 — OPTIMIZATION

Profile CPU/GPU.

Apply:

- LOD
- instancing
- pooling
- texture compression
- worker changes

Gate:

target hardware reaches acceptable performance.

---

## PHASE 26 — PHYSICS QUALITY PASS

Do not add flashy features.

Spend this entire phase correcting:

- tire feel
- suspension response
- aero balance
- braking
- differential
- drivetrain
- setup effects

---

## PHASE 27 — GRAPHICS QUALITY PASS

Spend entire phase improving:

- geometry
- materials
- lighting
- reflections
- particles
- track detail
- cockpit quality

---

## PHASE 28 — RACING QUALITY PASS

Improve:

- AI decisions
- race starts
- battles
- pit strategy
- flags
- traffic behavior

---

## PHASE 29 — GAME FEEL PASS

Improve:

- input response
- camera
- audio
- vibration
- speed sensation
- transitions

Do NOT cheat vehicle physics.

---

## PHASE 30 — CATASTROPHIC DEFECT PASS

Search for:

- crashes
- NaN
- race deadlocks
- incorrect laps
- stuck pit states
- broken replay
- memory leaks
- extreme FPS drops
- AI pileups
- physics explosions

Fix all.

---

# 141. THREE FINAL AUDITS

After everything works, perform three full-project audits.

## AUDIT ONE — ENGINEERING

Inspect every major simulation module.

Ask:

Is this actually modeled?

Is it numerically stable?

Is telemetry real?

Is code duplicated?

Are constants defensible?

Are tests sufficient?

Fix deficiencies.

---

## AUDIT TWO — PLAYER EXPERIENCE

Drive multiple sessions.

Ask:

Does braking feel powerful?

Does front grip build naturally?

Can rear slides be read?

Do kerbs have mass?

Does 300 km/h feel fast?

Does wet weather alter decision-making?

Does AI feel alive?

Does cockpit feel connected?

Fix deficiencies.

---

## AUDIT THREE — VISUAL/AUDIO QUALITY

Inspect frame-by-frame.

Look for:

- blockiness
- repeating textures
- dead environments
- cheap particles
- bad shadows
- flat materials
- weak sounds
- unrealistic camera
- static driver
- low-quality cockpit
- poor rain

Fix everything material.

---

# 142. ANTI-LAZINESS RULES

You are forbidden from declaring success merely because:

- TypeScript compiles
- car moves
- one lap works
- screenshots look attractive
- AI can follow line
- rain particles exist
- menu exists

All systems must be integrated.

---

# 143. PLACEHOLDER POLICY

Temporary placeholders are acceptable during intermediate development.

Before final completion:

search entire repository for:

```text
TODO
FIXME
HACK
TEMP
PLACEHOLDER
MOCK
STUB

```

Review every result.

Remove or resolve all release-critical placeholders.

---

# 144. COMMENTS

Comment difficult mathematics and assumptions.

Do not write comments that merely restate code.

Explain:

- coordinate conventions
- integration method
- tire equations
- thermal assumptions
- aero interpolation
- AI prediction

---

# 145. CODE QUALITY

No giant 5000-line god class.

No circular dependencies.

No random global variables.

No hidden mutable singleton physics state.

Maintain clear ownership.

---

# 146. FINAL REQUIRED SCENARIO

The final build must complete this scenario:

Start application.

Choose race session.

Load circuit.

Enter cockpit.

See detailed Formula car.

Perform grid start.

Modulate wheelspin.

Accelerate through gears.

Follow AI.

Experience slipstream.

Approach high-speed corner.

Brake near tire limit.

Lock front wheel if brake abused.

Release brake.

Recover grip.

Ride kerb.

Observe suspension movement.

Run onto grass.

Return with dirty tires.

Experience temporarily reduced grip.

Continue.

Build tire temperature.

Wear tires.

Use ERS.

Fight another car.

Overtake or abort intelligently.

Experience changing weather.

Track becomes damp spatially.

Spray begins.

Slick grip deteriorates.

Pit.

Fit wet/intermediate tire.

Return.

Experience materially different grip.

Follow car in dirty air.

Lose aero performance.

Make contact.

Damage front aero.

Experience understeer from damage.

Finish race.

View results.

Watch replay.

Switch cameras.

Inspect telemetry.

No console crash.

No physics explosion.

No fake state.

---

# 147. FINAL QUALITY STANDARD

The implementation should be convincing enough that a technically knowledgeable player can identify actual simulation concepts operating underneath the experience.

They should be able to perceive:

- longitudinal load transfer
- lateral load transfer
- combined slip
- tire saturation
- understeer
- oversteer
- aero balance
- brake bias
- differential effects
- dirty air
- tire degradation
- thermal effects
- track evolution
- wet-line differences
- ERS deployment
- suspension behavior
- damage effects

without needing a UI explanation.

---

# 148. FINAL OPERATING INSTRUCTION

Do not work like a model attempting to finish the request as quickly as possible.

Work like an engineering team attempting to make an exceptional racing simulator.

Whenever you reach a point where a normal coding agent would say:

“Implemented.”

Do the following instead:

1. inspect it
2. instrument it
3. test it
4. drive it
5. profile it
6. identify what feels artificial
7. identify what looks cheap
8. identify what behaves incorrectly
9. repair it
10. repeat

Use the repository itself as persistent engineering state.

Do not repeatedly ask the user what to do next if the specification already answers the question.

Make reasonable technical decisions yourself.

Do not abandon difficult features and replace them with decorative approximations.

Do not sacrifice coherent physics for visual spectacle.

Do not sacrifice visual quality because the project runs in a browser.

Do not sacrifice performance because high-end hardware can brute-force poor architecture.

The objective is the intersection of:

SIMULATION DEPTH

-

AAA-STYLE PRESENTATION

-

EXTREME RESPONSIVENESS

-

DEEP RACING LOGIC

-

HIGH PERFORMANCE

-

ROBUST SOFTWARE ENGINEERING

This should be an attempt at a genuinely exceptional browser racing simulator rather than merely an impressive Three.js experiment.

Before declaring the project complete, ask one final question:

"If an experienced racing-simulator player, vehicle-dynamics engineer, graphics programmer, and senior game developer independently inspected this project, what would each of them immediately criticize?"

Find those criticisms yourself.

Fix them.

Then perform the test suite again.

Then perform the complete race scenario again.

Then perform the profiling pass again.

Only then consider the project complete.