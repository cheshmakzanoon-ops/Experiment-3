# Assignment 44 — production build and native browser acceptance

**Outcome: the frozen product build passed. Native browser acceptance is blocked before the global graphics probe; all gameplay and GPU assertions are unexecuted.** This assignment made no application, model, character, asset, or authored-environment edits and no git mutations.

## Source and product identity

The direct production command was:

```sh
node --max-old-space-size=2048 node_modules/vite/bin/vite.js build
```

Vite 7.1.7 exited 0, transformed 1,106 modules, and reported 13.09 seconds. The IP guard passed. The existing warning about chunks larger than 500 kB remains. The build used the default `product` variant and `full` edition; owner/review assets were not enabled. The exact [build log](../evidence/44-native-browser-build.log) is retained.

| Identity | Observed value |
| --- | --- |
| Full Vite source fingerprint | `a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0` |
| Dirt-bike adapter SHA-256 | `7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e` |
| Fingerprint inputs | 1,129 source/config files |
| Preserved input manifest | 1,423 files; zero changed bytes/modes and zero added protected inputs |
| Build commit field | `null`, reflecting the source tree rather than inventing a clean commit |

The fingerprint was checked before and after the attempts. `dist/BUILD_IDENTITY.json` matches it. A direct Vite preview also served that exact identity over HTTP before the installed-browser attempt. Final input comparison covered the source, public assets, authoring assets, tools, and the selected project/test harness inputs.

## Native attempts and precise blocker

Both attempts invoked the original `e2e/45-motocross-gameplay.spec.ts` through the installed Playwright 1.55.1 CLI with `APEX_BROWSER_BACKEND=swiftshader`, `APEX_MOTOCROSS_JOURNEY_QUALITY=low`, and `APEX_MOTOCROSS_JOURNEY_PROGRESS=1`. The original 20-minute test timeout, readiness gates, visible settings flow, and assertions were retained. An external 22-minute cleanup bound never triggered.

1. **System Chromium:** `/usr/bin/chromium` exists only as a launcher; `/usr/lib/chromium/chromium` is missing. Its browser process exited 127, and the test command exited 1 after 2.18 seconds. No browser page was created. See the [system launch log](../evidence/44-native-browser-system-launch.log).
2. **Authorized temporary installation:** one unchanged standard `playwright install chromium` invocation completed in 38.14 seconds, exit 0. The first CDN endpoint returned HTTP 403; Playwright's built-in Microsoft mirror fallback downloaded Chromium 140.0.7339.186, build 1193, and its bundled tools. No custom endpoint, manual download retry, system package installation, or access-policy override was used. The executable's `--version` command exited 0. See the [installer log](../evidence/44-native-browser-install.log).
3. **Installed Chromium:** the unchanged global setup attempted to launch that executable, then Chromium aborted with `SIGABRT` before creating a page:

```text
FATAL:chrome/browser/process_singleton_posix.cc:292
Check failed: . socket() failed: Operation not permitted (1)
```

Crashpad separately reported `ptrace: Operation not permitted (1)`. The test command exited 1 after 2.05 seconds at `scripts/browser-backend-setup.ts:11` (`chromium.launch`). The complete [IPC launch log](../evidence/44-native-browser-ipc-launch.log) is retained. Further native retries and IPC workarounds were stopped as directed.

## Acceptance scope and handoff

The requested renderer was SwiftShader, but **no renderer identity was observed**: `browser-backend.json` was never created, and the framebuffer probe did not execute. The test body did not execute. No gameplay screenshot exists to inspect. This run establishes no motocross entry, animation, riding, flight, landing, camera, pause, venue-switch, or physical-GPU performance result. The browser failure occurred before application execution and cannot establish a gameplay regression or a gameplay pass.

Owned preview processes were stopped, and the `dist`/port 4173 reservation was released. No model-generation lifecycle hook ran. The first attempt used the existing config's ordinary `npm run preview`; it has no pre/post hook. The installed-browser attempt reused a direct Vite preview from the same process namespace. Input preservation was verified after both.

The [machine-readable receipt](../evidence/44-native-browser.json) records timestamps, complete commands, build/source identity, process outcomes, environment history, cleanup, and hashes of the retained text logs. Native acceptance remains outstanding on a host that permits Chromium's required IPC. The successful build is independent evidence only.
