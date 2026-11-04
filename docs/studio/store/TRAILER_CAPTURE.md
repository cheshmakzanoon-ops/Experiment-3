# Trailer capture: what exists, what does not, and how to finish it

Companion to [`TRAILER_STORYBOARD.md`](TRAILER_STORYBOARD.md) (the shot list). The storyboard's rule stands:
the Steam trailer is **gameplay footage recorded on a real GPU**. This repository can not make it. This page says
what the pipeline in `scripts/studio/tools/trailer-capture.mjs` does produce and what a person must run elsewhere.

## Real trailer, storyboard, animatic: three different things

| Thing | What it is | Where | Fit for Steam? |
| --- | --- | --- | --- |
| **Storyboard** | 16 shots with venue, machine, weather, camera and timing, as data in `trailer-capture.mjs` (`--list`) | `TRAILER_STORYBOARD.md`, the tool | A plan |
| **Keyframes** | One still per shot from the real game (software GL), reused from key-art frames and store screenshots where the shot is the same, plus the keyframes this tool took itself | `trailer/keyframes/`, `art/frames/`, `screenshots/` | Reference only |
| **Animatic** | A silent 15-20 s film of those stills: slow pushes, a slanted board wipe on every cut, the storyboard's captions, the logo end card. Labelled "Animatic. Stills from the game. Software GL." in the corner | `trailer/capsule-teaser-animatic.mp4`, `trailer/teaser-timings.json` | **No.** It is not gameplay footage (Steam asks for gameplay in the trailer) and it comes from software-GL stills. Use it for a social post or as a timing reference, labelled as what it is |
| **Real trailer** | 75 s main cut and 30 s cut-down recorded from the packaged game at 1920x1080 60 fps on a GPU | **not recorded** | Yes, once recorded |

## Why keyframes and not clips here

Software GL (SwiftShader on shared CPUs) draws single-digit frames per second and a 1080p frame takes minutes
(store-shots logged 8-17 minutes per shot). A frame-accurate 2-4 s clip at 30 fps is 60-120 frames: hours per shot, and
it would still not show the game's frame rate, bloom or reflections. The technique that does work, reused from
`store-shots.mjs` and wrapped in `scripts/studio/tools/lib/game-director.mjs`: drive the session on the in-game AI at a
small scan viewport, press the game's own pause on the moment the shot asks for, optionally frame it in the photo
studio (free orbit, lens, filter), grow the viewport to the target size, let the held frame redraw, screenshot.
A replay seek was tried by the earlier tool and redrew a stale frame at the high preset, so nothing here uses the replay.

## Shot table and timings

`node scripts/studio/tools/trailer-capture.mjs --list` prints this from the data. Times are seconds into the 75 s trailer.

| Shot | Time | Keyframe now | Status |
| --- | --- | --- | --- |
| t01 cold open, showroom orbit | 0:00-0:04 | `art/frames/apx01-showroom.jpg` | keyframe |
| t02 lights out, low chase with the pack | 0:04-0:09 | `trailer/keyframes/t02-grid-pack.jpg` | **captured**, HUD on: formula car at 286 km/h on Aurel, P2 of 8 (AI driver, software GL; the first take had the pause menu over it and was retaken) |
| t03 night street run | 0:09-0:14 | `art/frames/night-gt-neon.jpg` | keyframe (a tunnel, not neon streets) |
| t04 harbour streets in rain | 0:14-0:19 | `screenshots/night-street-rain.jpg` (stand-in) | **capture rejected**: on software GL the wet road and car rendered as flat black and blown-out white (`trailer/keyframes/rejected/t04-rain-harbour.jpg`, a render defect, not diagnosed); the older neon-city rain screenshot stands in |
| t05 GP bike lean | 0:19-0:24 | `art/frames/gp-lean-side.jpg` | keyframe |
| t06 superbikes, rain arrives | 0:24-0:29 | none (the GP frame stands in) | not captured |
| t07 holeshot and the jump | 0:29-0:35 | `art/frames/mx-jump-side.jpg` | keyframe (a real in-air frame) |
| t08 floodlit supercross | 0:35-0:40 | none | not captured this pass (entry is in the tool: `--only t08`) |
| t09 the hook: wrong machine, right track | 0:40-0:46 | `art/frames/wildcard-knobblies-banking.jpg` | keyframe (the Wildcard series shipped, so this is no longer PENDING) |
| t10 trophy truck, forest gravel | 0:46-0:50 | none | not captured this pass (entry is in the tool: `--only t10`) |
| t11 coast road, golden hour | 0:50-0:56 | `art/frames/coast-eh3-wide.jpg` | keyframe |
| t12 drift zone | 0:56-1:01 | none | not captured: a drift needs a driver |
| t13 airfield jump | 1:01-1:05 | none | not captured: a festival jump needs a driver |
| t14 photo mode | 1:05-1:08 | `screenshots/photo-studio.jpg` | keyframe |
| t15 podium and results, montage | 1:08-1:12 | `screenshots/results-board.jpg` | keyframe (AI-driven result; layout only) |
| t16 end card | 1:12-1:15 | designed (the animatic end card) | designed; add the wishlist line and release window when real |

