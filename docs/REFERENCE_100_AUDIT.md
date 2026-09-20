# 100-image reference review and implementation evidence

**Coverage means reviewed and traceable, not visual parity.** All 100 numbered image files were visually inspected. 050–065 are unrelated article/product images; 048–049 are supplementary input-hardware photographs. Repeated compositions remain individually listed, with links to their first occurrence. No source artwork is shipped in the game.

Archive SHA-256: `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.

## Changes in this pass

A persistent original Team HQ (calendar, finances, staffing/facilities, fictional driver contracts, three physics-backed setup studies and local classified-race rivalry); an actual-car livery editor with saved paints, pattern, wordmark and race number; a frozen-frame photo studio with car selection, orbit, lens, exposure, roll and canvas PNG export; and an in-game searchable 100-image evidence browser.

## Status language

`enhanced`: this pass adds a usable feature for the cue. `cue-present`: a working pre-existing system supplies the cue. `partial`: important depicted functionality or scene content remains absent. `supplementary`: relevant peripheral/editorial evidence, not a gameplay screenshot. `excluded`: unrelated contamination. Every row retains remaining limitations; none of these labels certifies F1 25/PS5 parity.

## Validation and acceptance

Pure tests cover transactional finance, research gates/setup effects, duplicate or AI race-reward rejection, save validation, livery bounds, lens math and index completeness. Browser tests cover persisted livery/reload, safe photo freeze/return, real PNG pixels, HQ flows and the index. See the PR/commit validation report for actual executed results; an unrun test file is not evidence of a passing run.

A screenshot cannot establish exact physics, source scanning, platform or internal rendering technique. The pack includes official artwork, editorial composites, older/repeated compositions and apparently different-title imagery (066/084). Filenames/source categories are not treated as verified platform provenance.

## One-by-one observations

### 001 — Circuit scan comparison

File: `001_ps_screenshot_01.webp` · 1200 × 675 · **partial**
SHA-256: `ebb5ecedcd3c3df621431104384c4d6e340459e33cad69d137c4a17883dd9645`

**Observed:** Split image contrasts point-cloud survey geometry with the finished straight: grid markings, curb edges, fence posts, spectator structures and city scale.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 002 — Side-on panning car

File: `002_ps_screenshot_02.webp` · 1200 × 675 · **partial**
SHA-256: `7c334ec3606b04f1f5fbbd0d9d11d1c818d545f4b9ce477da752d6a3b2597d1b`

**Observed:** Low side profile emphasizes layered wings, distinct tire sidewalls, wheel rotation and a horizontally streaked background.

**Game evidence:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`

### 003 — Working cockpit wheel

File: `003_ps_steeringwheel.webp` · 1200 × 675 · **cue-present**
SHA-256: `0f2df1b7304701557ac3f7025e9983aca8239f83c9325640f72282593c9952e1`

**Observed:** The wheel carries a compact display, labeled colored rotary controls and buttons; gloved hands sit inside a carbon-lined cockpit beneath the halo.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 004 — Wheel-change pit choreography

File: `004_ps_pitstop.webp` · 1200 × 675 · **partial**
SHA-256: `97fdd0502303a4f989568c735b4b52abb6f71ca05eb2cf686682b7dfe6e7d4c4`

**Observed:** Mechanics converge on four corners while front and rear jack operators lift the car; the wheel exchange is a sequence, not decorative standing people.

**Game evidence:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`

### 005 — Livery showroom

File: `005_ps_editor.webp` · 1200 × 675 · **enhanced**
SHA-256: `a0e589a7b639a2268eb2ec7af7547bef82282fe5c65a765beed7785605c0e1cf`

**Observed:** A dark neutral car presentation isolates the body graphics, paint finish and selectable visual identity.

**Game evidence:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes.

**Inspect:** Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Remaining gap:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`

### 006 — High-angle curb duel

File: `006_ps_bp3_action.webp` · 1200 × 675 · **enhanced**
SHA-256: `c8d250012e7b8f78a2488aa792b2d78decbe333464a88b1f04a9832202b995d6`

**Observed:** Two cars run close together beside red, white and green curb paint. The high view exposes front-wing width, suspension and spacing.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 007 — Dense elevated race pack

File: `007_ps_screenshot_03.webp` · 1200 × 675 · **partial**
SHA-256: `d6637ba0068906fa2e027018b1b9be4822a53b71010c3f00f4120ccf6fdb9712`

**Observed:** A multi-car field climbs through a corner with grandstands, catch fencing and layered distant spectators framing the road.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 008 — Pod camera down the straight

File: `008_ps_screenshot_05.webp` · 1200 × 675 · **cue-present**
SHA-256: `88a094d040523d9e9b9f620305f7b10ee65c9ed8e9007a26c3227682780b82a9`

**Observed:** Forward-facing halo/pod view preserves the wheel, tires, driver helmet edge and a car ahead; mirrors and track furniture provide distance cues.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 009 — Helmet and halo close-up

File: `009_ps_screenshot_06.webp` · 1200 × 675 · **partial**
SHA-256: `66ae1a9f62575a806f941ac5380df783605270b92905c1cf2af7b2f2a34187ab`

**Observed:** A very close view emphasizes the helmet visor, cockpit rim, halo paint, fabric and carbon-material contrast.

**Game evidence:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit.

**Inspect:** Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Remaining gap:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Code:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`

### 010 — Wet rear three-quarter view

File: `010_ps_rain.webp` · 1200 × 675 · **cue-present**
SHA-256: `16210586874a8b7729c376b952026bcb6da467ccc8d29baa955ce53448b772b4`

**Observed:** A blue-banded wet tire, red rear lamp, mist plume and damp track reflections communicate rain without relying on a weather label.

**Game evidence:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Remaining gap:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`

