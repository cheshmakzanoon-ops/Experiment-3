import { resolve, relative, isAbsolute, sep } from 'node:path';
export const GAME_SCHEME = 'motobound';
export const GAME_HOST = 'game';
export const GAME_URL = 'motobound://game/babylon.html';
export const GAME_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-src 'none'";
export function isGameURL(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === `${GAME_SCHEME}:` &&
      u.hostname === GAME_HOST &&
      !u.port &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
export function gameAssetPath(root: string, value: string) {
  if (!isGameURL(value)) return null;
  try {
    const u = new URL(value),
      path = decodeURIComponent(u.pathname);
    if (path.includes('\\') || path.includes('\0')) return null;
    const candidate = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    const local = relative(resolve(root), candidate);
    if (
      !local ||
      local === '..' ||
      local.startsWith('..' + sep) ||
      isAbsolute(local) ||
      local.endsWith('.map')
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}
export function isGameNavigation(value: string) {
  if (!isGameURL(value)) return false;
  return ['/', '/index.html', '/babylon.html'].includes(new URL(value).pathname);
}
export const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};
