import { ghostKey } from '../core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../core/session-identity.ts';
import {
  wildcardMedalFromRecord,
  wildcardKey,
  wildcardSeries,
  type WildcardEntry,
} from '../career/wildcard-series.ts';
import type { Medal } from '../career/licences.ts';
import type { CareerSave } from '../career/save.ts';
import { CIRCUITS } from '../simulation/circuits.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { wildcardOpen } from '../release/demo.ts';
import {
  parseLeaderboardKey,
  formatScore,
  lapScore,
  timeTrialBoardName,
  wildcardBoardName,
  type BoardStore,
} from '../steam/leaderboards.ts';
import type { LeaderboardStatus } from '../steam/leaderboard-runtime.ts';
import {
  LEADERBOARD_SIZE,
  readLeaderboard,
  type LeaderboardEntry,
} from '../storage/leaderboard.ts';
import { CIRCUIT_MENU_LABELS } from './circuit-menu.ts';
import { glyph } from './glyphs.ts';
import { escapeHtml } from './team-hub.ts';

/**
 * RECORDS: the local leaderboard screen. Every valid time-trial lap already enters a per-circuit,
 * per-machine top ten in the save store (storage/leaderboard.ts), the best one is the ghost
 * (core/ghost-lap.ts) and the Wildcard board keeps its best lap and medal in the career save;
 * nothing showed them. This is that screen, and it is the whole leaderboard experience in the web
 * build: no network, no account, personal bests and the ghost. In the desktop build each board
 * also carries its Steam state (sent, or queued for Steam), see src/steam/leaderboard-runtime.ts.
 */

export interface TimeTrialRow {
  circuit: string;
  circuitLabel: string;
  vehicle: string;
  vehicleName: string;
  laps: LeaderboardEntry[];
  /** The personal-best lap is saved as a ghost to race against. */
  ghost: boolean;
  steam: SteamMark;
}
export interface WildcardRow {
  id: string;
  title: string;
  machine: string;
  venue: string;
  /** Best valid lap (s), 0 when none. */
  bestLap: number;
  starts: number;
  medal: Medal | null;
  /** Position-ladder events keep a best finish too. */
  bestPosition: number;
  steam: SteamMark;
  open: boolean;
}
export type SteamMark = 'sent' | 'queued' | null;
export interface RecordsView {
  timeTrial: TimeTrialRow[];
  wildcard: WildcardRow[];
  /** Local boards from an older physics version (kept on disk, not shown or ranked). */
  archived: number;
  steam: LeaderboardStatus | null;
}
export type RecordsTab = 'time-trial' | 'wildcard';

export interface RecordsSource {
  store: {
    read(key: string): Promise<unknown>;
    keys(prefix: string): Promise<string[]>;
  };
  career: Pick<CareerSave, 'results'> | null;
  boards: BoardStore | null;
  steam: LeaderboardStatus | null;
}

const markOf = (boards: BoardStore | null, name: string | null, score: number): SteamMark => {
  const record = name ? boards?.boards[name] : undefined;
  if (!record) return null;
  return record.sent !== null && record.sent <= score ? 'sent' : 'queued';
};
const machineName = (id: string) => (Object.hasOwn(VEHICLES, id) ? VEHICLES[id].name : id);
const machineCodes = (entry: WildcardEntry) =>
  [...new Set([entry.event.vehicles].flat())]
    .map((id) => (Object.hasOwn(VEHICLES, id) ? VEHICLES[id].name.split(' ')[0] : id))
    .join(' / ');

