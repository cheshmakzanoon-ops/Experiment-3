# Desktop-first product delivery

MOTOBOUND targets installed Windows, macOS and Linux applications. Babylon.js is the primary engine direction; the existing custom simulation stays authoritative. The website is a secondary engineering preview. Packaging alone does not qualify visuals, handling, performance or the full game.

## Runtime and ownership

`desktop/main.ts` launches the bundled Babylon entry, with a temporary existing-content compatibility route in the Game menu. There is no hosted-site dependency or listening HTTP server. `motobound://game/` serves only bundled renderer files. Node integration is disabled; context isolation, process sandboxing and web security remain enabled. Popups, foreign navigation and unrelated permissions are denied.

The app preserves the existing keyboard/gamepad/touch input controller and IndexedDB save format in its own profile. F11/Alt+Enter fullscreen and native window controls are available. Browser and desktop profiles are separate; automatic browser-save migration is not claimed.

- `desktop/policy.ts`: origin, path, navigation and CSP policy.
- `desktop/target.ts`: explicit target architecture, host architecture, executable selection and bounded CI graphics-driver choices.
- `scripts/prepare-desktop.mjs`: compiled offline payload, source receipt and original app icon. No duplicate renderer node_modules tree or source maps.
- `scripts/desktop-smoke.mjs`: actual packaged executable, architecture/renderer evidence, keyboard driving, pause/resume/restart, original-model import, isolation, remote-request checks and lossless screenshot.
- `scripts/desktop-checksums.mjs`: SHA-256 and target-specific source receipts.
- `desktop-dist/`, `desktop-stage/`, `desktop-out/`, `desktop-evidence/`: generated outputs, not source.

## Supported development-release matrix

| Target | Runner | CI graphics | Packages |
| --- | --- | --- | --- |
| Windows x64 | windows-2022 | Native platform driver | EXE |
| Linux x64 | ubuntu-22.04 | Explicit Mesa/llvmpipe | AppImage, tar.gz |
| macOS ARM | macos-15 | Native Metal driver | DMG, ZIP |

Intel macOS is **experimental and unreleased**. Its separate `desktop-intel-experimental.yml` workflow is manual-only and cannot publish. Both workflows reuse `desktop-platform.yml`, so its failures are retained rather than bypassed with `continue-on-error`. The Intel CI candidate uses Chromium's documented OpenGL ES driver mode: `--use-gl=angle --use-angle=swiftshader`. It does **not** add `--enable-unsafe-swiftshader`, use `swiftshader-webgl` fallback, disable sandboxing or alter the shipped application's renderer flags. The report must identify the requested driver; failure stays a failure. This route requires its own successful run. [Chromium driver-mode documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md).

With the owner’s approval on 2026-10-31, all three supported lanes must build, launch and finish their checks before a source-addressed `desktop-dev-<commit>-<run>-<attempt>` prerelease publishes. Checksums and embedded source IDs accompany packages. Publication also checks that the tested source remains main. The current status is recorded in [CURRENT_STATUS.md](CURRENT_STATUS.md); publication of the approved three-target development build is pending.

## Test-harness details

The native test shows the window before the startup observation, then checks actual displayed state with 100 ms polling under the original 120-second startup deadline. Pointer actions retain their normal checks and deadlines. Stage timestamps and initial visibility/status distinguish slow boot from delayed observation. No game state is injected.

Model success waits for completed ready frames. Screenshots capture the existing viewport through CDP under the same 30-second budget, avoiding redundant font/style preparation on a busy software renderer. PNG validity is checked; image inspection remains necessary.

Target and build-host architectures are recorded separately and checked against the running Electron process. A prior Rosetta experiment also required actual translated x64 execution; its failures remain in the history below. A translated CI-only background-timer setting never changes shipping defaults or focus-loss pause code.

## Validation history

