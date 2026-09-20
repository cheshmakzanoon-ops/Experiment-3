# 100-image reference review — source-verified implementation pass

Baseline: `a223c9afb57a00d8974000b9e3e983699a089f0a` on `main`. Reviewed 20 September 2026.
Archive: `F1_25_PS5_Developer_Reference_100_Images(3).zip`.
Archive SHA-256: `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.

## Scope and evidence

All 100 numbered images were viewed in sequence, four per 1600×1000 inspection sheet, with a full-image recheck for the black/yellow showroom composition. Every image is individually described below and its exact bytes match the catalogue hash. This is visual cue analysis, not a pixel-by-pixel fidelity certification.
The pack contains 82 racing/game-related entries, 2 physical wheel-product photographs (048–049), and 16 unrelated entries (050–065). Fifteen repeated/variant compositions are recorded separately; they are not fifteen independent missing systems. No source reference artwork, publisher logos or photographed people were copied into the application.
Existing status labels refer to a represented cue, not completion of the entire image. A feature being wired into source or passing geometry/DOM tests does not prove rendered resemblance. This pass does not meet all 100 complete-image requirements: acted narrative/media scenes, online/reverse-track/ghost features, licensed geography and commercial visual fidelity remain gaps.

## Implemented this pass

1. Ten independently saved, positioned, scaled and rotated text decals painted into the actual left/right car UV textures (005, 026, 031–033).
2. Opt-in photo depth-of-field with subject/manual focus and aperture, scoped to the frozen photo scene (including 006, 042, 045, 075–077, 083).
3. Actual mesh-derived point-cloud/full-render comparison with bounded geometry sampling and renderer-state restoration (001, 046).
4. Opt-in read-only audio-driving cues, independent event switches, volume/lookahead, inversion and previews, with stale/nonhuman/session gates (040).
5. An original inspectable 3D workshop/atrium, not a painted menu background (011–013, 016, 035, 081, 086).
6. Four-week projection from the real local team economy/research rules, not fabricated future transactions (014, 015, 035).

## Validation boundary

Chromium in this environment returns no WebGL2 context. Geometry, settings, DOM, actual Canvas2D texture changes and real OfflineAudioContext synthesis can be validated here; final GPU rendering, scene composition and performance cannot. See `REFERENCE_100_PASS_VALIDATION.md` for final commands/results. No screenshots from the component fixture should be described as gameplay screenshots.

## Individual image assessments

### 001 — Circuit scan comparison

**File:** `official_playstation/001_ps_screenshot_01.webp` · 1200 × 675 · `ebb5ecedcd3c3df621431104384c4d6e340459e33cad69d137c4a17883dd9645`

**Observed:** A vertical point-cloud/render split shows a narrow street corridor: grid paint, concrete walls, yellow-green kerbs, tall catch fencing, trees, overhead bridge and canopies. The comparison is the key cue, not proof that this project's track is surveyed.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views. This pass adds a bounded point-cloud view sampled from the actual original circuit/car meshes, including instanced transforms, with a draggable-value split against the same rendered camera. It is real source geometry, not an overlaid reference photograph.

**Change this pass:** This pass adds a bounded point-cloud view sampled from the actual original circuit/car meshes, including instanced transforms, with a draggable-value split against the same rendered camera. It is real source geometry, not an overlaid reference photograph.

**Phase 27A change:** Phase 27A adds deterministic low/outside drainage grates, marshal shelters, utility cabinets and physical replay-camera sites around the lap. The drain locations share their cadence and side-selection rules with the real surface-water drainage field; replay-camera housings share the exact replay-director positions.

**Inspect:** Reference Review → 001 → INSPECT/OPEN. Use COMPARE GEOMETRY / RENDER; change Survey and Split in Photo Studio. Rendering is not locally GPU-verified.

**Remaining gap / limit:** Not measured LiDAR or a licensed circuit. Sampling is bounded to the selected-car neighbourhood, coloured by height and not a dense physical scan. GPU side-by-side appearance remains unverified here.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`, `src/rendering/geometry-survey.ts`, `src/rendering/renderer.ts`, `src/rendering/photo-camera.ts`, `src/ui/photo-studio.ts`

### 002 — Side-on panning car

**File:** `official_playstation/002_ps_screenshot_02.webp` · 1200 × 675 · `7c334ec3606b04f1f5fbbd0d9d11d1c818d545f4b9ce477da752d6a3b2597d1b`

**Observed:** Low front-three-quarter panning shot of a red open-wheel car: multiple front-wing elements, exposed suspension, red soft-compound rings, sharp car silhouette and motion-streaked grandstands.

**In the game:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 002 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap / limit:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Source:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 003 — Working cockpit wheel

**File:** `official_playstation/003_ps_steeringwheel.webp` · 1200 × 675 · `0f2df1b7304701557ac3f7025e9983aca8239f83c9325640f72282593c9952e1`

**Observed:** Driver-eye view through a halo arch and central pillar; gloved hands turn the wheel, its display shows gear 8, and coloured buttons, rotaries, shift LEDs and two mirrors frame a fenced straight.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 003 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 004 — Wheel-change pit choreography

**File:** `official_playstation/004_ps_pitstop.webp` · 1200 × 675 · `97fdd0502303a4f989568c735b4b52abb6f71ca05eb2cf686682b7dfe6e7d4c4`

**Observed:** Low frontal pit-service view with purple/yellow crew working at all four corners, wheel guns, spare tyres, front/rear jacks, overhead equipment and the garage behind.

**In the game:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 004 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap / limit:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Source:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 005 — Livery showroom

**File:** `official_playstation/005_ps_editor.webp` · 1200 × 675 · `a0e589a7b639a2268eb2ec7af7547bef82282fe5c65a765beed7785605c0e1cf`

**Observed:** Predominantly BLACK bodywork with bright yellow and white graphics in a nearly black showroom, not a white-bodied car. Front-three-quarter lighting separates the carbon aero layers, curved panels and white hard-tyre lettering.

**In the game:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures. This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Change this pass:** This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Inspect:** Reference Review → 005 → INSPECT/OPEN. Open Photo / Livery → Independent decals; select a slot, enable it, choose its side and transform, then SAVE LIVERY. Inspect left and right flanks and race with the saved paint.

**Remaining gap / limit:** Ten text slots cover the left/right flank UVs only. No uploaded bitmap decals, arbitrary nose/wing surface selection, direct on-car dragging or licensed sponsor library. GPU appearance remains unverified here.

