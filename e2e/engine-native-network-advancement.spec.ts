import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-network-advancement.ts';

type NativeWindow = Window & { EngineNativeNetworkAdvancement: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const bundled = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-network-advancement.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeNetworkAdvancement',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = bundled.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_network_advancement__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine transfer ownership</title>',
    }),
  );
  await page.goto('/__engine_native_network_advancement__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native transfers preserve snapshot recipients, input accounting and corrected playback', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeNetworkAdvancement.transferredRace(),
  );
  await info.attach('native-network-advancement.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  expect(report.simulatedMs).toBe(5000);
  expect(report.server.phase).toBe('race');
  expect(report.server.tick).toBeGreaterThan(500);
  expect(report.server.invalidMessages).toBe(0);
  expect(report.server.transportErrors).toBe(0);
  expect(report.server.kicks).toEqual([]);
  expect(report.wire.packets).toBeGreaterThan(700);
  expect(report.wire.detached).toBe(report.wire.packets);
  expect(report.wire.received).toBe(report.wire.packets);
  expect(report.wire.uniqueReceivedBuffers).toBe(report.wire.packets);
  expect(report.wire.matchedBytes).toBe(report.wire.sentBytes);
  expect(report.wire.matchedBytes).toBeGreaterThan(80000);
  expect(report.wire.senderViewsRemainDetached).toBe(true);
  expect(report.wire.retainedReceivers).toBe(6);
  expect(report.wire.retainedReceiversUnchanged).toBe(true);
  expect(report.wire.dropped).toBe(3);

  // Independent MessagePorts need not dispatch their initial joins in peer order.
  expect(report.peers.map((peer) => peer.car).sort()).toEqual([0, 1, 2]);
  const ticks = report.peers[0].headers.map((header) => header.tick);
  expect(ticks.length).toBeGreaterThan(90);
  for (const peer of report.peers) {
    expect(peer.state).toBe('race');
    expect(peer.invalidMessages).toBe(0);
    expect(peer.headers.map((header) => header.tick)).toEqual(ticks);
    expect(peer.headers.every((header) => header.bytes === 152)).toBe(true);
    expect(
      peer.headers.every((header) => header.full.length === 1 && header.full[0] === peer.car),
    ).toBe(true);
    expect(peer.inputPackets).toBe(peer.sentInputLengths.length);
    expect(peer.recordedInputLengths).toEqual(peer.sentInputLengths);
    expect(peer.recordedInputTotal).toBe(peer.actualInputTotal);
    expect(peer.actualInputTotal).toBeGreaterThan(10000);
    expect(peer.commandCopies).toBeGreaterThan(peer.commands);
    expect(peer.ack).toBeGreaterThan(200);
    expect(peer.playback).toMatchObject({ bounded: true, rawCommandTargetErrors: 0 });
    expect(peer.playback.frames).toBeGreaterThan(250);
  }
  const affected = report.peers[0];
  expect(affected.playback.rawRewinds).toBeGreaterThan(0);
  expect(affected.playback.correctionFrames).toBeGreaterThan(20);
  const lossy = report.peers[1];
  expect(lossy.initiallyDroppedSequences.length).toBeGreaterThan(0);
  expect(lossy.recoveredDroppedSequences).toEqual(lossy.droppedSequences);
  expect(lossy.ack).toBeGreaterThan(Math.max(...lossy.initiallyDroppedSequences));
  const lossyServerInput = report.server.inputs.find((input) => input.car === lossy.car);
  expect(lossyServerInput?.duplicates).toBeGreaterThan(0);
  expect(lossyServerInput?.rejected).toBe(0);
  expect(report.server.snapshots).toBe(ticks.length * 3);
  expect(report.cleanup).toEqual({ closedPorts: 6, pendingNative: 0, pendingEvents: 0 });
  expect(report.nativeErrors).toEqual([]);
  expect(errors).toEqual([]);
});
