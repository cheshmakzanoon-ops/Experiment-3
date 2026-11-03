# Steamworks setup

Everything Steam-related is optional and **fails closed**: without the `steamworks.js` package,
without a running Steam client, with `MOTOBOUND_STEAM=0` / `--steam=0`, or on any API error, the
game runs normally and the Steam calls are no-ops (`desktop/src/steam.cjs`, unit-tested in
`tests/desktop-shell.test.ts`). It never throws and never blocks start-up.

**No real app id is committed.** Steam supplies the id when it launches the game; developers
use their own. The placeholder `480` below is Valve's public "Spacewar" test app and appears
only in these development notes, never in code, config or build output.

## What is wired

| feature | where | status |
| --- | --- | --- |
| Achievements (54 defined) | `src/steam/achievements.ts` (data + pure engine), `src/steam/runtime.ts` (persist + unlock) | engine unit-tested; **Steam side not run here (no client)** |
| Rich presence | `src/steam/runtime.ts` -> `desktop/main.cjs` `steam:presence` | not run against Steam |
| Steam Cloud | auto-cloud on `userData/saves/` (below) | configuration only; not run against Steam |
| Overlay | `electronEnableSteamOverlay()` when Steam initialised | not run against Steam |
| Steam Input / Deck | no native Steam Input; Steam's default controller template (gamepad) | see `docs/studio/store/STEAM_DECK_CHECKLIST.md` |

## Development against a real Steam client

1. Install the Steam client and sign in. In `desktop/`: `npm install` (pulls the optional
   `steamworks.js`, ~9 MB of native libraries; if it fails to install the game still runs).
2. Use your own app id, or Valve's test id 480 (shared by every developer; achievements you set
   there are not yours): `MOTOBOUND_STEAM_APPID=480 npm start`. As an alternative create an
   **untracked** `steam_appid.txt` containing the id next to the executable (the repository's
   `.gitignore` for the packaged `release/` folder keeps it out; never commit it).
3. The log (`userData/logs/main.log`) states the outcome: `steam: connected as <persona>` or the
   reason it is off. `MOTOBOUND_STEAM=0` forces it off.

## Steamworks partner site checklist

1. **Achievements.** The `id` of every entry in `ACHIEVEMENTS` is the *API Name* (lower snake
   case). Create all 54 (`docs/studio/store/ACHIEVEMENTS.md` lists id, name, description,
   hidden flag). Each needs two 256x256 icons (unlocked colour, locked grey); the art brief is in
   `CAPSULE_AND_ART_BRIEF.md`. Names and descriptions are English only today.
2. **Stats and achievements -> "Allow stats and achievements to be set from the client"** is not
   needed; steamworks.js uses the client API. Publish the stats configuration.
3. **Rich presence.** Upload a localisation file (Steamworks -> Community -> Rich Presence):

   ```
   "lang"
   {
     "english"
     {
       "tokens"
       {
         "#Status_Menu"     "In the paddock"
         "#Status_Loading"  "Loading a session"
         "#Status_Racing"   "Racing"
         "#Status_Paused"   "Paused"
         "#Status_Results"  "Reading the results"
         "#Status_Replay"   "Watching a replay"
         "#Status_Photo"    "In photo mode"
         "#Status_Festival" "Roaming the festival"
       }
     }
   }
   ```

   The game sets `steam_display` to `#Status_<status>` and also publishes plain keys `status`,
   `venue`, `vehicle`, `weather`, `discipline` (circuit / vehicle ids, not display names) for
   richer tokens such as `"#Status_Racing" "Racing at %venue% in %vehicle%"` once the ids are
   mapped to names.
4. **Steam Cloud** (Steamworks -> Application -> Steam Cloud). Prefer **Auto-Cloud** (no code):
   - Quota: 100 MB and 10 files is comfortable. `saves.json` holds settings, career, team and
     festival progress (a few KB to a few hundred KB). `ghosts.json` grows with every stored
     time-trial ghost: a 2-minute lap at 30 Hz x 11 floats is about 160 KB raw (the recorder's own
     comment says 50 KB, which is wrong by its own constants) and about 210 KB once base64-encoded
     in the JSON, so 100 ghosts is roughly 21 MB. If that is too much to upload on every save,
     leave `ghosts.json` out of the Cloud rules; nothing else depends on it.
   - Add one root-path rule per platform:

     | Root | Subdirectory | Pattern | Platforms |
     | --- | --- | --- | --- |
     | `WinAppDataRoaming` | `MOTOBOUND/saves` | `*.json` | Windows |
     | `WinAppDataRoaming` | `MOTOBOUND/saves` | `*.json.bak` | Windows |
     | `LinuxXdgConfigHome` | `MOTOBOUND/saves` | `*.json` and `*.json.bak` | Linux (also Steam Deck) |
     | `MacAppSupport` | `MOTOBOUND/saves` | `*.json` and `*.json.bak` | macOS |

   - Do **not** sync `*.tmp` or `saves.corrupt-*.json`, `logs/`, `window-state.json` or the
     Chromium profile folders: window placement is per machine, and IndexedDB is a database
     that must not be file-synced.
   - How it works: the game writes `saves.json`/`ghosts.json` atomically after each save.
     Steam downloads a newer remote copy before launch (and uploads on exit). At start-up the
     renderer compares the file's revision with the revision stored in IndexedDB
     (`src/storage/desktop-mirror.ts`): newer file -> restored into IndexedDB; newer IndexedDB ->
     the file is re-seeded. Two machines that both progressed offline produce a Steam Cloud
     conflict dialog (file level, "keep local / keep cloud"); there is no field-level merge.
   - **Verify with a real client before launch:** play on machine A, exit, start on machine B
     (empty profile), confirm the career arrives; then repeat with B ahead of A.
   - Folder names depend on `productName` (`MOTOBOUND`). Changing it moves `userData`; change
     the rules with it.
5. **Launch options.** Windows: executable `MOTOBOUND.exe`. Linux: `motobound` (the
   `linux-unpacked` folder). On Linux add the launch argument `--no-sandbox` unless you have
   verified that Chromium's user-namespace sandbox works inside the Steam Linux Runtime
   container (the shell also adds it itself when `SteamGameId` is present). Optional extra
   launch entries: `--windowed`, `--borderless`.
6. **Depots.** Upload the **unpacked** folders (`win-unpacked`, `linux-unpacked`, the macOS
   `.app`) with `steamcmd`, not the NSIS installer or AppImage. Redistributables: none required;
   `steam_api64.dll` / `libsteam_api.so` / `libsteam_api.dylib` already ship inside
   `node_modules/steamworks.js/dist/<platform>` (unpacked from the asar).
7. **Do not** ship a `steam_appid.txt` in the depot; Steam provides the id.

## Known limits

- The in-process-GPU switch that `electronEnableSteamOverlay()` adds can change GPU behaviour
  and is only applied when Steam actually initialised. If it causes problems set
  `MOTOBOUND_STEAM_OVERLAY=0` (the overlay then will not render over the game).
- `steamworks.js` 0.4.0 is a small community binding. It exposes achievements, rich presence,
  cloud files, input and callbacks; there is no Steam Input action-set integration here, so
  the game depends on Steam's default gamepad/keyboard templates.
- If the game is started directly (not through Steam) with no `steam_appid.txt`, Steam features
  are simply off. There is no DRM and no `SteamAPI_RestartAppIfNecessary`; add it with the real
  app id if you want "must launch via Steam".