**Source:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/decal-editor.ts`

### 006 — High-angle curb duel

**File:** `official_playstation/006_ps_bp3_action.webp` · 1200 × 675 · `c8d250012e7b8f78a2488aa792b2d78decbe333464a88b1f04a9832202b995d6`

**Observed:** TWO purple/yellow cars run side by side in a high diagonal view beside red-white-green kerbing. The earlier audit's white/red second-car description was incorrect; wheel spacing, layered wings and streaked ground are the important cues.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 006 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 007 — Dense elevated race pack

**File:** `official_playstation/007_ps_screenshot_03.webp` · 1200 × 675 · `d6637ba0068906fa2e027018b1b9be4822a53b71010c3f00f4120ccf6fdb9712`

**Observed:** Dense field climbing uphill from a low rear-three-quarter view of a blue car: green intermediate-tyre rings, visible rear suspension/diffuser, grass, catch fences, grandstands and rubbered kerbs.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable composition views.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 007 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap / limit:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 008 — Pod camera down the straight

**File:** `official_playstation/008_ps_screenshot_05.webp` · 1200 × 675 · `88a094d040523d9e9b9f620305f7b10ee65c9ed8e9007a26c3227682780b82a9`

**Observed:** High pod view just behind the helmet on a main straight, with an opponent ahead, flanking mirrors, fast near-ground streaking and crowded grandstands.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 008 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 009 — Helmet and halo close-up

**File:** `official_playstation/009_ps_screenshot_06.webp` · 1200 × 675 · `66ae1a9f62575a806f941ac5380df783605270b92905c1cf2af7b2f2a34187ab`

**Observed:** Close over-the-shoulder composition around helmet, halo and steering wheel. Suit fabric, carbon weave, small name/flag decals and shallow subject framing carry the driver-presence cue.

**In the game:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 009 → the entry's INSPECT/OPEN button. Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Remaining gap / limit:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Source:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 010 — Wet rear three-quarter view

**File:** `official_playstation/010_ps_rain.webp` · 1200 × 675 · `16210586874a8b7729c376b952026bcb6da467ccc8d29baa955ce53448b772b4`

**Observed:** Low rear wet-weather shot with grooved blue-ring wet tyres, a bright rear rain light, spray leaving the contact patches, grey sky and softened trees.

**In the game:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 010 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Phase 27A change:** Phase 27A adds spatial-water-driven physical clearcoat, a faster bounded local-reflection cadence when real rain/wheel water is present, and distinct bounded spray-plume/rain-streak particle profiles without changing simulation emission rules.

**Remaining gap / limit:** No full screen-space reflection system, ray tracing, windshield-wiper simulation or commercial volumetric spray/raindrop fidelity.

**Source:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 011 — Team headquarters exterior

**File:** `official_ea_myteam/011_ea_myteam_facilities.jpg` · 3840 × 2160 · `54ce0c0a91457f6146ca51cad5fc46f06ce57b89090611d770ac8aa5f6dafab4`

**Observed:** Team-factory courtyard with a regular facade, diagonal team-coloured panels, glass doors, paved paths, plants and a standing manager figure.

**In the game:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 011 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** Original procedural inspection set, not the reference campus, a walkable office simulation, a suspended-display-car atrium, or animated staff. Geometry is validated; GPU lighting/composition still need verification.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 012 — Engineering department menu

**File:** `official_ea_myteam/012_ea_engineering.jpg` · 3840 × 2160 · `bd0788a2bcc0b2b0605df03021bcf0e54a110b13583ca6b4b2c21494a83ec76b`

**Observed:** Engineering menu exposes phase/workforce counters and research, upgrades, history and component categories over a workshop with raised chassis, benches, racks, screens and overhead lighting.

**In the game:** Added priced, timed studies with a one-active-study limit and staffing-dependent completion. Completed studies unlock explicit setup changes saved for the next session. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 012 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** Research is a three-study local setup loop, not a full component development tree, manufacturing/history system or invisible car-stat upgrade.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/simulation/config.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 013 — Personnel department menu

**File:** `official_ea_myteam/013_ea_personnel.jpg` · 3840 × 2160 · `aafc150368007a3c8b20349627e435ecfef080950ee160f5bdfb2e56a8a088a6`

**Observed:** Personnel screen separates driver, workforce and facility decisions over a lounge/cafe setting with chairs, plants and a seated staff member looking at a phone.

**In the game:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 013 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** Original driver contracts and staffing exist, and an inspectable workshop/lounge is available. No licensed portraits/icons, driver-skill simulation, animated office people or workforce-driven pit-speed bonus.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 014 — Workforce economics screen

**File:** `official_ea_myteam/014_ea_workforce.jpg` · 3840 × 2160 · `8879ed796eeaa2e6901e110777836a9d344b2d57065826007c11306eaf7f4c7e`

**Observed:** Three-department workforce allocation screen includes staff/capacity counts, hiring state, gauges and salary, resource-production and lead-time consequences.

**In the game:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions. A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Change this pass:** A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Inspect:** Reference Review → 014 → INSPECT/OPEN. Team HQ → Headquarters → NEXT FOUR WEEKS. Commission a study in Engineering, inspect its forecast, then advance a week to book real local income/costs and progress.

**Remaining gap / limit:** Four-week current-staffing projection, not a multi-race world calendar, negotiated sponsor pipeline, travel/events engine or full financial forecast. Future changes in staffing/contracts alter it.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 015 — Team finance ledger

**File:** `official_ea_myteam/015_ea_finances.jpg` · 3840 × 2160 · `d62c1ed24179d6e1a7f2537eb22d5135c484bfe5fd1509ba2d5e46af69e7916c`

**Observed:** Finance screen combines balance, weekly/season progress, upcoming contract/payroll information, income versus outgoings and finance-history/cost-cap tabs.

**In the game:** Added a bounded saved ledger with real income, payroll, facility and transaction deductions. Invalid/insolvent actions leave state unchanged. A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Change this pass:** A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Inspect:** Reference Review → 015 → INSPECT/OPEN. Team HQ → Headquarters → NEXT FOUR WEEKS. Commission a study in Engineering, inspect its forecast, then advance a week to book real local income/costs and progress.

**Remaining gap / limit:** Four-week current-staffing projection, not a multi-race world calendar, negotiated sponsor pipeline, travel/events engine or full financial forecast. Future changes in staffing/contracts alter it.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/storage/data.ts`, `src/ui/reference-routes.ts`

### 016 — Headquarters atrium

**File:** `official_ea_myteam/016_ea_hq.jpg` · 2560 × 1440 · `f12a5f68a33d184ee6b8bb7d71ac149ca6159da3b9c81b2731ce48a89413c5ef`

**Observed:** Double-height headquarters atrium: large glass facade, mezzanine, stairs and rails, suspended display car, timber baffles, seating and groups of staff.

**In the game:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 016 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** Original procedural inspection set, not the reference campus, a walkable office simulation, a suspended-display-car atrium, or animated staff. Geometry is validated; GPU lighting/composition still need verification.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 017 — Driver roster comparison

**File:** `official_ea_myteam/017_ea_driver_select.jpg` · 3840 × 2160 · `bd75c79b190aa424b14c1a358e45f98b89c3acc3a7594e2ee9e4995df2df42f8`

**Observed:** Two full-height driver comparison cards show overall and EXP/RAC/AWA/PAC/FOC ratings with a drive-as selector; portraits and the identities themselves are not generic car-game assets.

**In the game:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 017 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap / limit:** Original driver contracts and staffing exist, and an inspectable workshop/lounge is available. No licensed portraits/icons, driver-skill simulation, animated office people or workforce-driven pit-speed bonus.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 018 — Team rivalry screen

**File:** `official_ea_myteam/018_ea_fan_rating.jpg` · 3840 × 2160 · `66c3fc3879625167110787dbaf434cb2368e3afdada8cf0bda9c7bd6236ca2ee`

**Observed:** Despite the filename, this is a TEAM RIVALRY screen: 209 versus 200 points, a 268-point target, heated intensity and a manager figure, rather than a standalone fan-rating display.

**In the game:** Added local team points/reputation and a visible fictional Meridian rivalry, updated only by classified manual Grand Prix results with opponents.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 018 → the entry's INSPECT/OPEN button. Finish a manual race against opponents → Team HQ. AI-demonstration sessions earn no team result.

**Remaining gap / limit:** Meridian scoring is a disclosed local model, not an online competitor or relationship/event-driven campaign rivalry.

**Source:** `src/storage/team-career.ts`, `src/main.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`

### 019 — Driver icon selection

**File:** `official_ea_myteam/019_ea_driver_icons.jpg` · 3840 × 2160 · `65f5a5520ae1c42b6a586e8f6a9d05a218962e54e09ad006952f509b23c2cd71`

**Observed:** Legends/icons availability menu with official-only/all/choose-style market options and toggles; it concerns eligible driver profiles, not a requirement to copy licensed faces.

**In the game:** Added four fictional driver contracts, salary/signing costs, player name/number identity, department workforce/capacity and facility upgrades with saved transactions.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 019 → the entry's INSPECT/OPEN button. Team HQ → Personnel → recruit/reassign, upgrade a department or sign a driver.

**Remaining gap / limit:** Original driver contracts and staffing exist, and an inspectable workshop/lounge is available. No licensed portraits/icons, driver-skill simulation, animated office people or workforce-driven pit-speed bonus.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/main.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 020 — Media-pen interview

**File:** `official_ea_braking/020_ea_bp_press.jpg` · 3840 × 2160 · `ae2c3734ddee997d7b70311c076965bd6e8c4f70b956548b4c868c5f609b212c`

**Observed:** Press interview with a driver in yellow/purple uniform, photographers behind a barrier, a branded backdrop and strong separation of the foreground subject from the crowd.

**In the game:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 020 → the entry's INSPECT/OPEN button. Read Headquarters briefing after a completed study or race.

**Remaining gap / limit:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 021 — Helmet-led title graphic

**File:** `official_ea_braking/021_ea_bp_trailer_thumb.png` · 1920 × 1080 · `fe7ce67b6e556079be36b166189db8ba471389475b04801b800d0e2e7821a645`

**Observed:** Promotional trailer/title card: reflective helmet visor, night bokeh/spotlights and large title treatment. It is marketing composition, not independent evidence of a new gameplay system.

**In the game:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 021 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap / limit:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Source:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 022 — Front three-quarter cornering

**File:** `official_ea_tips/022_ea_hamilton.jpg` · 3840 × 2160 · `722c24b40f1fd260a2e7b32b8db7cbd506c608e3bcd85cd67ff8efc35b7a2b77`

**Observed:** Panning red car in a bend with visible steering and tyres, a grounded shadow, guardrail and red-white kerbs.

**In the game:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 022 → the entry's INSPECT/OPEN button. Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Remaining gap / limit:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Source:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 023 — Tutorial composite: driver and rig

**File:** `official_ea_tips/023_ea_oar2_0.jpg` · 1080 × 1920 · `7c69047acfa6f2c86431a40edc78542d120a6dc2fee6082f5cb78e09f1001f73`

**Observed:** Vertical tutorial layout shows a presenter at a physical steering-wheel rig and a central driver-lineup menu, plus an overhead rig view. The presenter is filmed, not a rendered in-game character.

**In the game:** Existing controls, calibration, setup and assist explanations provide an in-game learning route. Editorial presenters are intentionally not inserted as game assets.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 023 → the entry's INSPECT/OPEN button. Menu → Controls or Garage & Settings; choose practice to learn inputs.

**Remaining gap / limit:** No embedded presenter video, voiced tutorial campaign or exact vertical social-media layout.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/ui/reference-routes.ts`

### 024 — Tutorial composite: chase telemetry

**File:** `official_ea_tips/024_ea_oar2_1.jpg` · 1080 × 1920 · `7169dcad583c10f062917e6d469322d733c82bb864032e96ac95a0bd7b244c5b`

**Observed:** Vertical tutorial chase view along a palm-lined corridor, circular gear-8/speed/battery display and a presenter panel below.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 024 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`