/** Read everything the screen shows. Never throws: an unreadable board is skipped. */
export async function loadRecords(source: RecordsSource): Promise<RecordsView> {
  // Steam marks exist only where the shell can send scores; a browser shows local records only.
  const boards = source.steam?.supported ? source.boards : null;
  const timeTrial: TimeTrialRow[] = [];
  let archived = 0;
  let ghosts = new Set<string>();
  try {
    ghosts = new Set(await source.store.keys('ghost:'));
  } catch {
    /* no ghost marks */
  }
  let keys: string[] = [];
  try {
    keys = await source.store.keys('leaderboard:');
  } catch {
    /* no local boards */
  }
  for (const key of keys) {
    const id = parseLeaderboardKey(key);
    if (!id) continue;
    if (id.physics !== SIMULATION_VERSION) {
      archived++;
      continue;
    }
    let laps: LeaderboardEntry[] = [];
    try {
      laps = readLeaderboard(await source.store.read(key));
    } catch {
      continue;
    }
    if (!laps.length) continue;
    const circuit = Object.hasOwn(CIRCUITS, id.circuit) ? id.circuit : null;
    timeTrial.push({
      circuit: id.circuit,
      circuitLabel: circuit
        ? CIRCUIT_MENU_LABELS[circuit as keyof typeof CIRCUIT_MENU_LABELS].split(' · ')[0]
        : id.circuit,
      vehicle: id.vehicle,
      vehicleName: machineName(id.vehicle),
      laps,
      ghost: ghosts.has(ghostKey(id.circuit, id.vehicle)),
      steam: markOf(
        boards,
        timeTrialBoardName(id.circuit, id.vehicle, id.physics),
        lapScore(laps[0].lapTime) ?? 0,
      ),
    });
  }
  // Circuit order of the menu, then machine name: the screen is a list to scan.
  const order = Object.keys(CIRCUITS);
  timeTrial.sort(
    (a, b) =>
      order.indexOf(a.circuit) - order.indexOf(b.circuit) ||
      a.vehicleName.localeCompare(b.vehicleName),
  );
  const wildcard: WildcardRow[] = wildcardSeries().map((entry) => {
    const record = source.career?.results[wildcardKey(entry)];
    const bestLap = record?.bestLap ?? 0;
    return {
      id: entry.id,
      title: entry.title,
      machine: machineCodes(entry),
      venue: CIRCUIT_MENU_LABELS[entry.event.circuit].split(' · ')[0],
      bestLap,
      starts: record?.starts ?? 0,
      bestPosition: record?.bestPosition ?? 0,
      medal: wildcardMedalFromRecord(entry, record),
      steam: markOf(boards, wildcardBoardName(entry.id), lapScore(bestLap) ?? 0),
      open: wildcardOpen(entry.id),
    };
  });
  // The Steam demo lists its own events first.
  wildcard.sort((a, b) => Number(b.open) - Number(a.open));
  return { timeTrial, wildcard, archived, steam: source.steam };
}

const lapText = (seconds: number) => formatScore(Math.round(seconds * 1000));
const steamTag = (mark: SteamMark) =>
  mark === 'sent'
    ? '<span class="rc-steam" data-state="sent">ON STEAM</span>'
    : mark === 'queued'
      ? '<span class="rc-steam" data-state="queued">QUEUED</span>'
      : '';
const MEDAL_LETTER: Readonly<Record<Medal, string>> = { gold: 'G', silver: 'S', bronze: 'B' };

function statusLine(view: RecordsView) {
  const s = view.steam;
  if (!s?.supported)
    return '<p class="rc-status" data-state="local">LOCAL RECORDS · KEPT ON THIS DEVICE. NO ACCOUNT, NO NETWORK.</p>';
  if (s.online)
    return `<p class="rc-status" data-state="online">STEAM LEADERBOARDS · ${s.sent} BOARD${s.sent === 1 ? '' : 'S'} SENT${s.pending ? `, ${s.pending} WAITING` : ''}.</p>`;
  return `<p class="rc-status" data-state="offline">STEAM LEADERBOARDS · NOT TAKING SCORES${s.reason ? ` (${escapeHtml(s.reason.toUpperCase())})` : ''}. YOUR TIMES ARE KEPT HERE${s.pending ? ` AND ${s.pending} WAIT TO BE SENT` : ''}.</p>`;
}