`trailer/keyframes/manifest.json` has the status and note of every keyframe this tool took (captured, failed or rejected). The beats of the
animatic and the file each one used (including stand-ins) are in `trailer/teaser-timings.json`.

30 s cut-down: shots 2, 7, 5, 11, 9, 15 at 5 s each. The first three seconds must read without sound (lights out, a
jump, a lean): autoplay on a Steam page is muted.

Measured: the animatic is 19.4 s, 582 frames, H.264 High 1920x1080 30 fps yuv420p, 5.5 MB (`ffprobe`), eight beats and an end card;
rendering the frames took about one minute on the shared CPUs.

## The commands

```
# Keyframes (software GL: minutes each; one browser at a time; resumable)
npx vite build --outDir /tmp/dist-art
npx vite preview --outDir /tmp/dist-art --host 127.0.0.1 --port 4291 &
node scripts/studio/tools/trailer-capture.mjs --url http://127.0.0.1:4291            # t02, t04, t08, t10
node scripts/studio/tools/art-frames.mjs --url http://127.0.0.1:4291                 # the shared hero frames

# Animatic (needs ffmpeg with libx264; Playwright's bundled ffmpeg has VP8 only)
node scripts/studio/tools/trailer-capture.mjs --teaser                               # ~19 s, 1920x1080, 30 fps
```

## To finish the real trailer (on a machine with a GPU)

1. `npm ci && npm run build` and run the packaged desktop build (or `npx vite preview` of the FULL build) in a
   1920x1080 window, render preset High or above, **no software rendering**.
2. Record each shot as `trailer/clips/tNN.mp4` (NN = the shot number), 1920x1080, 60 fps, at least as long as the
   shot's duration. Set up each entry from the table above (`--list`) in the paddock menu; press **G** for the AI
   driver and **C** for the camera; use the replay (speeds 1/4 to 2x, seek bar) to repeat a moment for the cameras you need;
   the photo studio freezes a moment. Keep the HUD on for at least half the shots. Recorders: OBS (window capture,
   NVENC or x264 CRF 16), or ffmpeg directly: Windows `ffmpeg -f gdigrab -framerate 60 -i title="MOTOBOUND" ...`,
   Linux `-f x11grab`, macOS `-f avfoundation`. Hard cuts; no crossfades baked in.
3. Captions: `node scripts/studio/tools/trailer-capture.mjs --captions` writes transparent 1920x1080 PNGs
   (`trailer/captions/caption-NN.png`) in the game's type.
4. Music: an original or CC0 / CC-BY bed as `trailer/music.wav` (record the licence in `LEGAL_CHECKLIST.md`). None is
   bundled: no soundtrack ships with the game, and none may be added from a licensed track.
5. Assemble: `bash docs/studio/store/trailer/assemble-from-clips.sh main` (75 s) or `... cutdown` (30 s). The script
   is generated from the storyboard table (`trailer-capture.mjs --recipe-script`): it trims each clip to the shot's
   duration, scales to 1920x1080 at 60 fps, overlays the caption PNG from 0.5 s to 3.7 s, concatenates with hard
   cuts, mixes the music with a 1 s fade in and a 2 s fade out (AAC 192 kb/s), and writes H.264 High, yuv420p,
   `+faststart`. A missing clip is skipped with a message.
6. Upload to Steamworks as the trailer (1920x1080 H.264 MP4). Add the wishlist line and release window to the end
   card only when the page is live and the date is real.

## What was and was not tested here

* The assembly script was run against synthetic clips made from stills (`ffmpeg -loop 1`) for shots 1, 3, 7, 9, 11:
  27 s H.264 1920x1080 60 fps with AAC audio for `main`, 15 s for `cutdown`, with the missing-clip branch
  exercised. That proves the script, not a trailer.
* Real footage, music, a GPU recording and the drift and airfield shots: **not done**.
