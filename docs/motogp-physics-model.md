# MotoGP prototype single-track dynamics

## Scope and isolation
GP-R1 and GP-R2 explicitly opt into MotoGPChassis in src/simulation/bike-vehicle.ts. Cars retain vehicle.ts and the motocross terrain/suspension subsystem remains in offroad/. Other motorcycles keep the established reduced-order Bike model. A plain research new Bike() does not enable GP physics.

## Model: original calibration, not proprietary MotoGP physics

At each fixed physics substep the GP chassis integrates measured body-frame lateral velocity v_y and yaw rate r. Each front/rear tyre gets load-scaled nonlinear camber and combined-slip forces through the shared tyre-force.ts Magic-Formula-shaped law:

- Front slip angle: alpha_f = atan2(v_y + a*r, v_x) - steer; rear: alpha_r = atan2(v_y - b*r, v_x). Camber thrust is represented by a stiffness-dependent slip-angle shift.
- Lateral balance: m * (dv_y/dt + v_x*r) = F_yf*cos(steer) + F_xf*sin(steer) + F_yr.
- Yaw balance: I_z * dr/dt = a * (F_yf*cos(steer) + F_xf*sin(steer)) - b * F_yr.
- The friction ellipse clips cornering authority when braking or accelerating spends the longitudinal traction budget.
- A travel-distance relaxation length smooths transient lateral tyre force. Lean responds to the measured lateral acceleration rather than only geometric steering curvature.
- The rider's lean-intent steering controller closes feedback on physical yaw rate and body sideslip, clamping extra correction to +/-0.08 rad and keeping the steer-slew limit.
- The front and rear wheel angular velocities differ from ideal road-rolling speed and respond to effective slip and untransmitted torque. In raw assist mode, brakes can lock the front and rear drive can spin the rear. Contact sliding work contributes to the existing tyre heat/wear channels.
- Front contact is gated by the existing normal-load and wheelie-clearance logic. An airborne front contact cannot supply road steering.
- The GP model drives body lateral velocity, wheel-force telemetry, contact animation, recorded angular kinematics, and lateral-g telemetry used by cameras and rider animation.

## Limitations and calibration work

This is a deterministic, reduced-order single-track motorcycle model, not full six-DOF multibody simulation or calibrated OEM MotoGP tyre data. Longitudinal load transfer, engine torque/braking, ABS, traction control, wheelies, lean, incidents and recovery continue to be supplied by Bike, with the new GP module integrated alongside that existing system. The wheel angular-speed response uses authored force-related relaxation plus untransmitted-torque inertia, not a monolithic coupled implicit wheel/contact solver.

The model cannot claim motorcycle manufacturer accuracy, tire finite element fidelity, verified gyroscopic steer-head torque, official MotoGP game-engine source, or track-data validation. Further engineering should calibrate inertia, load sensitivity, camber curves, and controller stability to measured telemetry, and simulate race-length tests on GP circuits with wet grip and variable kerbs before describing the simulation as quantitatively hyperrealistic.

## Background

- MotoGP on corner speed and rider hanging off: https://www.motogp.com/en/news/2020/11/26/how-do-motogp-riders-corner-so-fastx/1088112
- MotoGP on engine braking: https://www.motogp.com/en/blog-articles/what-is-motogp-engine-braking/823663
- Non-proprietary shared tyre-force law: src/simulation/tyre-force.ts
