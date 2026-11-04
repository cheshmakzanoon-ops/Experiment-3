# MOTOBOUND: music brief for a composer or a licensed library

Status: the game has NO music today. Every sound is synthesised in the browser; the repository contains no audio
file. This brief describes what to commission or license and exactly where it plugs in. The code socket exists and is
tested (`src/audio/music.ts`); it is disabled by default and does nothing until a cue gets an asset.

## 1. What the game is, in music terms

A racing game that blends circuit racing, GP motorcycles, motocross and open-world festival driving, with a
hand-authored, slightly unexpected tone (mismatched vehicle and venue "Wildcard" events, a festival coast, snow, fog,
night racing). The soundscape is already busy and tonal: engines occupy roughly 150 Hz to 4 kHz with strong harmonic
combs (measured centroids 260 to 2,100 Hz depending on the machine), tyres and wind fill the noise floor, menu sounds are
short mechanical clicks and chimes. Music must sit UNDER that, never fight the engine pitch, and never reveal that it
is looping. Original, instrumental, no vocals, no samples of recognisable works, no soundalikes of real racing games or
broadcasts.

## 2. The eight cues

All cues: stereo, 48 kHz, instrumental. "Loop" means a seamless loop; "stinger" plays once. Loudness is the integrated
loudness of the delivered file (ITU-R BS.1770 LUFS), true peak at most -1 dBTP; the in-game bus is calibrated so that a
file mastered to its target plays at unity (`cueNormalisation` in `music.ts`, reference -24 LUFS).

| # | Cue id | Where it plays | Kind and length | Target LUFS | Mood and palette |
|---|---|---|---|---|---|
| 1 | `menu` | Paddock board, garage, settings, career screens | loop, 90 to 150 s, 4 or 8 bar phrases | -22 | Confident, warm, anticipatory. Mid tempo (90 to 105 BPM) so it can sit under UI clicks without a strong pulse on every beat. Analogue-leaning synths, a plucked or muted-guitar figure, soft kick, no hi-hat roll (the relay ticks and stencil thuds must stay readable). |
| 2 | `race-ambient` | Normal racing, every discipline, dry | loop, 3 to 4 min, vertically layered (section 4) | -26 | A pad and pulse underbed: it supports speed without competing with engine pitch. Sparse harmony (open fifths, suspended chords), a slow filtered arpeggio. Leaves 150 to 900 Hz thin (the engine pocket). |
| 3 | `race-tension` | Final laps, safety car, rain onset, a close fight | loop, 2 to 3 min, tempo-locked to `race-ambient` so it can crossfade | -24 | The same harmonic world with rising urgency: tighter rhythm, higher register motif, restrained distortion on the pulse. Never louder than +2 LU over `race-ambient`. |
| 4 | `results` | Results board, share card, podium | loop, 60 to 90 s, with an optional 4 s intro stinger | -22 | Resolved and warm for a podium; a neutral, calmer alternate mix for a retirement or a last place (same file, stems on or off). |
| 5 | `wildcard-sting` | Starting a Wildcard event from the board and on the event card | stinger, 4 to 8 s, ends in silence | -20 | The "only here" hook: playful, a little odd, a strong rhythmic signature that matches the mismatched vehicle and venue idea (for example a bright, slightly detuned motif). Must not clip the race start lamps (`start-lights.ts`). |
| 6 | `festival-day` | Open-world festival coast by day | loop, 4 to 6 min | -26 | Open, sunlit, driving-with-the-window-down. Acoustic or electric guitar, warm bass, light percussion. Spacious and slow-changing so hours of free roam do not tire. |
| 7 | `festival-night` | Festival coast at night (LIGHT dial = night, LIVE sky after dark) | loop, 4 to 6 min | -26 | Same coast, after dark: slower, more reverb, electric piano and soft synth bass, no bright hats. |
| 8 | `snow` | Snow and ice venues and the snow pass | loop, 3 to 5 min | -27 | Cold, still and close: bell-like tones, long decays, low sparse bass. Snowfall already absorbs highs in the mix (`weather-ambience.ts`), so avoid heavy high-frequency content. |

