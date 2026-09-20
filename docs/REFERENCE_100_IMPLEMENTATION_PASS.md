# 100-image implementation continuation — individually reviewed

Baseline: `c79992a56a08cdfee84732bbc32cac8e0d073085` on `main`.
Input: `F1_25_PS5_Developer_Reference_100_Images(2).zip`.
Archive SHA-256: `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.

## What the counts mean

All 100 source images were visually inspected individually, using numbered four-image sheets with original files available for detail. Every image hash was checked against the repository catalogue. There are **82 motorsport-related frames**, **2 supplementary wheel/pedal product photographs** (048–049), and **16 unrelated images** (050–065). Several motorsport frames are repeated/cropped compositions; the existing catalogue identifies 15 such cross-references. These are not 100 independent game features.

Every one of the 84 non-excluded entries now has a native **OPEN/INSPECT** action; the other 16 remain visibly excluded. **A route is discoverability, not feature completion.** An image can contain both a working cue and missing systems. None of the supplied screenshots, real-person portraits, editorial overlays or publisher logos are bundled into the game.

## Executed validation and limitations

The final local `npm run check` succeeded: ESLint, **621 unit tests in 61 files**, TypeScript checking and the Vite production build. The exact baseline passed 571 tests; this continuation adds 50. The earlier CSV compatibility failure was repaired by preserving the 228-column export contract rather than changing the expected historical columns.

Ten separate DOM-only checks passed at **1440 × 1000** and **390 × 844**: Academy, searchable/reference-filtered catalogue and action delegation, photo-backdrop controls, explicit replacement confirmation, and driving HUD layout. The programme and advisory rows now flow within the instrument panel; the layout check rejects intersection with classification, lap timing or action controls. These fixtures contain synthetic layout data and do not instantiate the 3D GameApp. Screenshots are visibly labelled accordingly.

The production Playwright attempt could not navigate to the test app: `net::ERR_BLOCKED_BY_ADMINISTRATOR`; a separate capability probe returned WebGL2 unavailable. The three new production-browser cases therefore **are not passing visual or gameplay evidence**. They remain checked in for a permitted WebGL-enabled browser. No browser policy was disabled or bypassed. Commercial-fidelity and full production-game visual acceptance remain unverified.

The build emits the existing type of advisory about JavaScript chunks above 500 kB; the application chunk is approximately 548 kB and Three.js approximately 529 kB before compression. Performance on a target phone or GPU has not been measured in this continuation.

Delivery evidence includes the final check log, 100-file hash verification, DOM check JSON and labelled screenshots, and the blocked production-browser log/trace. A local commit or bundle is not evidence that GitHub accepted a push; publication is reported separately in the delivery manifest.

## New working code in this continuation

- Native road-centre chevrons with cyclic braking advice, wet/yellow reductions and accessible visual cues.
- Five-attempt live consistency programme with an actual banker lap and measured grades; physics-worker validity/penalty/AI metadata prevents manufactured human awards.
- Native dark livery showroom with reversible scene/fog/visibility changes and unchanged simulation state.
- Pre-grid suspension-hub tyre blankets and staff withdrawal driven by recorded time.
- Original floodlit night presentation with bounded nearby lights and an original patterned LED sphere.
- Position/heading-based left/right traffic and overlap arrows, including overpass and retirement filtering.
- Individually routed reference inspection and reference-aware photo composition.

## Evidence boundary

Unit/integration tests exercise geometry, bounds, real worker metadata, lap crossings, replay preservation and scene-state restoration. Browser DOM checks are not GPU visual evidence. This environment reports WebGL2 unavailable and blocks local page navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`; full production-render visual acceptance and the new end-to-end game tests therefore require a WebGL-enabled browser/CI runner. Do not mark all 100 images complete or claim F1 25/PS5 fidelity based on this pass.

The existing race, wet tyre, pit, livery, photo and team systems were preserved; this report explicitly distinguishes those baseline features from new work. Images describing cinematics, real portraits, online rankings, advanced multi-slot decals or audio driving accessibility remain partially/unimplemented as noted below.

## Image-by-image analysis, implementation and remaining gaps

### 001 — Circuit scan comparison

**Source:** `001_ps_screenshot_01.webp`, 1200 × 675; SHA-256 `ebb5ecedcd3c3df621431104384c4d6e340459e33cad69d137c4a17883dd9645`.

**Observed:** A vertical split compares point-cloud survey data with a rendered boulevard: painted grid boxes, concrete walls, yellow-green kerbs, fence posts, canopies, trees and a bridge establish the circuit corridor.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Reference Review → 001 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 002 — Side-on panning car

**Source:** `002_ps_screenshot_02.webp`, 1200 × 675; SHA-256 `7c334ec3606b04f1f5fbbd0d9d11d1c818d545f4b9ce477da752d6a3b2597d1b`.

**Observed:** A low front-three-quarter panning view of a red open-wheel car shows multi-element front wings, exposed suspension, soft-compound red sidewalls and dense grandstands streaked by motion.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Reference Review → 002 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Still missing / qualification:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Catalogue status:** `partial`. **Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`

### 003 — Working cockpit wheel

**Source:** `003_ps_steeringwheel.webp`, 1200 × 675; SHA-256 `0f2df1b7304701557ac3f7025e9983aca8239f83c9325640f72282593c9952e1`.

**Observed:** The driver-eye cockpit has a central halo pillar and curved arch, gloved hands on a turned wheel, gear 8 on the physical display, coloured controls and two mirror views down a fenced corridor.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 003 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 004 — Wheel-change pit choreography

**Source:** `004_ps_pitstop.webp`, 1200 × 675; SHA-256 `97fdd0502303a4f989568c735b4b52abb6f71ca05eb2cf686682b7dfe6e7d4c4`.

**Observed:** A pit service surrounds all four wheels with mechanics, wheel guns and replacement tyres, while front and rear jacks establish a coordinated vehicle-lift and release sequence.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Reference Review → 004 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Still missing / qualification:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Catalogue status:** `partial`. **Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 005 — Livery showroom

**Source:** `005_ps_editor.webp`, 1200 × 675; SHA-256 `a0e589a7b639a2268eb2ec7af7547bef82282fe5c65a765beed7785605c0e1cf`.

**Observed:** A white/yellow car stands in a nearly black showroom. Controlled highlights reveal body curvature, layered aero and slick tyre lettering without circuit scenery competing with the livery.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 005 → the entry's INSPECT/OPEN button. Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Still missing / qualification:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Catalogue status:** `enhanced`. **Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`

### 006 — High-angle curb duel

**Source:** `006_ps_bp3_action.webp`, 1200 × 675; SHA-256 `c8d250012e7b8f78a2488aa792b2d78decbe333464a88b1f04a9832202b995d6`.

**Observed:** An elevated diagonal view places purple/yellow and white/red cars side by side next to red-white-green kerbing. Wheel spacing, front-wing width and speed-blurred ground carry the composition.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 006 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 007 — Dense elevated race pack

**Source:** `007_ps_screenshot_03.webp`, 1200 × 675; SHA-256 `d6637ba0068906fa2e027018b1b9be4822a53b71010c3f00f4120ccf6fdb9712`.

**Observed:** A dense rear-view race pack climbs beside grass, catch fences, tiered stands and trees. Rear suspension, diffusers and tyre stripes remain readable at several distances.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Reference Review → 007 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 008 — Pod camera down the straight

