# Audio department report

Branch `studio/audio-measurement-rig` (cut from main 99a235d). Department: Audio. Date: 2026-11-04.

**Honesty statement.** Nobody has listened to this game, including this department. Everything below is a
numeric proxy measured offline on the production audio code: K-weighted loudness (LUFS-like, ungated, over the
settled part of a short clip), sample and 4x-oversampled true peak, spectral centroid, harmonic profile, pitch
tracking against the expected firing frequency, click and level-step detectors, mono fold-down. A target met on
paper is not a promise that it sounds good. The rig feeds the real graph SYNTHETIC presented snapshots (engine
states built from each machine's own gear ratios, torque curve and rev range), not frames recorded from the physics
simulation. No hardware, speaker, headphone, Steam or Electron-on-Windows audio path was exercised.

## 1. The rig (what was built)

| File | Role |
|---|---|
| `scripts/studio/tools/audio-render.mjs` | Orchestrator. Bundles the fixture with vite, launches headless Chromium (`/opt/pw-browsers/chromium`, args from AGENT_BRIEF), renders every scenario into an `OfflineAudioContext`, writes 32-bit float stereo WAVs, then runs the analysis. `--stems` renders each mix scene once per bus (pre-limiter), `--live` runs the live-AudioContext autoplay check, `--volume`, `--group`, `--only`, `--no-analyse`. |
| `scripts/studio/tools/audio-fixture.ts` | Browser side. Drives the real `RacingAudio` (all buses, beds, contact layers, power unit, spatial scene, start lamps, limiter cue), real `UiSounds` and the driving-cue tones. Frames are stepped with `context.suspend()` on the 128-frame render quantum, exactly like the game's per-frame update. |
| `scripts/studio/tools/audio-scenarios.ts` | Pure scenario and snapshot builders (unit-tested in `tests/audio-rig-scenarios.test.ts`). |
| `scripts/studio/tools/audio-analyze.py` | numpy + Pillow analysis, ranked findings, spectrogram PNGs and the distinctness heat map. |
| `scripts/studio/tools/audio-compare.py` | Before/after tables (the ones below). |

Run it (about 2.5 min render + 40 s analysis on the shared 4-CPU host):

```
node --no-warnings scripts/studio/tools/audio-render.mjs --out <dir> --label after --stems --live
python3 -I scripts/studio/tools/audio-compare.py <before>/analysis.json <after>/analysis.json
```

`RacingAudio.start(context?)` accepts an injected context (the only production-code change the rig itself needs);
`ReviewAudioTap` (the existing MediaStream tap) is what `--live` captures. No Python beyond numpy and Pillow is
needed (matplotlib and scipy are not installed here; the spectrogram renderer is ~60 lines of numpy).

**Coverage per run (369 renders):** 22 representative machines x 8 engine states (idle, mid, redline, lift, gear
change, 5-gear pull, rev limiter, pit limiter) plus the chase-camera pull; mid and redline for every one of the 57
catalogue machines (balance and distinctness); tyre squeal at four slip levels; rolling noise on nine surfaces; wind at
three speeds; light rain, heavy rain, thunderstorm, snow, dust, fog and gale; three collision strengths; three
landings; start lamps and lights-out; a 12-car grid and a pass-by; fifteen full mixes, each also as engine /
effects / ambience stems; six menu sounds and the accessibility tones; a live-context autoplay probe.

**Baseline method.** The "before" numbers come from commit 3808f33 (the rig plus the context injection, no behaviour
change) in a throwaway worktree (removed afterwards) with unity stem buses patched in, so the stems of the UNCHANGED
signal path could be isolated. Its full-mix renders equal an unpatched baseline (engine mid median -28.7 LUFS in both
runs). An earlier baseline run without stems made the ambience look 1 to 6 dB LOUDER than the engine; that was the
engine leaking into the "ambience" scenes (the baseline cannot mute it) and is not used anywhere below.

Evidence kept in the repo: `docs/studio/reports/audio-screens/` (24 spectrograms + the distinctness heat map, each
under 150 KB), `docs/studio/reports/audio-numbers.json` (LUFS, RMS, peak and true peak of every render, before and
after, plus the ranked findings of both runs). WAVs are not committed (about 1 GB per run).

## 2. Targets and verdict (default settings: master volume 0.45, every bus slider at 1)

| Target | Before | After | Verdict |
|---|---|---|---|
| No clipping on any path | 0 clipped | 0 clipped; soft ceiling at -1.5 dBFS on the race master and on the menu context | met |
| Master peak <= -1 dBFS (true peak) | met only because everything was 15 to 25 dB quiet | worst render -1.2 dBFS (menu tick); stress at volume 1.0: worst -1.8 dBFS over all 17 mixes incl. the 12-car grid | met |
| Engine loudness within +-3 dB across classes at the same relative throttle | mid: 7.7 dB range, 10 machines outside; redline: 14.2 dB range, 9 outside | mid 3.0 dB range, redline 3.5 dB range, 0 outside; electric families trimmed -4 dB, truck +1.5 dB on purpose | met |
| Engine gets louder with revs | redline 6.8 dB QUIETER than mid (median) | redline 3.5 dB louder than mid | met |
| Ambience >= 12 dB below the engine (stems, racing scenes) | 7 of 15 scenes within 12 dB (electric pull -2.3, dust -2.9, GP bike -5.0, storm -6.2) | 0 of 14 racing scenes; tightest: dust storm -12.1, electric pull -13.0 | met (dust storm marginal) |
| UI cues -18..-12 dBFS RMS | -28 to -52 (23 dB spread between cues) | -14.7 to -17.1, peaks <= -1.2 dBFS | met |
| No unexplained clicks | 0 flagged (detector excludes scheduled events) | 0 flagged; gear-change dips > 9 dB: 4 before, 0 after | met |
| A usable default level | engine -33.5 LUFS median at the default volume, peaks -26 dBFS | engine pull -21 LUFS; slider at max -14 LUFS median mix, ceiling holds | met |
| Pitch follows RPM | median error 13 cents on pulls | 17 cents (the measurement step is 8.7 cents); no non-idle render above 60 cents | met |
| Mono compatibility | worst fold-down -1.5 dB | -1.5 dB | met |
| DC offset / silence | worst -68.8 dBFS; electric cars silent at a standstill | worst -64.2 dBFS; no silent engine render | met |

### Measured tables (generated by `audio-compare.py`)

#### Engine loudness, cockpit, default volume (0.45)

| metric | before | after | change |
|---|---|---|---|
| APX-01 idle (LUFS) | -31.5 | -29.8 | +1.7 dB |
| APX-01 mid (LUFS) | -28.4 | -24.1 | +4.3 dB |
| APX-01 redline (LUFS) | -34.2 | -20.7 | +13.4 dB |
| APX-01 pull (LUFS) | -29.7 | -21.1 | +8.6 dB |
| all machines, mid: median LUFS | -28.7 | -23.5 | +5.3 dB |
| all machines, mid: range (max - min) | 7.7 | 3.0 | -4.7 dB |
| all machines, mid: outside median +-3 dB | 10 | 0 | |
| all machines, redline: median LUFS | -35.5 | -19.9 | +15.6 dB |
| all machines, redline: range (max - min) | 14.2 | 3.5 | -10.7 dB |
| all machines, redline: outside median +-3 dB | 9 | 0 | |
| redline minus mid, median (positive = louder with revs) | -6.8 | 3.5 | +10.3 dB |

#### Peaks and headroom

| metric | before | after |
|---|---|---|
| worst true peak, default volume (dBFS) | -16.7 (mix__formula-rain) | -1.2 (ui__tick) |
| renders above -1 dBFS / clipping, default volume | 0 / 0 | 0 / 0 |
| STRESS: master volume 1.0, all mix scenes, worst true peak | -9.8 (mix__formula-rain) | -1.8 (mix__start-lights) |
| STRESS: scenes above -1 dBFS / clipped (of 17) | 0 / 0 | 0 / 0 |
| STRESS: median mix loudness at volume 1.0 (LUFS) | -23.4 | -14.0 |

#### Menu sounds, active-window RMS (dBFS) at the default volume (target -18 to -12)

| cue | before | after | |
|---|---|---|---|
| tick | -36.8 | -17.1 | peak -1.2 dBFS |
| select | -28.2 | -14.7 | peak -4.3 dBFS |
| confirm | -35.1 | -15.3 | peak -2.0 dBFS |
| open | -51.5 | -16.9 | peak -1.9 dBFS |
| close | -40.1 | -16.4 | peak -2.8 dBFS |
| deny | -34.1 | -15.5 | peak -5.3 dBFS |
| driving cue tones (accessibility) | -43.9 | -20.3 | peak -8.7 dBFS |

#### Level balance per mix scene: stem minus engine stem (dB, pre-limiter; ambience target <= -12)

| scene | ambience before | ambience after | effects before | effects after |
|---|---|---|---|---|
| electric-pull | -2.3 | -13.0 | -21.8 | -17.6 |
| formula-braking-squeal | -11.1 | -16.2 | -7.4 | -5.5 |
| formula-dust | -2.9 | -12.1 | -33.0 | -28.0 |
| formula-fog | -12.8 | -22.3 | -33.1 | -28.3 |
| formula-pull | -12.7 | -22.1 | -13.8 | -13.5 |
| formula-pull-chase | -7.8 | -16.3 | -13.8 | -13.2 |
| formula-rain | -12.7 | -22.1 | +4.0 | -6.3 |
| formula-snow | -12.8 | -22.3 | -33.1 | -28.3 |
| formula-storm | -6.2 | -15.5 | -6.2 | -12.1 |
| gp-bike-pull | -5.0 | -17.9 | -35.9 | -34.7 |
| gt-pull | -11.3 | -23.7 | -11.9 | -14.5 |
| kart-pull | -19.7 | -35.6 | -37.0 | -42.0 |
| mx-pull | -17.0 | -36.0 | -17.4 | -26.5 |
| truck-pull | -15.5 | -26.7 | -5.8 | -7.4 |

(`start-lights` is omitted: the lamps are events, the effects stem is the lamp ticks.) The braking-squeal scene's
effects stem at -5.5 dB is the squeal warning over a lifted engine and is accepted at -3 dB.

#### Effects and ambience rendered alone (engine silent), default volume

| scene | before LUFS | after LUFS | before peak | after peak |
|---|---|---|---|---|
| tyre squeal light / moderate / heavy / locked | -39.5 / -38.2 / -35.6 / -31.9 | -37.5 / -33.4 / -28.6 / -23.8 | -30.1 / -28.0 / -25.5 / -24.6 | -27.0 / -23.7 / -19.5 / -17.3 |
| rolling asphalt | -42.9 | -41.9 | -33.3 | -30.1 |
| rolling kerb | -42.8 | -39.9 | -33.6 | -30.1 |
| rolling grass | -42.2 | -36.6 | -33.2 | -26.3 |
| rolling gravel | -32.4 | -27.9 | -25.9 | -22.0 |
| rolling dirt | -37.3 | -29.7 | -28.7 | -22.8 |
| rolling mud | -41.9 | -35.4 | -32.7 | -25.7 |
| rolling sand | -31.0 | -28.8 | -25.4 | -23.6 |
| rolling snow / ice | -39.6 / -42.4 | -33.0 / -38.8 | -30.5 / -32.8 | -24.8 / -29.1 |
| wind 30 / 60 / 90 m/s | -51.8 / -39.8 / -32.7 | -51.6 / -39.5 / -32.5 | -42.4 / -30.4 / -23.3 | -37.7 / -27.7 / -20.8 |
| light rain / heavy rain | -51.5 / -34.0 | -42.7 / -31.8 | -43.9 / -29.0 | -37.1 / -26.8 |
| thunderstorm / gale / dust | -29.6 / -29.6 / -35.8 | -31.3 / -29.4 / -35.6 | -23.8 / -21.3 / -26.8 | -24.7 / -18.9 / -24.5 |
| snow / fog | -120.7 / -120.7 (silent) | -120.7 / -120.7 (silent) | -46.8 / -46.9 | -42.0 / -42.2 |
| collision light / medium / heavy | peak -31.1 for all three | peak -21.9 / -15.4 / -10.6 | | |
| landing 2 / 5 / 8 m/s | peak -45.5 / -40.2 / -36.3 | peak -32.3 / -20.3 / -16.1 | | |

#### Cues that did not exist

| metric | before | after |
|---|---|---|
| rev limiter, APX-01 / GT-8F / GP-R1 / SK-125 / MX-450: envelope swing dB | 0.1 / 0.8 / 0.1 / 0.1 / 0.5 | 5.7 / 6.1 / 6.6 / 6.6 / 6.7 (12 Hz) |
| pit limiter, same five: envelope swing dB | 0.4 / 0.1 / 0.5 / 1.2 / 1.2 | 5.1 / 5.1 / 5.3 / 5.7 / 6.1 (6 Hz) |
| start lamps: rise over the idling engine (mean of 5) | 0.2 dB | 13.0 dB |
| EH-3 / XH-3 standstill hum (LUFS) | -120.7 / -96.9 | -33.4 / -33.4 |

#### Defect counts

| metric | before | after |
|---|---|---|
| gear changes dipping the engine > 9 dB | 4 | 0 |
| renders with unexplained clicks | 0 | 0 |
| near-identical engine pairs (of 57 machines) | 20 | 16 |
| non-idle renders with pitch error > 60 cents | 2 | 0 |
| median pitch error on pulls (cents; step 8.7) | 13.0 | 17.4 |

#### Per class (22 representatives, LUFS before / after, cockpit, default volume)

| machine | class | family | idle | mid | redline | pull after | centroid mid Hz | pitch err pull (cents) |
|---|---|---|---|---|---|---|---|---|
| apx01 | formula | v6-turbo-hybrid | -31.5 / -29.8 | -28.4 / -24.1 | -34.2 / -20.7 | -21.1 | 594 | 9 |
| hf67 | historic formula | v8-na | -32.7 / -30.4 | -27.8 / -23.7 | -36.1 / -19.9 | -20.4 | 537 | 17 |
| tc1 | touring | i4-turbo | -35.1 / -30.4 | -28.5 / -22.9 | -34.9 / -19.2 | -19.4 | 286 | 17 |
| gt8f | GT | v8-crossplane-turbo | -31.8 / -30.7 | -27.9 / -23.3 | -37.9 / -19.9 | -20.0 | 374 | 17 |
| gt10m | GT | v10-na | -37.8 / -30.7 | -29.4 / -23.7 | -37.0 / -20.3 | -20.6 | 681 | 17 |
| gs4 | GT sport | flat6-na | -36.5 / -29.8 | -27.5 / -23.4 | -35.7 / -20.3 | -20.5 | 323 | 17 |
| sc7 | road supercar | v12-na | -39.7 / -30.9 | -30.3 / -23.6 | -38.5 / -20.4 | -20.8 | 779 | 17 |
| hy9 | hypercar | v6-turbo-hybrid | -35.5 / -30.3 | -27.6 / -23.0 | -33.6 / -19.5 | -20.0 | 371 | 13 |
| eh3 | electric | electric | -120.7 / -33.4 | -32.9 / -22.1 | -31.9 / -22.0 | -21.9 | 2117 | 44 |
| xh3 | fuel cell | fuel-cell | -96.9 / -33.4 | -35.1 / -22.2 | -33.9 / -22.0 | -21.9 | 1499 | 44 |
| sk125 | kart | two-stroke-kart | -37.3 / -30.1 | -33.8 / -24.4 | -39.9 / -19.9 | -20.3 | 819 | 9 |
| dk100 | kart | two-stroke-kart | -38.5 / -29.7 | -33.3 / -24.1 | -40.3 / -20.1 | -20.6 | 930 | 44 |
| dx8 | truck | v8-truck | -36.3 / -29.3 | -27.9 / -22.0 | -36.8 / -18.6 | -19.2 | 339 | 26 |
| rp6 | pickup | v6-turbo | -37.1 / -30.4 | -28.7 / -23.3 | -35.6 / -19.9 | -21.0 | 260 | 17 |
| bg2 | buggy | v6-turbo | -36.1 / -30.1 | -28.6 / -23.3 | -35.4 / -19.7 | -20.3 | 299 | 17 |
| gpr1 | GP bike | v4-bike | -30.0 / -30.2 | -28.1 / -23.8 | -36.5 / -19.9 | -20.2 | 628 | 9 |
| gpr2 | GP bike | i4-bike | -34.1 / -30.2 | -30.8 / -24.2 | -38.3 / -20.0 | -20.3 | 815 | 9 |
| sbk1000 | superbike | i4-bike | -38.3 / -30.8 | -30.5 / -23.7 | -38.9 / -20.3 | -20.3 | 686 | 9 |
| nr900 | road bike | i3-bike | -35.9 / -30.4 | -29.6 / -23.5 | -38.4 / -20.4 | -19.5 | 396 | 9 |
| cr750 | classic bike | two-stroke-bike | -39.3 / -30.7 | -34.3 / -24.3 | -42.9 / -20.6 | -20.5 | 1265 | 9 |
| mx450 | motocross | single-mx | -30.4 / -30.2 | -34.9 / -23.6 | -46.1 / -21.0 | -20.6 | 269 | 17 |
| mx250 | motocross 2T | two-stroke-kart | -38.6 / -29.8 | -33.4 / -24.0 | -41.3 / -21.0 | -20.6 | 807 | 17 |

Distinctness (heat map: `audio-screens/distinctness-matrix.png`; distance over pitch, centroid, spectral flatness,
five band shares and the first eight harmonics at mid and redline; median pair distance 2.79). Most distinct:
EH-3 (mean 5.9), MX-450 (5.1), XH-3 (4.9), NR-900 (3.3), SK-125 (3.1). Closest pairs: **APX-01 formula and GP-R1 bike
(0.49)**, RP-6 pickup and TC-1 touring (0.53), GP-R1 and GT-10M (0.61), GP-R1 and GP-R2 (0.70). The kart, electric,
truck and motocross classes are clearly apart; the formula car, the GP bikes and the high-revving GTs are not.

## 3. Defects, ranked, with what was done

Ranking is by how much a player would notice.

1. **Whole mix far too quiet and out of balance (HIGH, fixed).** Engine -33.5 LUFS median in the cockpit at the
   default volume, 8 dB apart at mid revs and 14 dB at the limiter, and QUIETER towards the limiter (the band weights
   are Gaussians centred below the redline, so the top note faded). Root cause: loudness was a by-product of band
   weights, waveform crest and rev range. Fix: `src/audio/engine-loudness.ts` predicts a voice's K-weighted loudness
   analytically (PeriodicWave harmonics, BS.1770 K-weighting, the voice low-pass) and `engine-voices.ts` scales each
   voice's bands to a DESIGNED curve (idle about 10 dB down, mid about 4 dB down, redline full; swells with load),
   leaving the band weights, i.e. the timbre, untouched. Per-family trims are explicit (`levelDb`). Cost 13 us per
   voice update (2 ms per second of one core, measured). Plus `mixer.ts`: bus trims, +9 dB make-up, bus compressor
   and a soft ceiling.
2. **Ambience as loud as the engine (HIGH, fixed).** Ambience stems were 2.3 to 12.8 dB under the engine; now 12.1 to
   36 dB under. Ambience bus trim -8 dB and ducking of up to 8 dB while the engines are present (`duckGain`, driven by
   `EngineVoices.presence`); wind is 40 % lower for a camera outside the cockpit.
3. **UI cues 23 dB apart and 20 to 36 dB below the engine (MEDIUM, fixed).** Measured per-cue trims, make-up and a
   soft ceiling in the menu context (`UI_TRIM_DB`, `UI_MAKEUP_DB`); the relay tick recipe was softened because the
   first trim put it at 0 dBFS true peak.
4. **Gravel and sand as loud as the engine, asphalt inaudible (MEDIUM, fixed).** Rolling noise at 50 m/s: sand -31
   and gravel -32 LUFS against asphalt -43; after: -29 / -28 against -42..-35 (loose surfaces still the loudest, all
   7 to 14 dB under the engine). Heavy rain made the effects stem +4.0 dB OVER the engine (spray); now -6.3 dB.
5. **Collisions and landings inaudible (MEDIUM, fixed).** The hardest hit peaked at -31 dBFS stand-alone, 25 dB under
   the engine; now -10.6. An 8 m/s landing: -36.3 to -16.1 dBFS peak.
6. **No audible rev limiter or pit limiter (MEDIUM, fixed).** The note held steady (envelope swing 0.1 to 1.2 dB).
   `limiter-cue.ts`: fuel-cut bounce, 12 Hz on the rev limiter, 6 Hz on the pit limiter (the HUD's PIT LIMITER state);
   swing now 5.1 to 6.7 dB. Electric drive has no rev limiter and gets none.
7. **Silent start sequence (MEDIUM, fixed).** Five lamps and lights-out passed in silence (0.2 dB over the idle).
   `start-lights.ts`: one original synthesised tick per lamp, rising in pitch, and a two-note go chime that changes
   pitch at near-zero gain (no click); +13 dB over the idle bed.
8. **Electric and fuel-cell cars silent at a standstill (MEDIUM, fixed).** -121 and -97 LUFS on the grid. Now an
   inverter hum at 140 Hz (-33 LUFS) that rises into the whine; the motor oscillator is a triangle instead of a
   sawtooth (its harmonics ran to 16 kHz and read as a shriek on the spectrogram).
9. **Accessibility tones 8 dB under the engine (MEDIUM, fixed).** -29 dBFS RMS at the default cue volume against an
   engine at -21 LUFS; peak gain 0.18 to 0.5 (+8.9 dB): -20 dBFS RMS. The tones skip the buses on purpose so a player
   who turned the engine or effects down still hears them.
10. **Session start can hang under the autoplay policy (MEDIUM, fixed; section 4).**
11. **Trophy truck voiced as the historic V8 formula car (LOW, fixed).** New `v8-truck` family (low rev centre,
    lumpy sub-harmonic burble, darker roll-off, +1.5 dB). The kart (`two-stroke-kart`) and electric voices already
    existed; the truck was the missing class voice.
12. **Same-family machines sound alike (LOW, partly fixed).** 20 near-identical pairs of the 57; a per-machine
    signature (band tilt from peak torque plus an id hash, corner raised for small engines) leaves 16. The corner is
    deliberately never lowered: a lower corner broke `e2e/spatial-audio.spec.ts` (the zero-crossing ratio of an
    approaching car fell from the Doppler factor 1.21 to 0.81) and was removed. Remaining pairs: FE-4 / HH-2 / RH-3,
    GB-4 / GS-4, GS-6M / PR-3, GT-10M / LX-12, GT-6S / RS-5, HF-76 / XF-2, HF-86 / PR-2, MX-450 / SM-450 (the same
    engine on purpose), RCX-6 / TC-2 / TC-3, RD-2 / VC-62, RXE / XH-3, SC-7 / SP-71.
13. **Tyre squeal saturates early (MEDIUM, NOT changed).** `contactMix` clamps the scrub gain at 78 kW of total slip
    power, so anything above a mild slide sounds the same loudness. The rig's squeal ladder now brackets the knee.
    A design decision for the audio and handling owners, not a bug to fix blind.

## 4. Settings, accessibility, autoplay, blur

* **Controls.** Only a master Volume and the accessibility cue volume existed. Added `Settings.audioLevels` (engine,
  effects, ambience, menu sounds, music; square-law taper: half way is -12 dB) and `Settings.musicEnabled` (default
  off), validated and migrated (older saves get defaults), shown in a SOUND MIX section of the settings screen
  (`src/ui/audio-mixer.ts`), applied by `RacingAudio.levels` on every update and by `UiSounds` (`level`). The master
  stays linear amplitude (`volume * 0.8`) so saved values keep their meaning. The music slider and switch are hidden
  until a music asset ships (`MUSIC_AVAILABLE`). The engine bus covers voices and power unit; effects cover tyres,
  surfaces, impacts, landings and the start lamps; ambience covers wind, rain, grit and thunder.
* **Unlock.** Measured in headless Chromium with the default autoplay policy (`--live`, page served over HTTP so that
  no automation gesture unlocks it): a bare `AudioContext().resume()` stays PENDING for ever (1500 ms probe). The old
  `await ctx.resume()` in `RacingAudio.start()` would therefore never return for a gamepad-only player (a gamepad
  button is not a user activation) who reaches the grid with no click or key. Now: `start()` returns after at most
  250 ms with `locked: true` (measured 274 to 293 ms in four runs), `AudioUnlock` retries `resume()` on every pointer,
  key and touch gesture, a real mouse click unlocked the context, the review tap then carried signal (-19.4 dBFS peak),
  and `main.ts` toasts "Sound starts after your next key press or click." once. 0 page errors. The unit tests
  (`tests/audio-unlock.test.ts`) pin the logic deterministically. Early ad-hoc runs of the live check were
  inconsistent because `page.evaluate()` itself grants a user gesture; the rig avoids that.
* **Electron.** `desktop/main.cjs` and `desktop/src/flags.cjs` already set `autoplayPolicy: 'no-user-gesture-required'`,
  so the locked path does not occur there. Read, not run (no Electron here).
* **Menu sounds** are gated on `navigator.userActivation` (existing) and create their context only after a gesture;
  they now follow the menu slider and have a soft ceiling.
* **Mute on blur.** Window `blur` and `visibilitychange` pause the race or festival, which fades the master to 0
  (`playing` is false); a replay stops its audio on blur. The `mute` key and the `muted` flag are honoured by the race
  graph, the menu sounds and the driving cues. Verified by reading the code paths (`input/controller.ts` blur,
  `main.ts suspendPlayback`, `session/free-roam.ts` `playing = !isPaused && !document.hidden`); not exercised end
  to end in a browser.
* **Regression check on the shipped audio specs.** `e2e/audio.spec.ts` and `e2e/spatial-audio.spec.ts` (real
  offline audio in Chromium) pass with `scripts/studio/tools/pw-dom.config.ts`.

## 5. Music

**The game has no music.** Every sound is synthesised in the browser and no audio asset ships (the repository holds no
audio file). Low-quality generative music was NOT fabricated. Delivered instead:

* `docs/studio/reports/audio-music-brief.md`: the composer brief (eight cues, loudness targets, loop specs, stem plan,
  budget-free licensing requirements, hook points).
* `src/audio/music.ts`: an optional music bus, disabled by default, silent while a cue has no asset, ducking under
  the engines, obeying the music slider, crossfading and looping between sample-accurate loop points;
  `musicCueFor(scene)` is the pure scene-to-cue choice; `RacingAudio.playMusic / stopMusic / musicEnabled` expose it.
  Tested with a recording fake context in `tests/audio-music-settings.test.ts` (13 tests, music and settings together).

## 6. Not fixed, not verified (honest list)

1. **No human listened.** Every judgment above is a numeric proxy; a listening pass on speakers and on headphones is
   the first thing the next audio pass needs.
2. **Synthetic engine states.** The rig does not run the physics simulation. Real gear changes, clutch slip, throttle
   noise and the real rev-limiter behaviour may differ (the rig pins revs 10 rpm under the limit and ramps them linearly between gears).
   A rig mode fed by recorded `Simulation` snapshots (as `scripts/studio/tools/driver-selftest.mjs` can produce) is
   the obvious extension.
3. **The formula car and the GP bikes sound alike** (heat map distance 0.49), as do 16 same-family pairs of machines.
   A family or an extra voice layer per class is a sound-design task (and needs listening).
4. **Crowd and field.** Only the four nearest cars are voiced: twelve cars at full revs on the grid measure -24 LUFS in
   the chase view against -26 LUFS for ONE car there, only 2 dB more. A far-field "traffic" bed is missing. The
   pass-by at 12 m (-36 LUFS) is 10 dB under the chase view and 15 dB under the cockpit (the distance roll-off is the
   documented `8 m / (8 m + d)`).
5. **No tunnel, cabin or enclosure filtering.** The snapshot carries no enclosure channel; only the weather hush
   (fog and snow close the master low-pass) exists. Snow and fog have NO ambient bed of their own: those two scenes
   render silent (-121 LUFS) apart from the master hush.
6. **Idle pitch tracking is not judged** below about 100 Hz fundamentals (analysis window); the oscillator floor of
   50 Hz on the half-order band is unchanged (a four-cylinder idle at 1,600 rpm puts that band at 50 Hz, not 27 Hz).
7. **Master volume is still linear** while the new sliders are square-law. Moving the master to the same taper would
   change what every saved volume means.
8. **Not run:** the full vitest suite, `npm run build`, Electron, Steam, a gamepad-only session in the real game, and
   any hardware audio device. `docs/studio/reports` WAVs are not committed.
9. **Merge note for the PM.** No seeded physics or AI behaviour changed (audio is presentation): no
   `SIMULATION_VERSION` bump, `session-identity` untouched. `src/main.ts`, `src/ui/interface.ts` and
   `src/storage/data.ts` carry small hunks (settings fields, the SOUND MIX section, `applyAudio`, the lock toast);
   expect trivial conflicts with the UX department's settings work.

## 7. Recommended next tasks, ranked

1. A listening pass (speakers, headphones, small laptop speakers) against the targets above; retune
   `ENGINE_REFERENCE_RMS`, bus trims and `GAIN_STAGING` with the rig open. Everything is one constant each.
2. Feed the rig recorded simulation snapshots (launch, a lap, a crash, a pit stop) instead of synthetic ones.
3. Give the GP bikes and the formula car clearly different voices (V4 chop and intake rasp versus turbo-hybrid whine).
4. Voice the field: a far-field engine bed for traffic beyond the four nearest cars; a pass-by gain review for the
   broadcast cameras.
5. Snow and fog beds; tunnel/cabin filtering once the snapshot carries an enclosure channel.
6. Commission or license the soundtrack (brief in `audio-music-brief.md`) and fill `MUSIC_CUES`.
7. Decide the squeal law (item 13 above) with the handling owners; add skid/stone-spit one-shots.
8. Move the master volume to the square-law taper behind a settings migration.

## 8. Verification (commands run in this worktree, all green unless stated)

* `npx tsc --noEmit`: 0 errors.
* `npx eslint` on every changed and new file under `src/audio`, `src/ui`, `src/storage`, `src/main.ts`, `tests`,
  `scripts/studio/tools`: 0 problems.
* `npx vitest run` on `tests/audio-mixer`, `engine-loudness`, `audio-unlock`, `limiter-start-audio`,
  `audio-music-settings`, `audio-rig-scenarios` (all new, 62 tests) and the existing `sound-profiles`,
  `power-unit-audio`, `spatial-audio`, `phase27f-atmosphere-audio`, `airborne-audio`, `airborne-clutch`, `audio`,
  `front-end-light-sound`, `gp-engine-braking`, `reference-depth`, `settings-transition`, `results-settings`,
  `core`, `race-day`, `radio`, `presentation`, `ultra-options`, `desktop-shell`: all pass.
* `npx playwright test -c scripts/studio/tools/pw-dom.config.ts e2e/audio.spec.ts e2e/spatial-audio.spec.ts`: 2 passed.
* `node --no-warnings scripts/studio/tools/audio-render.mjs --out <dir> --label after --stems --live`: 369 renders,
  0 page errors, live check as in section 4; the same command on the baseline worktree for the "before" figures.