### 025 — Tutorial composite: energy controls

**File:** `official_ea_tips/025_ea_oar2_2.jpg` · 1080 × 1920 · `0af2c94f04591421380571dcb940a6358bb91d9302af386548d1afae11c1b856`

**Observed:** Night cockpit tutorial uses a large red editorial arrow to point out battery information beside gear 3. The arrow is explanatory video annotation, not a permanent racing HUD element.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 025 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 026 — Tutorial composite: assist settings

**File:** `official_ea_tips/026_ea_oar2_3.jpg` · 1080 × 1920 · `de2e5f8571e14955dcabd8da39accd48e647e52512affeea349f2939bcf1c8b6`

**Observed:** Tutorial shows a dark livery showroom with selectors/category icons and a red explanatory arrow, alongside the presenter; the applicable cue is discoverable vehicle customisation.

**In the game:** Existing saved assists, bindings, custom-device calibration and graphics controls provide real configuration rather than static option cards. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures. This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Change this pass:** This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Inspect:** Reference Review → 026 → INSPECT/OPEN. Open Photo / Livery → Independent decals; select a slot, enable it, choose its side and transform, then SAVE LIVERY. Inspect left and right flanks and race with the saved paint.

**Remaining gap / limit:** Ten text slots cover the left/right flank UVs only. No uploaded bitmap decals, arbitrary nose/wing surface selection, direct on-car dragging or licensed sponsor library. GPU appearance remains unverified here.

**Source:** `src/ui/interface.ts`, `src/ui/device-calibration.ts`, `src/ui/presentation.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/ui/decal-editor.ts`, `src/storage/livery.ts`, `src/rendering/car-livery.ts`

### 027 — Tutorial composite: narrow-street cockpit

**File:** `official_ea_tips/027_ea_oar2_4.jpg` · 1080 × 1920 · `e25b77786db47c514750fff4807f81f9d2d0932c859b87b4bcc54ef9fae6491e`

**Observed:** Tutorial onboard view from a pink cockpit through a narrow, bright street corridor with a nearby car, race telemetry and energy-management information.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 027 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 028 — Tutorial composite: braking reference

**File:** `official_ea_tips/028_ea_oar2_5.jpg` · 1080 × 1920 · `bbfd1482ae20780b49a9c6f626aed857e57f9da4047cadc049bea79d645cb61a`

**Observed:** Tutorial cockpit/near-wheel composition includes a turned steering wheel, a 100-metre braking marker and an opponent ahead, illustrating corner approach rather than a new car type.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable composition views. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 028 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap / limit:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 029 — Tutorial composite: corner exit

**File:** `official_ea_tips/029_ea_oar2_6.jpg` · 1080 × 1920 · `b4328456df0c82b5cae5b7147613d0d6ad4e96a178ff4095c0f7449193c57b20`

**Observed:** Tutorial chase view runs beside broad kerbing with gear 6, speed and a green battery indicator; its main cue is readable telemetry during motion.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 029 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`

### 030 — Tutorial composite: wheel and horizon

**File:** `official_ea_tips/030_ea_oar2_8.jpg` · 1080 × 1920 · `2683eab7bf48332187e99d00a55b6bf435b20ba984b2c1b91e6d1dc70964f738`

**Observed:** Physical steering-wheel tutorial paired with a virtual cockpit showing gear 6 and shift LEDs on a straight. The lesson and hardware are distinct from the actual rendered wheel.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 030 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 031 — Editable sidepod sponsor slots

**File:** `official_ea_customisation/031_ea_decal.jpg` · 3840 × 2160 · `430f536252611c2ed84d81ef18608eb6cd435aa639b562dcc2a1d00a32b01f52`

**Observed:** Side-profile decal editor has a vertical slot list, Slot 9/10, left-side selection, placement controls/markers and independent sponsor text with the car's race number.

**In the game:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures. This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Change this pass:** This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Inspect:** Reference Review → 031 → INSPECT/OPEN. Open Photo / Livery → Independent decals; select a slot, enable it, choose its side and transform, then SAVE LIVERY. Inspect left and right flanks and race with the saved paint.

**Remaining gap / limit:** Ten text slots cover the left/right flank UVs only. No uploaded bitmap decals, arbitrary nose/wing surface selection, direct on-car dragging or licensed sponsor library. GPU appearance remains unverified here.

**Source:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/decal-editor.ts`

### 032 — Side-by-side numbered cars

**File:** `official_ea_customisation/032_ea_driver_number.jpg` · 3316 × 1865 · `6444b284c3fa0da95341b49d953c5d7321c0401af4d843c6ac57cd67568b614b`

**Observed:** Side-by-side customised white/yellow/blue cars carry a large number 34 on engine-cover/mirror areas; number placement and consistent identity matter across camera views.

**In the game:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed. This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Change this pass:** This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Inspect:** Reference Review → 032 → INSPECT/OPEN. Open Photo / Livery → Independent decals; select a slot, enable it, choose its side and transform, then SAVE LIVERY. Inspect left and right flanks and race with the saved paint.

**Remaining gap / limit:** Ten text slots cover the left/right flank UVs only. No uploaded bitmap decals, arbitrary nose/wing surface selection, direct on-car dragging or licensed sponsor library. GPU appearance remains unverified here.