**Source:** `008_ps_screenshot_05.webp`, 1200 × 675; SHA-256 `88a094d040523d9e9b9f620305f7b10ee65c9ed8e9007a26c3227682780b82a9`.

**Observed:** An elevated onboard camera looks over the driver's helmet, halo, mirrors and exposed front tyres toward another car. Grid paint and rubber darkening organize the long straight.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 008 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 009 — Helmet and halo close-up

**Source:** `009_ps_screenshot_06.webp`, 1200 × 675; SHA-256 `66ae1a9f62575a806f941ac5380df783605270b92905c1cf2af7b2f2a34187ab`.

**Observed:** A tight driver close-up shows a reflective helmet visor, gloves, carbon cockpit edge, halo and a small identity decal. It is a material/occupancy reference, not evidence for identifying the person.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit.

**Inspect:** Reference Review → 009 → the entry's INSPECT/OPEN button. Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Still missing / qualification:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Catalogue status:** `partial`. **Code:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`

### 010 — Wet rear three-quarter view

**Source:** `010_ps_rain.webp`, 1200 × 675; SHA-256 `16210586874a8b7729c376b952026bcb6da467ccc8d29baa955ce53448b772b4`.

**Observed:** A wet rear-three-quarter car view contains blue wet-compound stripes, tread grooves, tyre spray, a red rain light, dark reflective asphalt and an overcast tree-lined background.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 010 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Still missing / qualification:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 011 — Team headquarters exterior

**Source:** `011_ea_myteam_facilities.jpg`, 3840 × 2160; SHA-256 `54ce0c0a91457f6146ca51cad5fc46f06ce57b89090611d770ac8aa5f6dafab4`.

**Observed:** A team headquarters exterior uses large glazed openings, panelled facade layers, planters, trees and people to establish an occupied facility rather than a flat menu background.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Reference Review → 011 → the entry's INSPECT/OPEN button. Menu → Team HQ → Headquarters, Personnel or Finance.

**Still missing / qualification:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 012 — Engineering department menu

**Source:** `012_ea_engineering.jpg`, 3840 × 2160; SHA-256 `bd0788a2bcc0b2b0605df03021bcf0e54a110b13583ca6b4b2c21494a83ec76b`.

**Observed:** The engineering screen overlays a workshop with a raised car, tools, monitors and staff. Department navigation, research phases and progress controls connect the environment to facility management.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added priced, timed studies with a one-active-study limit and staffing-dependent completion. Completed studies unlock explicit setup changes saved for the next session.

**Inspect:** Reference Review → 012 → the entry's INSPECT/OPEN button. Team HQ → Engineering → Commission; advance weeks; Apply to next session; inspect Garage setup.

**Still missing / qualification:** Research is a three-study local setup loop, not a full component development tree, manufacturing/history system or invisible car-stat upgrade.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/simulation/config.ts`, `src/ui/reference-routes.ts`

### 013 — Personnel department menu

**Source:** `013_ea_personnel.jpg`, 3840 × 2160; SHA-256 `aafc150368007a3c8b20349627e435ecfef080950ee160f5bdfb2e56a8a088a6`.

**Observed:** The personnel screen presents a furnished staff lounge with chairs, tables and people behind department navigation, driver management and workforce/facility controls.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Reference Review → 013 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Still missing / qualification:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 014 — Workforce economics screen

**Source:** `014_ea_workforce.jpg`, 3840 × 2160; SHA-256 `8879ed796eeaa2e6901e110777836a9d344b2d57065826007c11306eaf7f4c7e`.

**Observed:** The workforce screen separates engineering, personnel and corporate departments, showing allocation limits, salaries, income/resource effects and time-related management decisions.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Reference Review → 014 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Still missing / qualification:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 015 — Team finance ledger

**Source:** `015_ea_finances.jpg`, 3840 × 2160; SHA-256 `d62c1ed24179d6e1a7f2537eb22d5135c484bfe5fd1509ba2d5e46af69e7916c`.

**Observed:** The finance screen combines account balance, cost-cap information, historical financial changes and contract cards; weekly and seasonal values need actual recorded transactions.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a bounded saved ledger with real income, payroll, facility and transaction deductions. Invalid/insolvent actions leave state unchanged.

**Inspect:** Reference Review → 015 → the entry's INSPECT/OPEN button. Team HQ → Finance; inspect ledger before/after hiring, research and advancing a week.

**Still missing / qualification:** Fictional local credits only; no real money, full financial forecast model or sponsor-negotiation system.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/storage/data.ts`, `src/ui/reference-routes.ts`

### 016 — Headquarters atrium

**Source:** `016_ea_hq.jpg`, 2560 × 1440; SHA-256 `f12a5f68a33d184ee6b8bb7d71ac149ca6159da3b9c81b2731ce48a89413c5ef`.

**Observed:** A two-storey headquarters atrium includes a display car, stair, railings, glazed upper rooms, people, work tables, sofas and plants. Multiple depth layers are visible.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Reference Review → 016 → the entry's INSPECT/OPEN button. Menu → Team HQ → Headquarters, Personnel or Finance.

**Still missing / qualification:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 017 — Driver roster comparison

**Source:** `017_ea_driver_select.jpg`, 3840 × 2160; SHA-256 `bd75c79b190aa424b14c1a358e45f98b89c3acc3a7594e2ee9e4995df2df42f8`.

**Observed:** A driver-selection layout compares two suited driver figures, their numerical attributes and selection controls. An original driver roster is a counterpart; real likenesses are not required.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Reference Review → 017 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Still missing / qualification:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 018 — Team rivalry screen

**Source:** `018_ea_fan_rating.jpg`, 3840 × 2160; SHA-256 `66c3fc3879625167110787dbaf434cb2368e3afdada8cf0bda9c7bd6236ca2ee`.

**Observed:** A rivalry screen compares two scores, a future race target, rivalry intensity and fan/reward information. It depicts explicit opponent progression, not just a generic results table.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added local team points/reputation and a visible fictional Meridian rivalry, updated only by classified manual Grand Prix results with opponents.

**Inspect:** Reference Review → 018 → the entry's INSPECT/OPEN button. Finish a manual race against opponents → Team HQ. AI-demonstration sessions earn no team result.