### 011 — Team headquarters exterior

File: `011_ea_myteam_facilities.jpg` · 3840 × 2160 · **partial**
SHA-256: `54ce0c0a91457f6146ca51cad5fc46f06ce57b89090611d770ac8aa5f6dafab4`

**Observed:** An office-like team campus with planted grounds and human-scale entrances establishes an identity beyond the circuit.

**Game evidence:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Menu → Team HQ → Headquarters, Personnel or Finance.

**Remaining gap:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 012 — Engineering department menu

File: `012_ea_engineering.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `bd0788a2bcc0b2b0605df03021bcf0e54a110b13583ca6b4b2c21494a83ec76b`

**Observed:** Research, development, upgrade assignment, history, component management and a facility panel share a clear department navigation system.

**Game evidence:** Added priced, timed studies with a one-active-study limit and staffing-dependent completion. Completed studies unlock explicit setup changes saved for the next session.

**Inspect:** Team HQ → Engineering → Commission; advance weeks; Apply to next session; inspect Garage setup.

**Remaining gap:** Research is a three-study local setup loop, not a full component development tree, manufacturing/history system or invisible car-stat upgrade.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/simulation/config.ts`

### 013 — Personnel department menu

File: `013_ea_personnel.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `aafc150368007a3c8b20349627e435ecfef080950ee160f5bdfb2e56a8a088a6`

**Observed:** Driver and workforce decisions appear inside a team-office context with department navigation and facility access.

**Game evidence:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`

### 014 — Workforce economics screen

File: `014_ea_workforce.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `8879ed796eeaa2e6901e110777836a9d344b2d57065826007c11306eaf7f4c7e`

**Observed:** Capacity, staff allocation, staffing costs, research-time changes and income effects are visible together rather than hidden in tooltips.

**Game evidence:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`

### 015 — Team finance ledger

File: `015_ea_finances.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `d62c1ed24179d6e1a7f2537eb22d5135c484bfe5fd1509ba2d5e46af69e7916c`

**Observed:** Balance, income, outgoings and driver contracts are organized as inspectable financial information.

**Game evidence:** Added a bounded saved ledger with real income, payroll, facility and transaction deductions. Invalid/insolvent actions leave state unchanged.

**Inspect:** Team HQ → Finance; inspect ledger before/after hiring, research and advancing a week.

**Remaining gap:** Fictional local credits only; no real money, full financial forecast model or sponsor-negotiation system.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/storage/data.ts`

### 016 — Headquarters atrium

File: `016_ea_hq.jpg` · 2560 × 1440 · **partial**
SHA-256: `f12a5f68a33d184ee6b8bb7d71ac149ca6159da3b9c81b2731ce48a89413c5ef`

**Observed:** An architectural interior suspends a show car above meeting areas and staff circulation, with daylight and material depth.

**Game evidence:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Menu → Team HQ → Headquarters, Personnel or Finance.

**Remaining gap:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 017 — Driver roster comparison

File: `017_ea_driver_select.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `bd75c79b190aa424b14c1a358e45f98b89c3acc3a7594e2ee9e4995df2df42f8`

**Observed:** Two driver cards show ratings and recognizable suit/helmet identity, supporting a choice between people rather than an anonymous number.

**Game evidence:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`

### 018 — Team rivalry screen

File: `018_ea_fan_rating.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `66c3fc3879625167110787dbaf434cb2368e3afdada8cf0bda9c7bd6236ca2ee`

**Observed:** Two teams are compared through scores, rivalry intensity and fan reputation, with a visible direction of progress.

**Game evidence:** Added local team points/reputation and a visible fictional Meridian rivalry, updated only by classified manual Grand Prix results with opponents.

**Inspect:** Finish a manual race against opponents → Team HQ. AI-demonstration sessions earn no team result.

**Remaining gap:** Meridian scoring is a disclosed local model, not an online competitor or relationship/event-driven campaign rivalry.

**Code:** `src/storage/team-career.ts`, `src/main.ts`, `src/ui/team-hub.ts`

### 019 — Driver icon selection

File: `019_ea_driver_icons.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `65f5a5520ae1c42b6a586e8f6a9d05a218962e54e09ad006952f509b23c2cd71`

**Observed:** A driver-market or legacy-driver selection grid uses individual portraits and metadata as a hiring surface.

**Game evidence:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`

### 020 — Media-pen interview

File: `020_ea_bp_press.jpg` · 3840 × 2160 · **partial**
SHA-256: `ae2c3734ddee997d7b70311c076965bd6e8c4f70b956548b4c868c5f609b212c`

**Observed:** A driver is surrounded by cameras and press-area graphics, suggesting a post-race presentation scene.

**Game evidence:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Read Headquarters briefing after a completed study or race.

**Remaining gap:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 021 — Helmet-led title graphic

File: `021_ea_bp_trailer_thumb.png` · 1920 × 1080 · **partial**
SHA-256: `fe7ce67b6e556079be36b166189db8ba471389475b04801b800d0e2e7821a645`

**Observed:** A promotional title composition combines a helmet/cockpit close-up with the game identity; it is not an in-race interface.

**Game evidence:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`

### 022 — Front three-quarter cornering

File: `022_ea_hamilton.jpg` · 3840 × 2160 · **cue-present**
SHA-256: `722c24b40f1fd260a2e7b32b8db7cbd506c608e3bcd85cd67ff8efc35b7a2b77`

**Observed:** The car loads its outside tires near a curb; front suspension, aero surfaces and the low nose remain readable in motion.

**Game evidence:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles.

