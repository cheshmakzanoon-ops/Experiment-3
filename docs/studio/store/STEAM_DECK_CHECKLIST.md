# Steam Deck checklist

Goal: **Deck Verified** (gate G8 asks for 40+ fps on a Deck; nothing here has been run on a Deck).
Valve's review looks at four areas: input, display, seamlessness and system support. The
criteria below are from Valve's published Steam Deck compatibility documentation as the release
engineer knows it; re-read it on the Steamworks site before submitting, because the wording changes.

Status key: **Done (repo)** verified by code/tests in this repository, **Gap** known missing,
**Hardware** needs a Steam Deck (or Linux handheld), **Policy** a decision for a human.

## Input

| Requirement | Status | Notes |
| --- | --- | --- |
| Full controller support: every function reachable with the Deck's built-in controls and no keyboard/mouse | **Gap** | Front-end menus (paddock, garage & settings, career, event cards, results) have no gamepad navigation: `src/main.ts` polls `pollActions('off')` outside driving/pause/replay, and nothing moves focus from a D-pad. `e2e/gamepad-basics.spec.ts` records this as an expected failure (`test.fail`) and it does fail as expected: D-pad down twice does not move focus. Until it is fixed the page must say *partial* controller support, which blocks Verified. Owner: UX/UI (gate G5). |
| In-race driving by pad | **Done (repo)** | Standard-mapping pad: steering axis 0, throttle/brake buttons 7/6 or axes (configurable), shifts 5/4, Start (9) pauses, Y/3 camera, X/2 hybrid; rumble channels; calibration screen. `tests/input.test.ts`, `tests/button-actions.test.ts`, `tests/controller-buttons.test.ts`. Start pauses and resumes a live session: `e2e/gamepad-basics.spec.ts` (needs a browser run). |
| Hot-plug and unplug do not crash | **Done (repo, faked API)** | `e2e/gamepad-basics.spec.ts` passed in the final run: a pad connected after load and disconnected at the menu causes no page error; Start pauses and resumes a live session; unplugging mid-session leaves the game paused/driving with no page error. The code pauses on a lost selected device (`deviceFault`). Real hardware **Hardware**. |
| Controller glyphs match the controller shown | **Gap** | The UI says "button 7"-style numbers in settings; no glyphs. Deck needs prompts like "A / B". |
| On-screen keyboard appears for text entry | **Policy** | The shipped UI has only numeric fields (settings, calibration, photo studio); no free text entry except developer tools (`?dev`). Keep it that way; if a team/driver name field is added, call Steam's floating keyboard. `steamworks.js` 0.4.0 does not expose it; test the Deck's automatic keyboard instead. |
| Default Steam Input template is usable | **Hardware** | With no native Steam Input, the "Gamepad" template is used. Check that the right trackpad does not fight the pad axes (the game reads the Gamepad API, which Steam presents as an Xbox-style pad). Consider shipping an official template once controls are final. |
| No input that needs focus loss (background gamepad) | **Done (repo)** | Chromium only delivers pad events to the focused window; the shell keeps the game window focused on show. Steam overlay/QAM is the only expected focus loss: confirm the game pauses (`document.hidden` stops the input pump in `main.ts`) and resumes. **Hardware** |

## Display

| Requirement | Status | Notes |
| --- | --- | --- |
| Default resolution 1280x800 (or 1280x720) works and is the default | **Hardware** | The window is fullscreen at the display size; `MIN_WIDTH`/`MIN_HEIGHT` is 960x540. Layouts were tested at 320-1920 px wide (`e2e/30-menu-access.spec.ts`), 1280x800 specifically is not. |
| Text readable at 7 inch | **Gap (likely)** | `style.css` sets buttons to 11 px with wide tracking and a base UI scale of 1 (adjustable 0.8-1.35 in settings). 11 px on an 800p 7" panel is below comfortable; add a Deck default of UI scale >= 1.2 or raise minimum sizes. Needs a real-device check. |
| Default graphics preset is playable | **Hardware** | Default quality is Medium (2x MSAA, AO, bloom). Expect to need a Deck-specific default (Low/Medium, 40 fps target); see `SteamDeck` detection below. |
| HDR/odd aspect handling | **Policy** | Not supported; 16:10 and 16:9 are the targets. |

## Seamlessness

| Requirement | Status | Notes |
| --- | --- | --- |
| Launches straight into the game, no launcher, no setup | **Done (repo)** | The shell starts fullscreen on the menu; no EULA modal exists yet (see `LEGAL_CHECKLIST.md`: if one is added it must be controller-navigable). |
| First-run needs no keyboard/mouse | **Gap** | Same as the menu-navigation gap: starting a first session needs the pointer today. |
| Cloud saves work | **Hardware** | Auto-Cloud on `~/.config/MOTOBOUND/saves` is configured in `desktop/STEAM.md`; verify with two devices. |
| Suspend/resume leaves audio and input working | **Hardware** | The audio context and Gamepad API after resume have not been tested. |
| No crash on first launch with Steam's runtime | **Hardware** | Test the Linux build in the Steam Linux Runtime (container). Chromium's sandbox usually cannot start inside it: the shell adds `--no-sandbox` when `SteamGameId` is present, and STEAM.md also lists it as a launch option. |
| Shader/asset loading does not stall for minutes | **Hardware** | Cold start to menu has only been measured under software GL (see the release report), which is not meaningful for a Deck. |
| Quits cleanly from the Steam menu | **Hardware** | `before-quit` flushes the save mirror synchronously; `app.quit()` is the exit path. Test "Exit game" from Steam. |

## System support

| Requirement | Status | Notes |
| --- | --- | --- |
| Runs on SteamOS | **Hardware** | Ship the native Linux build (`desktop/release/linux-unpacked`), not a Windows build under Proton: Proton + Electron + Chromium GPU paths are the less predictable combination. AMD RADV/Vulkan through ANGLE: the shell leaves the backend on Chromium's default; try `MOTOBOUND_ANGLE=vulkan` on a Deck if the default GL path is slow. |
| No unsupported anti-cheat / middleware | **Done (repo)** | None used. |
| Steam API features degrade gracefully | **Done (repo)** | `desktop/src/steam.cjs` never throws; `tests/desktop-shell.test.ts`. |
| Performance: 40+ fps (gate G8) | **Hardware** | Unmeasured. First candidate fixes: Low preset by default on Deck, 40 fps cap with 40 Hz display mode, smaller shadow/vegetation budgets. |

## A small thing to build once a Deck is available

Detect the Deck (environment `SteamDeck=1` is set by SteamOS in game mode; also check
`SteamOS` in `/etc/os-release`) in `desktop/main.cjs`, expose `app.isDeck` through the bridge,
and let the game choose a Deck default (UI scale, Low/Medium quality, 40 fps cap). It is not
implemented yet because no value in it can be chosen without measuring on the device.

## Test script on the device

1. Install the Linux depot from a beta branch; launch from Game Mode with only the Deck controls.
2. Reach the first race with the pad alone (expected to fail today: see Input).
3. Race one lap each: circuit car, GP bike, motocross; pause with Start; open settings.
4. Unplug/suspend/resume mid-race; check audio and pad still respond.
5. Photo mode export lands in `~/Pictures/MOTOBOUND`.
6. Exit from the Steam menu; relaunch; confirm the career and settings persisted; confirm Cloud.
7. Record frame times (`frames` in the smoke report, or the in-game engineering overlay) for each.