| Source / run | Outcome |
| --- | --- |
| `59fefcb`, [41167060442](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41167060442) | Windows-invalid historical filenames, host-dependent gzip header and headless graphics failures. Log contents were preserved under portable names; pinned asset hashes were not relaxed. |
| `a99cf63`, [41168620134](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41168620134) | Windows and native ARM Mac launch passed; Linux WebGL blocklist and Intel EGL initialization remained. |
| `27bfb66`, [41169800313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41169800313) | Windows, Linux and native ARM Mac passed expanded keyboard/model checks; Intel VM graphics failed. |
| `d64b4c3`, [41170919104](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41170919104) | Rosetta x64 started Metal/WebGL, then pointer-action stability timed out. |
| `395d7df`, [41171968874](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41171968874) | Visible-car capture verified on ARM Mac; Linux functional checks passed but page-wide screenshot capture timed out. Rosetta's focus observation ran before startup completed. |
| `704e933`, [41173505000](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41173505000) | Linux, Windows and ARM Mac passed all smoke/capture checks. Rosetta initial readiness observation timed out; later image showed rendering. Publication skipped. |
| `82b0692`, [41175753019](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41175753019) | Three native lanes passed. Rosetta passed its startup predicate but timed out on a subsequent DOM read; exact cause remains unproven. Publication skipped. |

## Distribution and qualification limits

Packages are unsigned development artifacts. Signing certificates and macOS notarization are not configured; OS trust warnings are possible. No result here certifies Steam readiness, final graphics, full four-discipline Babylon parity or representative hardware performance. Software/virtualized CI graphics are functional evidence, not physical GPU benchmarks.

Remaining qualification includes controller-only navigation across every screen, full-mode playtests, installer upgrade/uninstall behavior, physical Intel-Mac graphics, target-PC frame-time/memory/loading budgets, asset rights, Steamworks features and independent player feedback. Signing/Steam credentials and purchases require the owner's participation; these workflows do not create them. No sales/profit guarantee follows from a successful build.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol), [electron-builder targets](https://www.electron.build/v26/docs/architecture/), [GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Verified development download

Source `6afc763500c7eb3b9f04b4facb7b1f652f5950af` passed all three supported native lanes and publication in [run 41179328737](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41179328737). The [published development release](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-6afc763500c7eb3b9f04b4facb7b1f652f5950af-41179328737-1) contains Windows EXE, Apple Silicon DMG/ZIP and Linux AppImage/tar packages, plus per-platform checksum lists and source receipts. All three native reports record no runtime HTTP(S) requests or renderer errors; screenshots show the original Formula model. Windows/macOS smaller-window captures exposed a diagnostic-panel overlap addressed in the following source increment. These unsigned packages remain development evidence, not complete-game, installer-upgrade, physical-performance or Steam qualification.

## Four-discipline native compatibility qualification

The next native-check increment invokes the shipped Game-menu compatibility entry, uses the real settings UI at Low quality for software runners, then enters Formula practice, GP practice, Outdoor MX racing and the open-world festival. Each route must accept real keyboard throttle, advance both authoritative and presented snapshots with autopilot off, pause, resume with renewed motion, pause again, capture a screenshot and return through its production menu. The open-world receipt observes its own worker and rendered frames, never stale circuit data. Non-2xx/local asset failures and unexpected remote requests are retained as failures.

These journeys ran on `710fb863` but **did not pass the complete native gate**. Windows/Apple Silicon completed all four routes, then failed on decoder CSP errors. Linux lost its graphics context during Formula preparation. Existing 180 s menu and 300 s preparation allowances are functional readiness budgets, not load-time targets; input remains 30 s and capture 30 s. The overall platform job allows 50 minutes for packaging plus four newly added real-mode journeys. This coverage does not assert a completed race, physics certification, final graphics or full Babylon parity.

The newer [b0b3ccc development release](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-b0b3cccb54502898312efe5f884c2c254ddc48f2-41183949366-1) includes wheel/HUD changes and demand-driven paused rendering, and passed all three native lanes plus five WebGL journeys. All 11 published assets were checked against source receipts and SHA-256 metadata. The subsequent four-mode qualification exposed the decoder CSP and Linux graphics failures described above; b0b3 remains a limited development baseline, not full four-mode acceptance.

## Linux driver comparison

Required release validation continues to use Mesa/llvmpipe with all existing checks and deadlines. A separate non-publishing workflow compares Chromium's documented full SwiftShader GLES driver on the same Linux source and full journeys. It does not enable the unsafe WebGL fallback or change the shipped app's driver selection/security. A passing comparison cannot turn a failed Mesa release lane green; it is diagnostic evidence to distinguish driver sensitivity from application behavior. [Chromium driver documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md).