**Still missing / qualification:** Meridian scoring is a disclosed local model, not an online competitor or relationship/event-driven campaign rivalry.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/main.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`

### 019 — Driver icon selection

**Source:** `019_ea_driver_icons.jpg`, 3840 × 2160; SHA-256 `65f5a5520ae1c42b6a586e8f6a9d05a218962e54e09ad006952f509b23c2cd71`.

**Observed:** A driver market presents a grid of portrait cards, selectable driver options and season/mode context. The screen depends on a real roster and meaningful selection outcomes.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Inspect:** Reference Review → 019 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Still missing / qualification:** No licensed portraits or historical icons, driver skill simulation, rendered office/people, or workforce-driven pit-speed bonus.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 020 — Media-pen interview

**Source:** `020_ea_bp_press.jpg`, 3840 × 2160; SHA-256 `ae2c3734ddee997d7b70311c076965bd6e8c4f70b956548b4c868c5f609b212c`.

**Observed:** A media interview focuses on a suited, capped driver while photographers and a sponsor-style backdrop are defocused behind the subject. This is a human-animation and presentation reference.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Reference Review → 020 → the entry's INSPECT/OPEN button. Read Headquarters briefing after a completed study or race.

**Still missing / qualification:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 021 — Helmet-led title graphic

**Source:** `021_ea_bp_trailer_thumb.png`, 1920 × 1080; SHA-256 `fe7ce67b6e556079be36b166189db8ba471389475b04801b800d0e2e7821a645`.

**Observed:** A promotional helmet close-up uses visor reflections, dramatic lighting and title graphics. The typography and likeness are marketing content, not separate vehicle-physics requirements.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Reference Review → 021 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Still missing / qualification:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 022 — Front three-quarter cornering

**Source:** `022_ea_hamilton.jpg`, 3840 × 2160; SHA-256 `722c24b40f1fd260a2e7b32b8db7cbd506c608e3bcd85cd67ff8efc35b7a2b77`.

**Observed:** A low red-car front-three-quarter panning composition emphasizes stacked front-wing elements, suspension rods, the front tyre and kerb/barrier motion streaks.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles.

**Inspect:** Reference Review → 022 → the entry's INSPECT/OPEN button. Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Still missing / qualification:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`, `src/ui/reference-routes.ts`

### 023 — Tutorial composite: driver and rig

**Source:** `023_ea_oar2_0.jpg`, 1080 × 1920; SHA-256 `7c69047acfa6f2c86431a40edc78542d120a6dc2fee6082f5cb78e09f1001f73`.

**Observed:** A tutorial composite combines a physical sim rig or presenter area with driver-career portrait selection. Its editorial layout should not be mistaken for a single native gameplay scene.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing controls, calibration, setup and assist explanations provide an in-game learning route. Editorial presenters are intentionally not inserted as game assets.

**Inspect:** Reference Review → 023 → the entry's INSPECT/OPEN button. Menu → Controls or Garage & Settings; choose practice to learn inputs.

**Still missing / qualification:** No embedded presenter video, voiced tutorial campaign or exact vertical social-media layout.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/ui/reference-routes.ts`

### 024 — Tutorial composite: chase telemetry

**Source:** `024_ea_oar2_1.jpg`, 1080 × 1920; SHA-256 `7169dcad583c10f062917e6d469322d733c82bb864032e96ac95a0bd7b244c5b`.

**Observed:** A chase-view tutorial drives down a palm-lined straight with classification, large gear/speed readouts and battery information. The presenter/tutorial overlay is separate from the game HUD.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Reference Review → 024 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`

### 025 — Tutorial composite: energy controls

**Source:** `025_ea_oar2_2.jpg`, 1080 × 1920; SHA-256 `0af2c94f04591421380571dcb940a6358bb91d9302af386548d1afae11c1b856`.

**Observed:** A night-street onboard tutorial shows an opponent, gear/battery readouts and an editorial arrow. Night illumination and cockpit telemetry are actual cues; the added arrow is editorial.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 025 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 026 — Tutorial composite: assist settings

**Source:** `026_ea_oar2_3.jpg`, 1080 × 1920; SHA-256 `de2e5f8571e14955dcabd8da39accd48e647e52512affeea349f2939bcf1c8b6`.

**Observed:** The livery tutorial displays an orange car against a studio setting with selectable categories, patterns and colour controls. Editing must change the car, not merely a thumbnail.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Existing saved assists, bindings, custom-device calibration and graphics controls provide real configuration rather than static option cards. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 026 → the entry's INSPECT/OPEN button. Menu → Garage & Settings; change, Apply & Save, then reload.

**Still missing / qualification:** Vehicle-series selection and the reference video presenter are not game features here.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/device-calibration.ts`, `src/ui/presentation.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 027 — Tutorial composite: narrow-street cockpit

**Source:** `027_ea_oar2_4.jpg`, 1080 × 1920; SHA-256 `e25b77786db47c514750fff4807f81f9d2d0932c859b87b4bcc54ef9fae6491e`.

**Observed:** An onboard city-circuit tutorial shows timing gaps, a classification tower and a gear-5 driving HUD beside tightly enclosed scenery; editorial framing surrounds the gameplay.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 027 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 028 — Tutorial composite: braking reference

**Source:** `028_ea_oar2_5.jpg`, 1080 × 1920; SHA-256 `bbfd1482ae20780b49a9c6f626aed857e57f9da4047cadc049bea79d645cb61a`.

**Observed:** A driver looks right from the cockpit toward a nearby rival. The wheel/halo, working mirror and a 100-metre braking board remain visible and establish spatial awareness.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 028 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 029 — Tutorial composite: corner exit

**Source:** `029_ea_oar2_6.jpg`, 1080 × 1920; SHA-256 `b4328456df0c82b5cae5b7147613d0d6ad4e96a178ff4095c0f7449193c57b20`.

**Observed:** A chase camera follows a car through a kerbed bend. The rear assembly, charging/ERS readout, gear 6 and peripheral circuit detail combine racing presentation with live data.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Inspect:** Reference Review → 029 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`

### 030 — Tutorial composite: wheel and horizon

**Source:** `030_ea_oar2_8.jpg`, 1080 × 1920; SHA-256 `2683eab7bf48332187e99d00a55b6bf435b20ba984b2c1b91e6d1dc70964f738`.

**Observed:** A close onboard view makes the physical wheel display, gear 6, coloured controls and gloved hands prominent inside a carbon-lined halo cockpit.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 030 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 031 — Editable sidepod sponsor slots

**Source:** `031_ea_decal.jpg`, 3840 × 2160; SHA-256 `430f536252611c2ed84d81ef18608eb6cd435aa639b562dcc2a1d00a32b01f52`.

**Observed:** A decal editor shows roughly ten sponsor slots, placement markers, a carousel, race number 86 and a multicolour flank. This is more capable than a single editable wordmark.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 031 → the entry's INSPECT/OPEN button. Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Still missing / qualification:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Catalogue status:** `partial`. **Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`

### 032 — Side-by-side numbered cars

**Source:** `032_ea_driver_number.jpg`, 3316 × 1865; SHA-256 `6444b284c3fa0da95341b49d953c5d7321c0401af4d843c6ac57cd67568b614b`.

**Observed:** A white/blue/yellow rival with number 34 runs close beside a side-looking cockpit camera. A custom number and paint must remain readable on an actual nearby car.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 032 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Still missing / qualification:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/style.css`

### 033 — Customized livery on circuit

**Source:** `033_ea_sponsor_livery.jpg`, 3298 × 1855; SHA-256 `251c60b2e74300455292756d1a9b2731d4de29fba8012bf5803cc3b0ed3c4927`.

**Observed:** A white/blue/yellow livery with wordmarks is framed beside multi-rail Armco, catch fencing and grass; the image connects car identity to real circuit-side depth.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 033 → the entry's INSPECT/OPEN button. Menu → Photo / Livery; edit, Save Livery, return and race. Inspect the same paint on circuit.

**Still missing / qualification:** No arbitrary uploaded image decals, UV dragging, licensed sponsor catalogue or multi-slot placement editor.

**Catalogue status:** `enhanced`. **Code:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`

### 034 — Backmarker objective overlay

**Source:** `034_push_156273.webp`, 900 × 506; SHA-256 `7cb5c768b3f333f9f5bcd4e1b50490b5c1a9a809e403b3f7814ce044c0c7a89d`.

