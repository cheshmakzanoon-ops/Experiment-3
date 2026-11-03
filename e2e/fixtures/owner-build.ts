/**
 * Release gate G15 (docs/studio/reports/ip-audit.md). A product web build (`npm run build`)
 * does not contain the owner-supplied real-brand player model: the player's APX-01 is the
 * original authored car. Specs that exercise the supplied model itself only apply to an
 * owner build, made and served with `MOTOBOUND_SUPPLIED_PLAYER=1`:
 *
 *   MOTOBOUND_SUPPLIED_PLAYER=1 npm run build && MOTOBOUND_SUPPLIED_PLAYER=1 npx playwright test e2e/39-supplied-player.spec.ts
 *
 * Specs that need the internal review tooling (reference catalogue, `?dev` review panel)
 * likewise need `MOTOBOUND_REVIEW_TOOLS=1` at build time.
 */
export const OWNER_BUILD = process.env.MOTOBOUND_SUPPLIED_PLAYER === '1';
export const REVIEW_BUILD = process.env.MOTOBOUND_REVIEW_TOOLS === '1';
export const OWNER_ONLY_REASON =
  'owner-supplied player model: only present in a MOTOBOUND_SUPPLIED_PLAYER=1 build (G15)';
export const REVIEW_ONLY_REASON =
  'internal review tooling: only present in a MOTOBOUND_REVIEW_TOOLS=1 build (G15)';