**Source:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/style.css`, `src/ui/decal-editor.ts`, `src/ui/photo-studio.ts`

### 033 — Customized livery on circuit

**File:** `official_ea_customisation/033_ea_sponsor_livery.jpg` · 3298 × 1855 · `251c60b2e74300455292756d1a9b2731d4de29fba8012bf5803cc3b0ed3c4927`

**Observed:** Front-three-quarter customised car with sponsor treatment across multiple body/nose/wing surfaces and a guardrail behind it; this asks for car-surface artwork, not text over the screen.

**In the game:** Added editable body/accent paint, race number, sanitized wordmark, three flank patterns and four presets. Changes repaint the actual car and persist across reload, session start and texture-quality changes. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures. This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Change this pass:** This pass adds ten independent saved text-decal slots: select left/right flank, edit text/colour, position, scale and rotation, and enable/disable each. They repaint real car UV canvases, survive texture-quality changes and are not screen overlays.

**Inspect:** Reference Review → 033 → INSPECT/OPEN. Open Photo / Livery → Independent decals; select a slot, enable it, choose its side and transform, then SAVE LIVERY. Inspect left and right flanks and race with the saved paint.

**Remaining gap / limit:** Ten text slots cover the left/right flank UVs only. No uploaded bitmap decals, arbitrary nose/wing surface selection, direct on-car dragging or licensed sponsor library. GPU appearance remains unverified here.

**Source:** `src/storage/livery.ts`, `src/rendering/car-livery.ts`, `src/rendering/car.ts`, `src/rendering/texture-budget.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/decal-editor.ts`

### 034 — Backmarker objective overlay

**File:** `ps5_review_pushsquare/034_push_156273.webp` · 900 × 506 · `7cb5c768b3f333f9f5bcd4e1b50490b5c1a9a809e403b3f7814ce044c0c7a89d`

**Observed:** Cockpit story challenge names an overtake-backmarker objective, highlights the player in a timing tower, shows sectors, lap 11/18, target gap and laps remaining, and combines a radio subtitle with green/red guidance.

**In the game:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 034 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap / limit:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Source:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 035 — Headquarters calendar

**File:** `ps5_review_pushsquare/035_push_156274.webp` · 900 × 506 · `35dabca8522b418c13454a8abe3d86d523b78ec70ca7e0c32965301241ca3d7e`

**Observed:** Headquarters reception calendar lays out future weeks, income/costs, resource points and events such as driver talks/grid reveal, with advance-time and department navigation.

**In the game:** Added explicit one-week advancement charging payroll/overhead, crediting partnership income and completing research, with transaction persistence before UI confirmation. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car. A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car. A new four-week operating calendar uses the actual partnership, payroll, facility and research rules. It shows due studies at the real staffing-dependent rate, clearly marks forecasts as unbooked, and leaves transactions to the existing persisted ADVANCE ONE WEEK action.

**Inspect:** Reference Review → 035 → INSPECT/OPEN. Team HQ → Headquarters → NEXT FOUR WEEKS. Commission a study in Engineering, inspect its forecast, then advance a week to book real local income/costs and progress.

**Remaining gap / limit:** Four-week current-staffing projection, not a multi-race world calendar, negotiated sponsor pipeline, travel/events engine or full financial forecast. Future changes in staffing/contracts alter it.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 036 — Chase vehicle-management panel

**File:** `ps5_review_pushsquare/036_push_156275.webp` · 900 × 506 · `f7f600f50a589a39d9151d4afcb67db13f3e96e87daa5a7b9b39da8c0c51cb70`

**Observed:** Practice chase view shows position P1, green advisory line, DRS 77 m and a multifunction panel for fuel, brake bias, differential and energy deployment beside grandstands.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 036 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 037 — Practice target and delta

**File:** `ps5_review_pushsquare/037_push_156276.webp` · 900 × 506 · `1cefccfc2f509bea45a7425aa3d7ff25e81749ce79854adb2a015f43afd96762`

**Observed:** Cockpit five-lap practice programme shows L1-L5 star slots, personal delta, road guidance and palm-lined scenery; measured programme feedback is separate from normal race scoring.

**In the game:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 037 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap / limit:** Five measured attempts and advisory guidance now exist. This is not the reference game's complete practice programme, ghost system, commercial coaching logic, star artwork or validated optimum racing line.

**Source:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 038 — Letterboxed story dialogue

**File:** `ps5_review_pushsquare/038_push_156277.webp` · 900 × 506 · `47a470b08bd0b34a3e9bb248e13f4ae648a2a034bf76d37fab3e2a4033e51adc`

**Observed:** Letterboxed narrative conversation between two human characters with subtitles. This is a character/animation/voice/story cue, not something a finance menu alone reproduces.

**In the game:** Added contextual original written briefings after driver/research/race changes. This is a limited management presentation, not an equivalent cinematic.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 038 → the entry's INSPECT/OPEN button. Team HQ → read the current briefing.

**Remaining gap / limit:** The two-character animated story scene, voice acting, facial animation and narrative campaign are not implemented.

**Source:** `src/storage/team-career.ts`, `src/ui/team-hub.ts`, `src/ui/reference-routes.ts`

### 039 — Broadcast wide field

**File:** `ps5_review_thumbculture/039_thumbculture_2.jpg` · 1024 × 576 · `4612e6dede3e24ea01af37c5140373bc6f8663e4ae433280acd4dc8d2eebf6d0`

**Observed:** High broadcast view of a night race combines a timing tower, replay badge, a snaking field and brightly floodlit runoff areas.

**In the game:** Existing recorded full-field replay, timing tower, car tracking and trackside cameras now also support frozen selectable-car compositions. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 039 → the entry's INSPECT/OPEN button. Drive, pause → Watch Replay; cycle C to trackside; Photo Studio for an intentional wide shot.

**Phase 27A change:** Phase 27A keeps local scene probes active under night presentation and adds physical replay-camera infrastructure at the exact authored replay-rig positions; the additions are original and do not alter simulation time/weather.

**Remaining gap / limit:** Original night illumination, local reflections and venue/camera infrastructure now exist, but this is not a matched city circuit, licensed landmark, 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review remains required.

**Source:** `src/rendering/renderer.ts`, `src/storage/replay-pages.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/ui/driving-academy.ts`

### 040 — Audio driving-assistance settings

**File:** `ps5_review_thumbculture/040_thumbculture_3.jpg` · 1024 × 576 · `2b1cc77cff8645f0247707f71797cec9c97248cd261c82213526f95f8cda299e`

**Observed:** Audio-driving accessibility screen exposes brake frequency/volume, gear cues, stereo steering inversion and lookahead, track-limit, turn and wrong-way tones, plus previews.

**In the game:** Added opt-in advisory audio for braking, stereo turn direction, gears, track limits and wrong-way travel. Each event is independently selectable with volume/lookahead, stereo inversion and preview. The director reads actual worker/track state, prioritises warnings and suppresses stale frames, grid, pits, finish, AI demo and replay. Saved preferences migrate from legacy settings.

**Change this pass:** Added opt-in advisory audio for braking, stereo turn direction, gears, track limits and wrong-way travel. Each event is independently selectable with volume/lookahead, stereo inversion and preview. The director reads actual worker/track state, prioritises warnings and suppresses stale frames, grid, pits, finish, AI demo and replay. Saved preferences migrate from legacy settings.

**Inspect:** Reference Review → 040 → INSPECT ACCESSIBILITY SETTINGS. Find Audio driving cues, enable options, preview, APPLY, and drive manually with game audio enabled.

**Remaining gap / limit:** Not certified blind-driving assistance or a fully custom per-event frequency/volume/min-max-lookahead interface. Geometry-based advice cannot guarantee an optimum line or traffic avoidance. Real Web Audio synthesis and state gates pass tests; physical accessibility/user testing remains outstanding.

**Source:** `src/ui/presentation.ts`, `src/ui/device-calibration.ts`, `src/audio/engine.ts`, `src/ui/reference-routes.ts`, `src/audio/driving-cues.ts`, `src/ui/audio-accessibility.ts`, `src/storage/data.ts`, `src/main.ts`

### 041 — Gravel incident and dust

**File:** `ps5_review_thumbculture/041_thumbculture_4.jpg` · 1024 × 576 · `c6d6401cf838a1ffbbe8adce502125925250cb7b0719ed269303078542d64789`

**Observed:** Replay of a car sliding into gravel, with wheels in loose material and a dense dirt plume partly obscuring the body, framed by cinematic bars.

**In the game:** Existing contact-state dust, gravel/spark/debris effects and damage respond to actual off-track/contact events and recorded replay state.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 041 → the entry's INSPECT/OPEN button. Drive onto gravel; review recorded incident from trackside or Photo Studio.

**Remaining gap / limit:** Procedural particle density and damage deformation do not match the reference cinematic quality.

**Source:** `src/rendering/effects.ts`, `src/rendering/debris.ts`, `src/simulation/collision.ts`, `src/ui/reference-routes.ts`

### 042 — Telephoto straight composition

**File:** `ps5_review_thumbculture/042_thumbculture_5.jpg` · 1024 × 576 · `9b49192bd0df80332b566697930a3012227af34192f709cf2b691f592259e510`

**Observed:** Tracking shot of two cars on a straight with grid markings, layered road rubber, pit wall, garage structures and directional shadows in a letterboxed composition.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 042 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 043 — Media-pen interview repeat

**File:** `review_techradar/043_techradar_1.jpg` · 970 × 546 · `3b0207c45d17ea5a9f926cf219fb77e91ec41bcd753be922d8586a4833d684c9`

**Observed:** Crop/recompression of image 020's driver press interview with yellow/purple clothing, camera crowd and barrier; not an additional independent game feature.

**Duplicate/variant:** 020. It remains individually checked but is not treated as an independent feature.

**In the game:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 043 → the entry's INSPECT/OPEN button. Read Headquarters briefing after a completed study or race.

**Remaining gap / limit:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 044 — Elevated pack repeat

**File:** `review_techradar/044_techradar_2.jpg` · 970 × 546 · `2612e8f5d8bc10ec9a00e8b84fd5f57852e5711b543c50ed4d3dd812b259f636`

**Observed:** Repeat/variant of image 007's climbing race pack, foreground blue car, green tyre markings and grandstands.

**Duplicate/variant:** 007. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable composition views.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 044 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap / limit:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 045 — Overhead curb duel repeat

**File:** `review_techradar/045_techradar_3.jpg` · 970 × 546 · `cea59e74486237b44761ef3368334785e57f6686f3b1e53215accaccc8b3a28d`

**Observed:** Repeat/variant of image 006's two purple/yellow cars in an elevated side-by-side kerb duel; not a different vehicle-pair requirement.

**Duplicate/variant:** 006. It remains individually checked but is not treated as an independent feature.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 045 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 046 — Circuit scan split repeat

**File:** `review_techradar/046_techradar_4.jpg` · 970 × 546 · `3b5c1abeb151609ad9a1bd8e36cf399e7e08e5792672215c8e92b38823e708ef`

**Observed:** Repeat/variant of image 001's point-cloud/render circuit comparison, retaining the split corridor, painted road and fencing cues.

**Duplicate/variant:** 001. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable survey/composition views. This pass adds a bounded point-cloud view sampled from the actual original circuit/car meshes, including instanced transforms, with a draggable-value split against the same rendered camera. It is real source geometry, not an overlaid reference photograph.

**Change this pass:** This pass adds a bounded point-cloud view sampled from the actual original circuit/car meshes, including instanced transforms, with a draggable-value split against the same rendered camera. It is real source geometry, not an overlaid reference photograph.

**Phase 27A change:** Phase 27A adds deterministic low/outside drainage grates, marshal shelters, utility cabinets and physical replay-camera sites around the lap. The drain locations share their cadence and side-selection rules with the real surface-water drainage field; replay-camera housings share the exact replay-director positions.

**Inspect:** Reference Review → 046 → INSPECT/OPEN. Use COMPARE GEOMETRY / RENDER; change Survey and Split in Photo Studio. Rendering is not locally GPU-verified.

**Remaining gap / limit:** Not measured LiDAR or a licensed circuit. Sampling is bounded to the selected-car neighbourhood, coloured by height and not a dense physical scan. GPU side-by-side appearance remains unverified here.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`, `src/rendering/geometry-survey.ts`, `src/rendering/renderer.ts`, `src/rendering/photo-camera.ts`, `src/ui/photo-studio.ts`

### 047 — Pre-grid tire preparation

**File:** `review_techradar/047_techradar_5.jpg` · 970 × 546 · `700dab0033308cd7187a9b8748e1a353b386edc8b590c3d5594bb5fd9541f023`

**Observed:** Stationary pre-grid red car wears labelled tyre blankets on front and rear wheels, with cables and mechanics holding tablets around it.

