/**
 * Release gate G15 (docs/studio/reports/ip-audit.md). A product web build (`npm run build`)
 * does not contain the owner-supplied real-brand player model: the player's APX-01 is the
 * original authored car. Specs that exercise the supplied model itself only apply to an
 * owner build: a QA build that is never published, made by `npm run build:qa` (the only way to
 * make one: `npm run build` refuses the variables and `scripts/ip-guard.mjs` refuses the
 * output), served, and run with the same variable set:
 *
 *   npm run build:qa && MOTOBOUND_SUPPLIED_PLAYER=1 npx playwright test e2e/39-supplied-player.spec.ts
 *
 * Specs that need the internal review tooling (reference catalogue, `?dev` review panel)
 * likewise need `MOTOBOUND_REVIEW_TOOLS=1` when they run; `build:qa` builds it in.
 */
export const OWNER_BUILD = process.env.MOTOBOUND_SUPPLIED_PLAYER === '1';
export const REVIEW_BUILD = process.env.MOTOBOUND_REVIEW_TOOLS === '1';
export const OWNER_ONLY_REASON =
  'owner-supplied player model: only present in a MOTOBOUND_SUPPLIED_PLAYER=1 build (G15)';
export const REVIEW_ONLY_REASON =
  'internal review tooling: only present in a MOTOBOUND_REVIEW_TOOLS=1 build (G15)';

/**
 * Vite `define` for every ad-hoc fixture bundle (`build({ configFile: false, ... })`), which
 * does not read `vite.config.ts`. Without it `__SUPPLIED_PLAYER__` is undefined in the bundle,
 * so a spec run against an owner build (`MOTOBOUND_SUPPLIED_PLAYER=1`) would silently measure the
 * ORIGINAL car while the page under test showed the supplied one. With it, every fixture bundle
 * is the same kind of build as the server it is injected into: the original authored APX-01 as
 * car zero in a product build (`__SUPPLIED_PLAYER__` false: the owner loader is tree-shaken out
 * of the bundle), the owner-supplied model in an owner build. `__REVIEW_TOOLS__` is deliberately
 * left undefined: fixture bundles keep the review data available (src/build-flags.d.ts).
 * `tests/e2e-fixture-bundles.test.ts` fails when a spec forgets it.
 */
export function fixtureDefine(): Record<string, string> {
  return { __SUPPLIED_PLAYER__: JSON.stringify(OWNER_BUILD) };
}