**Inspect:** Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Remaining gap:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Code:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`

### 023 — Tutorial composite: driver and rig

File: `023_ea_oar2_0.jpg` · 1080 × 1920 · **partial**
SHA-256: `7c69047acfa6f2c86431a40edc78542d120a6dc2fee6082f5cb78e09f1001f73`

**Observed:** A vertical social-video layout includes a presenter in a simulator and driver imagery. The presenter is editorial packaging, not game content.

**Game evidence:** Existing controls, calibration, setup and assist explanations provide an in-game learning route. Editorial presenters are intentionally not inserted as game assets.

**Inspect:** Menu → Controls or Garage & Settings; choose practice to learn inputs.

**Remaining gap:** No embedded presenter video, voiced tutorial campaign or exact vertical social-media layout.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`

### 024 — Tutorial composite: chase telemetry

File: `024_ea_oar2_1.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `7169dcad583c10f062917e6d469322d733c82bb864032e96ac95a0bd7b244c5b`

**Observed:** The gameplay portion shows a chase straight with prominent circular speed/gear/energy information; a presenter occupies another region.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 025 — Tutorial composite: energy controls

File: `025_ea_oar2_2.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `0af2c94f04591421380571dcb940a6358bb91d9302af386548d1afae11c1b856`

**Observed:** A cockpit street-racing view highlights an energy meter with an editorial arrow. The arrow is a teaching overlay, not a physical asset.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 026 — Tutorial composite: assist settings

File: `026_ea_oar2_3.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `de2e5f8571e14955dcabd8da39accd48e647e52512affeea349f2939bcf1c8b6`

**Observed:** A menu segment explains vehicle or assist categories while a presenter remains visible. The actionable reference is a legible settings hierarchy.

**Game evidence:** Existing saved assists, bindings, custom-device calibration and graphics controls provide real configuration rather than static option cards.

**Inspect:** Menu → Garage & Settings; change, Apply & Save, then reload.

**Remaining gap:** Vehicle-series selection and the reference video presenter are not game features here.

**Code:** `src/ui/interface.ts`, `src/ui/device-calibration.ts`, `src/ui/presentation.ts`

### 027 — Tutorial composite: narrow-street cockpit

File: `027_ea_oar2_4.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `e25b77786db47c514750fff4807f81f9d2d0932c859b87b4bcc54ef9fae6491e`

**Observed:** The cockpit follows another car through close urban barriers. The host panel should not be mistaken for a missing game feature.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 028 — Tutorial composite: braking reference

File: `028_ea_oar2_5.jpg` · 1080 × 1920 · **partial**
SHA-256: `bbfd1482ae20780b49a9c6f626aed857e57f9da4047cadc049bea79d645cb61a`

**Observed:** The onboard view highlights a 100-metre braking board and usable roadside distance cues.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 029 — Tutorial composite: corner exit

File: `029_ea_oar2_6.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `b4328456df0c82b5cae5b7147613d0d6ad4e96a178ff4095c0f7449193c57b20`

**Observed:** Chase view shows corner exit, curb use and a colored racing line. The instruction layer sits outside the game scene.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 030 — Tutorial composite: wheel and horizon

File: `030_ea_oar2_8.jpg` · 1080 × 1920 · **cue-present**
SHA-256: `2683eab7bf48332187e99d00a55b6bf435b20ba984b2c1b91e6d1dc70964f738`

**Observed:** The useful gameplay crop is a forward cockpit view with a wheel gear readout, road horizon and nearby structures.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 031 — Editable sidepod sponsor slots

File: `031_ea_decal.jpg` · 3840 × 2160 · **enhanced**
SHA-256: `430f536252611c2ed84d81ef18608eb6cd435aa639b562dcc2a1d00a32b01f52`

**Observed:** A decal selector shows a specific car region and selectable placements, requiring a visual edit that survives leaving the editor.

**Game evidence:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes.

**Inspect:** Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Remaining gap:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`

### 032 — Side-by-side numbered cars

File: `032_ea_driver_number.jpg` · 3316 × 1865 · **partial**
SHA-256: `6444b284c3fa0da95341b49d953c5d7321c0401af4d843c6ac57cd67568b614b`

**Observed:** Different numbers and colors distinguish nearby cars; the side mirrors reflect spatially meaningful racing context.

**Game evidence:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`

### 033 — Customized livery on circuit

File: `033_ea_sponsor_livery.jpg` · 3298 × 1855 · **enhanced**
SHA-256: `251c60b2e74300455292756d1a9b2731d4de29fba8012bf5803cc3b0ed3c4927`

**Observed:** The custom paint treatment is visible in actual track lighting and motion, not only a static customization thumbnail.

**Game evidence:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes.

**Inspect:** Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Remaining gap:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`

### 034 — Backmarker objective overlay

File: `034_push_156273.webp` · 900 × 506 · **partial**
SHA-256: `7cb5c768b3f333f9f5bcd4e1b50490b5c1a9a809e403b3f7814ce044c0c7a89d`

**Observed:** An overtaking task sits alongside position tower, gaps, subtitles and a high-gear wheel readout.

**Game evidence:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal.

**Inspect:** Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`

### 035 — Headquarters calendar

File: `035_push_156274.webp` · 900 × 506 · **enhanced**
SHA-256: `35dabca8522b418c13454a8abe3d86d523b78ec70ca7e0c32965301241ca3d7e`

**Observed:** An advance-time control links the calendar to incoming funds, expenses and driver or department tasks.

**Game evidence:** Added explicit one-week advancement charging payroll/overhead, crediting partnership income and completing research, with transaction persistence before UI confirmation.

**Inspect:** Team HQ → Advance one week; inspect Finance and Engineering.

**Remaining gap:** No multirace world calendar, date-based travel or full career-event scheduling.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`

### 036 — Chase vehicle-management panel

