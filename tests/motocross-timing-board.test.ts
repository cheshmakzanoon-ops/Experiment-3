import * as T from 'three';
import { expect, it } from 'vitest';
import { MxTimingBoard } from '../src/rendering/offroad/mx-timing-board.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';

it('both arena ends follow the official leader, hold the winning time and rewind without a texture upload', () => {
  const board = new MxTimingBoard([new T.Vector3(0, 10, -60), new T.Vector3(0, 10, 60)]);
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  frame[carBase(0) + F.RANK] = 2;
  const leader = carBase(1);
  frame[leader + F.RANK] = 1;
  const uv = board.mesh.geometry.getAttribute('uv') as T.BufferAttribute;
  const snapshot = () => Array.from(uv.array);
  const readDigits = () =>
    Array.from({ length: 10 }, (_, i) => {
      const v = (i + 3) * 4;
      const x = Math.round(uv.getX(v) * 1024 - 1);
      const y = Math.round((1 - uv.getY(v + 2)) * 512 - 1);
      return ((y - 144) / 128) * 8 + (x - 448) / 72;
    });
  const gate = snapshot();
  expect(readDigits().slice(0, 2)).toEqual([1, 11]);
  const points = board.mesh.geometry.getAttribute('position');
  // Each single-digit lap starts under its heading. For two-digit laps,
  // the physical gutter between the last glyph and the clock is 0.59 m.
  expect(points.getX(5 * 4) - points.getX(4 * 4 + 1)).toBeCloseTo(20 * 30 / 1024, 5);
  const atlasVersion = board.atlas.version;
  frame[H.PHASE] = PHASE.RACING;
  frame[H.RACE_TIME] = 3661.02;
  frame[H.LAP_LEADER] = 12;
  board.update(frame);
  expect(readDigits()).toEqual([1, 2, 0, 1, 10, 0, 1, 10, 0, 1]);
  const racing = snapshot();
  expect(racing.slice(0, racing.length / 2)).toEqual(racing.slice(racing.length / 2));
  const version = uv.version;
  frame[H.RACE_TIME] += 0.2;
  board.update(frame);
  expect(uv.version).toBe(version);
  frame[H.LAP_LEADER] = 13;
  frame[leader + F.LAPS] = 12;
  frame[leader + F.FINISH] = 3663.87;
  board.update(frame);
  const finish = snapshot();
  expect(finish).not.toEqual(racing);
  expect(readDigits()).toEqual([1, 2, 0, 1, 10, 0, 1, 10, 0, 3]);
  frame[H.RACE_TIME] = 3690;
  frame[H.PHASE] = PHASE.FINISHED;
  board.update(frame);
  expect(snapshot()).toEqual(finish);
  frame.fill(0);
  board.update(frame);
  expect(snapshot()).toEqual(gate);
  expect(board.atlas.version).toBe(atlasVersion);
  board.mesh.geometry.dispose();
  board.mesh.material.dispose();
  board.atlas.dispose();
});
