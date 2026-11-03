/**
 * Build-time switches injected by `vite.config.ts` (`define`). Ambient, never imported.
 *
 * `__SUPPLIED_PLAYER__` is release gate G15 (docs/studio/reports/ip-audit.md).
 * `public/models/supplied-player.glb.gz` is an owner-supplied model of a real
 * Formula 1 car with real team and sponsor decal sheets. It must never ship in a
 * product build, so it is excluded from `dist/` and from the bundle unless the build is
 * made with `MOTOBOUND_SUPPLIED_PLAYER=1` (owner-only). Read it as
 *
 *   const OWNER_BUILD = typeof __SUPPLIED_PLAYER__ !== 'undefined' && __SUPPLIED_PLAYER__ === true;
 *
 * in a module-level const of the module that branches on it, so the bundler folds the
 * literal and drops the dead branch together with the modules only that branch reaches.
 * Unit tests define it true (vitest.config.ts) to keep covering the owner-only code.
 */
declare const __SUPPLIED_PLAYER__: boolean | undefined;

/**
 * `__REVIEW_TOOLS__` keeps internal review tooling data in the bundle: the reference
 * catalogue quotes the pages (titles, observations, URLs) of a commercial game's coverage
 * and must not ship to players. `vite.config.ts` injects false unless
 * `MOTOBOUND_REVIEW_TOOLS=1` builds it in for the e2e review specs; where nothing injects it
 * (Node scripts, Playwright, ad-hoc fixture bundles) the data stays available.
 */
declare const __REVIEW_TOOLS__: boolean | undefined;