File: `036_push_156275.webp` · 900 × 506 · **cue-present**
SHA-256: `f7f600f50a589a39d9151d4afcb67db13f3e96e87daa5a7b9b39da8c0c51cb70`

**Observed:** A chase race combines the minimap, position, gear/speed and a multifunction panel for tire, fuel and energy management.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 037 — Practice target and delta

File: `037_push_156276.webp` · 900 × 506 · **partial**
SHA-256: `1cefccfc2f509bea45a7425aa3d7ff25e81749ce79854adb2a015f43afd96762`

**Observed:** A practice screen presents objectives, a live time delta, a racing line and DRS/straight context alongside the wheel display.

**Game evidence:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback.

**Inspect:** Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap:** No rendered ghost car, dedicated practice-program scoring, reverse track or online time-trial board.

**Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`

### 038 — Letterboxed story dialogue

File: `038_push_156277.webp` · 900 × 506 · **partial**
SHA-256: `47a470b08bd0b34a3e9bb248e13f4ae648a2a034bf76d37fab3e2a4033e51adc`

**Observed:** Two rendered characters speak in a cinematic, letterboxed scene with subtitles. This implies narrative production, not just a racing HUD.

**Game evidence:** Added contextual original written briefings after driver/research/race changes. This is a limited management presentation, not an equivalent cinematic.

**Inspect:** Team HQ → read the current briefing.

**Remaining gap:** The two-character animated story scene, voice acting, facial animation and narrative campaign are not implemented.

**Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`

### 039 — Broadcast wide field

File: `039_thumbculture_2.jpg` · 1024 × 576 · **enhanced**
SHA-256: `4612e6dede3e24ea01af37c5140373bc6f8663e4ae433280acd4dc8d2eebf6d0`

**Observed:** A distant replay angle captures a full field on broad colored runoff with a full position tower.

**Game evidence:** Existing recorded full-field replay, timing tower, car tracking and trackside cameras now also support frozen selectable-car compositions.

**Inspect:** Drive, pause → Watch Replay; cycle C to trackside; Photo Studio for an intentional wide shot.

**Remaining gap:** No exact television graphics package, human commentary or automatic editorial shot director.

**Code:** `src/rendering/renderer.ts`, `src/storage/replay-pages.ts`, `src/ui/interface.ts`

### 040 — Audio driving-assistance settings

File: `040_thumbculture_3.jpg` · 1024 × 576 · **partial**
SHA-256: `2b1cc77cff8645f0247707f71797cec9c97248cd261c82213526f95f8cda299e`

**Observed:** Dedicated controls cover braking cues/frequency, steering panning, track limits, turn guidance and wrong-way assistance.

**Game evidence:** Existing input remapping, contrast/color-vision options, UI scale and audio controls provide some accessibility foundations.

**Inspect:** Garage & Settings → presentation, audio and device bindings.

**Remaining gap:** Dedicated braking/steering/turn/wrong-way sonification assistance from this screen is not implemented; ordinary race audio is not a substitute.

**Code:** `src/ui/presentation.ts`, `src/ui/device-calibration.ts`, `src/audio/engine.ts`

### 041 — Gravel incident and dust

File: `041_thumbculture_4.jpg` · 1024 × 576 · **cue-present**
SHA-256: `c6d6401cf838a1ffbbe8adce502125925250cb7b0719ed269303078542d64789`

**Observed:** A yawed car in a gravel escape produces a dust cloud; the background buildings and track edge remain spatially consistent.

**Game evidence:** Existing contact-state dust, gravel/spark/debris effects and damage respond to actual off-track/contact events and recorded replay state.

**Inspect:** Drive onto gravel; review recorded incident from trackside or Photo Studio.

**Remaining gap:** Procedural particle density and damage deformation do not match the reference cinematic quality.

**Code:** `src/rendering/effects.ts`, `src/rendering/debris.ts`, `src/simulation/collision.ts`

### 042 — Telephoto straight composition

File: `042_thumbculture_5.jpg` · 1024 × 576 · **enhanced**
SHA-256: `9b49192bd0df80332b566697930a3012227af34192f709cf2b691f592259e510`

**Observed:** Two cars, longitudinal rubber marks, grid paint and distant roadside barriers are compressed by a long-lens viewpoint.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 043 — Media-pen interview repeat

File: `043_techradar_1.jpg` · 970 × 546 · **partial**
SHA-256: `3b0207c45d17ea5a9f926cf219fb77e91ec41bcd753be922d8586a4833d684c9`

Repeated/variant composition of **020**; not counted as a separate implementation.

**Observed:** The composition repeats the press-driver scene, including camera operators and backdrop; it is not a new independent gameplay system.

**Game evidence:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Read Headquarters briefing after a completed study or race.

**Remaining gap:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 044 — Elevated pack repeat

File: `044_techradar_2.jpg` · 970 × 546 · **partial**
SHA-256: `2612e8f5d8bc10ec9a00e8b84fd5f57852e5711b543c50ed4d3dd812b259f636`

Repeated/variant composition of **007**; not counted as a separate implementation.

**Observed:** The composition repeats the crowded uphill corner and spectator layering.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 045 — Overhead curb duel repeat

File: `045_techradar_3.jpg` · 970 × 546 · **enhanced**
SHA-256: `cea59e74486237b44761ef3368334785e57f6686f3b1e53215accaccc8b3a28d`

Repeated/variant composition of **006**; not counted as a separate implementation.

**Observed:** The composition repeats the high-angle two-car curb encounter.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 046 — Circuit scan split repeat

File: `046_techradar_4.jpg` · 970 × 546 · **partial**
SHA-256: `3b5c1abeb151609ad9a1bd8e36cf399e7e08e5792672215c8e92b38823e708ef`

Repeated/variant composition of **001**; not counted as a separate implementation.

