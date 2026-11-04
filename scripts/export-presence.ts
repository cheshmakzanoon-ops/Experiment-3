/**
 * Print the Steam Rich Presence localisation file (src/steam/presence.ts) in Valve's VDF format,
 * ready to upload at Steamworks -> Community -> Rich Presence. The committed copy is
 * docs/studio/store/RICH_PRESENCE.vdf; tests/steam-presence.test.ts fails when it is stale.
 *
 *   node --no-warnings --experimental-transform-types scripts/export-presence.ts > docs/studio/store/RICH_PRESENCE.vdf
 */
import { presenceVdf } from '../src/steam/presence.ts';

process.stdout.write(presenceVdf());
