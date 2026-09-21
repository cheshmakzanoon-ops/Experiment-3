import { expect, it } from 'vitest';
import {
  SessionReview,
  SESSION_REVIEW_COLUMNS,
  type SessionReviewObservation,
} from '../src/core/session-review.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
const identity = {
  source: 'a'.repeat(64),
  machine: 'Unit fixture, not hardware',
  reviewer: 'Automated regression',
  startedAt: '2026-09-21T00:00:00Z',
};
function observation(): SessionReviewObservation {
  return {
    state: 'driving',
    sessionId: 'unit-race',
    sessionMode: 'race',
    autopilot: false,
    camera: 'cockpit',
    telemetryOpen: false,
    visible: true,
    frame: new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 1 }).makeFrame(),
  };
}
it('retains real snapshot values and UI states without accepting a human scenario or mutating its inputs', () => {
  const review = new SessionReview(),
    o = observation(),
    before = o.frame!.slice();
  review.start(identity, 0, 'menu');
  review.observe(0, o);
  review.observe(20, o);
  expect(review.count).toBe(1);
  o.frame![H.TIME] = 1;
  review.observe(500, o);
  for (const state of ['results', 'replay', 'paused'])
    review.observe(510, { ...o, state, telemetryOpen: state === 'paused' });
  review.stop('Fixture finished');
  const report = review.report()!;
  expect(report.columns).toEqual(SESSION_REVIEW_COLUMNS);
  expect(report.rows).toHaveLength(3);
  expect(report.rows[0][report.columns.indexOf('player_speed')]).toBe(before[carBase(0) + F.SPEED]);
  expect(report.events.some((e) => e.detail.includes('replay'))).toBe(true);
  expect(report.events.some((e) => e.detail.includes('telemetry:true'))).toBe(true);
  expect(report.humanVerified).toBe(false);
  expect(report.section146Accepted).toBe(false);
  report.rows[0][1] = 999;
  expect(review.report()!.rows[0][1]).toBe(before[H.TIME]);
  o.frame![H.TIME] = before[H.TIME];
  expect(o.frame).toEqual(before);
});
it('does not hide automation, pauses, visibility loss or a second live session', () => {
  const review = new SessionReview(),
    o = observation();
  review.start(identity, 100, 'menu');
  review.observe(100, { ...o, autopilot: true });
  review.observe(101, { ...o, state: 'paused', visible: false });
  review.observe(600, { ...o, sessionId: 'restarted' });
  const report = review.report()!;
  expect(report.state).toBe('interrupted');
  expect(report.reason).toContain('restarted');
  expect(report.autopilotObserved).toBe(true);
  expect(report.integrityWarnings).toEqual(
    expect.arrayContaining(['autopilot-used', 'visibility-loss', 'mid-race-pause']),
  );
});
it('rejects wrong starting state, backwards clocks, non-finite physics and oversized event histories', () => {
  const review = new SessionReview(),
    o = observation();
  expect(() => review.start(identity, 0, 'driving')).toThrow('paddock');
  review.start(identity, 0, 'menu');
  review.observe(1000, o);
  review.observe(999, o);
  expect(review.report()!.reason).toContain('Non-monotonic');
  review.start(identity, 0, 'menu');
  o.frame![carBase(0) + F.SPEED] = NaN;
  review.observe(0, o);
  expect(review.report()!.reason).toContain('Non-finite');
  review.start(identity, 0, 'menu');
  for (let i = 0; i <= SessionReview.maximumEvents; i++) review.event(i, 'action', 'camera');
  expect(review.report()!.events).toHaveLength(SessionReview.maximumEvents);
  expect(review.report()!.state).toBe('interrupted');
});
it('labels non-race observations, enforces two-hour limits and ignores replay rewinds as live physics', () => {
  const review = new SessionReview(),
    o = observation();
  review.start(identity, 0, 'menu');
  review.observe(0, { ...o, sessionMode: 'practice' });
  review.observe(1000, { ...o, state: 'replay' });
  expect(review.active).toBe(true);
  review.observe(7200000, o);
  expect(review.report()!.reason).toContain('Two-hour');
  expect(review.report()!.integrityWarnings).toContain('not-a-race-session');
});

it('retains a final classification snapshot once even between scheduled samples', () => {
  const review = new SessionReview(),
    o = observation();
  review.start(identity, 0, 'menu');
  review.observe(0, o);
  o.frame![H.TIME] = 0.1;
  o.frame![carBase(0) + F.FINISH] = 1;
  review.observe(100, { ...o, state: 'results' });
  review.observe(800, { ...o, state: 'results' });
  review.stop('End of fixture');
  const report = review.report()!;
  expect(report.rows).toHaveLength(2);
  expect(report.rows[1][report.columns.indexOf('player_finish')]).toBe(1);
  expect(report.events.filter((e) => e.kind === 'results-snapshot')).toHaveLength(1);
});
