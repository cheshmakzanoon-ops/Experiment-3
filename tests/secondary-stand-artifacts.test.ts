import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSecondaryStandEvidence } from '../e2e/fixtures/secondary-stand-artifacts.ts';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
test('PNG exists with exact owned bytes before attachment is notified', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'a12-save-'));
  try {
    const path = join(dir, 'day-450-front.png');
    let called = false;
    await saveSecondaryStandEvidence(path, png, async (saved) => {
      assert.equal(saved, path);
      assert.deepEqual(await readFile(saved), png);
      called = true;
    });
    assert.equal(called, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('an attachment failure cannot discard the already written image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'a12-save-'));
  try {
    const path = join(dir, 'day-450-front.png');
    const failure = new Error('Reporter stopped');
    await assert.rejects(
      saveSecondaryStandEvidence(path, png, async () => {
        throw failure;
      }),
      failure,
    );
    assert.deepEqual(await readFile(path), png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('write failure is reported without claiming an attachment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'a12-save-'));
  try {
    const path = join(dir, 'missing', 'image.png');
    let called = false;
    await assert.rejects(
      saveSecondaryStandEvidence(path, png, async () => {
        called = true;
      }),
      { code: 'ENOENT' },
    );
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('duplicate writes do not overwrite previous evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'a12-save-'));
  try {
    const path = join(dir, 'day-450-front.png');
    await saveSecondaryStandEvidence(path, png, async () => {});
    await assert.rejects(
      saveSecondaryStandEvidence(path, Buffer.from('replacement'), async () => {}),
      { code: 'EEXIST' },
    );
    assert.deepEqual(await readFile(path), png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