Common rules: no melody in the 400 to 900 Hz band during racing cues; keep the long-term spectrum tilted down above
3 kHz; keep dynamic range narrow (loudness range under 6 LU) so the music does not breathe against the engine; no
sudden transients above -12 dBFS sample peak; no tempo or key change inside a loop.

## 3. Loop specification

* Deliver each loop as a WAV master (24-bit, 48 kHz) AND the game file (see section 6).
* The loop must be sample-accurate: the file contains a pre-roll (intro) and a tail that carries reverb and delay past
  the loop end. Provide `loopStart` and `loopEnd` in seconds (to the sample) in a sidecar JSON; the game sets
  `AudioBufferSourceNode.loopStart / loopEnd` from them (`MusicCueSpec.loop`).
* Loop length is a whole number of bars (4, 8 or 16). Check the seam by rendering the loop three times end to end and
  listening and by looking at the waveform around the seam for a step; any residual DC or click at the seam is a defect.
* The cue must start and end on a bar line so a crossfade from another cue of the same tempo (`race-ambient` to
  `race-tension`) lands on the beat. Crossfade times are in the cue table (`fade`, 2.5 to 4 s).
* A stinger ends in digital silence or a decayed tail under -60 dBFS within its stated length.

## 4. Stem plan

Deliver stems from the same render (same start, same length) so they can be summed or layered:

| Stem | Content | Used for |
|---|---|---|
| `bed` | pad, bass, ambience | always on |
| `pulse` | rhythmic and arpeggio layer | racing (cue 2, 3); off in menus' quiet moments and in the results retirement mix |
| `lead` | motif, melody or colour | on when the player is in a clean-air lap or a podium; off during pit lane and safety car |
| `tension` | risers, high pulse, filtered noise (cue 3 only, or an add-on to cue 2) | last laps, rain onset, close fight |

The code today plays a cue as one file (`MusicBus.play`). Vertical layering is a second step (one `MusicBus` voice per
stem with per-stem gains); stems are requested now so the layering needs no re-delivery. Provide a single stereo mix
of every cue as well.

## 5. Mix rules for the game

* Music bus gain: trim -3 dB against the other buses, a player slider (square-law, default 0.8) and a duck of up to 6 dB
  while the engines are present (`MUSIC_DUCK_DB`, `musicGain`).
* Reference levels in the current mix (rig measurements, default volume): engine pull -21 LUFS, ambience stems 12 to 36 dB
  under the engine, menu sounds -15 dBFS RMS. The level of music against the engine has NOT been measured (there is no
  asset): add a `music` stem scene to the rig and re-measure with `scripts/studio/tools/audio-render.mjs` as soon as
  the first cue lands, then set the music trim in `GAIN_STAGING.trimDb.music`.
* Music is off by default (`Settings.musicEnabled`) and the settings screen shows its controls only when a cue has an
  asset (`MUSIC_AVAILABLE`).
* The accessibility driving cues and the start lamps (`CueSynth`, `start-lights.ts`) bypass the music bus entirely.

## 6. Delivery format and naming

* Game files: Ogg Vorbis (quality 6, about 192 kbps) or Opus 128 kbps stereo, 48 kHz (Chromium and Electron decode
  both with `decodeAudioData`). One file per cue, optionally one per stem.
* Place under `public/audio/music/<cue-id>.ogg` and put the URL in `MUSIC_CUES[<cue-id>].src` together with `loop`
  points and the file's mastered `lufs`. A cue with `src: null` stays "unavailable" by design.
* Memory: a 4-minute stereo loop decoded is about 92 MB of float PCM at 48 kHz (240 s x 48,000 x 2 channels x 4 bytes); decode one cue at a time, drop the
  previous one after the crossfade (the bus already does this), and prefer streaming through a media element for
  festival cues if memory becomes a concern (Performance department).
* Every asset needs a provenance row (release gate G15: asset audit): composer or library, licence text, date,
  receipt or order reference, and the licence file stored in the repository.

## 7. Budget-free alternatives (Steam-safe licensing)

No specific tracks are proposed or attached here. Any source must satisfy ALL of the following, and the licence text
must be archived in the repository:

