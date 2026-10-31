import { app, BrowserWindow, Menu, dialog, net, protocol, session } from 'electron';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GAME_SCHEME,
  GAME_URL,
  GAME_CSP,
  MIME,
  gameAssetPath,
  isGameNavigation,
  isGameURL,
} from './policy.js';

app.setName('MOTOBOUND');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: GAME_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);
let window: BrowserWindow | null = null;
const createWindow = async () => {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#111820',
    title: 'MOTOBOUND',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isGameNavigation(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', async (_event, details) => {
    if (details.reason === 'clean-exit' || !window) return;
    const result = await dialog.showMessageBox(window, {
      type: 'error',
      title: 'MOTOBOUND stopped rendering',
      message: 'The graphics process stopped. You can restart the game window.',
      detail: details.reason,
      buttons: ['Restart', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) void window?.loadURL(GAME_URL);
    else app.quit();
  });
  window.once('ready-to-show', () => {
    window?.show();
    window?.focus();
  });
  window.on('closed', () => {
    window = null;
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      (input.key === 'F11' || (input.alt && input.key === 'Enter'))
    ) {
      event.preventDefault();
      window?.setFullScreen(!window.isFullScreen());
    }
  });
  await window.loadURL(GAME_URL);
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'win32')
        app.setAppUserModelId('io.github.cheshmakzanoon-ops.motobound');
      const root = join(app.getAppPath(), 'dist');
      protocol.handle(GAME_SCHEME, async (request) => {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return new Response('Method not allowed', { status: 405 });
        const file = gameAssetPath(root, request.url);
        if (!file) return new Response('Not found', { status: 404 });
        try {
          const response = await net.fetch(pathToFileURL(file).href);
          const headers = new Headers(response.headers);
          headers.set('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
          headers.set('Content-Security-Policy', GAME_CSP);
          headers.set('X-Content-Type-Options', 'nosniff');
          // A .gz asset remains gzip bytes. The importer verifies its raw and
          // compressed forms; HTTP servers may instead decode it transparently.
          headers.delete('Content-Encoding');
          return new Response(request.method === 'HEAD' ? null : response.body, {
            status: response.status,
            headers,
          });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          callback(
            contents === window?.webContents &&
              isGameURL(details.requestingUrl ?? contents.getURL()) &&
              ['fullscreen', 'pointerLock'].includes(permission),
          );
        },
      );
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, origin) =>
          contents === window?.webContents &&
          isGameURL(origin) &&
          ['fullscreen', 'pointerLock'].includes(permission),
      );
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
          {
            label: 'Game',
            submenu: [
              { label: 'Babylon development build', click: () => void window?.loadURL(GAME_URL) },
              {
                label: 'Existing content · migration fallback',
                click: () => void window?.loadURL('motobound://game/index.html'),
              },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          { label: 'Window', submenu: [{ role: 'togglefullscreen' }, { role: 'minimize' }] },
          {
            label: 'About',
            click: () =>
              void dialog.showMessageBox({
                type: 'info',
                title: 'MOTOBOUND',
                message: `MOTOBOUND ${app.getVersion()}`,
                detail:
                  'Desktop development build. Babylon.js main-engine migration with the existing custom simulation. Not a finished commercial release.',
              }),
          },
        ]),
      );
      await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('MOTOBOUND could not start', String(error));
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
