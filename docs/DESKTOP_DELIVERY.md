# Desktop-first product delivery

## Product direction

As of 2026-10-31, MOTOBOUND is a Windows/macOS/Linux desktop game. Babylon.js is the primary engine direction; the existing custom simulation is retained as a component. The website is a secondary engineering preview. Packaging is not a substitute for visual, handling, performance or gameplay quality.

## Runtime

`desktop/main.ts` owns the Electron application lifecycle. It launches the local Babylon entry with a temporary menu route to the existing full-content implementation. There is no hosted-webpage dependency or listening local web server. `motobound://game/` serves only files beneath the packaged renderer directory, with a restrictive Content Security Policy. Renderer Node integration is disabled; context isolation and process sandboxing are enabled. Untrusted windows, foreign navigation and unrelated permissions are denied.

The renderer uses the existing keyboard/gamepad/touch controller. Native F11/Alt+Enter fullscreen and operating-system window controls are provided. The existing IndexedDB save format remains in the app's own persistent profile. Desktop and browser profiles are separate; automatic migration of browser saves is not claimed.

## Build layout

- `desktop/`: TypeScript application main process and offline asset policy.
- `electron-builder.yml`: Windows NSIS, macOS DMG/ZIP and Linux AppImage/tar targets.
- `build/icon.svg`: original MOTOBOUND app monogram; the prepare script produces its PNG.
- `scripts/prepare-desktop.mjs`: assemble only compiled renderer/main-process files, assets, icon and source identity into the offline payload. No duplicated renderer dependency tree is shipped.
- `scripts/desktop-smoke.mjs`: launch the **packaged executable**, verify the Babylon origin and pause/restart, inspect sandbox settings, record GPU capabilities, errors and a screenshot.
- `scripts/desktop-checksums.mjs`: package checksums and source receipts.
- `desktop-dist/`, `desktop-stage/`, `desktop-out/`, `desktop-evidence/`: generated, ignored build outputs.

## Native GitHub Actions matrix

| Platform            | Runner         | Artifacts        |
| ------------------- | -------------- | ---------------- |
| Linux x64           | ubuntu-22.04   | AppImage, tar.gz |
| Windows x64         | windows-2022   | EXE installer    |
| Intel macOS target  | macos-15 + Rosetta | x64 DMG, ZIP |
| Apple Silicon macOS | macos-15       | DMG, ZIP         |

Windows, Linux and Apple Silicon execute natively on their OS runners. The macOS x64 package is built on Apple Silicon and launched under Rosetta; the smoke test requires the process to report x64 and translated execution. Every lane launches the actual unpacked executable produced by the packager, checks sandbox isolation and retains launch evidence. This does not certify a physical Intel GPU. All four lanes must succeed before the workflow publishes a source-addressed `desktop-dev-<commit>-<run>-<attempt>` prerelease. These prereleases are explicitly development builds, not the fully qualified stable game. Full gameplay/rendering gates remain separate and must pass before a retail release.

## Signing and distribution limitations

Signing certificates and macOS notarization are not configured. Initial packages are unsigned development artifacts and may encounter operating-system trust warnings. Do not claim they are signed, notarized, Steam-ready or safe for unrestricted retail distribution. Configuring credentials, buying certificates or submitting to Steam requires the owner's participation and appropriate authorization; this workflow does none of those things.

Steamworks features, cloud saves, achievements, installer upgrade/uninstall testing, representative physical hardware, controller-only navigation across every screen and independent playtesting remain qualification work. No sales/profit guarantee follows from a successful build.

## References

- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol)
- [electron-builder CLI/targets](https://www.electron.build/docs/cli/)
- [Native GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

## First native run and portability repairs

[Run 41167060442](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41167060442), source `59fefcb`, exposed three distinct issues. Windows could not check out five historical log filenames containing colons; their contents are preserved under hyphenated names, while the historical inventory retains the original names. A repository-path regression test now rejects Windows-invalid names and case collisions. Both macOS lanes rejected regenerated LOD bytes; the gzip producer-OS byte is now canonicalized to the existing Unix value, without changing or relaxing the pinned asset hashes. Native reruns must confirm whether this fully accounts for the mismatch. Linux produced its packages and opened the application, but the captured UI reported WebGL unavailable on the headless runner. Its smoke lane now selects Mesa/OpenGL software rendering explicitly and records GPU status, application output and startup errors. Sandbox and web security remain enabled. This is CI rendering coverage, not physical-GPU performance qualification.

No native prerelease was published from that failed run. Repairs require a successful four-platform rerun before packages can be advertised as validated.

The `a99cf63` rerun confirms the Windows installer and Apple Silicon DMG/ZIP build and packaged offline launch. Both pass pause/resume/restart and isolation checks. Linux still fails its renderer gate: Chromium reports WebGL1/2 **blocklisted** on llvmpipe. The next CI-only Mesa invocation uses the repository's established GPU compatibility-list override, keeps sandbox/web security enabled, and requires the observed renderer to identify llvmpipe. No driver overrides are added to the shipped application. Native keyboard driving, frozen-pause ticks and original-model import are also added to the next smoke run; those stronger checks are pending.

Intel macOS also finishes package construction on `a99cf63`, but its GPU process fails EGL initialization before Babylon starts. Its next smoke invocation explicitly selects ANGLE/OpenGL instead of the unavailable default backend. This is a runner-specific test configuration, not a claim of an Intel graphics pass and not a shipping renderer override.

### Architecture-explicit macOS x64 validation

Both default EGL and explicit OpenGL initialization failed on the Intel hosted VM. The x64 lane therefore moves to `macos-15` (Apple Silicon) with preinstalled Rosetta, verified before packaging. It still produces and launches the **x64** Electron application; it does not substitute the arm64 binary. Build receipts record target and host architectures separately, checksum filenames use the target, and runtime evidence records process architecture and translation status. Windows/Linux/native ARM macOS remain unchanged. Physical Intel-Mac graphics and performance testing remains an open qualification gate.

References: [GitHub's Rosetta image provisioning](https://raw.githubusercontent.com/actions/runner-images/main/images/macos/scripts/build/install-rosetta.sh), [Apple's x64 translation environment](https://developer.apple.com/documentation/Apple-Silicon/porting-your-macos-apps-to-apple-silicon), [electron-builder architecture targets](https://www.electron.build/v26/docs/architecture/).

Run [41169800313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41169800313), source `27bfb66`, subsequently passed the expanded packaged-game checks on Windows x64, Linux x64 (Mesa/llvmpipe) and native Apple Silicon. These checks include keyboard acceleration, a frozen paused tick, original Formula-model import, offline runtime requests and renderer isolation. Intel-VM graphics initialization still failed, so its release job correctly skipped publication. The Rosetta lane above remains a candidate until its own run succeeds.

The `d64b4c3` x64/Rosetta job confirms the correct translated x64 process, an Apple Paravirtual Metal renderer and Babylon WebGL2 startup. It failed later at Playwright's unchanged 30-second pointer-action stability check for Pause. The next test explicitly activates the native application/window and records focus state before exercising the same real clicks. No forced click, disabled sandbox or increased action timeout is used. Independently, model-import completion now waits for rendered-ready frames rather than only decoded asset data; new screenshots must verify visible output.

The subsequent `395d7df` Rosetta report showed its 30-second focus gate ran before Babylon completed cold startup. The harness now awaits actual application readiness before requesting foreground activation. For translated CI execution only, it records and disables background timer throttling in the test process so desktop occlusion cannot stall requestAnimationFrame-based action stability. It does not alter the packaged application's defaults, input events, focus-loss pause code, sandbox, web security, action deadlines or renderer quality. Host focus is diagnostic rather than an early pre-startup success requirement. Physical Intel input/performance testing remains open.