1. Commercial use in a distributed video game, worldwide, perpetual (the licence must not lapse when a subscription
   ends or when the game is delisted, and must cover updates and DLC).
2. Redistribution inside the game binary and the Steam depots, and in trailers, store capsules and gameplay streams,
   with no per-unit or revenue-share royalty.
3. No Content ID or similar claim risk for players who stream or record the game: the licensor must either not
   register the tracks for automatic claims or provide an explicit whitelist for streaming and video of the game.
4. Modification allowed: trimming, looping, layering stems, mixing, loudness processing.
5. Clear authorship: original recordings with a named rights holder who can sign a licence; no samples of third-party
   works; no uncleared covers; nothing "in the style of" a real racing game or broadcast.
6. Attribution, if required (for example Creative Commons BY), is acceptable only if the credits screen can carry it
   and the string is tracked in `docs/` with the file. Non-commercial (NC) and no-derivatives (ND) licences are NOT
   acceptable. CC0 or public-domain dedication is acceptable if the dedication is documented.
7. Generative or AI-assisted music is acceptable only if the tool's terms grant commercial rights in writing, the
   output carries no third-party likeness or prompt-to-artist imitation, and Steam's AI-content disclosure is filed.
   Prefer human-composed music for the hero cues (`menu`, `race-ambient`, `wildcard-sting`).

Practical routes, cheapest first: (a) a composer on a flat buy-out for the eight cues with a short written assignment
or exclusive licence, stems included; (b) a licence-reviewed royalty-free library whose terms meet 1 to 6 (keep the
purchase receipt and the licence PDF for each pack); (c) CC0 or public-domain recordings, vetted one by one. A mixed
approach is fine: hero cues commissioned, ambient beds (`snow`, `festival-night`) sourced.

## 8. Hook points in the code (what plugs in where)

| Where | What to call | State |
|---|---|---|
| `src/audio/music.ts` | `MUSIC_CUES[id].src / loop / lufs`; `musicCueFor(scene)`; `MusicBus` | built, tested, disabled by default |
| `src/audio/engine.ts` | `RacingAudio.musicEnabled`, `playMusic(id)`, `stopMusic()`; the bus feeds the master gain, so pause and mute silence it and it is ducked by `EngineVoices.presence` | built |
| `src/main.ts` `applyAudio()` | sets `musicEnabled = settings.musicEnabled && MUSIC_AVAILABLE` and the levels | built |
| `src/main.ts` session start (after `await this.audio.start()`) | `this.audio.playMusic(musicCueFor({ scene: 'race', night, snow }))` | NOT wired: no asset yet |
| `src/main.ts` results and championship flow | `playMusic('results')`, then `stopMusic()` on exit to the paddock | NOT wired |
| Wildcard start from the board | `playMusic('wildcard-sting')` | NOT wired |
| `src/session/free-roam.ts` (festival host `audio`) | `musicCueFor({ scene: 'festival', night, snow })` | NOT wired |
| Menu (paddock) | needs a persistent context: `RacingAudio` creates its context at session start and `UiSounds` has its own; attach a `MusicBus` to the `UiSounds` context (created on the first gesture) or create a menu context once | design step |
| `src/ui/audio-mixer.ts` | shows the music slider and switch when `MUSIC_AVAILABLE` | built |

Wiring the five NOT-wired lines is about thirty lines once a file exists; they were left out on purpose so that no
code path requests a missing asset.

## 9. Acceptance checklist for each delivered cue

1. Loudness and peak verified with a BS.1770 meter: integrated within +-0.5 LU of the table, true peak <= -1 dBTP.
2. Loop seam verified (three consecutive loops, no click, no tempo drift, no tail truncation).
3. Engine-pocket check: spectrum from 150 to 900 Hz at least 6 dB under the 100 Hz and 2 to 5 kHz regions for the racing
   cues, compared with the `engine__*__pull__cockpit` spectrograms in `docs/studio/reports/audio-screens/`.
4. Mixed into the rig (`mix` scene with a `music` stem): ambience, engine and music balance recorded; no render above
   -1.5 dBFS true peak at master volume 1.
5. Licence file, receipt and provenance row committed.