**Observed:** The composition repeats the point-cloud-to-finished-circuit comparison, which does not establish that this repository has survey data.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 047 — Pre-grid tire preparation

File: `047_techradar_5.jpg` · 970 × 546 · **partial**
SHA-256: `700dab0033308cd7187a9b8748e1a353b386edc8b590c3d5594bb5fd9541f023`

**Observed:** Mechanics work around a stationary car fitted with tire blankets, showing a preparation phase distinct from the racing pit stop.

**Game evidence:** The game has functional pit crew, grid staging and starting prompts, distinct from the new team-management workforce.

**Inspect:** Start Grand Prix for the staged grid; request a pit stop to inspect crew.

**Remaining gap:** Separate pre-grid tire blankets, detachable covers and grid-mechanic preparation animation are not implemented.

**Code:** `src/rendering/pit-crew.ts`, `src/rendering/paddock-detail.ts`, `src/ui/interface.ts`

### 048 — Wheel and three-pedal hardware

File: `048_techradar_6.jpg` · 840 × 473 · **supplementary**
SHA-256: `7a70123da12ffb11d75e20245ded1e77fc0a0c1165b1ec23adce1237d0a35f49`

**Observed:** A commercial steering-wheel base, rim and pedal set is a product photograph, not a gameplay capture.

**Game evidence:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Inspect:** Garage & Settings → select and calibrate a connected custom device.

**Remaining gap:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Code:** `src/input/controller.ts`, `src/ui/device-calibration.ts`

### 049 — Two wheel-and-pedal products

File: `049_techradar_7.jpg` · 840 × 473 · **supplementary**
SHA-256: `82f1c79f4e5edcc69d2315a3bf19a38ae2d19a93dcf5d5454167018ac676f44c`

**Observed:** A side-by-side peripheral comparison depicts physical input hardware, not an F1 game scene.

**Game evidence:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Inspect:** Garage & Settings → select and calibrate a connected custom device.

**Remaining gap:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Code:** `src/input/controller.ts`, `src/ui/device-calibration.ts`

### 050 — Unrelated dark fantasy character

File: `050_techradar_8.jpg` · 840 × 473 · **excluded**
SHA-256: `4f20142be0052bea19a231daa5d4f2a5632e4cc0c73e7a35ce3f88910eefbd43`

**Observed:** The image depicts a dark fantasy/horror character rather than Formula racing.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 051 — Unrelated science-fiction shooter tile

File: `051_techradar_9.jpg` · 840 × 473 · **excluded**
SHA-256: `b19d018358bfbccea153efb3c5d726c307035ccc4e6af513e3eb43145e19a5c6`

**Observed:** A science-fiction shooter/article image has no direct motorsport implementation requirement.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 052 — Unrelated event announcement

File: `052_techradar_10.jpg` · 840 × 473 · **excluded**
SHA-256: `44b8198a9d8cc71766c0eedb8e43f12ea1bb20122bca3869145c3ffedf440c4b`

**Observed:** An event-sign graphic for Summer Game Fest 2026 is article-navigation material, not the reference racing game.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 053 — Unrelated water-racing article image

File: `053_techradar_11.jpg` · 840 × 473 · **excluded**
SHA-256: `133579c3f492894f25b34110c499be802ca9703897b1cee735487c24e3e50279`

**Observed:** A water or hovercraft racing landscape belongs to a different game context.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 054 — Unrelated anime portrait

File: `054_techradar_12.jpg` · 840 × 473 · **excluded**
SHA-256: `56927f54b11ff982cba8078bc64f990d43abbd59f74bac2ddbfe3541d255e64c`

**Observed:** A stylized anime character portrait has no identifiable racing-game content.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 055 — Unrelated creature close-up

File: `055_techradar_13.jpg` · 840 × 473 · **excluded**
SHA-256: `101850b5cab3947332c5fdf7eb466d1f423f613fa2b22ac15ad10c2bb82855cc`

**Observed:** An alien or monster close-up is unrelated film/game imagery.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 056 — Unrelated fantasy combat artwork

File: `056_techradar_14.jpg` · 840 × 473 · **excluded**
SHA-256: `65d8886f794b9640ce4d32cd33099f508f15cc46337ac4650f8262d608d6b895`

**Observed:** Fantasy-combat key art has no direct connection to this racing simulation.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 057 — Unrelated demon fantasy artwork

File: `057_techradar_15.jpg` · 840 × 473 · **excluded**
SHA-256: `f47e6ed617e25ef3aed48e05fcf35583ad899bdd6094ef7a034564ede56d1891`

**Observed:** A demon/fantasy image is unrelated article artwork, not a missing car, track or menu.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 058 — Unrelated computer product

File: `058_techradar_16.jpg` · 840 × 473 · **excluded**
SHA-256: `5a2c523e967761716e4fea374fe1fd9937c85e9bc8f9838bebdeba3173b2bba9`

**Observed:** A small desktop/gaming-device product photograph is hardware editorial imagery.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 059 — Unrelated fantasy landscape

File: `059_techradar_17.jpg` · 840 × 473 · **excluded**
SHA-256: `f62a4557ec9e953410b32ba093d79b3bf88c97c641f03d5bfced3a4f822b29cb`

**Observed:** The fantasy game landscape is unrelated to the reference racing title.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 060 — Unrelated portal-and-warrior artwork

File: `060_techradar_18.png` · 840 × 473 · **excluded**
SHA-256: `fd42c0787195dcf07c6f1389af0eae601b2777587851fed73ce8d9f56bda29ca`

**Observed:** Fantasy portal/warrior key art is not an in-game motorsport scene.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 061 — Unrelated smartphone photograph

