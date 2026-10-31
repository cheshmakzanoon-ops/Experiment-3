# MOTOBOUND development direction

Read README.md, docs/CURRENT_STATUS.md, docs/REPOSITORY_MAP.md and docs/DESKTOP_DELIVERY.md before making changes.

## Shipping product

- This is a desktop game for Windows, macOS and Linux, not a browser-first product. Produce native packages and launch-test them through GitHub Actions on each target OS.
- TypeScript and Babylon.js are the primary engine direction. Preserve the existing custom physics/simulation as a component, with exactly one authoritative physics solver.
- Preserve existing models, shaders, animation, audio, controls, saves, progression and all four disciplines. Three.js is a temporary compatibility path until verified Babylon parity, not disposable work.
- Browser previews and browser-based tests are secondary engineering tools. An EXE wrapper, successful compile or diagnostic scene does not satisfy the goal of a professional game.
- The quality ambition is high-end graphics, responsive controls, coherent atmosphere, fun and strong replay value. Do not claim perfection, PS5 parity, commercial readiness or guaranteed profits from automated tests.

## Execution and evidence

- Keep development on main. Preserve ancestry and all work before deleting any already-integrated branches. Never overwrite concurrent remote work.
- Commit/publish verified increments. Keep the main README and current-status page truthful about source, packages, deployment and remaining limitations.
- Run affected tests locally. Use GitHub Actions for native OS and WebGL checks unavailable locally. Preserve failure artifacts and inspect screenshots, not only exit codes.
- Do not exclude tests, lower quality budgets or change assertions simply to obtain green checks. Diagnose and document actual defects and obsolete assumptions with stronger appropriate evidence.
- Distinguish unit tests, real renderer/browser tests, packaged application smoke tests and physical-hardware/playtest acceptance.
- Desktop signing/notarization and Steam credentials are not configured. Do not invent credentials, publish secrets, purchase services or claim signed retail builds.
- Historical phase reports describe their own commits. This desktop-first direction supersedes browser-first delivery language in older documentation; do not rewrite immutable reference material to hide its history.
