'use strict';
/**
 * The privileged `motobound://app/` scheme that serves the built web game.
 *
 * file:// cannot be used: module Web Workers, WebAssembly streaming, fetch(),
 * IndexedDB and localStorage all behave differently (or not at all) on opaque
 * file origins. A registered standard+secure scheme gives the game a stable
 * origin, so IndexedDB survives updates and the save mirror always sees the
 * same database. Pure helpers only (no Electron import) so they are testable.
 */
const nodePath = require('node:path');

const SCHEME = 'motobound';
const HOST = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
});

function mimeFor(file) {
  return MIME[nodePath.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Map a request URL to a file under `root`, or null when it is not ours or
 * tries to leave the root. Directory requests resolve to index.html.
 */
function resolveRequest(root, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST) return null;
  let relative;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (relative.includes('\0') || relative.includes('\\')) return null;
  if (relative.endsWith('/') || relative === '') relative += 'index.html';
  const resolvedRoot = nodePath.resolve(root);
  const file = nodePath.resolve(resolvedRoot, '.' + relative);
  if (file !== resolvedRoot && !file.startsWith(resolvedRoot + nodePath.sep)) return null;
  return file;
}

/**
 * Content-Security-Policy for the game page. The game is fully offline, so
 * nothing may leave the scheme: no http(s), no websockets, no frames, no
 * plugins. blob:/data: are required (module workers from Vite, canvas
 * captures, generated textures).
 *
 * 'unsafe-eval' is deliberate and was found by running the build: three's
 * KTX2Loader starts its Basis transcoder in blob workers, and that emscripten
 * glue builds its embind invokers with the Function constructor. A policy
 * without it makes every one of those workers throw an EvalError on start
 * (4 console errors, KTX2 textures unavailable). The risk this accepts is
 * small here: the page loads only first-party files, renders no remote or
 * user-supplied HTML, and the request allow-list below blocks all network.
 */
function contentSecurityPolicy({ dev = false } = {}) {
  const self = `'self'`;
  return [
    `default-src ${self} blob: data:`,
    `script-src ${self} 'unsafe-eval' 'wasm-unsafe-eval' blob:`,
    `worker-src ${self} blob:`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `media-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `connect-src ${self} data: blob:${dev ? ' ws://127.0.0.1:* http://127.0.0.1:*' : ''}`,
    `object-src 'none'`,
    `base-uri ${self}`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/**
 * True for a page served by this scheme. `URL.origin` is the opaque string "null" for custom
 * schemes, so compare protocol and host instead (comparing origins silently rejects every IPC call).
 */
function isTrustedSenderUrl(rawUrl) {
  try {
    const { protocol, hostname, username, password } = new URL(rawUrl);
    return protocol === `${SCHEME}:` && hostname === HOST && !username && !password;
  } catch {
    return false;
  }
}

/** URLs the renderer is allowed to load; everything else is cancelled. */
function isAllowedRequestUrl(rawUrl) {
  try {
    const { protocol, hostname } = new URL(rawUrl);
    if (protocol === `${SCHEME}:`) return hostname === HOST;
    return protocol === 'blob:' || protocol === 'data:' || protocol === 'devtools:';
  } catch {
    return false;
  }
}

module.exports = {
  SCHEME,
  HOST,
  ORIGIN,
  MIME,
  mimeFor,
  resolveRequest,
  contentSecurityPolicy,
  isAllowedRequestUrl,
  isTrustedSenderUrl,
};
