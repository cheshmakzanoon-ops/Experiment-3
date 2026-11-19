# Motorcycle thermal work and ownership

The road and offroad adapters now advance two physical tyre/rotor thermal networks using the existing implicit four-node solver. The four-slot vehicle protocol retains front/front/rear/rear aliases. Slots 0 and 2 own the physical temperatures; slots 1 and 3 receive the same temperatures, pressure, wear and slip-power share after each update. There is no separate unrecorded temperature history, so deterministic resimulation reconstructs the same thermal state.

## Energy sources and boundaries

All mechanical inputs are watts; the integration timestep is seconds. The solver stores heat in tread surface, carcass, core and rotor reservoirs and exchanges it with the session's ambient air, the sampled road temperature and loaded-contact water film.

| Input | Source and limits |
| --- | --- |
| GP contact sliding | Signed contact force dotted with actual relative wheel/ground velocity. The front velocity is rotated into the steered wheel frame. Pure rolling in a turn produces no slip heat. A contact with zero load contributes zero. |
| Player MX contact sliding | The existing soil solver's slip work averaged over the same microsteps that advance the chassis and wheel momentum. The adapter no longer multiplies these watts by `dt` before publishing them. |
| Reduced road/supermoto steering | This model has no independent sliding contact state. Its kinematic cornering force is not passed off as dissipated work. The supermoto/offroad fallback can report an actual longitudinal rotor/ground mismatch during wheel pickup. |
| Rolling resistance | The exact `Crr * mass * g` resistance already removed by the reduced bike core, multiplied by forward speed and shared between the currently loaded contacts. Landing load does not multiply the total work. Extra soil bulldozing stays outside the tyre reservoir. |
| Road rotor braking | Contact brake force times rotor rim speed, excluding the rear engine-braking share. This remains a reduced wheel-force estimate, not a complete torque-integrated GP rotor model. A locked rotor does not receive continuing `force * roadSpeed` heat. |
| Player MX rotor braking | Actual actuator torque after ABS multiplied by the finite rotor rotation during each microstep. The part attributed to engine braking is excluded. Heat generation stops at wheel lock. |
| MX airborne braking | The finite spin/brake integration supplies rotor work while ground slip and rolling heat remain zero. Coasting bearing losses are not incorrectly attributed to the friction brake. |

Rotor/core conduction is equal and opposite within the finite thermal solve. Tread gets 62% of contact slip work; the remainder belongs to the road/soil boundary. Rolling heat is fully retained in the tyre, with 72% entering the carcass. These shares and the thermal parameters are original engineering calibration, not manufacturer measurements.

The front tyre's effective heat capacity is 13.2 kJ/K and the rear's is 18.4 kJ/K before tread wear. Rotor capacities are 3.2 and 1.8 kJ/K. The front rotor reservoir represents the complete front brake assembly. Positive capacities and nonnegative conductances preserve the stable passive-exchange property of the shared solver.

No source moves a tyre toward its compound's ideal temperature. A cold idle at a 20°C air/road boundary stays at 20°C. Authored warm starts and tyre replacements keep the existing initial conditions; reset/teleport only changes the pose. Core temperature now drives hot pressure through the existing absolute-pressure gas law.

## Calibration checkpoint

Before production integration, the new network was advanced alongside an Aurel hot-start lap without feeding its temperatures back into grip. Initial tread/carcass/core were 87°C and discs 320°C.

| Shadow replay | Front / rear surface at finish | Front / rear carcass at finish | Front / rear rotor at finish |
| --- | --- | --- | --- |
| Superbike, 73.87 s, zero falls | 76.89 / 77.54°C | 87.69 / 88.01°C | 200.77 / 104.83°C |
| GP, 69.91 s, zero falls | 82.13 / 82.36°C | 87.83 / 88.40°C | 219.79 / 88.44°C |

The GP shadow lap supplied front/rear contact slip work of 38.13/56.48 kJ, rolling work of 44.71/62.55 kJ and friction-brake work of 934.58/4.63 kJ. The Superbike supplied no fabricated cornering slip work; its rolling work was 56.55/76.98 kJ and rotor work 823.74/77.06 kJ. These are calibration observations, not a claim that a particular real tyre or brake has been reproduced. They also are not a post-integration handling acceptance result.

## Verification and limits

The dedicated thermal tests independently check first-law balances, a perfectly rolling steered wheel, finite wheel-stop work, cold idle, environmental cooling and passivity. Production checks cover GP, Superbike, MX and Supermoto cold idle; warm replacement and pose resets; exactly mirrored physical-wheel state; slip watts counted once; real road-drop separation; and bitwise thermal resimulation through flashback.

The original Supermoto thermal test expected a warm tread to heat before a very short Raw-braking fall. That expectation depended on the removed ideal-temperature source. It now requires positive rotor heat reconstructed from the rotor's first-law balance, zero fabricated tread slip work and passive warm-tread cooling. Its crash, braking, recovery and temperature-limit assertions remain in place. Recovery additionally checks that the complete physical tyre/rotor stored heat cannot increase when all environmental boundaries are cooler.

The ordinary road/supermoto model still lacks a resolved two-contact slip solver. Its long-run slip wear and lockup heat cannot be inferred from lateral force magnitude. GP wheel spin also remains a reduced relaxation model; its road-brake heat input does not establish global wheel/chassis energy conservation. Neither limitation is hidden by restoring a temperature target or modifying a grip curve. Broader race/scenario acceptance belongs to the combined engine validation checkpoint.
