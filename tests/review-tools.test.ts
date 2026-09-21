import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PresentationReview, reviewFrame } from '../src/rendering/presentation-review.ts';
import {
  ReferenceEvidenceStore,
  referenceCapture,
  REFERENCE_AUDIT_LIMIT,
} from '../src/ui/reference-evidence.ts';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
const directory = mkdtempSync(join(tmpdir(), 'apex-review-test-'));
const source = 'a'.repeat(64);
const cli = (...args: string[]) =>
  spawnSync(
    process.execPath,
    ['--experimental-transform-types', resolve('scripts/phase27e-review.ts'), ...args],
    { encoding: 'utf8', timeout: 15000 },
  );
const save = (name: string, value: unknown) => {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe('Phase 27E evidence command line', () => {
  it('recomputes raw observations, enforces source identity and gives strict failures for interrupted captures', () => {
    const review = new PresentationReview();
    review.start(
      {
        source,
        machine: 'Synthetic CLI fixture, not hardware',
        browser: 'fixture',
        configuration: '{}',
        workload: 'clear-day',
        camera: 'chase',
        mode: 'full-lap',
        trackLength: 1000,
        startS: 0,
        startLaps: 0,
        startTime: 0,
        followedCar: 0,
        videoRequested: false,
      },
      0,
    );
    const frame = reviewFrame();
    frame.time = 1;
    frame.s = 10;
    review.record(1000, frame);
    review.interrupt('Controlled partial fixture');
    const path = save('partial.json', review.report());
    const valid = cli('presentation', path, source);
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout).budget.state).toBe('unmeasured');
    expect(cli('presentation', path, source, '--strict').status).toBe(1);
    expect(cli('presentation', path, 'b'.repeat(64)).status).toBe(2);
    expect(
      cli(
        'presentation',
        save('forged.json', { ...review.report(), state: 'complete', reason: null }),
        source,
      ).status,
    ).toBe(2);
  });
  it('verifies actual counterpart PNG bytes without converting declarations into art certification', async () => {
    const store = new ReferenceEvidenceStore();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=',
      'base64',
    );
    const name = 'apex-reference-002-fixture.png';
    writeFileSync(join(directory, name), png);
    const capture = await referenceCapture(
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      2,
      {
        source,
        imageFile: name,
        capturedAt: '2026-09-21T00:00:00Z',
        simulationTime: 1,
        width: 1,
        height: 1,
        view: 'Synthetic PNG verifier fixture, not game art',
      },
    );
    store.capture(2, capture);
    store.decide(2, 'accepted', 'fixture', 'Tests reviewer declaration only', source);
    const path = save('audit.json', store.export(source));
    const result = cli('references', path, source, directory);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.checked).toHaveLength(100);
    expect(output.applicableAccepted).toBe(1);
    expect(output.reviewerDeclarationsNotCertification).toBe(true);
    expect(cli('references', path, source, directory, '--strict').status).toBe(1);
    png[png.length - 1] ^= 1;
    writeFileSync(join(directory, name), png);
    expect(cli('references', path, source, directory).status).toBe(2);
  });
  it('round-trips all 100 maximum-length reviewer records within the declared import bound', () => {
    const store = new ReferenceEvidenceStore();
    for (const entry of REFERENCES) {
      store.capture(entry.id, {
        source,
        referenceHash: entry.sha256,
        imageHash: 'c'.repeat(64),
        imageFile: `apex-${entry.id}.png`,
        capturedAt: '2026-09-21T00:00:00Z',
        simulationTime: 1,
        width: 1,
        height: 1,
        view: '\\'.repeat(6000),
      });
      store.decide(
        entry.id,
        store.get(entry.id, source).status,
        '\\'.repeat(80),
        '\\'.repeat(2000),
        source,
      );
    }
    const raw = JSON.stringify(store.export(source), null, 2);
    expect(Buffer.byteLength(raw)).toBeLessThan(REFERENCE_AUDIT_LIMIT);
    const restored = new ReferenceEvidenceStore();
    restored.replace(raw);
    expect(restored.export(source)).toEqual(store.export(source));
  });
});
