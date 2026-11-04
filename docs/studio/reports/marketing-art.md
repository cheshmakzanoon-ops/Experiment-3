# Marketing and key art: Steam store art, brand identity, trailer pipeline

Branch `studio/marketing-key-art`, cut from `main` at `2ed0ae9`. Owner: Marketing & Key Art.
Honesty rule as in `release-2.md`: **verified** means a command was run in this sandbox and is listed below; what was not
run is said so. Sandbox facts that shape everything here: 4 shared CPUs at load 6-15 (other agents), **software GL only**
(SwiftShader), no GPU, so every game frame is a software-GL capture and a trailer cannot be recorded.

## Scope and result

| # | Deliverable | Status |
| --- | --- | --- |
| 1 | Brand identity: wordmark, roundel, lockups, one-colour versions, clear space and minimum sizes | **Done.** Hand-drawn SVG in `docs/studio/store/brand/` (12 files), rules in `docs/studio/store/BRAND.md`. Trademark clearance of the name is **not** done (owner/counsel, gate G15) |
| 2 | Key art and capsules at exact Steam sizes, from real frames plus the SVGs | **Done**: 17 files (2x and 1x capsules, library capsule/header/hero/logo, page background, icons incl. ICO, event banner), `art/manifest.json`, `art/contact-sheet.png`. Tools: `art-frames.mjs` (frames), `capsule-art.mjs` (composer), `lib/game-director.mjs` (shared driver). Frames are software-GL: **retake on a GPU before upload** |
| 3 | Trailer pipeline | **Keyframes, recipe, animatic: done. Real trailer: not possible here and not made.** `trailer-capture.mjs`, `docs/studio/store/TRAILER_CAPTURE.md`. The animatic (`trailer/capsule-teaser-animatic.mp4`) is a silent film of stills, labelled as such; it is not a Steam trailer |
| 4 | Store page assets update | **Done**: `STORE_PAGE.md` (art table with alt text, further frames), `ART_UPLOAD_CHECKLIST.md` (slot by slot), `CAPSULE_AND_ART_BRIEF.md` status block, `art/README.md` |

Gate G11 ("store page assets: capsule, trailer script, screenshots, description"): the **capsule art half is now closed in
the repository** (files exist, sizes verified, safe areas measured); it still needs a GPU retake of the frames, a
real-GPU trailer, and a human look in the Steamworks preview. The status stays **P** until then.

## 1. Brand

* The idea is one object from a race weekend, stencilled: nine capitals with stencil gaps and chamfered corners, leaning
  10 degrees like the in-game wordmark; a roundel (the CIRCUIT nose-roundel plate) with a leaning M and a ring split by two
  stencil gaps; under the wordmark a hairline ending in the three lane chevrons of the menu's primary action. Colours are the
  Paddock Board tokens (chalk, amber, ink, asphalt, paper), not new ones. The old vermilion/teal table in
  `CAPSULE_AND_ART_BRIEF.md` is marked superseded.
* Provenance: every letter is a polygon written by hand on a 100-unit grid; no font outlines (an earlier idea to extract
  Saira Stencil One outlines was dropped: ~500 path commands per letter and not original), no trace, no stock. The SVGs
  contain no text. The tagline and labels on the capsules are live Saira / Saira Stencil One (OFL, already bundled).
* Rendered and looked at on asphalt and on paper at several sizes. Findings that changed the geometry: the M's stencil gaps
  turned it into "H/M" noise (removed, the M is clean); letter gap 12 to 14 for legibility at 112 px; chevrons enlarged
  because they vanished; the roundel's M enlarged from 78% to 90% and the ring given stencil gaps so it is not a generic
  "M in a circle". The one-colour versions use real knockouts (masks), so the ground shows through.
* Not done: a favicon-size (16 px) simplification (the ICO contains 16 px renders of the full roundel; at 16 px it is a disc with
  a blob), print files (CMYK/PDF), a motion logo beyond the animatic stamp.

## 2. Frames, capsules and the iterations

### Frames captured from the real game (`art/frames/`, `art-frames.mjs`)

All headless Chromium, SwiftShader, render preset High, the FULL build at `2ed0ae9`, framed with the game's **photo studio**
(free orbit, lens, filter, clean frame) so the shot is not limited to the chase camera. `art/frames/manifest.json` records
entry, camera values, build and notes.