function timeTrialHtml(view: RecordsView) {
  if (!view.timeTrial.length)
    return `<div class="rc-empty"><b>NO LAPS YET.</b><p>Pick SESSION · Time trial in the paddock and set a valid lap. Every valid lap enters a local top ten for that circuit and machine, and your best lap is saved as a ghost to race against.</p></div>`;
  return `<ul class="rc-list">${view.timeTrial
    .map((row) => {
      const best = row.laps[0];
      const laps = row.laps
        .slice(0, LEADERBOARD_SIZE)
        .map(
          (lap, i) =>
            `<li><span class="rc-rank">${i + 1}</span><b>${lapText(lap.lapTime)}</b><span>${escapeHtml(lap.driver)}</span><span class="rc-meta">${escapeHtml(lap.weather.toUpperCase())} · ${lap.assist === 'raw' ? 'NO ASSISTS' : 'ABS + TC'}</span></li>`,
        )
        .join('');
      return `<li class="rc-board" data-circuit="${escapeHtml(row.circuit)}" data-vehicle="${escapeHtml(row.vehicle)}"><details><summary><span class="rc-name"><b>${escapeHtml(row.circuitLabel)}</b><small>${escapeHtml(row.vehicleName)}</small></span><span class="rc-best">${lapText(best.lapTime)}</span>${row.ghost ? '<span class="rc-ghost">GHOST</span>' : ''}${steamTag(row.steam)}${glyph('caret', 'rc-caret')}</summary><ol class="rc-laps" aria-label="Top ${row.laps.length} laps, ${escapeHtml(row.circuitLabel)}, ${escapeHtml(row.vehicleName)}">${laps}</ol></details></li>`;
    })
    .join(
      '',
    )}</ul>${view.archived ? `<p class="rc-note">${view.archived} board${view.archived === 1 ? '' : 's'} from an older physics version stay on this device and do not compete with current laps.</p>` : ''}`;
}

function wildcardHtml(view: RecordsView) {
  return `<ul class="rc-list">${view.wildcard
    .map((row) => {
      const disc = row.medal
        ? `<span class="wc-medal" data-medal="${row.medal}" aria-label="${row.medal} medal"><b>${MEDAL_LETTER[row.medal]}</b></span>`
        : '<span class="wc-medal" data-medal="none" aria-hidden="true"></span>';
      const best = !row.open
        ? '<span class="rc-ghost" data-fullgame>FULL GAME</span>'
        : row.bestLap > 0
          ? `<span class="rc-best">${lapText(row.bestLap)}</span>`
          : row.starts > 0
            ? `<span class="rc-best">P${row.bestPosition}</span>`
            : '<span class="rc-none">NOT RUN</span>';
      return `<li class="rc-board rc-event" data-event="${escapeHtml(row.id)}"${row.open ? '' : ' data-locked="true"'}><div class="rc-row">${disc}<span class="rc-name"><b>${escapeHtml(row.title)}</b><small>${escapeHtml(row.machine)} on ${escapeHtml(row.venue)}</small></span>${best}${steamTag(row.steam)}</div></li>`;
    })
    .join('')}</ul>`;
}

/** The screen. `tab` picks the list; the tab buttons are `records:tab:<tab>` actions. */
export function recordsHtml(view: RecordsView, tab: RecordsTab = 'time-trial'): string {
  const tabs: [RecordsTab, string, number][] = [
    ['time-trial', 'TIME TRIAL', view.timeTrial.length],
    ['wildcard', 'WILDCARD SERIES', view.wildcard.filter((r) => r.bestLap > 0).length],
  ];
  return `<div class="rc" data-tab="${tab}"><header class="rc-head"><div><span class="eyebrow">RECORDS</span><h2>Your fastest laps.</h2></div><button type="button" data-action="modalClose" class="wc-close" aria-label="Close records">${glyph('close')}</button></header>${statusLine(view)}<nav class="rc-tabs" aria-label="Record lists">${tabs
    .map(
      ([id, label, count]) =>
        `<button type="button" data-action="records:tab:${id}" aria-pressed="${id === tab}">${label} <small>${count}</small></button>`,
    )
    .join(
      '',
    )}</nav><div class="rc-body">${tab === 'time-trial' ? timeTrialHtml(view) : wildcardHtml(view)}</div></div>`;
}