File: `061_techradar_19.jpg` · 840 × 473 · **excluded**
SHA-256: `74d0e0781ea62543a0651b7a545d24ff65d813523c1e00f290f1e23ba1f2e95f`

**Observed:** Two phones are shown as consumer-electronics products.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 062 — Unrelated camera product

File: `062_techradar_20.jpg` · 840 × 473 · **excluded**
SHA-256: `4e0fee52d767cd0fc4244e1057ea0e42c742d8faea7bc438293fe2cc6589e73e`

**Observed:** A mirrorless-camera product photograph is not a photo-mode screenshot.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 063 — Unrelated hooded anime character

File: `063_techradar_21.jpg` · 840 × 473 · **excluded**
SHA-256: `276461c001951ef8c0fa36aaa950e206dbe3e069f66d3af87ce419395a4a0875`

**Observed:** A hooded stylized character belongs to unrelated entertainment artwork.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 064 — Unrelated long-lens camera

File: `064_techradar_22.jpg` · 840 × 472 · **excluded**
SHA-256: `209fa5ab0dde6088e3ea3669a68ca13ccee0498dca2dd5d469eda3eb6fc5bb84`

**Observed:** A camera and telephoto lens are consumer-photography hardware, not a rendered racing camera.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 065 — Unrelated 3D printer product

File: `065_techradar_23.jpg` · 840 × 360 · **excluded**
SHA-256: `0da73201701b18c84038b4945aae26285edeed7e20d54dd50a57d476063275d4`

**Observed:** A multicolor 3D printer is shown as a hardware product.

**Game evidence:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap:** This source entry is contaminated reference material, not evidence of a missing feature.

**Code:** None: deliberately excluded.

### 066 — Close curb pack with different title marking

File: `066_techradar_24.jpg` · 970 × 546 · **cue-present**
SHA-256: `8c46b4b297c75e874a183d0cd0a49658d28da28a77fb31f5642fe1eba78f4248`

**Observed:** Formula cars run tightly beside turquoise/orange runoff. The wall branding appears to say F1 26; the supplied filename is not proof of F1 25 or PS5 provenance.

**Game evidence:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles.

**Inspect:** Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Remaining gap:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Code:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`

### 067 — Pod straight composition repeat

File: `067_topgear_1.webp` · 892 × 502 · **cue-present**
SHA-256: `63768d607ea85c263944233ffeeb423e080772865d216f8309776042103beaa9`

Repeated/variant composition of **008**; not counted as a separate implementation.

**Observed:** The composition repeats the forward pod/halo straight view.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 068 — Wet rear view repeat

File: `068_topgear_2.webp` · 892 × 502 · **cue-present**
SHA-256: `ed96e68c0d754f28b2ff084f2fcd8cf24098e284dfd5e7b9f271b8a4a4eca424`

Repeated/variant composition of **010**; not counted as a separate implementation.

**Observed:** The composition repeats the wet blue-banded-tire rear three-quarter scene.

**Game evidence:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Remaining gap:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`

### 069 — Reverse-layout leaderboard

File: `069_topgear_3.webp` · 892 × 502 · **partial**
SHA-256: `ba557220a19a8fb0c784167a51237b8d17365f8fc4e08ce0281304ee0b134940`

**Observed:** A reverse Silverstone selection shows global/friends lap rankings and flags for assists or setups.

**Game evidence:** Existing per-assist/compound/weather local best-lap storage provides a narrow timing foundation only.

**Inspect:** Complete a session and inspect local best-lap information.

**Remaining gap:** Reverse Silverstone, global/friends networking, leaderboard validation and ghost downloads are absent. Do not mark this image complete.

**Code:** `src/storage/data.ts`, `src/ui/interface.ts`

### 070 — Onboard setup-management panel

File: `070_topgear_4.webp` · 892 × 502 · **cue-present**
SHA-256: `1274c85d727bc7cdae18b0699ee3f947a5d9b3cc169e52eb7a0a44a739a24fbf`

**Observed:** A live solo cockpit view shows a delta and selectable brake-bias/differential parameters.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 071 — Pit-stop composition repeat

File: `071_topgear_5.webp` · 892 × 502 · **partial**
SHA-256: `3d25aa6397bf06398b49dd4fd715c28f55d4356543346c131c28341dc4852b80`

Repeated/variant composition of **004**; not counted as a separate implementation.

**Observed:** The composition repeats the coordinated multi-mechanic wheel change.

**Game evidence:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`

### 072 — Solo tight-corner delta

File: `072_topgear_6.webp` · 892 × 502 · **partial**
SHA-256: `fbfd71dfc92488cbaec30dab5d2ef49fff4a8c69d15d83b057e6f439fc6a8af4`

**Observed:** A low-gear onboard corner uses timing/ghost information, racing-line guidance and a legible wheel display.

**Game evidence:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback.

**Inspect:** Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap:** No rendered ghost car, dedicated practice-program scoring, reverse track or online time-trial board.

**Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`

### 073 — Helmet detail repeat

File: `073_topgear_7.webp` · 892 × 502 · **partial**
SHA-256: `0165fcf2842132f884c88ec1e6b287e5d77421ec45b28a5d61f493bf7267b6bf`

Repeated/variant composition of **009**; not counted as a separate implementation.

**Observed:** The composition repeats the close helmet, halo and cockpit material shot.

**Game evidence:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit.

**Inspect:** Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Remaining gap:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Code:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`

### 074 — Solo fast-straight timing

File: `074_topgear_8.webp` · 892 × 502 · **partial**
SHA-256: `925c5b543b392b93435eb46d0b48ac6163a57fdbbd5e5110dbebfa49b47c3012`

**Observed:** A high-speed straight view combines a timing delta with detailed stands, fencing and roadside structures.

**Game evidence:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback.

**Inspect:** Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap:** No rendered ghost car, dedicated practice-program scoring, reverse track or online time-trial board.

**Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`

