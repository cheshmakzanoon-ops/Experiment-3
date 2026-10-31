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
| Intel macOS         | macos-15-intel | DMG, ZIP         |
| Apple Silicon macOS | macos-15       | DMG, ZIP         |

Every lane builds locally on its native runner, launches the unpacked executable produced by the packager, checks sandbox isolation and retains launch evidence. All four lanes must succeed before the workflow publishes a source-addressed `desktop-dev-<commit>-<run>-<attempt>` prerelease. These prereleases are explicitly development builds, not the fully qualified stable game. Full gameplay/rendering gates remain separate and must pass before a retail release.

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
