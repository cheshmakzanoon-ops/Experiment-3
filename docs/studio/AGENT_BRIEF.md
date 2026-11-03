# Common brief for every studio agent

You work for the MOTOBOUND studio (see STUDIO.md, RELEASE_GATES.md). Goal of the whole studio:
an extraordinary, original, Steam-ready racing game that blends circuit racing (F1-style),
GP motorcycles, motocross and open-world festival driving (Forza-Horizon-style), with fun,
unexpected tracks, gorgeous vehicles, mismatched vehicle/venue combinations that are cool to
drive, varied environments and weather, and a front end that feels hand-authored, not generic.

## Environment rules (4 CPUs shared by several agents)

- You are in your own git worktree on a `studio/...` branch cut from `main`. Commit there.
  Do not touch other branches. Do not push to `main` — the PM merges.
- First run: `ln -s /home/user/Experiment-3/node_modules node_modules` (do not run npm ci).
- Run only targeted checks: `npx tsc --noEmit` (≈40 s), `npx eslint <files>`,
  `npx vitest run tests/<file>.test.ts`. NEVER run the full vitest suite or `npm run check`.
- Browser: Chromium at `/opt/pw-browsers/chromium` via Playwright from the main checkout's
  node_modules (`/home/user/Experiment-3/node_modules/@playwright/test/index.mjs`), launch args
  `['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--headless=new']`.
  Software GL is slow (~45 s boot, low fps): run at most ONE browser at a time, keep viewports
  ≤ 1280×720, serve your own build with `npx vite preview --port <your port>` (ports given in task).
- Put scratch files in your scratchpad directory, not in the repo.
- Existing e2e/unit tests encode contracts (DOM ids, ARIA labels, data attributes). Before
  changing UI/DOM, `grep -rn` the tests and keep those contracts, or update the test with a stated reason.
- Never weaken, skip or delete tests to pass. Never use real licensed names/logos/liveries.
- Keep the diff purposeful: reuse existing modules, catalogues and helpers before writing new code.
- Do not invent verification. Report only what you ran. "Not tested" is an acceptable status.

## Finish

1. Commit all work on your branch with descriptive messages (end with the attribution lines the
   harness gives you, if any).
2. Write `docs/studio/reports/<dept>.md`: scope, what you verified (commands + results), what you
   fixed (files), what is still broken or unverified, recommended next tasks (ranked).
3. Final message to the PM: branch name, commit SHA, the report path, 10-line summary, and the exact
   verification commands you ran with pass/fail.