### 075 — Photo-mode tutorial title

File: `075_traxion_1.jpg` · 1024 × 576 · **enhanced**
SHA-256: `7d0b236d0d269d8b8e564d3657fb4de1c0bf454c962d356452ef5af0ace985c7`

**Observed:** A tutorial title sits over a panning car photograph. Its actionable requirement is a usable capture/composition tool.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 076 — Sweeping elevated photo composition

File: `076_traxion_2.jpg` · 1024 × 576 · **enhanced**
SHA-256: `47651c43db1c7d4fad57d9a633c3d3925bce56772e3584a94618f9d5b2bdfecb`

**Observed:** A trackside photograph frames the winding road, elevation, grandstands and background scale as a single composition.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 077 — Low front mechanical photograph

File: `077_traxion_3.jpg` · 1024 × 576 · **enhanced**
SHA-256: `95a623a2d8fe9375310ad8ea76a64a774275bb3f2b24aa49cd1a8ad2df44a4e0`

**Observed:** A close front three-quarter image exposes front-wing elements, suspension links, tire shape and curb contact.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 078 — Panned side photograph

File: `078_traxion_4.jpg` · 1024 × 576 · **partial**
SHA-256: `70643f53a259e69b556cb901ec0255965e5d1133bc1570a3da2d28b22168d1d7`

**Observed:** A low side view separates the focused car silhouette from blurred background and rotating wheels.

**Game evidence:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`

### 079 — Night circuit with illuminated sphere

File: `079_traxion_5.jpg` · 1024 × 576 · **partial**
SHA-256: `8271f9d8e609293a4bbf8be66b577720786ebd6ff31ea8fde7cc26220eca8c53`

**Observed:** A large glowing sphere or screen landmark and floodlit racing infrastructure define a nighttime urban scene.

**Game evidence:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown.

**Inspect:** Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Remaining gap:** True night lighting, floodlights/neon, the giant illuminated sphere and a matching urban circuit are not implemented.

**Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`

### 080 — Night reflective bodywork detail

File: `080_traxion_6.jpg` · 1024 × 576 · **partial**
SHA-256: `2cc8cd2883502540038b9f373eedea35076cf1e974d17422af7c5b2b8ab4a902`

**Observed:** Neon-lit paint, close helmet/sidepod surfaces and wheel motion carry a nighttime reflective material treatment.

**Game evidence:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown.

**Inspect:** Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Remaining gap:** True night lighting, floodlights/neon, the giant illuminated sphere and a matching urban circuit are not implemented.

**Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`

### 081 — Headquarters atrium repeat

File: `081_gamingbolt_1.jpg` · 1024 × 576 · **partial**
SHA-256: `8a81129cd9e2fc7b6633f6a26e6bcb106ccf5312da3a78f75aed7632b0dc009c`

Repeated/variant composition of **016**; not counted as a separate implementation.

**Observed:** The composition repeats the suspended show-car atrium and staff/meeting interior.

**Game evidence:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Menu → Team HQ → Headquarters, Personnel or Finance.

**Remaining gap:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 082 — Wet rear scene repeat

File: `082_gamingbolt_2.jpg` · 1024 × 576 · **cue-present**
SHA-256: `a473af1d332b3edf91b3d370f447d66dda4fd624bfe4ebce1454a42c6a710dce`

Repeated/variant composition of **010**; not counted as a separate implementation.

**Observed:** The composition repeats the same rain-light, spray and wet-tire rear view.

**Game evidence:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Remaining gap:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`

### 083 — Curb duel repeat

File: `083_gamingbolt_3.jpg` · 1024 × 576 · **enhanced**
SHA-256: `409a5b1da61e5c57938089a6251c0e2f0c28ac2bc3e06596923bb4980125f4b3`

Repeated/variant composition of **006**; not counted as a separate implementation.

**Observed:** The composition repeats the overhead close two-car duel.

**Game evidence:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Remaining gap:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`

### 084 — Another-series cockpit

File: `084_gamescreed_1.jpg` · 1280 × 720 · **cue-present**
SHA-256: `6545371f28d795844142966b606c4fda676f0c8205ab1693670c3a1d4ebb36a9`

**Observed:** An onboard image includes another racing-series identity, with gloved steering, halo and mirrors behind a lead car.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 085 — Chase traffic proximity

File: `085_gamescreed_2.jpg` · 1280 × 720 · **cue-present**
SHA-256: `898f1e91bc3d2e758166fc898085de0f4d30a6d6bf0bdf3f830593a74a07f0d3`

**Observed:** A close chase battle uses proximity direction, competitor names, tower and vehicle telemetry to communicate overlap.

**Game evidence:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`

### 086 — Garage team-launch interview

File: `086_gamescreed_3.jpg` · 1280 × 720 · **partial**
SHA-256: `df938b4d1b16c06376af60197ecc365f7ad9ec94d9f8744109abacc36034bf03`

**Observed:** Presenters and a car share a garage presentation scene with lower-third identification/subtitle elements.

**Game evidence:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Read Headquarters briefing after a completed study or race.

**Remaining gap:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`

### 087 — Night sphere and rear car

File: `087_maxigeek_1.webp` · 1000 × 562 · **partial**
SHA-256: `48e4effa1b9e9a300310e336b10b59fe051a0df89e4fcfff1212f774226caa5a`

**Observed:** A rear three-quarter car is framed beside a giant bright sphere, grandstands and urban floodlighting.

**Game evidence:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown.

**Inspect:** Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Remaining gap:** True night lighting, floodlights/neon, the giant illuminated sphere and a matching urban circuit are not implemented.

**Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`