**Observed:** A story-race HUD specifies overtaking a backmarker and then winning, with laps remaining, gap information, radio context and a coloured driving line on the road.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Current game counterpart:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Inspect:** Reference Review → 034 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Still missing / qualification:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 035 — Headquarters calendar

**Source:** `035_push_156274.webp`, 900 × 506; SHA-256 `35dabca8522b418c13454a8abe3d86d523b78ec70ca7e0c32965301241ca3d7e`.

**Observed:** The headquarters hub displays calendar/week context, income and costs, current tasks and the next race day over a reception/facility scene. Time advancement should have consequences.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added explicit one-week advancement charging payroll/overhead, crediting partnership income and completing research, with transaction persistence before UI confirmation.

**Inspect:** Reference Review → 035 → the entry's INSPECT/OPEN button. Team HQ → Advance one week; inspect Finance and Engineering.

**Still missing / qualification:** No multirace world calendar, date-based travel or full career-event scheduling.

**Catalogue status:** `enhanced`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`

### 036 — Chase vehicle-management panel

**Source:** `036_push_156275.webp`, 900 × 506; SHA-256 `f7f600f50a589a39d9151d4afcb67db13f3e96e87daa5a7b9b39da8c0c51cb70`.

**Observed:** A practice chase view crosses green-yellow kerbing and grid paint with a DRS distance and a multifunction display for fuel, front brake bias, differential and ERS.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Inspect:** Reference Review → 036 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 037 — Practice target and delta

**Source:** `037_push_156276.webp`, 900 × 506; SHA-256 `1cefccfc2f509bea45a7425aa3d7ff25e81749ce79854adb2a015f43afd96762`.

**Observed:** A practice programme presents five labelled attempts with star-like outcome indicators, a target/delta and on-track guidance. Its progress should come from measured performance, not clicks.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Current game counterpart:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Inspect:** Reference Review → 037 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Still missing / qualification:** Five measured attempts and advisory guidance now exist. This is not the reference game's complete practice programme, ghost system, commercial coaching logic, star artwork or validated optimum racing line.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 038 — Letterboxed story dialogue

**Source:** `038_push_156277.webp`, 900 × 506; SHA-256 `47a470b08bd0b34a3e9bb248e13f4ae648a2a034bf76d37fab3e2a4033e51adc`.

**Observed:** A letterboxed narrative conversation shows two people with subtitles. This requires original character staging, dialogue and animation to reproduce as a game system.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added contextual original written briefings after driver/research/race changes. This is a limited management presentation, not an equivalent cinematic.

**Inspect:** Reference Review → 038 → the entry's INSPECT/OPEN button. Team HQ → read the current briefing.

**Still missing / qualification:** The two-character animated story scene, voice acting, facial animation and narrative campaign are not implemented.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`

### 039 — Broadcast wide field

**Source:** `039_thumbculture_2.jpg`, 1024 × 576; SHA-256 `4612e6dede3e24ea01af37c5140373bc6f8663e4ae433280acd4dc8d2eebf6d0`.

**Observed:** A night broadcast angle shows a full field, timing tower, replay treatment, floodlights and coloured run-off. The density and venue are distinct from a small daytime test circuit.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing recorded full-field replay, timing tower, car tracking and trackside cameras now also support frozen selectable-car compositions. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 039 → the entry's INSPECT/OPEN button. Drive, pause → Watch Replay; cycle C to trackside; Photo Studio for an intentional wide shot.

**Still missing / qualification:** Original night illumination and an LED venue motif now exist, but this is not a matched city circuit, the licensed spherical landmark, a 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review of this new pass remains outstanding.

**Catalogue status:** `partial`. **Code:** `src/rendering/renderer.ts`, `src/storage/replay-pages.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/ui/driving-academy.ts`

### 040 — Audio driving-assistance settings

**Source:** `040_thumbculture_3.jpg`, 1024 × 576; SHA-256 `2b1cc77cff8645f0247707f71797cec9c97248cd261c82213526f95f8cda299e`.

**Observed:** An accessibility settings screen provides audio driving cues for gears, wrong-way travel, track limits and corners, with volume, stereo panning, preview and lookahead controls.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing input remapping, contrast/color-vision options, UI scale and audio controls provide some accessibility foundations.

**Inspect:** Reference Review → 040 → the entry's INSPECT/OPEN button. Garage & Settings → presentation, audio and device bindings.

**Still missing / qualification:** Optional audio-driving cues with per-event settings, stereo previews and configurable lookahead are still missing. Existing visual accessibility and device mapping must not be represented as that audio system.

**Catalogue status:** `partial`. **Code:** `src/ui/presentation.ts`, `src/ui/device-calibration.ts`, `src/audio/engine.ts`, `src/ui/reference-routes.ts`

### 041 — Gravel incident and dust

**Source:** `041_thumbculture_4.jpg`, 1024 × 576; SHA-256 `c6d6401cf838a1ffbbe8adce502125925250cb7b0719ed269303078542d64789`.

**Observed:** Two cars in a gravel incident produce dust and visible debris, with fencing and industrial buildings behind them. These effects should follow contact and surface state.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing contact-state dust, gravel/spark/debris effects and damage respond to actual off-track/contact events and recorded replay state.

**Inspect:** Reference Review → 041 → the entry's INSPECT/OPEN button. Drive onto gravel; review recorded incident from trackside or Photo Studio.