**In the game:** The game has functional pit crew, grid staging and starting prompts, distinct from the new team-management workforce. Added four suspension-hub-aligned tyre blankets, retaining straps and two original preparation staff per car. Blankets withdraw before the first red light and staff clear before the second; pause/replay uses recorded time and nothing remains on the racing grid.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 047 → the entry's INSPECT/OPEN button. Start Grand Prix for the staged grid; request a pit stop to inspect crew.

**Remaining gap / limit:** The preparation people and blanket motion are procedural, not commercial-quality scans or full hand animations. Blanket visuals do not add a physical preheating model; no PS5 visual equivalence is claimed.

**Source:** `src/rendering/pit-crew.ts`, `src/rendering/paddock-detail.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/grid-preparation.ts`, `src/rendering/renderer.ts`

### 048 — Wheel and three-pedal hardware

**File:** `review_techradar/048_techradar_6.jpg` · 840 × 473 · `7a70123da12ffb11d75e20245ded1e77fc0a0c1165b1ec23adce1237d0a35f49`

**Observed:** Retail photograph of a physical steering wheel and three-pedal set. It can inform input calibration, but is not an in-game car or scenery reference.

**In the game:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 048 → the entry's INSPECT/OPEN button. Garage & Settings → select and calibrate a connected custom device.

**Remaining gap / limit:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Source:** `src/input/controller.ts`, `src/ui/device-calibration.ts`, `src/ui/reference-routes.ts`

### 049 — Two wheel-and-pedal products

**File:** `review_techradar/049_techradar_7.jpg` · 840 × 473 · `82f1c79f4e5edcc69d2315a3bf19a38ae2d19a93dcf5d5454167018ac676f44c`

**Observed:** Retail comparison image of two physical wheel/three-pedal packages. The hardware products themselves are not assets to insert into a race scene.

**In the game:** Supplementary evidence for existing explicit steering/pedal axis calibration and button mapping; a physical product photo is not a scene requirement.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 049 → the entry's INSPECT/OPEN button. Garage & Settings → select and calibrate a connected custom device.

**Remaining gap / limit:** No wheel hardware was tested in this environment; native force feedback is not implemented.

**Source:** `src/input/controller.ts`, `src/ui/device-calibration.ts`, `src/ui/reference-routes.ts`

### 050 — Unrelated dark fantasy character

**File:** `review_techradar/050_techradar_8.jpg` · 840 × 473 · `4f20142be0052bea19a231daa5d4f2a5632e4cc0c73e7a35ce3f88910eefbd43`

**Observed:** Unrelated third-person medieval/fantasy character scene, with no open-wheel racing content; this is contamination in the reference pack.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 051 — Unrelated science-fiction shooter tile

**File:** `review_techradar/051_techradar_9.jpg` · 840 × 473 · `b19d018358bfbccea153efb3c5d726c307035ccc4e6af513e3eb43145e19a5c6`

**Observed:** Unrelated military-shooter action promotion/game badge, not a Formula racing image.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 052 — Unrelated event announcement

**File:** `review_techradar/052_techradar_10.jpg` · 840 × 473 · `44b8198a9d8cc71766c0eedb8e43f12ea1bb20122bca3869145c3ffedf440c4b`

**Observed:** Photograph of a physical summer-game event with an SGF sign/news treatment, unrelated to the racing simulation.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 053 — Unrelated water-racing article image

**File:** `review_techradar/053_techradar_11.jpg` · 840 × 473 · `133579c3f492894f25b34110c499be802ca9703897b1cee735487c24e3e50279`

**Observed:** Unrelated futuristic hovering-pod racing scene over an alien landscape; not a Formula car, conventional circuit or requested vehicle series.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 054 — Unrelated anime portrait

**File:** `review_techradar/054_techradar_12.jpg` · 840 × 473 · `56927f54b11ff982cba8078bc64f990d43abbd59f74bac2ddbfe3541d255e64c`

**Observed:** Unrelated stylised horned animated fantasy character portrait.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 055 — Unrelated creature close-up

**File:** `review_techradar/055_techradar_13.jpg` · 840 × 473 · `101850b5cab3947332c5fdf7eb466d1f423f613fa2b22ac15ad10c2bb82855cc`

**Observed:** Unrelated science-fiction/horror creature close-up.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 056 — Unrelated fantasy combat artwork

**File:** `review_techradar/056_techradar_14.jpg` · 840 × 473 · `65d8886f794b9640ce4d32cd33099f508f15cc46337ac4650f8262d608d6b895`

**Observed:** Unrelated painted fantasy combat with serpent/magic imagery.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 057 — Unrelated demon fantasy artwork

**File:** `review_techradar/057_techradar_15.jpg` · 840 × 473 · `f47e6ed617e25ef3aed48e05fcf35583ad899bdd6094ef7a034564ede56d1891`

**Observed:** Unrelated demonic fantasy key art; neither a race car nor circuit, racing interface or input device is present.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 058 — Unrelated computer product

**File:** `review_techradar/058_techradar_16.jpg` · 840 × 473 · `5a2c523e967761716e4fea374fe1fd9937c85e9bc8f9838bebdeba3173b2bba9`

**Observed:** Product photograph of a compact black console/computer and gamepad on a counter, unrelated to in-game Formula scenery.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 059 — Unrelated fantasy landscape

**File:** `review_techradar/059_techradar_17.jpg` · 840 × 473 · `f62a4557ec9e953410b32ba093d79b3bf88c97c641f03d5bfced3a4f822b29cb`

**Observed:** Unrelated fantasy landscape/party artwork with a glowing sword.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 060 — Unrelated portal-and-warrior artwork

**File:** `review_techradar/060_techradar_18.png` · 840 × 473 · `fd42c0787195dcf07c6f1389af0eae601b2777587851fed73ce8d9f56bda29ca`

**Observed:** Unrelated armed science-fiction figure against an orange portal in promotional artwork.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 061 — Unrelated smartphone photograph

**File:** `review_techradar/061_techradar_19.jpg` · 840 × 473 · `74d0e0781ea62543a0651b7a545d24ff65d813523c1e00f290f1e23ba1f2e95f`

**Observed:** Product photograph of the rear of two phones, unrelated to racing-game implementation.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 062 — Unrelated camera product

**File:** `review_techradar/062_techradar_20.jpg` · 840 × 473 · `4e0fee52d767cd0fc4244e1057ea0e42c742d8faea7bc438293fe2cc6589e73e`

**Observed:** Photograph of a mirrorless camera held in hands, unrelated to a virtual car or circuit.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 063 — Unrelated hooded anime character

**File:** `review_techradar/063_techradar_21.jpg` · 840 × 473 · `276461c001951ef8c0fa36aaa950e206dbe3e069f66d3af87ce419395a4a0875`

**Observed:** Unrelated stylised hooded fantasy character portrait, with no Formula car, circuit or racing-interface content.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 064 — Unrelated long-lens camera

**File:** `review_techradar/064_techradar_22.jpg` · 840 × 472 · `209fa5ab0dde6088e3ea3669a68ca13ccee0498dca2dd5d469eda3eb6fc5bb84`

**Observed:** Camera/telephoto-lens product photograph, not a screenshot of the game's photo mode.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 065 — Unrelated 3D printer product

**File:** `review_techradar/065_techradar_23.jpg` · 840 × 360 · `0da73201701b18c84038b4945aae26285edeed7e20d54dd50a57d476063275d4`

**Observed:** Desktop multicolour 3D-printer product photograph, unrelated to the game.

**In the game:** Excluded from racing implementation after visual inspection. Retained here so the supplied number is never silently skipped.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** No in-game reproduction: unrelated article/product artwork should not become a racing feature.

**Remaining gap / limit:** This source entry is contaminated reference material, not evidence of a missing feature.

**Source:** Not applicable — excluded non-game image.

### 066 — Close curb pack with different title marking

**File:** `review_techradar/066_techradar_24.jpg` · 970 × 546 · `8c46b4b297c75e874a183d0cd0a49658d28da28a77fb31f5642fe1eba78f4248`

**Observed:** Black/gold car rides raised orange-white kerbing beside turquoise runoff, with following traffic, a canted view and tall catch fencing; wheel travel and road contact matter.

**In the game:** Existing multi-element aero, suspension links, steering/camber and compliant tire posing expose loaded-car detail. Photo Studio now supports inspection angles.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 066 → the entry's INSPECT/OPEN button. Drive over a curb, pause, select a low three-quarter Photo Studio composition.

**Remaining gap / limit:** No claim of matching a specific manufacturer model or PS5 material/animation quality.

**Source:** `src/rendering/bodywork.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/rendering/tire-carcass.ts`, `src/ui/reference-routes.ts`

### 067 — Pod straight composition repeat

**File:** `review_topgear/067_topgear_1.webp` · 892 × 502 · `63768d607ea85c263944233ffeeb423e080772865d216f8309776042103beaa9`

**Observed:** Repeat/variant of image 008's helmet-adjacent high pod view along the main straight with mirrors and traffic.

**Duplicate/variant:** 008. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 067 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 068 — Wet rear view repeat

