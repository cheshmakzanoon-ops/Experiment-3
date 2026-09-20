import { expect, it } from 'vitest';
import { GpuTimer } from '../src/rendering/gpu-timer.ts';
function fixture(supported = true) {
  const state = { lost: false, disjoint: false, ready: false, value: 8e6,
    next: 0, starts: 0, ends: 0, deletes: 0, failAllocation: false };
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => supported ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
    isContextLost: () => state.lost,
    getParameter: () => state.disjoint,
    getQueryParameter: (_q: unknown, type: number) => type === 1 ? state.ready : state.value,
    createQuery: () => state.failAllocation ? null : { id: state.next++ },
    beginQuery: () => { state.starts++; }, endQuery: () => { state.ends++; },
    deleteQuery: () => { state.deletes++; },
  } as unknown as WebGL2RenderingContext;
  return { timer: new GpuTimer(gl), state };
}
it('unsupported timer is explicitly null and performs no GL queries', () => {
  const { timer, state } = fixture(false);
  timer.begin(); timer.end(); timer.dispose();
  expect(timer.supported).toBe(false); expect(timer.milliseconds).toBeNull();
  expect(state.starts).toBe(0);
});
it('reads a completed query without blocking and advances its sample identity', () => {
  const { timer, state } = fixture();
  timer.begin(); timer.end();
  expect(timer.milliseconds).toBeNull();
  state.ready = true; timer.begin(); timer.end();
  expect(timer.milliseconds).toBe(8); expect(timer.sampleSequence).toBe(1);
  expect(state.deletes).toBe(1);
});
it('caps outstanding GPU queries and prevents nested begins', () => {
  const { timer, state } = fixture();
  for (let i = 0; i < 20; i++) { timer.begin(); timer.begin(); timer.end(); }
  expect(state.starts).toBe(4); expect(state.ends).toBe(4);
  timer.dispose(); timer.dispose(); timer.begin();
  expect(state.deletes).toBe(4); expect(state.starts).toBe(4);
});
it('disjoint timing invalidates all results and does not begin another query that frame', () => {
  const { timer, state } = fixture();
  timer.begin(); timer.end(); state.ready = true; timer.begin(); timer.end();
  expect(timer.milliseconds).toBe(8);
  state.disjoint = true; timer.begin(); timer.end();
  expect(timer.milliseconds).toBeNull(); expect(state.starts).toBe(2);
  expect(state.deletes).toBe(2);
  state.disjoint = false; timer.begin(); timer.end();
  expect(state.starts).toBe(3);
});
it('context loss between begin/end clears ownership without calls on invalid handles', () => {
  const { timer, state } = fixture();
  timer.begin(); state.lost = true; timer.end(); timer.dispose();
  expect(state.ends).toBe(0); expect(state.deletes).toBe(0);
  expect(timer.milliseconds).toBeNull();
});
it('rejects invalid or negative GPU measurements and handles allocation failure', () => {
  for (const value of [-1, NaN, Infinity]) {
    const { timer, state } = fixture();
    timer.begin(); timer.end(); state.value = value; state.ready = true;
    timer.begin(); timer.end();
    expect(timer.milliseconds).toBeNull(); expect(timer.sampleSequence).toBe(0);
  }
  const { timer, state } = fixture(); state.failAllocation = true;
  timer.begin(); timer.end(); timer.dispose();
  expect(state.starts).toBe(0); expect(state.ends).toBe(0);
});
it('disjoint occurring during a query invalidates it at end', () => {
  const { timer, state } = fixture();
  timer.begin(); state.disjoint = true; timer.end();
  expect(state.ends).toBe(1); expect(state.deletes).toBe(1);
  expect(timer.sampleSequence).toBe(0);
});