**Still missing / qualification:** Procedural particle density and damage deformation do not match the reference cinematic quality.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/effects.ts`, `src/rendering/debris.ts`, `src/simulation/collision.ts`, `src/ui/reference-routes.ts`

### 042 — Telephoto straight composition

**Source:** `042_thumbculture_5.jpg`, 1024 × 576; SHA-256 `9b49192bd0df80332b566697930a3012227af34192f709cf2b691f592259e510`.

**Observed:** An elevated broadcast view looks down a pit straight with two cars, painted grid boxes, rubbered asphalt, pit-wall structures and a long architectural corridor.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Reference Review → 042 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 043 — Media-pen interview repeat

**Source:** `043_techradar_1.jpg`, 970 × 546; SHA-256 `3b0207c45d17ea5a9f926cf219fb77e91ec41bcd753be922d8586a4833d684c9`.

**Observed:** A tighter variant of reference 020 again emphasizes an interview subject, photographers, shallow focus and a media backdrop rather than another independent driving feature.

**Repeated composition:** variant of 020; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Reference Review → 043 → the entry's INSPECT/OPEN button. Read Headquarters briefing after a completed study or race.

**Still missing / qualification:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 044 — Elevated pack repeat

**Source:** `044_techradar_2.jpg`, 970 × 546; SHA-256 `2612e8f5d8bc10ec9a00e8b84fd5f57852e5711b543c50ed4d3dd812b259f636`.

**Observed:** A cropped variant of reference 007 repeats rear-view traffic, layered fencing, grandstands, tyres and elevation in a dense field.

**Repeated composition:** variant of 007; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Reference Review → 044 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 045 — Overhead curb duel repeat

**Source:** `045_techradar_3.jpg`, 970 × 546; SHA-256 `cea59e74486237b44761ef3368334785e57f6686f3b1e53215accaccc8b3a28d`.

**Observed:** A variant of reference 006 repeats the elevated side-by-side duel, coloured kerb and motion-blurred road, rather than supplying an additional independent system.

**Repeated composition:** variant of 006; not an independent feature.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 045 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 046 — Circuit scan split repeat

**Source:** `046_techradar_4.jpg`, 970 × 546; SHA-256 `3b5c1abeb151609ad9a1bd8e36cf399e7e08e5792672215c8e92b38823e708ef`.

**Observed:** A variant of reference 001 repeats the survey-versus-render comparison, roadside alignment, barrier heights and painted grid geometry.

**Repeated composition:** variant of 001; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Reference Review → 046 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 047 — Pre-grid tire preparation

**Source:** `047_techradar_5.jpg`, 970 × 546; SHA-256 `700dab0033308cd7187a9b8748e1a353b386edc8b590c3d5594bb5fd9541f023`.

**Observed:** A pre-grid car wears tyre blankets while mechanics stand or kneel around it. Warmers, temporary equipment and the front-wing area distinguish preparation from active pit service.

**This continuation:** Added four suspension-hub-aligned tyre blankets, retaining straps and two original preparation staff per car. Blankets withdraw before the first red light and staff clear before the second; pause/replay uses recorded time and nothing remains on the racing grid.

**Current game counterpart:** The game has functional pit crew, grid staging and starting prompts, distinct from the new team-management workforce. Added four suspension-hub-aligned tyre blankets, retaining straps and two original preparation staff per car. Blankets withdraw before the first red light and staff clear before the second; pause/replay uses recorded time and nothing remains on the racing grid.

**Inspect:** Reference Review → 047 → the entry's INSPECT/OPEN button. Start Grand Prix for the staged grid; request a pit stop to inspect crew.

**Still missing / qualification:** The preparation people and blanket motion are procedural, not commercial-quality scans or full hand animations. Blanket visuals do not add a physical preheating model; no PS5 visual equivalence is claimed.

**Catalogue status:** `partial`. **Code:** `src/rendering/pit-crew.ts`, `src/rendering/paddock-detail.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/grid-preparation.ts`, `src/rendering/renderer.ts`

### 048 — Wheel and three-pedal hardware

**Source:** `048_techradar_6.jpg`, 840 × 473; SHA-256 `7a70123da12ffb11d75e20245ded1e77fc0a0c1165b1ec23adce1237d0a35f49`.

**Observed:** A physical steering-wheel and three-pedal product bundle is photographed on a blue background. It informs calibration expectations, not a circuit object or proof of hardware support.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Inspect:** Reference Review → 048 → the entry's INSPECT/OPEN button. Garage & Settings → select and calibrate a connected custom device.

**Still missing / qualification:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Catalogue status:** `supplementary`. **Code:** `src/input/controller.ts`, `src/ui/device-calibration.ts`, `src/ui/reference-routes.ts`

### 049 — Two wheel-and-pedal products

**Source:** `049_techradar_7.jpg`, 840 × 473; SHA-256 `82f1c79f4e5edcc69d2315a3bf19a38ae2d19a93dcf5d5454167018ac676f44c`.

**Observed:** Two physical steering-wheel/pedal bundles appear on an orange background. Their compatibility and force-feedback behaviour cannot be inferred from the photograph.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Inspect:** Reference Review → 049 → the entry's INSPECT/OPEN button. Garage & Settings → select and calibrate a connected custom device.

**Still missing / qualification:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Catalogue status:** `supplementary`. **Code:** `src/input/controller.ts`, `src/ui/device-calibration.ts`, `src/ui/reference-routes.ts`

### 050 — Unrelated dark fantasy character

**Source:** `050_techradar_8.jpg`, 840 × 473; SHA-256 `4f20142be0052bea19a231daa5d4f2a5632e4cc0c73e7a35ce3f88910eefbd43`.

**Observed:** An unrelated medieval action-game scene with torch-lit combat appears in the archive. It contains no identifiable requirement for this formula-racing game.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 051 — Unrelated science-fiction shooter tile

**Source:** `051_techradar_9.jpg`, 840 × 473; SHA-256 `b19d018358bfbccea153efb3c5d726c307035ccc4e6af513e3eb43145e19a5c6`.

**Observed:** An unrelated shooter promotional scene depicts armed characters and an explosion with editorial graphics; it is contamination in a motorsport reference set.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 052 — Unrelated event announcement

**Source:** `052_techradar_10.jpg`, 840 × 473; SHA-256 `44b8198a9d8cc71766c0eedb8e43f12ea1bb20122bca3869145c3ffedf440c4b`.

**Observed:** An exterior event sign for Summer Game Fest 2026 is unrelated to formula racing. The event branding is not a game-feature requirement.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 053 — Unrelated water-racing article image

**Source:** `053_techradar_11.jpg`, 840 × 473; SHA-256 `133579c3f492894f25b34110c499be802ca9703897b1cee735487c24e3e50279`.

**Observed:** Unrelated science-fiction pod-racing artwork has an editorial event graphic. Its vehicles and fictional environment do not belong to the provided formula-car target.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 054 — Unrelated anime portrait

**Source:** `054_techradar_12.jpg`, 840 × 473; SHA-256 `56927f54b11ff982cba8078bc64f990d43abbd59f74bac2ddbfe3541d255e64c`.

**Observed:** An unrelated anime/fantasy character with horns appears against a stylized background. No formula-racing feature can be grounded in this image.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 055 — Unrelated creature close-up

**Source:** `055_techradar_13.jpg`, 840 × 473; SHA-256 `101850b5cab3947332c5fdf7eb466d1f423f613fa2b22ac15ad10c2bb82855cc`.

**Observed:** An unrelated alien-creature horror close-up appears in the pack. It is excluded rather than translated into a racing asset.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 056 — Unrelated fantasy combat artwork

**Source:** `056_techradar_14.jpg`, 840 × 473; SHA-256 `65d8886f794b9640ce4d32cd33099f508f15cc46337ac4650f8262d608d6b895`.

**Observed:** An unrelated fantasy combat scene includes serpentine enemies and a lightning-like weapon effect; it is not evidence for racing physics or presentation.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 057 — Unrelated demon fantasy artwork

**Source:** `057_techradar_15.jpg`, 840 × 473; SHA-256 `f47e6ed617e25ef3aed48e05fcf35583ad899bdd6094ef7a034564ede56d1891`.

**Observed:** Unrelated demon/fantasy promotional artwork supplies no motorsport requirement and is retained only as an explicitly excluded audit entry.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 058 — Unrelated computer product

**Source:** `058_techradar_16.jpg`, 840 × 473; SHA-256 `5a2c523e967761716e4fea374fe1fd9937c85e9bc8f9838bebdeba3173b2bba9`.

**Observed:** An unrelated small cube-shaped computer/console and controller product photograph is not a car, circuit, racing interface or supported wheel/pedal test.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 059 — Unrelated fantasy landscape

**Source:** `059_techradar_17.jpg`, 840 × 473; SHA-256 `f62a4557ec9e953410b32ba093d79b3bf88c97c641f03d5bfced3a4f822b29cb`.

**Observed:** An unrelated third-person fantasy landscape with a magical tower is not a circuit environment reference and is excluded from implementation claims.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 060 — Unrelated portal-and-warrior artwork

**Source:** `060_techradar_18.png`, 840 × 473; SHA-256 `fd42c0787195dcf07c6f1389af0eae601b2777587851fed73ce8d9f56bda29ca`.

**Observed:** Unrelated sword-hero artwork uses a magical circular portal composition. It does not describe the requested formula-racing game.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 061 — Unrelated smartphone photograph

**Source:** `061_techradar_19.jpg`, 840 × 473; SHA-256 `74d0e0781ea62543a0651b7a545d24ff65d813523c1e00f290f1e23ba1f2e95f`.

**Observed:** A smartphone product photograph is unrelated to the supplied racing reference objective; it is not evidence that the game has a particular mobile UI.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 062 — Unrelated camera product

**Source:** `062_techradar_20.jpg`, 840 × 473; SHA-256 `4e0fee52d767cd0fc4244e1057ea0e42c742d8faea7bc438293fe2cc6589e73e`.

**Observed:** A camera-body product photograph does not show the racing game's photo mode or rendering. It is excluded rather than counted as an implemented feature.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 063 — Unrelated hooded anime character

**Source:** `063_techradar_21.jpg`, 840 × 473; SHA-256 `276461c001951ef8c0fa36aaa950e206dbe3e069f66d3af87ce419395a4a0875`.

**Observed:** An unrelated hooded anime character is promotional character artwork, not a driver or racing-system requirement.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 064 — Unrelated long-lens camera

**Source:** `064_techradar_22.jpg`, 840 × 472; SHA-256 `209fa5ab0dde6088e3ea3669a68ca13ccee0498dca2dd5d469eda3eb6fc5bb84`.

**Observed:** A camera-lens product photograph is not an in-game optical effect demonstration and is excluded from racing coverage counts.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 065 — Unrelated 3D printer product

**Source:** `065_techradar_23.jpg`, 840 × 360; SHA-256 `0da73201701b18c84038b4945aae26285edeed7e20d54dd50a57d476063275d4`.

**Observed:** A 3D-printer/filament product photograph is unrelated to formula racing and has no implementation counterpart in the game.

**This continuation:** No racing implementation: unrelated input explicitly retained in the audit.

**Current game counterpart:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Still missing / qualification:** This source entry is contaminated reference material, not evidence of a missing feature.

**Catalogue status:** `excluded`. **Code:** None — deliberately excluded.

### 066 — Close curb pack with different title marking

**Source:** `066_techradar_24.jpg`, 970 × 546; SHA-256 `8c46b4b297c75e874a183d0cd0a49658d28da28a77fb31f5642fe1eba78f4248`.

**Observed:** A yellow/black lead car crosses raised red-white kerbing and turquoise run-off with two pursuers, palms, fencing and architecture. Low front framing stresses aero clearance and traffic depth.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles.

**Inspect:** Reference Review → 066 → the entry's INSPECT/OPEN button. Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Still missing / qualification:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`, `src/ui/reference-routes.ts`

