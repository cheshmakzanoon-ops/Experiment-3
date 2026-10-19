# Motocross contact, terrain continuity and lit roost — 2026-10-19

This pass improves tyre contact, rider braking control and soil presentation in the Three.js motocross section. It builds on the existing rider-weight controls, formed bike mouldings and worked-soil materials. The reviewed starting commit is `9e5ff534ecf4d8391eaa7075a284b141544de7ee`; the changes below describe the current working tree. Validation results remain pending in this report.

## Reference review and provenance

The [existing 100-image audit](motocross-reference-review-20261019.json) supplies the image IDs, filenames, source URLs and archived hashes. This pass downloaded and decoded **100 current responses from those exact URLs**, visually reviewed all 100 through contact sheets, and separately inspected images **054, 058, 059, 066, 085, 092, 094, 095 and 096** at their downloaded resolution.

The [current-source review record](motocross-contact-reference-review-20261019.json) preserves all 100 exact URLs, current and archived hashes, decoded dimensions, download validity and inspection scope.

The original `Motocross_PS5_100_Developer_Reference_Images(2).zip` was located, but its download helper failed with HTTP 503. **Zero of the 100 current downloads matched the recorded archived image hashes.** The reason for the byte differences was not established. This is a current-source visual review; it does not reverify the archive or renew earlier audits' archive-hash claims. These images informed appearance and visible contact relationships. Physics coefficients, restitution and particle lifetimes were not measured from stills.

The following paths are exact reference-index paths, not newly committed image assets:

| ID | Reference-index path | Observation applied |
| --- | --- | --- |
| 054 | `04_Gameplay_Cameras_and_Race_Composition/054_SX25_dense_stadium_pack_at_takeoff.jpg` | Angular foreground soil fragments retain distinct lit faces. |
| 058 | `04_Gameplay_Cameras_and_Race_Composition/058_SX25_low_camera_on_a_multi_bike_stadium_launch.jpg` | Sharp fragments sit above softer contact dust. The current image shows a leaned corner despite its “launch” filename. |
| 059 | `04_Gameplay_Cameras_and_Race_Composition/059_SX25_chase_view_approaching_a_steep_ramp_and_finish_marker.jpg` | Highlights follow continuous curved rut shoulders into a ramp. |
| 066 | `04_Gameplay_Cameras_and_Race_Composition/066_MXGP21_congested_mxgp_corner.jpg` | Translucent dust overlaps lower riders while solid fragments remain distinct. |
| 085 | `05_Menus_HUD_Customization_and_Presentation/085_SX25_general_settings_screen_with_highlighted_options.jpg` | “Joint brakes Off” appears separately from Auto brakes and Rider Weight. |
| 092 | `06_Lighting_Weather_Dirt_and_FX/092_SX4_blue_rider_from_rear_on_dark_churned_soil.jpg` | The rear tyre follows a dark trough between raised soil shoulders. |
| 094 | `06_Lighting_Weather_Dirt_and_FX/094_MXATV_close_atv_corner_with_dirt_roost.jpg` | Individually shaded clods coexist with diffuse dust; this ATV image supports appearance, not motorcycle dynamics. |
| 095 | `06_Lighting_Weather_Dirt_and_FX/095_MXATV_backlit_motorcycle_jump_under_stadium_lamps.jpg` | A raised front tyre is separated from rear-origin debris. |
| 096 | `06_Lighting_Weather_Dirt_and_FX/096_MXATV_mountain_jump_with_dust_trail.jpg` | Rear contact, a raised front tyre and continuous rut shading remain distinguishable. |

## Production changes

**Lit soil and contact response — 054/058/066/094/095/096.** [Roost](../../src/rendering/offroad/roost.ts) now separates soft point dust from irregular, rotating `MeshStandardMaterial` clods. One instanced mesh shares the existing 2,400-particle pool. Dry fragments can make one damped hop; wet fragments settle, retain their orientation and shrink at expiry. Front and rear touchdown bursts wait for their respective loaded tyre. Front rolling dust receives no drive-spin clods.

[OffroadScene](../../src/rendering/offroad/index.ts) connects debris and contact shadows to the displayed terrain. Up to **128 moving-clod contact probes** refresh per frame, each using five height samples; tyre and shadow probes are additional. The rotating budget avoids permanently favouring early pool slots. Predicted contact requests a fresh probe, and bounce/settlement require confirmation so an exhausted budget cannot freeze a fragment against an outdated cached plane.

**Continuous ruts — 059/092/096.** [TerrainView](../../src/rendering/offroad/terrain-view.ts) propagates boundary wear to the previous strip and closing lap strip. [MxTerrainNormalEdges](../../src/rendering/offroad/mx-terrain-normal-edges.ts) joins raw, area-weighted face contributions across chunk boundaries after updates. Conservative bounds accommodate rut depth. `heightAt` samples the actual displayed triangles, including replay deformation and the short final lap row, so cosmetic contacts follow the visible surface.

**Braking and tyre load — 085/092/095/096.** [DirtBikeVehicle](../../src/simulation/offroad/dirt-bike-vehicle.ts) enables independent rear braking for player MX-250/MX-450 bikes on motocross and supercross courses. Sport retains front-lever assistance toward the rear. Sprung front/rear loads enter the existing tyre-force solve before integration; unloaded rear slip demand no longer works the soil. [Bike snapshots](../../src/simulation/bike-vehicle.ts) publish the off-road wheel loads used by the tyre readouts.

## Try the controls

Start a player session with MX-250 or MX-450 at **VALLEY RIDGE / MOTOCROSS**. With default bindings, use **W** to accelerate, **A/D** to steer, **S** for the front brake and **Left Shift** for the rear brake. Compare short rear-pedal corrections with front braking on a straight approach. Sport may add rear braking from S; Left Shift remains rear-only. Repeat in Raw to compare without the braking/traction aids.

Use the existing **Q** forward and **Z** backward rider-weight controls during an approach, then release to return the input to neutral. **C** cycles cameras. These bindings and their motocross labels are verified in [bindings](../../src/input/bindings.ts), [controller](../../src/input/controller.ts) and the [controls screen](../../src/ui/interface.ts); saved custom bindings take precedence.

## Validation — pending completion

Root must record commands, results and evidence for the contact/traction, roost/contact, **129-clod budget**, terrain continuity/replay and existing motocross regressions; browser terrain/lighting captures; and lint, typecheck and build. Test presence is not a passing result. No frame-rate improvement, hardware certification or photorealism completion is claimed here.
