'use strict';
/**
 * The only bridge between the game page and the desktop shell. The web build
 * feature-detects it (`window.motobound?.desktop`) and runs unchanged without
 * it. Everything is a thin, validated IPC call; the page gets no Node access.
 */
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(`motobound:${channel}`, ...args);

contextBridge.exposeInMainWorld('motobound', {
  desktop: {
    /** Bridge protocol version; bump on a breaking change. */
    version: 1,
    app: {
      name: 'MOTOBOUND',
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    },
    saves: {
      /** { revision, savedAt, source, keys, path }: cheap summary of the mirror files. */
      info: () => call('saves:info'),
      /** { revision, entries }: everything the mirror holds (only when restoring). */
      load: () => call('saves:load'),
      /** Mirror one completed IndexedDB write. */
      put: (key, value, revision) => call('saves:put', key, value, revision),
      /** IndexedDB held newer data than the mirror: replace the mirror. */
      seed: (entries, revision) => call('saves:seed', entries, revision),
      flush: () => call('saves:flush'),
    },
    display: {
      get: () => call('display:get'),
      /** 'fullscreen' | 'borderless' | 'windowed' */
      set: (mode) => call('display:set', mode),
      toggleFullscreen: () => call('display:toggle'),
    },
    steam: {
      status: () => call('steam:status'),
      /** Subset of `ids` already unlocked on Steam. */
      unlocked: (ids) => call('steam:unlocked', ids),
      unlock: (ids) => call('steam:unlock', ids),
      /** { status: 'menu'|'racing'|..., venue?, vehicle?, weather?, discipline? } */
      presence: (state) => call('steam:presence', state),
      /** Leaderboards (optional on the page side; `available` says whether Steam can take scores). */
      leaderboards: {
        status: () => call('steam:lb:status'),
        submit: (name, score, details) => call('steam:lb:submit', name, score, details),
      },
    },
    shell: {
      /** Demo wishlist: ask the shell to open the store page. `source` is a campaign label only. */
      openStore: (source) => call('shell:openStore', source),
    },
    quit: () => call('quit'),
  },
});