### 067 — Pod straight composition repeat

**Source:** `067_topgear_1.webp`, 892 × 502; SHA-256 `63768d607ea85c263944233ffeeb423e080772865d216f8309776042103beaa9`.

**Observed:** A high onboard view looks over gloves, wheel, halo, mirrors and an opponent along a pit straight; strong peripheral speed blur contrasts with readable near-car geometry.

**Repeated composition:** variant of 008; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 067 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 068 — Wet rear view repeat

**Source:** `068_topgear_2.webp`, 892 × 502; SHA-256 `ed96e68c0d754f28b2ff084f2fcd8cf24098e284dfd5e7b9f271b8a4a4eca424`.

**Observed:** A wet rear-three-quarter yellow/purple car shows grooved blue-marked tyres, spray, a red rain light and dark wet road against trees, repeating the wet-racing motif of reference 010.

**Repeated composition:** variant of 010; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 068 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Still missing / qualification:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 069 — Reverse-layout leaderboard

**Source:** `069_topgear_3.webp`, 892 × 502; SHA-256 `ba557220a19a8fb0c784167a51237b8d17365f8fc4e08ce0281304ee0b134940`.

**Observed:** A circuit leaderboard separates global/friends-style results, rank, time, date, team and setup/assist indicators, including a reversed-layout marker. Local lap timing alone is not this online service.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing per-assist/compound/weather local best-lap storage provides a narrow timing foundation only.

**Inspect:** Reference Review → 069 → the entry's INSPECT/OPEN button. Complete a session and inspect local best-lap information.

**Still missing / qualification:** Reverse Silverstone, global/friends networking, leaderboard validation and ghost downloads are absent. Do not mark this image complete.

**Catalogue status:** `partial`. **Code:** `src/storage/data.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 070 — Onboard setup-management panel

**Source:** `070_topgear_4.webp`, 892 × 502; SHA-256 `1274c85d727bc7cdae18b0699ee3f947a5d9b3cc169e52eb7a0a44a739a24fbf`.

**Observed:** A time-trial cockpit combines gear 6, a full battery, a physical steering display, a green live delta, best-time comparison and brake-bias/differential controls with dashed road guidance.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Inspect:** Reference Review → 070 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 071 — Pit-stop composition repeat

**Source:** `071_topgear_5.webp`, 892 × 502; SHA-256 `3d25aa6397bf06398b49dd4fd715c28f55d4356543346c131c28341dc4852b80`.

**Observed:** A purple/yellow car receives four-corner pit service from suited and helmeted mechanics using wheel guns, replacement tyres and coordinated handling around the pit box.

**Repeated composition:** variant of 004; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Reference Review → 071 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Still missing / qualification:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Catalogue status:** `partial`. **Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 072 — Solo tight-corner delta

**Source:** `072_topgear_6.webp`, 892 × 502; SHA-256 `fbfd71dfc92488cbaec30dab5d2ef49fff4a8c69d15d83b057e6f439fc6a8af4`.

**Observed:** A turning time-trial onboard view shows gear 3, battery state, a green delta, comparison/ghost timing information and clearly bounded run-off around the bend.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Current game counterpart:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Inspect:** Reference Review → 072 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Still missing / qualification:** No rendered ghost car, dedicated practice-program scoring, reverse track or online time-trial board.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 073 — Helmet detail repeat

**Source:** `073_topgear_7.webp`, 892 × 502; SHA-256 `0165fcf2842132f884c88ec1e6b287e5d77421ec45b28a5d61f493bf7267b6bf`.

**Observed:** A tight side view of helmet, visor, halo, gloves and coloured wheel buttons includes a driver identity/country decal. The material arrangement matters; the person is not identified.

**Repeated composition:** variant of 009; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit.

**Inspect:** Reference Review → 073 → the entry's INSPECT/OPEN button. Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Still missing / qualification:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Catalogue status:** `partial`. **Code:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`

### 074 — Solo fast-straight timing

**Source:** `074_topgear_8.webp`, 892 × 502; SHA-256 `925c5b543b392b93435eb46d0b48ac6163a57fdbbd5e5110dbebfa49b47c3012`.

**Observed:** A fast onboard straight shows gear 8, full battery, a negative green delta, white guidance chevrons and a large grandstand on the right.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Current game counterpart:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Inspect:** Reference Review → 074 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Still missing / qualification:** No rendered ghost car, dedicated practice-program scoring, reverse track or online time-trial board.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 075 — Photo-mode tutorial title