| Frame | Size | Source | Verdict on looking at it |
| --- | --- | --- | --- |
| `apx01-showroom.jpg` | 1920x1080 | menu, photo studio, dark showroom, APX-01 | Good: the original hero car, low three-quarter, no paddock board. Half the frame is black void above the floor disc (cropped in use) |
| `apx01-portrait.jpg` | 1200x1224 | same, near-square | Good for the portrait capsule; the cyan pedestal ring reads as a car-configurator |
| `coast-eh3-wide.jpg` | **3840x1240 native** | festival, travel to the coast speed trap, festival photo mode, golden-hour light | Usable. Real sea horizon and sky, the EH-3 side-on. Flaws: the light is hazy rather than golden; **a parked traffic car cuts in at bottom-left** (masked by the hero's dark left third; the tool now turns ambient traffic off for a retake). The 1240-pixel-high render took 19 minutes |
| `wildcard-knobblies-banking.jpg` | 1920x1080 | Wildcard event started from the board, chase camera held with the game's pause | The hook frame: a motocross bike on the banked speed bowl, rival ahead. Rear chase view, washed sky |
| `mx-jump-side.jpg` | 1920x1080 | motocross, held in the air, photo studio side-on | A real in-air frame (the store shot `motocross-jump.jpg` is not). Dark forest, grass below, the ramp is out of frame |
| `gp-lean-side.jpg` | 1920x1080 | GP bike held at 0.61 rad lean, photo studio side-on | Crisp livery and rider, but the camera sits in the bike's leaning frame so the ground fills the frame: a lean close-up, no environment |
| `night-gt-neon.jpg` | 1920x1080 | GT-10M in the neon-city tunnel at night | Moody and dark; a headlight glare; reads as "night", not neon |

Frames **rejected and retaken**: the first Wildcard frame (photo studio on the banked bowl framed the grass: the orbit camera
sits under the 31 degree banking, so session photos on banked venues are not supported by this tool); the first coast attempt
(travelled to the first event in the list because the selector took the first `data-fest="travel"` button, so it was the town
again); the first motocross attempt (the browser was left in festival photo mode so the next shot could not leave it; the
jump window was also too tight for a software-GL poll). All three are fixed in `lib/game-director.mjs`.

### Capsule iterations (each looked at with the Read tool)

1. **First pass on stand-in frames** (the earlier store screenshots): the board layout (asphalt board with a forward-leaning
   edge, amber lane line, paper tagline strip) worked at once. Defects found: the library logo's chalk wordmark vanished on
   the paper test ground (added a 4 px hard ink outline plus the game's hard offset shadow); the library capsule cropped a
   menu screenshot with the paddock board in it and cut the car (needed a purpose-framed portrait frame); the 231x87 wordmark was
   legible but small (board 140 to 152 px, wordmark 112 to 124 px).
2. **Real frames**: crops retuned per frame (the bike moved to 72% of the width so the board never covers it; helmet clipped
   by the vertical capsule's board line, loosened; the library capsule changed from a nose-only crop to the whole car at 1.3x
   zoom; discipline bands re-cropped per frame). Alt texts rewritten after looking: the first draft said "GT car under
   floodlights" for a capsule that shows the APX-01.
3. **Programmatic checks added** (the visual passes kept finding margin and luminance questions): safe-area margin of the logo and strip is
   measured on the layout and the build refuses to write an image that violates it; the page background is tuned to a target mean
   luminance (0.150 measured, brief asks about 15%); transparency of the library logo is read back through a canvas
   (corner alpha 0, PNG colour type 6, 76% of pixels clear).

Honest critique of what ships: no gradient is used as decoration (the one soft edge is the mask that keeps the hero's left third quiet);
the layout is consistent and legible at 1x (checked at true pixels in the contact sheet). It is **not** premium key art: the frames are
modest software-GL renders, the header/main/small/event capsules all reuse one frame, the sky is blown out in it, and the library capsule
has a large black band from the showroom's void. A GPU retake with art-directed framing is the single biggest quality step left.

## 3. Trailer pipeline

* `scripts/studio/tools/trailer-capture.mjs`: the 16 storyboard shots as data (one source of truth for timings), `--list`, keyframe
  capture through the shared director (`--url`), `--captions` (transparent caption PNGs in the game's type), `--recipe-script`
  (writes `trailer/assemble-from-clips.sh`), `--teaser` (the animatic).
* **Why keyframes, not clips:** software GL gives single-digit fps and minutes per 1080p frame (observed here: 5 to 30 minutes per frame at
  load 6-15). Frame-accurate 2-4 s clips at 30 fps are hours per shot. The pause-and-grow technique from `store-shots.mjs` is
  reused; the replay seek is not (the earlier tool found it redraws a stale frame).
* **ffmpeg on the host:** `/usr/bin/ffmpeg` 6.1.1 has libx264, libx265, libvpx, aac. Playwright's `/opt/pw-browsers/ffmpeg-1011` is a
  VP8-only build, unusable for H.264. The tool checks for libx264 before rendering and says what to run elsewhere if it is missing.
* **Animatic:** `--teaser` renders a page frame by frame in Chromium and encodes it with the system ffmpeg: **19.4 s, 582 frames, H.264 High yuv420p, 1920x1080, 30 fps, 5.5 MB** (`ffprobe`), silent. Eight beats (APX-01 showroom, the HUD frame of the formula pack, the night GT, a wet-street stand-in, the GP lean, the motocross jump, the Wildcard bike on the banking, the EH-3 on the coast) with slow pushes, a slanted asphalt board with an amber lane edge wiping across on every cut, the storyboard's own captions on paper strips, and the logo end card. It carries a corner stamp "Animatic. Stills from the game. Software GL." (`--no-stamp` removes it). Which file each beat used, stand-ins included, is in `trailer/teaser-timings.json`. Looked at as a 3x3 contact strip of the real output: legible, no jitter in the pushes, the wipe covers the screen for one frame at each cut.
* **Recipe for the real trailer** (`TRAILER_CAPTURE.md`, `assemble-from-clips.sh`): record `clips/tNN.mp4` per shot on a GPU, render the
  caption overlays, drop in an original or CC0 music bed, run the script (trim to storyboard timings, scale to 1920x1080 60 fps, caption
  overlay 0.5-3.7 s, hard cuts, music fades, H.264 High yuv420p, faststart). **Tested on synthetic clips made from stills** (shots 1, 3, 7, 9, 11:
  27 s H.264 1920x1080 60 fps with AAC for `main`, 15 s for `cutdown`, missing clips skipped). That proves the script, not a trailer.
* Not captured: shot 6 (superbikes, rain arrives), 12 (drift zone), 13 (airfield jump). 12 and 13 need a driver in the festival (the AI driver does
  not drift or jump on purpose). Shot 9 is no longer PENDING: the Wildcard series shipped.

## 4. Verification (commands run in this sandbox)

@@VERIFY@@

## 5. What is still broken, unverified or open

* Every frame is software-GL. No bloom, reflection or frame-rate motion blur of a GPU build. **Retake with `art-frames.mjs` on a GPU, then rebuild.**
* No real trailer. The animatic is not uploadable as one. No music. Shots 6, 12, 13 have no keyframe.
* The coast frame has a traffic car intruding (masked, not removed); retake with the new `traffic: false`.
* The photo-studio camera in a held session on a banked venue frames the grass (not investigated further: a game-side defect or a limit of
  the orbit camera, worth a look by the Vehicle/Rendering agent).
* Steamworks sizes and slot names are from the producer's knowledge of the page, not the live page: re-check before upload. Client icon
  size/format in particular. `desktop/build/icon.png` is still the legacy placeholder (not touched: Release Engineering).
* The name MOTOBOUND and the roundel have had the engineering IP guard only (no real marque is imitated; no legal clearance).
* Capsule text is English only; localised capsules were not made.
* Achievement icons (54, two states) are not made.
* `store-shots.mjs` was left untouched to avoid a merge conflict with Release Engineering; it duplicates the helpers now in `lib/game-director.mjs`.

## 6. Recommended next tasks (ranked)

1. GPU retake of the seven frames (and traffic off for the coast) plus an art-directed Wildcard hook frame with a real banked-wall lean; rebuild; a person looks at the Steamworks preview.
2. Record the real trailer from `TRAILER_CAPTURE.md` (shots 2-5, 7-9, 11 first; the cut-down needs only six).
3. Wire `art/icons/client-icon-256x256.png` and `icon.ico` into `desktop/build/` (Release Engineering) and add a 16 px simplified roundel.
4. Achievement icon set from the roundel plate language (9 category templates).
5. Localised capsules and tagline once the page languages pass native review.
6. Move `store-shots.mjs` onto `lib/game-director.mjs` and delete the duplicate helpers.
