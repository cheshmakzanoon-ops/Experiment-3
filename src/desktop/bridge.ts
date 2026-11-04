/**
 * Optional desktop bridge. The Electron shell (desktop/preload.cjs) exposes
 * `window.motobound.desktop`; the browser build never sees it and every caller
 * feature-detects through desktopBridge(). Nothing here may throw on the web.
 */

export interface DesktopSaveInfo {
  /** Highest save revision recorded in the mirror files. */
  revision: number;
  savedAt: number;
  /** 'primary' | 'backup' | 'temp' | 'empty': which file the mirror recovered from. */
  source: string;
  keys: string[];
  path: string;
}

export interface DesktopSaveSnapshot {
  revision: number;
  entries: Record<string, unknown>;
}

export type DisplayMode = 'fullscreen' | 'borderless' | 'windowed';

export interface SteamPresence {
  /** Localisation token suffix, e.g. Menu, Racing, Festival, Photo. */
  status: string;
  venue?: string;
  vehicle?: string;
  weather?: string;
  discipline?: string;
}

export interface MotoboundDesktop {
  version: number;
  app: { name: string; platform: string; arch: string; electron: string; chrome: string };
  saves: {
    info(): Promise<DesktopSaveInfo>;
    load(): Promise<DesktopSaveSnapshot>;
    put(key: string, value: unknown, revision: number): Promise<number>;
    seed(entries: Record<string, unknown>, revision: number): Promise<boolean>;
    flush(): Promise<boolean>;
  };
  display: {
    get(): Promise<{ mode: DisplayMode; fullscreen: boolean }>;
    set(mode: DisplayMode): Promise<DisplayMode>;
    toggleFullscreen(): Promise<boolean>;
  };
  steam: {
    status(): Promise<{
      available: boolean;
      reason: string | null;
      appId: number | null;
      name: string | null;
    }>;
    unlocked(ids: string[]): Promise<string[]>;
    unlock(ids: string[]): Promise<string[]>;
    presence(state: SteamPresence): Promise<boolean>;
  };
  /** Optional: absent in a shell older than the demo edition. */
  shell?: {
    /**
     * Open the game's Steam store page in the player's browser (the Steam demo's wishlist
     * button). The page sends only a campaign label: the shell builds the URL from its own
     * configured app id and allow-list, so the page can never choose where this goes.
     */
    openStore(source: string): Promise<{ opened: boolean; reason: string | null }>;
  };
  quit(): Promise<boolean>;
}

declare global {
  interface Window {
    motobound?: { desktop?: MotoboundDesktop };
  }
}

/** The desktop bridge, or null in a browser. */
export function desktopBridge(): MotoboundDesktop | null {
  try {
    const bridge = globalThis.window?.motobound?.desktop;
    return bridge && bridge.version === 1 ? bridge : null;
  } catch {
    return null;
  }
}