### 088 — Cockpit looking toward paddock

File: `088_maxigeek_2.webp` · 1000 × 562 · **cue-present**
SHA-256: `61e87e6916966cf1e95c9c29f5471cdcf6859da288d72db67d1aa26bbc964ed2`

**Observed:** An off-center cockpit composition emphasizes glove and wheel surfaces, a metallic halo, rear-view mirror and paddock structures.

**Game evidence:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`

### 089 — Tree-lined objective straight

File: `089_maxigeek_3.webp` · 1000 × 562 · **partial**
SHA-256: `96064b237c6b324fa04a7712f2602f158e26dd06d9fb871c927d916ca6aaaa5a`

**Observed:** A chase straight shows hold-position instructions, remaining laps, a tower and a high gear alongside dense roadside trees.

**Game evidence:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal.

**Inspect:** Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`

### 090 — Side-panning composition repeat

File: `090_cgmag_1.jpg` · 768 × 432 · **partial**
SHA-256: `214e81eef68a83613725c336e50c111cf3f74ff3a24da3278ecd15d29e73e98a`

Repeated/variant composition of **002**; not counted as a separate implementation.

**Observed:** The composition repeats the side-profile car photograph with motion streaking.

**Game evidence:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`

### 091 — Driver identity portrait

File: `091_cgmag_2.jpg` · 768 × 432 · **partial**
SHA-256: `680977158ffb4454ca0ceb31fcba9a58e8b507025c1a7a6a8456b7224cb92eea`

**Observed:** A commercial portrait uses a red suit/team identity and promotional lighting; it is not evidence of a playable character system.

**Game evidence:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`

### 092 — Pit-stop action repeat

File: `092_fallback_gamecritics.webp` · 1024 × 576 · **partial**
SHA-256: `08c70107d31a87e41ee2d8107dd689d762546a9a5dcaa67b113b9e1e53a473e5`

Repeated/variant composition of **004**; not counted as a separate implementation.

**Observed:** The composition repeats the jack, wheel exchange and crew choreography.

**Game evidence:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`

### 093 — Rainy cockpit in close traffic

File: `093_fallback_noobfeed_media.jpg` · 1280 × 720 · **cue-present**
SHA-256: `449e648acac3d9b56662c615da07cfb7ba2c71106cc25dd499a5f5c242c8e1ff`

**Observed:** A dark wet cockpit follows traffic through spray, with rain-obscured viewing and a visible halo silhouette.

**Game evidence:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Remaining gap:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`

### 094 — Five-light race start

File: `094_fallback_joinsteer.jpg` · 2000 × 1125 · **cue-present**
SHA-256: `ea693240caf704cd22d11be0065ff2b370c9ca2caf06b9be6e6cbc1a1680c597`

**Observed:** An onboard starting grid shows five red lamps, a clutch engagement prompt and cars staged ahead.

**Game evidence:** Existing staged race grid, start-light state, clutch input and race-start timing implement the visible starting interaction.

**Inspect:** Start Grand Prix; use the configured clutch/control scheme and watch the five-light sequence.

**Remaining gap:** Procedural grid atmosphere, crew density and licensed starting environment remain different.

**Code:** `src/ui/interface.ts`, `src/input/controller.ts`, `src/simulation/race.ts`

### 095 — Cockpit pit-service timing

File: `095_fallback_onpsx.jpg` · 3840 × 2160 · **partial**
SHA-256: `5bf96fcfc8e0f193906fbbf6a5167eafff743e67b1101875a91e1f28b84c7aef`

**Observed:** The driver sees wheel-changing activity, a stop timer, pit-lane boxes and a turn-in or service classification display.

**Game evidence:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`

### 096 — Overcast wet cockpit

File: `096_fallback_vandal.jpg` · 768 × 432 · **cue-present**
SHA-256: `33544bdfef7fa10d94b6a501a96570f50c73033ee8b6059ef0b15aff9da33a32`

**Observed:** Moisture, softened reflections and a car ahead frame gloved steering beneath overcast spectator infrastructure.

**Game evidence:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Remaining gap:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`

### 097 — Undulating guided racing

File: `097_fallback_ps4hry.jpg` · 1600 × 900 · **partial**
SHA-256: `dc1d41d9d6edfd28c9050c0f938c11c9394f40fcf10834e0df2cfbfd529499e3`

**Observed:** The onboard road rises/falls through a green racing line with a gap objective, minimap, mirrors and large grandstands.

**Game evidence:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal.

**Inspect:** Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`

### 098 — Race-pack curve repeat

File: `098_fallback_gamingbolt_cover.jpg` · 1024 × 576 · **partial**
SHA-256: `0701ee824b1c3fb6ed3f87752570da77d1621ad60e4e5d0cb7de30acf4250caf`

Repeated/variant composition of **007**; not counted as a separate implementation.

**Observed:** The composition repeats the dense elevated corner with layered spectators.

**Game evidence:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`

### 099 — Driver portrait title variation

File: `099_fallback_thumbculture_video.jpg` · 1024 × 576 · **partial**
SHA-256: `aad6504c4416c94ab1f455f4e56db2a573dd192c5759e87f2776fe3194cf3e64`

Repeated/variant composition of **091**; not counted as a separate implementation.

**Observed:** A variation of the portrait at 091 adds game-title marketing. It is not a second distinct driver gameplay mechanic.

**Game evidence:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`

### 100 — Helmet and title identity montage

File: `100_fallback_ea_myteam_thumb.jpg` · 4000 × 2250 · **partial**
SHA-256: `c13bb7c7d04428e04b4b88a3c85b5d3e7e3bc62cd898137a86b4e34987821ca3`

**Observed:** The final promotional montage combines close helmet/halo/car detail with a game title.

**Game evidence:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`