**File:** `review_topgear/068_topgear_2.webp` · 892 × 502 · `ed96e68c0d754f28b2ff084f2fcd8cf24098e284dfd5e7b9f271b8a4a4eca424`

**Observed:** Repeat/variant of image 010's wet rear shot with blue wet tyres, rain light and spray.

**Duplicate/variant:** 010. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 068 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Phase 27A change:** Phase 27A adds spatial-water-driven physical clearcoat, a faster bounded local-reflection cadence when real rain/wheel water is present, and distinct bounded spray-plume/rain-streak particle profiles without changing simulation emission rules.

**Remaining gap / limit:** No full screen-space reflection system, ray tracing, windshield-wiper simulation or commercial volumetric spray/raindrop fidelity.

**Source:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 069 — Reverse-layout leaderboard

**File:** `review_topgear/069_topgear_3.webp` · 892 × 502 · `ba557220a19a8fb0c784167a51237b8d17365f8fc4e08ce0281304ee0b134940`

**Observed:** Global/friends time-trial leaderboard explicitly shows a reverse [R] track, rank, time, date, car, custom-setup/assist metadata and personal percentile/rank.

**In the game:** Existing per-assist/compound/weather local best-lap storage provides a narrow timing foundation only.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 069 → the entry's INSPECT/OPEN button. Complete a session and inspect local best-lap information.

**Remaining gap / limit:** Reverse Silverstone, global/friends networking, leaderboard validation and ghost downloads are absent. Do not mark this image complete.

**Source:** `src/storage/data.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 070 — Onboard setup-management panel

**File:** `review_topgear/070_topgear_4.webp` · 892 × 502 · `1274c85d727bc7cdae18b0699ee3f947a5d9b3cc169e52eb7a0a44a739a24fbf`

**Observed:** Time-trial cockpit shows personal best and delta, guidance, brake-bias/differential controls and a reverse-course context; this is not evidence that the current original circuit supports reverse racing.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 070 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** HUD layout is original; not every referenced multifunction popup or exact circular instrument layout is replicated. The depicted reverse-course variant is not implemented.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 071 — Pit-stop composition repeat

**File:** `review_topgear/071_topgear_5.webp` · 892 × 502 · `3d25aa6397bf06398b49dd4fd715c28f55d4356543346c131c28341dc4852b80`

**Observed:** Repeat/variant of image 004's low frontal four-corner pit service.

**Duplicate/variant:** 004. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 071 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap / limit:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Source:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 072 — Solo tight-corner delta

**File:** `review_topgear/072_topgear_6.webp` · 892 × 502 · `fbfd71dfc92488cbaec30dab5d2ef49fff4a8c69d15d83b057e6f439fc6a8af4`

**Observed:** Time-trial corner approach combines default-ghost comparison, a red cockpit/car, wide grandstands and a green delta; a saved lap time alone is not a rendered ghost.

**In the game:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 072 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap / limit:** Five-attempt programme and local result scoring exist. No rendered ghost car, reverse-track support, reference-specific practice programme or online/global time-trial board.

**Source:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 073 — Helmet detail repeat

**File:** `review_topgear/073_topgear_7.webp` · 892 × 502 · `0165fcf2842132f884c88ec1e6b287e5d77421ec45b28a5d61f493bf7267b6bf`

**Observed:** Repeat/variant of image 009's close driver/helmet/halo composition.

**Duplicate/variant:** 009. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing visor/glove/fabric/carbon details can now be inspected with user-controlled focal length and orbit. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 073 → the entry's INSPECT/OPEN button. Photo Studio → short distance, side orbit and longer lens; cockpit view for hands.

**Remaining gap / limit:** No scanned head meshes, licensed helmets or cinematic character close-up parity.

**Source:** `src/rendering/driver.ts`, `src/rendering/driver-materials.ts`, `src/rendering/surface-detail.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 074 — Solo fast-straight timing

**File:** `review_topgear/074_topgear_8.webp` · 892 × 502 · `925c5b543b392b93435eb46d0b48ac6163a57fdbbd5e5110dbebfa49b47c3012`

**Observed:** Time-trial cockpit through a high-speed arc with ghost-reference/delta information and receding grandstand perspective.

**In the game:** Existing free practice, personal lap timing/delta, racing guidance and recorded-lap comparison supply measurable driving feedback. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 074 → the entry's INSPECT/OPEN button. Menu → Free practice; drive a lap; open telemetry and compare laps.

**Remaining gap / limit:** Five-attempt programme and local result scoring exist. No rendered ghost car, reverse-track support, reference-specific practice programme or online/global time-trial board.

**Source:** `src/ui/interface.ts`, `src/storage/recorders.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`

### 075 — Photo-mode tutorial title

**File:** `photo_mode_traxion/075_traxion_1.jpg` · 1024 × 576 · `7d0b236d0d269d8b8e564d3657fb4de1c0bf454c962d356452ef5af0ace985c7`

**Observed:** Photo-mode tutorial promotion with bold typography and a panning red car in wet surroundings; the typography is video marketing, not an independent simulation feature.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 075 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 076 — Sweeping elevated photo composition

**File:** `photo_mode_traxion/076_traxion_2.jpg` · 1024 × 576 · `47651c43db1c7d4fad57d9a633c3d3925bce56772e3584a94618f9d5b2bdfecb`

**Observed:** Wide scenic photo places a small rear-view car at lower right, on an uphill S-shaped course amid banks, grass, hills and covered grandstands beneath blue sky.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 076 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 077 — Low front mechanical photograph

**File:** `photo_mode_traxion/077_traxion_3.jpg` · 1024 × 576 · `95a623a2d8fe9375310ad8ea76a64a774275bb3f2b24aa49cd1a8ad2df44a4e0`

**Observed:** Low frontal car shot at a raised kerb shows unloading/airborne wheel separation and contact shadows; frozen appearance should correspond to a real vehicle pose.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 077 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`

### 078 — Panned side photograph

**File:** `photo_mode_traxion/078_traxion_4.jpg` · 1024 × 576 · `70643f53a259e69b556cb901ec0255965e5d1133bc1570a3da2d28b22168d1d7`

**Observed:** Rear-three-quarter black/orange car stays sharp against a streaked crowd, with blurred rims and readable carbon diffuser in a panning composition.

**In the game:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 078 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap / limit:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Source:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 079 — Night circuit with illuminated sphere

**File:** `photo_mode_traxion/079_traxion_5.jpg` · 1024 × 576 · `8271f9d8e609293a4bbf8be66b577720786ebd6ff31ea8fde7cc26220eca8c53`

**Observed:** Wide/low night car photograph uses a giant luminous LED sphere, advertising panels, fences and floodlights as the venue backdrop.

**In the game:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 079 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Phase 27A change:** Phase 27A keeps local scene probes active under night presentation and adds physical replay-camera infrastructure at the exact authored replay-rig positions; the additions are original and do not alter simulation time/weather.

**Remaining gap / limit:** Original night illumination, local reflections and venue/camera infrastructure now exist, but this is not a matched city circuit, licensed landmark, 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review remains required.

**Source:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 080 — Night reflective bodywork detail

**File:** `photo_mode_traxion/080_traxion_6.jpg` · 1024 × 576 · `2cc8cd2883502540038b9f373eedea35076cf1e974d17422af7c5b2b8ab4a902`

**Observed:** Close panning teal car/front wheel with a pink tyre ring, against motion-streaked neon urban barriers at night.

**In the game:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 080 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Phase 27A change:** Phase 27A keeps local scene probes active under night presentation and adds physical replay-camera infrastructure at the exact authored replay-rig positions; the additions are original and do not alter simulation time/weather.

**Remaining gap / limit:** Original night illumination, local reflections and venue/camera infrastructure now exist, but this is not a matched city circuit, licensed landmark, 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review remains required.

**Source:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`, `src/rendering/photo-camera.ts`

### 081 — Headquarters atrium repeat

**File:** `review_gamingbolt/081_gamingbolt_1.jpg` · 1024 × 576 · `8a81129cd9e2fc7b6633f6a26e6bcb106ccf5312da3a78f75aed7632b0dc009c`

**Observed:** Repeat/variant of image 016's glazed double-height headquarters atrium, mezzanine, stairs and suspended display car.

**Duplicate/variant:** 016. It remains individually checked but is not treated as an independent feature.

**In the game:** Added a functional original Team HQ interface linked to funds, staff, facilities, contracts, research and calendar. Existing circuit paddock adds architectural depth. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 081 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** Original procedural inspection set, not the reference campus, a walkable office simulation, a suspended-display-car atrium, or animated staff. Geometry is validated; GPU lighting/composition still need verification.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 082 — Wet rear scene repeat

**File:** `review_gamingbolt/082_gamingbolt_2.jpg` · 1024 × 576 · `a473af1d332b3edf91b3d370f447d66dda4fd624bfe4ebce1454a42c6a710dce`

**Observed:** Repeat/variant of image 010's blue-wet-tyre rear shot, rain light and spray.

**Duplicate/variant:** 010. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state.