**Source:** `075_traxion_1.jpg`, 1024 × 576; SHA-256 `7d0b236d0d269d8b8e564d3657fb4de1c0bf454c962d356452ef5af0ace985c7`.

**Observed:** A photo tutorial cover places a side-panning red car behind large editorial text. The photography/composition is relevant; copying the title card is not an in-game feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Reference Review → 075 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 076 — Sweeping elevated photo composition

**Source:** `076_traxion_2.jpg`, 1024 × 576; SHA-256 `47651c43db1c7d4fad57d9a633c3d3925bce56772e3584a94618f9d5b2bdfecb`.

**Observed:** A wide landscape photograph frames a rear-view car low in the image beneath a steep climbing curve, tiered grandstands and black-red-yellow kerbs/run-off.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Reference Review → 076 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 077 — Low front mechanical photograph

**Source:** `077_traxion_3.jpg`, 1024 × 576; SHA-256 `95a623a2d8fe9375310ad8ea76a64a774275bb3f2b24aa49cd1a8ad2df44a4e0`.

**Observed:** A low front close-up catches a car unloading or lifting its wheels over a kerb. Exposed suspension, floor carbon, wing clearance, helmet and fencing make contact geometry visible.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export.

**Inspect:** Reference Review → 077 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 078 — Panned side photograph

**Source:** `078_traxion_4.jpg`, 1024 × 576; SHA-256 `70643f53a259e69b556cb901ec0255965e5d1133bc1570a3da2d28b22168d1d7`.

**Observed:** A rear-side panning view shows scuffed/dirty bodywork and floor edges, rotating tyres and a streaked crowd. Surface wear and photographic motion are separate cues.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Reference Review → 078 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Still missing / qualification:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Catalogue status:** `partial`. **Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`

### 079 — Night circuit with illuminated sphere

**Source:** `079_traxion_5.jpg`, 1024 × 576; SHA-256 `8271f9d8e609293a4bbf8be66b577720786ebd6ff31ea8fde7cc26220eca8c53`.

**Observed:** A night racing photograph includes a large emissive spherical venue landmark, floodlights, fencing and a low rear-three-quarter car. An original landmark is distinct from an exact venue recreation.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 079 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Still missing / qualification:** Original night illumination and an LED venue motif now exist, but this is not a matched city circuit, the licensed spherical landmark, a 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review of this new pass remains outstanding.

**Catalogue status:** `partial`. **Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 080 — Night reflective bodywork detail

**Source:** `080_traxion_6.jpg`, 1024 × 576; SHA-256 `2cc8cd2883502540038b9f373eedea35076cf1e974d17422af7c5b2b8ab4a902`.

**Observed:** A tight night front-side panning view picks up artificial-light reflections on bodywork and decals, with wheel blur and neon-like background streaks.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 080 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Still missing / qualification:** Original night illumination and an LED venue motif now exist, but this is not a matched city circuit, the licensed spherical landmark, a 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review of this new pass remains outstanding.

**Catalogue status:** `partial`. **Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 081 — Headquarters atrium repeat

**Source:** `081_gamingbolt_1.jpg`, 1024 × 576; SHA-256 `8a81129cd9e2fc7b6633f6a26e6bcb106ccf5312da3a78f75aed7632b0dc009c`.

**Observed:** A repeated headquarters atrium view shows two levels, people, display-car presentation, stairs and furnishings, reinforcing the spatial facility reference from 016.

**Repeated composition:** variant of 016; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth.

**Inspect:** Reference Review → 081 → the entry's INSPECT/OPEN button. Menu → Team HQ → Headquarters, Personnel or Finance.

**Still missing / qualification:** This is a management interface, not a walkable headquarters campus or a modeled suspended-car atrium.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 082 — Wet rear scene repeat

**Source:** `082_gamingbolt_2.jpg`, 1024 × 576; SHA-256 `a473af1d332b3edf91b3d370f447d66dda4fd624bfe4ebce1454a42c6a710dce`.

**Observed:** A repeated wet rear view shows spray, blue tyre markings, a rain light and reflective road; it reinforces 010/068 rather than introducing another weather model.

**Repeated composition:** variant of 010; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 082 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Still missing / qualification:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 083 — Curb duel repeat

**Source:** `083_gamingbolt_3.jpg`, 1024 × 576; SHA-256 `409a5b1da61e5c57938089a6251c0e2f0c28ac2bc3e06596923bb4980125f4b3`.

**Observed:** Another elevated side-by-side car composition repeats the duel, wheel spacing and coloured kerb cues in 006/045.

**Repeated composition:** variant of 006; not an independent feature.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 083 → the entry's INSPECT/OPEN button. Menu / Pause / Replay → Photo Studio; compose, Download PNG, Return. Race/replay remains safely paused.

**Still missing / qualification:** No depth-of-field, shutter-accumulation blur, night-city recreation or unrestricted free-fly collision system.

**Catalogue status:** `enhanced`. **Code:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 084 — Another-series cockpit

**Source:** `084_gamescreed_1.jpg`, 1280 × 720; SHA-256 `6545371f28d795844142966b606c4fda676f0c8205ab1693670c3a1d4ebb36a9`.

**Observed:** A junior-formula onboard race shows a turned steering wheel, gloved hands, gear 2, halo/mirrors, classification and opponent labels. A generic formula car is not a separate junior-series vehicle model.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 084 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 085 — Chase traffic proximity

**Source:** `085_gamescreed_2.jpg`, 1280 × 720; SHA-256 `898f1e91bc3d2e758166fc898085de0f4d30a6d6bf0bdf3f830593a74a07f0d3`.

**Observed:** A chase view in traffic includes a red side-proximity arrow, a field minimap and gear-5/battery HUD. The proximity cue should reflect actual nearby cars, not leaderboard order.

**This continuation:** Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Current game counterpart:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Inspect:** Reference Review → 085 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Still missing / qualification:** Actual side-proximity arrows and field minimap are present, but exact HUD artwork, commercial AI racecraft and image-level rendering equivalence remain unverified.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/style.css`

### 086 — Garage team-launch interview

**Source:** `086_gamescreed_3.jpg`, 1280 × 720; SHA-256 `df938b4d1b16c06376af60197ecc365f7ad9ec94d9f8744109abacc36034bf03`.

**Observed:** A showroom conversation stages three people beside a purple car with speaker identification and subtitles. It is a narrative scene, not simply a team-management form.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context.

**Inspect:** Reference Review → 086 → the entry's INSPECT/OPEN button. Read Headquarters briefing after a completed study or race.

