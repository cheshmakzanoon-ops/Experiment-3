import { desktopBridge, type MotoboundDesktop } from '../desktop/bridge.ts';

/**
 * The demo's WISHLIST call to action. The page never builds a URL and never touches the
 * network: it asks the desktop shell to open the store page (the shell owns the app id and the
 * allow-list, desktop/src/store-link.cjs). In a browser there is no bridge, so there is
 * nothing to press: the plate says where the game lives instead (see `wishlistAvailable`).
 */

export type WishlistOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-desktop' | 'not-configured' | 'refused' | 'failed'; message: string };

/** Campaign label sent to the shell: lowercase letters, digits and dashes only. */
export const wishlistSource = (where: string) =>
  where
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'demo';

/** Can this build open a store page at all (a desktop shell that offers `shell.openStore`)? */
export function wishlistAvailable(bridge: MotoboundDesktop | null = desktopBridge()) {
  return typeof bridge?.shell?.openStore === 'function';
}

const MESSAGES: Record<string, string> = {
  'not-configured':
    'The Steam store page is not live yet. Search MOTOBOUND on Steam to wishlist it.',
  'no-desktop': 'Wishlist MOTOBOUND on Steam: search for it in the Steam store.',
  refused: 'The store page could not be opened from here. Search MOTOBOUND on Steam.',
  failed: 'The store page could not be opened. Search MOTOBOUND on Steam.',
};

/** Open the store page. Never throws and never rejects. */
export async function openWishlist(
  where: string,
  bridge: MotoboundDesktop | null = desktopBridge(),
): Promise<WishlistOutcome> {
  const open = bridge?.shell?.openStore;
  if (typeof open !== 'function')
    return { ok: false, reason: 'no-desktop', message: MESSAGES['no-desktop'] };
  try {
    const result = await open.call(bridge!.shell, wishlistSource(where));
    if (result?.opened) return { ok: true };
    const reason = result?.reason === 'not-configured' ? 'not-configured' : 'refused';
    return { ok: false, reason, message: MESSAGES[reason] };
  } catch {
    return { ok: false, reason: 'failed', message: MESSAGES.failed };
  }
}