**Inspect:** Reference Review → 082 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Phase 27A change:** Phase 27A adds spatial-water-driven physical clearcoat, a faster bounded local-reflection cadence when real rain/wheel water is present, and distinct bounded spray-plume/rain-streak particle profiles without changing simulation emission rules.

**Remaining gap / limit:** No full screen-space reflection system, ray tracing, windshield-wiper simulation or commercial volumetric spray/raindrop fidelity.

**Source:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`

### 083 — Curb duel repeat

**File:** `review_gamingbolt/083_gamingbolt_3.jpg` · 1024 × 576 · `409a5b1da61e5c57938089a6251c0e2f0c28ac2bc3e06596923bb4980125f4b3`

**Observed:** Repeat/variant of image 006's elevated two-purple/yellow-car kerb duel.

**Duplicate/variant:** 006. It remains individually checked but is not treated as an independent feature.

**In the game:** Added a real frozen-scene studio: car selection, orbit, elevation, distance, 18–150 mm lens, exposure, roll, clean view and canvas-only PNG export. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed. This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Change this pass:** This pass adds optional depth-based photo focus with subject/manual focus distance and aperture controls. Focus is calculated along the camera axis and the pass is disabled outside Photo Studio.

**Inspect:** Reference Review → 083 → INSPECT/OPEN. Open Photo Studio; enable Depth of field, choose Subject or Manual, then change Focus distance, Aperture and camera angle. Disable focus to compare the sharp frame.

**Remaining gap / limit:** Depth-of-field source integration and controls are tested, but GPU appearance is unverified. No photographic shutter accumulation, matched night city, unrestricted collision-aware free flight or commercial-quality image parity.

**Source:** `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`, `src/main.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/interface.ts`, `src/ui/style.css`

### 084 — Another-series cockpit

**File:** `review_gamescreed/084_gamescreed_1.jpg` · 1280 × 720 · `6545371f28d795844142966b606c4fda676f0c8205ab1693670c3a1d4ebb36a9`

**Observed:** Different-series/F2-style cockpit with strongly turned wheel and gloves, both a top virtual rear-view display and physical mirrors, plus dense traffic/timing information.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 084 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** Only the original single-seater is implemented, not a separate F2 series/chassis. Existing cockpit/mirrors support the functional cue, not the licensed series, scenery or pixel parity.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 085 — Chase traffic proximity

**File:** `review_gamescreed/085_gamescreed_2.jpg` · 1280 × 720 · `898f1e91bc3d2e758166fc898085de0f4d30a6d6bf0bdf3f830593a74a07f0d3`

**Observed:** Overcast chase race with a red right-overlap arrow and a nearby car to the right, leader labels, a field minimap and congested traffic.

**In the game:** Existing timing tower, minimap, deltas, fuel/energy/tire readouts, proximity presentation and live setup fields cover the main driving information hierarchy. Added left/right near-car arrows from actual relative positions and heading, with stronger overlap treatment, a vertical separation gate and colour-accessible presentation. Retired cars and other road levels are suppressed.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 085 → the entry's INSPECT/OPEN button. Drive/practice; cycle camera, press E for energy, inspect HUD and Garage setup.

**Remaining gap / limit:** Actual side-proximity arrows and field minimap are present, but exact HUD artwork, commercial AI racecraft and image-level rendering equivalence remain unverified.

**Source:** `src/ui/interface.ts`, `src/ui/presentation.ts`, `src/rendering/steering-display.ts`, `src/ui/reference-routes.ts`, `src/ui/proximity.ts`, `src/ui/style.css`

### 086 — Garage team-launch interview

**File:** `review_gamescreed/086_gamescreed_3.jpg` · 1280 × 720 · `df938b4d1b16c06376af60197ecc365f7ad9ec94d9f8744109abacc36034bf03`

**Observed:** Workshop/studio interview with panelists, a pink car in the foreground and a lower-third speaker badge; the room and the performed interview are separate requirements.

**In the game:** HQ briefing text now reacts to hiring, research and classified outcomes; existing paddock camera/crew props contribute trackside context. This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Change this pass:** This pass adds an original inspectable 3D workshop/atrium: glass elevation, mezzanine, supported stairs and rails, tool chests/benches/screens, lounge furniture, plants, wood slats and overhead lights. Real meshes are batched; the inspection set follows the frozen subject without relocating the physical car.

**Inspect:** Reference Review → 086 → INSPECT/OPEN. Team HQ → VISIT 3D WORKSHOP, or Photo Studio → TEAM WORKSHOP / ATRIUM. Orbit the original room; return to Team HQ for real management controls.

**Remaining gap / limit:** No animated press interview, dialogue choice, voice acting, presenters or cinematic media scene is implemented.

**Source:** `src/ui/team-hub.ts`, `src/storage/team-career.ts`, `src/rendering/paddock-detail.ts`, `src/ui/reference-routes.ts`, `src/rendering/headquarters-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 087 — Night sphere and rear car

**File:** `review_maxigeek/087_maxigeek_1.webp` · 1000 × 562 · `48e4effa1b9e9a300310e336b10b59fe051a0df89e4fcfff1212f774226caa5a`

**Observed:** Purple/yellow night car near the large illuminated spherical landmark, with fences, crowd and spotlights.

**In the game:** Existing weather-responsive lighting/reflections and new photo exposure/lens controls support composition, but not the scene shown. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 087 → the entry's INSPECT/OPEN button. Inspect clear/rain lighting and Photo Studio exposure; this is not a night preset.

**Phase 27A change:** Phase 27A keeps local scene probes active under night presentation and adds physical replay-camera infrastructure at the exact authored replay-rig positions; the additions are original and do not alter simulation time/weather.

**Remaining gap / limit:** Original night illumination, local reflections and venue/camera infrastructure now exist, but this is not a matched city circuit, licensed landmark, 22-car field, scanned scenery or verified commercial-quality night imagery. Actual GPU visual review remains required.

**Source:** `src/rendering/daylight.ts`, `src/rendering/reflections.ts`, `src/ui/photo-studio.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 088 — Cockpit looking toward paddock

**File:** `review_maxigeek/088_maxigeek_2.webp` · 1000 × 562 · `61e87e6916966cf1e95c9c29f5471cdcf6859da288d72db67d1aa26bbc964ed2`

**Observed:** Side-looking cockpit frames a mirror reflection, patterned halo, gloved controls, overhead bridge and glazed grandstands.

**In the game:** Existing physical cockpit, wheel controls, live display, gloves/arms, halo and true rear-view render targets supply the onboard cues.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 088 → the entry's INSPECT/OPEN button. Drive and cycle C to cockpit or pod; double-click cockpit for mouse look. Pause → Photo Studio for close inspection.

**Remaining gap / limit:** No claim of scanned licensed cockpit geometry, face/suit parity, or pixel-matched street-circuit scenery.

**Source:** `src/rendering/cockpit.ts`, `src/rendering/steering-display.ts`, `src/rendering/mirrors.ts`, `src/rendering/driver.ts`, `src/rendering/renderer.ts`, `src/ui/reference-routes.ts`

### 089 — Tree-lined objective straight

**File:** `review_maxigeek/089_maxigeek_3.webp` · 1000 × 562 · `96064b237c6b324fa04a7712f2602f158e26dd06d9fb871c927d916ca6aaaa5a`

**Observed:** Chase-view story challenge asks the player to hold position while a fault is fixed and reach first before lap 11; objective/lap counters sit over a shadowed straight.

**In the game:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 089 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap / limit:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Source:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 090 — Side-panning composition repeat

**File:** `ps5_review_cgmag/090_cgmag_1.jpg` · 768 × 432 · `214e81eef68a83613725c336e50c111cf3f74ff3a24da3278ecd15d29e73e98a`

**Observed:** Repeat/variant of image 002's red-car front-three-quarter panning photograph.

**Duplicate/variant:** 002. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing depth-aware motion blur and rotating wheel assemblies supply speed cues. The photo camera adds deliberate composition, but freezes temporal blur. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 090 → the entry's INSPECT/OPEN button. Garage → rendering controls for live motion blur; watch replay in trackside view.

**Remaining gap / limit:** A frozen photograph has no adjustable photographic shutter, wheel-exposure accumulation or background tracking blur.

**Source:** `src/rendering/motion-blur.ts`, `src/rendering/car.ts`, `src/rendering/wheel-pose.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 091 — Driver identity portrait

**File:** `ps5_review_cgmag/091_cgmag_2.jpg` · 768 × 432 · `680977158ffb4454ca0ceb31fcba9a58e8b507025c1a7a6a8456b7224cb92eea`

**Observed:** Real promotional portrait in a red race suit against a red/yellow graphic background. Original identity treatment is appropriate; copying a real person's portrait is not required.

**In the game:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 091 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap / limit:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Source:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 092 — Pit-stop action repeat

**File:** `review_gamecritics/092_fallback_gamecritics.webp` · 1024 × 576 · `08c70107d31a87e41ee2d8107dd689d762546a9a5dcaa67b113b9e1e53a473e5`

**Observed:** Repeat/variant of image 004's four-corner pit service photograph.

**Duplicate/variant:** 004. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 092 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap / limit:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Source:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 093 — Rainy cockpit in close traffic