**Still missing / qualification:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Catalogue status:** `partial`. **Code:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`

### 087 — Night sphere and rear car

**Source:** `087_maxigeek_1.webp`, 1000 × 562; SHA-256 `48e4effa1b9e9a300310e336b10b59fe051a0df89e4fcfff1212f774226caa5a`.

**Observed:** Another night view places a glowing spherical landmark behind tyres, rubbered asphalt, fencing, stands and a purple/yellow car, reinforcing the venue motif of 079.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 087 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Still missing / qualification:** Original night illumination and an LED venue motif now exist, but this is not a matched city circuit, the licensed spherical landmark, a 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review of this new pass remains outstanding.

**Catalogue status:** `partial`. **Code:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 088 — Cockpit looking toward paddock

**Source:** `088_maxigeek_2.webp`, 1000 × 562; SHA-256 `61e87e6916966cf1e95c9c29f5471cdcf6859da288d72db67d1aa26bbc964ed2`.

**Observed:** A right-looking cockpit close-up reveals live wheel controls, gold-toned/carbon halo, a mirror and pit-wall/garage surroundings, emphasizing orientation and near-car readability.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Inspect:** Reference Review → 088 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Still missing / qualification:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 089 — Tree-lined objective straight

**Source:** `089_maxigeek_3.webp`, 1000 × 562; SHA-256 `96064b237c6b324fa04a7712f2602f158e26dd06d9fb871c927d916ca6aaaa5a`.

**Observed:** A story-race objective asks the driver to hold position while a fault is addressed, followed by a win target and lap limit. A green driving line, gaps and minimap support the mission.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Current game counterpart:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Inspect:** Reference Review → 089 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Still missing / qualification:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 090 — Side-panning composition repeat

**Source:** `090_cgmag_1.jpg`, 768 × 432; SHA-256 `214e81eef68a83613725c336e50c111cf3f74ff3a24da3278ecd15d29e73e98a`.

**Observed:** A red car is photographed from the front three-quarter angle on a pit straight, with paint catchlights, body decals, wheel motion and architectural depth behind it.

**Repeated composition:** variant of 002; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur.

**Inspect:** Reference Review → 090 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Still missing / qualification:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Catalogue status:** `partial`. **Code:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`

### 091 — Driver identity portrait

**Source:** `091_cgmag_2.jpg`, 768 × 432; SHA-256 `680977158ffb4454ca0ceb31fcba9a58e8b507025c1a7a6a8456b7224cb92eea`.

**Observed:** A promotional portrait of a real person in a red racing suit uses a bright yellow graphic background. An original team identity can echo the format without reproducing or identifying the person.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 091 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Still missing / qualification:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 092 — Pit-stop action repeat

**Source:** `092_fallback_gamecritics.webp`, 1024 × 576; SHA-256 `08c70107d31a87e41ee2d8107dd689d762546a9a5dcaa67b113b9e1e53a473e5`.

**Observed:** A repeated purple/yellow pit-service view reinforces the wheel-exchange choreography, crew positions and equipment visible in 071.

**Repeated composition:** variant of 004; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Reference Review → 092 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Still missing / qualification:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Catalogue status:** `partial`. **Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 093 — Rainy cockpit in close traffic

**Source:** `093_fallback_noobfeed_media.jpg`, 1280 × 720; SHA-256 `449e648acac3d9b56662c615da07cfb7ba2c71106cc25dd499a5f5c242c8e1ff`.

**Observed:** A real sim-rig photograph shows hands on a wheel and pedals beneath a curved monitor displaying wet night traffic. Physical device calibration, field of view and game rendering are separate concerns.

**This continuation:** Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Current game counterpart:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 093 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Still missing / qualification:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Catalogue status:** `partial`. **Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 094 — Five-light race start

**Source:** `094_fallback_joinsteer.jpg`, 2000 × 1125; SHA-256 `ea693240caf704cd22d11be0065ff2b370c9ca2caf06b9be6e6cbc1a1680c597`.

**Observed:** A cockpit grid start shows five red lights, manual-clutch/optimal-RPM prompts, neutral gear, a full battery and surrounding cars visible through mirrors and the halo.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing staged race grid, start-light state, clutch input and race-start timing implement the visible starting interaction.

**Inspect:** Reference Review → 094 → the entry's INSPECT/OPEN button. Start Grand Prix; use the configured clutch/control scheme and watch the five-light sequence.

**Still missing / qualification:** Procedural grid atmosphere, crew density and licensed starting environment remain different.

**Catalogue status:** `cue-present`. **Code:** `src/ui/interface.ts`, `src/input/controller.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`

### 095 — Cockpit pit-service timing

**Source:** `095_fallback_onpsx.jpg`, 3840 × 2160; SHA-256 `5bf96fcfc8e0f193906fbbf6a5167eafff743e67b1101875a91e1f28b84c7aef`.

**Observed:** A cockpit pit-stop view includes working crew, pit-lane/stop timing, a turn-in quality message and estimated service duration. These metrics should come from real service events.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Inspect:** Reference Review → 095 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Still missing / qualification:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Catalogue status:** `partial`. **Code:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 096 — Overcast wet cockpit

**Source:** `096_fallback_vandal.jpg`, 768 × 432; SHA-256 `33544bdfef7fa10d94b6a501a96570f50c73033ee8b6059ef0b15aff9da33a32`.

**Observed:** An onboard view centers a detailed physical wheel LCD, coloured rotaries, gloves and halo, with an overcast circuit, grandstands and an opponent pack outside.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 096 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Still missing / qualification:** No full screen-space reflection system, ray tracing or commercial volumetric spray/raindrop fidelity.

**Catalogue status:** `cue-present`. **Code:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 097 — Undulating guided racing

**Source:** `097_fallback_ps4hry.jpg`, 1600 × 900; SHA-256 `dc1d41d9d6edfd28c9050c0f938c11c9394f40fcf10834e0df2cfbfd529499e3`.

**Observed:** A leading cockpit view combines a win objective, lap 14/18, a gap/laps-left readout, minimap, road guidance, gear 6, battery information and a mirror bar against wooded hills.

**This continuation:** Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Current game counterpart:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Inspect:** Reference Review → 097 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Still missing / qualification:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Catalogue status:** `partial`. **Code:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 098 — Race-pack curve repeat

**Source:** `098_fallback_gamingbolt_cover.jpg`, 1024 × 576; SHA-256 `0701ee824b1c3fb6ed3f87752570da77d1621ad60e4e5d0cb7de30acf4250caf`.

**Observed:** A repeated rear-view blue-car race pack returns to kerbs, grandstands, fences, suspension detail and dense traffic as in 007/044.

**Repeated composition:** variant of 007; not an independent feature.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views.

**Inspect:** Reference Review → 098 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Still missing / qualification:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Catalogue status:** `partial`. **Code:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 099 — Driver portrait title variation

**Source:** `099_fallback_thumbculture_video.jpg`, 1024 × 576; SHA-256 `aad6504c4416c94ab1f455f4e56db2a573dd192c5759e87f2776fe3194cf3e64`.

**Observed:** A repeated promotional portrait adds game-title/publisher branding to the red-suit/yellow-background layout. Marketing logos and a real person's likeness are not shipped as game assets.

**Repeated composition:** variant of 091; not an independent feature.

**This continuation:** Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Current game counterpart:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Inspect:** Reference Review → 099 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Still missing / qualification:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 100 — Helmet and title identity montage

**Source:** `100_fallback_ea_myteam_thumb.jpg`, 4000 × 2250; SHA-256 `c13bb7c7d04428e04b4b88a3c85b5d3e7e3bc62cd898137a86b4e34987821ca3`.

**Observed:** A promotional close front-side/onboard view of a pink/blue car shows helmet, halo, mirror, nearby traffic and branding overlays. Original car geometry and photo composition are the applicable cues.

**This continuation:** Added a numbered native inspection route and corrected/expanded the direct visual observation; the substantive baseline system is not relabelled as newly built.

**Current game counterpart:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Inspect:** Reference Review → 100 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Still missing / qualification:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Catalogue status:** `partial`. **Code:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`
