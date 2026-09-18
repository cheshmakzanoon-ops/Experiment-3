# Local race control and penalty integration

This checkpoint implements local race-control behavior from directive sections 43, 83, 84, 87, 90 and 134. These are original APEX session rules, not a claim of official motorsport-rule compliance. It does not implement a physical safety car or complete the remaining master-directive audits.

## Rules that affect driving

Observed contact above the incident threshold raises a single yellow. A retired or persistently stationary car on the racing surface raises double yellow. The start has a six-second grace period; pit boxes and runoff do not create track obstructions. The zone covers 180 metres before the hazard and 65 after it, including across the start/finish seam. A recovered hazard clears after three seconds without renewed danger.

The controller previews its braking distance before the zone. Inside, the targets are 25 m/s for yellow and 12 m/s for double yellow. These are requested speeds, not edits to velocity or tire forces. Safe avoidance of stationary obstructions is allowed; the traffic planner holds behind moving rivals instead of treating yellow as permission to race. Faster leaders approaching lapped cars generate a local blue flag.

A completed moving-car pass under yellow starts a two-second position-return window. Returning the position cancels the infringement without penalizing the driver accepting it. Otherwise five seconds are added once. Entering the pits does not erase an earned infringement. Outstanding infringements settle before final classification, including penalty-adjusted finish times.

Pit speeding is evaluated for every competitor, not only the player. The 80 km/h speed zone has a 0.5 m/s measurement tolerance and requires one continuous second above it; a five-second penalty is issued once per visit. The automatic limiter reduces requested drivetrain power. Existing inertia, braking and road resistance still determine actual speed. Normal exit acceleration is outside the limiter zone.

## State and presentation

Six previously reserved snapshot fields expose each car's flag, caution distance, caution speed, blue-flag target, control-event sequence and penalty count. The frame stride is unchanged, the protocol version is incremented, and telemetry now has 187 uniquely named channels. Replay records the same state. The HUD gives text, explicit target speed and color-independent patterns for local warnings, including while AI demonstration driving is enabled.

Incident/clear/flag/penalty events are bounded to the latest 256 entries. Per-car state, pairwise pass state and scratch buffers are allocated per simulation instance; no shared mutable singleton or per-tick event flood is introduced.

## Validation and limits

The focused unit suite covers zone boundaries, lap wrapping, clearance, grid/pit/runoff exclusions, blue flags, bounded event history, moving-car passes, position-return symmetry, pit/finish loopholes, all-car pit enforcement and AI control targets. The complete local suite passes 209 tests, lint and the production TypeScript/Vite build.

`npm run test:race-control` executes an actual vehicle simulation with a stationary on-track obstruction. The approaching AI received double yellow, drove around the obstruction, exited the zone and resumed normal pace within 14.925 simulated seconds. Neither moving car nor the obstruction recorded an impact, and the distant car initially remained green. No position or velocity was reset during this measured run. `docs/marshal-integration.json` contains the source fingerprint and observed flag events.

The existing weather, vehicle-dynamics, physical pit and whole-field race fixtures are separate regressions. Their reports are not certification of all seeds, hardware frame rate, subjective handling or the final combined audiovisual scenario. Browser rendering of this checkpoint is checked separately by GitHub Actions.