**File:** `review_noobfeed/093_fallback_noobfeed_media.jpg` · 1280 × 720 · `449e648acac3d9b56662c615da07cfb7ba2c71106cc25dd499a5f5c242c8e1ff`

**Observed:** Physical simulator rig: real hands, legs and steering wheel in front of a screen showing a wet cockpit. The photographed hands are not proof of equivalent in-game character modelling.

**In the game:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state. Added selectable night presentation, instanced floodlight masts, four bounded nearby light sources and an original patterned LED sphere at about 13% of the Aurel lap. This does not change the weather or simulation clock.

**Inspect:** Reference Review → 093 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Phase 27A change:** Phase 27A adds spatial-water-driven physical clearcoat, a faster bounded local-reflection cadence when real rain/wheel water is present, and distinct bounded spray-plume/rain-streak particle profiles without changing simulation emission rules.

**Remaining gap / limit:** No full screen-space reflection system, ray tracing, windshield-wiper simulation or commercial volumetric spray/raindrop fidelity.

**Source:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`, `src/rendering/venue-lighting.ts`, `src/rendering/renderer.ts`, `src/ui/driving-academy.ts`

### 094 — Five-light race start

**File:** `reference_joinsteer/094_fallback_joinsteer.jpg` · 2000 × 1125 · `ea693240caf704cd22d11be0065ff2b370c9ca2caf06b9be6e6cbc1a1680c597`

**Observed:** Grid launch shows all five red start lights, clutch-engage and optimal-rev prompts, neutral gear, tightly packed cars, labels and an upper rear-view display.

**In the game:** Existing staged race grid, start-light state, clutch input and race-start timing implement the visible starting interaction.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 094 → the entry's INSPECT/OPEN button. Start Grand Prix; use the configured clutch/control scheme and watch the five-light sequence.

**Remaining gap / limit:** Procedural grid atmosphere, crew density and licensed starting environment remain different.

**Source:** `src/ui/interface.ts`, `src/input/controller.ts`, `src/simulation/race.ts`, `src/ui/reference-routes.ts`

### 095 — Cockpit pit-service timing

**File:** `reference_onpsx/095_fallback_onpsx.jpg` · 3840 × 2160 · `5bf96fcfc8e0f193906fbbf6a5167eafff743e67b1101875a91e1f28b84c7aef`

**Observed:** Cockpit stopped in a closely surrounded pit box shows crew, pit-lane elapsed time 7.5, stop time 1.6, optimal-turn-in feedback and an estimated stop; these numbers belong to actual service state, not decorative counters.

**In the game:** Existing staged approach, jack lift, corner crew, wheel exchange and release sequence are driven by actual pit-service state; the HUD reports progress.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 095 → the entry's INSPECT/OPEN button. Drive, request a stop with P, follow pit entry, then replay or photograph the service.

**Remaining gap / limit:** Crew models remain procedural; animation, density and licensed pit-box artwork do not match commercial reference fidelity.

**Source:** `src/rendering/pit-crew.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`

### 096 — Overcast wet cockpit

**File:** `review_vandal/096_fallback_vandal.jpg` · 768 × 432 · `33544bdfef7fa10d94b6a501a96570f50c73033ee8b6059ef0b15aff9da33a32`

**Observed:** Clean wet/overcast cockpit composition has fine droplets, gear 3, blue gloves, reflective surfaces and nearby crowds/buildings.

**In the game:** Existing weather changes clouds, wet-road response, rain lamps, tires, spray and cockpit droplets from live or recorded weather state. Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Change this pass:** Optional photo depth-of-field now supplies adjustable subject separation; it is an artistic depth-buffer approximation, not an optically calibrated lens or a shutter simulation.

**Inspect:** Reference Review → 096 → the entry's INSPECT/OPEN button. Menu → Heavy rain + Full wet; race or replay, then pause in Photo Studio.

**Phase 27A change:** Phase 27A adds spatial-water-driven physical clearcoat, a faster bounded local-reflection cadence when real rain/wheel water is present, and distinct bounded spray-plume/rain-streak particle profiles without changing simulation emission rules.

**Remaining gap / limit:** No full screen-space reflection system, ray tracing, windshield-wiper simulation or commercial volumetric spray/raindrop fidelity.

**Source:** `src/rendering/effects.ts`, `src/rendering/reflections.ts`, `src/rendering/daylight.ts`, `src/rendering/car.ts`, `src/rendering/circuit.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-camera.ts`, `src/rendering/renderer.ts`

### 097 — Undulating guided racing

**File:** `reference_ps4hry/097_fallback_ps4hry.jpg` · 1600 × 900 · `dc1d41d9d6edfd28c9050c0f938c11c9394f40fcf10834e0df2cfbfd529499e3`

**Observed:** Story race-winning objective with five laps remaining, target gap, timing tower, top mirror, minimap and mountain backdrop. A normal race win does not implement the whole narrative chapter.

**In the game:** Existing positions, race-control messages, lap targets and deltas support racing; new HQ briefing/points supply a persistent local goal. Added switchable road-centre driving chevrons with a closed-loop braking envelope, wet-surface and yellow-flag reductions, colour-accessible palettes and a text/silhouette cue; no automatic steering or physics input is applied. Added a five-attempt consistency programme: the first valid human lap locks a target, subsequent real crossings receive grades, and completed-lap worker metadata excludes invalid, penalized or AI-assisted results. Replays cannot award attempts.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 097 → the entry's INSPECT/OPEN button. Run Grand Prix for position/lap goals; practice for delta; read Team HQ race briefing.

**Remaining gap / limit:** No scripted overtake-backmarker/hold-position scenario engine or story subtitles matching these images.

**Source:** `src/ui/interface.ts`, `src/simulation/race.ts`, `src/storage/team-career.ts`, `src/ui/reference-routes.ts`, `src/rendering/driving-guide.ts`, `src/ui/driving-academy.ts`, `src/main.ts`, `src/simulation/practice-programme.ts`, `src/simulation/protocol.ts`, `src/simulation/world.ts`

### 098 — Race-pack curve repeat

**File:** `review_gamingbolt/098_fallback_gamingbolt_cover.jpg` · 1024 × 576 · `0701ee824b1c3fb6ed3f87752570da77d1621ad60e4e5d0cb7de30acf4250caf`

**Observed:** Repeat/variant of image 007's uphill pack and blue foreground car.

**Duplicate/variant:** 007. It remains individually checked but is not treated as an independent feature.

**In the game:** Existing circuit geometry, braking boards, elevation, grid paint, road rubber, crowds and paddock detailing supply these cues. Photo Studio now exposes adjustable composition views.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 098 → the entry's INSPECT/OPEN button. Enter a session; use C for pod/trackside, or Pause → Photo Studio and raise elevation/distance.

**Remaining gap / limit:** Aurel is an original procedural circuit, not LiDAR-surveyed Silverstone or a geometrically matched licensed track.

**Source:** `src/rendering/circuit.ts`, `src/rendering/paddock-detail.ts`, `src/rendering/circuit-finish.ts`, `src/rendering/grandstand.ts`, `src/rendering/circuit-barriers.ts`, `src/ui/reference-routes.ts`

### 099 — Driver portrait title variation

**File:** `ps5_review_thumbculture/099_fallback_thumbculture_video.jpg` · 1024 × 576 · `aad6504c4416c94ab1f455f4e56db2a573dd192c5759e87f2776fe3194cf3e64`

**Observed:** Variation of image 091's real driver portrait with added official title/publisher graphics; it is not a separate playable character requirement.

**Duplicate/variant:** 091. It remains individually checked but is not treated as an independent feature.

**In the game:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries. Added a native dark showroom: a level podium, floor, rim light, softbox geometry and fill lights isolate the actual editable car. Scene visibility and fog are restored after every render, including failures.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 099 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap / limit:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Source:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`, `src/rendering/photo-stage.ts`, `src/rendering/renderer.ts`, `src/ui/photo-studio.ts`

### 100 — Helmet and title identity montage

**File:** `official_ea_myteam/100_fallback_ea_myteam_thumb.jpg` · 4000 × 2250 · `c13bb7c7d04428e04b4b88a3c85b5d3e7e3bc62cd898137a86b4e34987821ca3`

**Observed:** Promotional title thumbnail built around a blue/pink cockpit, helmet/halo and number 9, with a following car and trees. The large official title is marketing artwork, not a new mechanic.

**In the game:** Original APEX/team wordmark, driver monograms, selected race number and car livery form a coherent in-game identity; existing rivals retain their own liveries.

**Change this pass:** Existing relevant implementation retained after source review; observation/limitations rechecked. No claim of a new unique implementation for this row.

**Inspect:** Reference Review → 100 → the entry's INSPECT/OPEN button. Team HQ → Personnel; Photo / Livery → save identity; return to driving and inspect the tower/car.

**Remaining gap / limit:** No licensed driver likeness, commercial title artwork, suit editor or portrait/cutscene replication.

**Source:** `src/storage/team-career.ts`, `src/storage/livery.ts`, `src/ui/team-hub.ts`, `src/rendering/car-livery.ts`, `src/ui/interface.ts`, `src/ui/reference-routes.ts`
