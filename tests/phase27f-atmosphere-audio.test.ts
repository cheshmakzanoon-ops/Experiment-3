import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkyEnvironment, configureSky } from '../src/rendering/daylight.ts';
import { ReviewAudioTap } from '../src/audio/review-tap.ts';

afterEach(() => vi.restoreAllMocks());
it('captures independent day/night environment identities and restores the live night mode after errors', () => {
  const sky = new Sky();
  configureSky(sky);
  sky.material.uniforms.nightAmount.value = 1;
  const modes: number[] = [],
    disposals: ReturnType<typeof vi.spyOn>[] = [];
  vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation(() => {
    modes.push(sky.material.uniforms.nightAmount.value);
    const target = new T.WebGLRenderTarget(2, 2);
    disposals.push(vi.spyOn(target, 'dispose'));
    return target;
  });
  vi.spyOn(T.PMREMGenerator.prototype, 'dispose').mockImplementation(() => {});
  const env = new SkyEnvironment(sky),
    scene = new T.Scene(),
    renderer = { compile: vi.fn() } as unknown as T.WebGLRenderer;
  expect(env.update(renderer, scene, 0.6, false)).toBe(true);
  expect(env.update(renderer, scene, 0.6, true)).toBe(true);
  expect(env.update(renderer, scene, 0.6, true)).toBe(false);
  expect(env.update(renderer, scene, 0.6, false)).toBe(true);
  expect(modes).toEqual([0, 1, 0]);
  expect(sky.material.uniforms.nightAmount.value).toBe(1);
  const before = scene.environment;
  vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementationOnce(() => {
    throw new Error('Failed night capture');
  });
  expect(() => env.update(renderer, scene, 0.6, true)).toThrow('Failed night');
  expect(scene.environment).toBe(before);
  expect(sky.material.uniforms.nightAmount.value).toBe(1);
  expect(env.captures).toBe(3);
  env.dispose();
  expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  sky.geometry.dispose();
  sky.material.dispose();
});
it('the opt-in audio tap disconnects only its own destination and releases each track once', () => {
  const track = { stop: vi.fn() };
  const destination = { stream: { getTracks: () => [track] }, disconnect: vi.fn() };
  const context = { state: 'running', createMediaStreamDestination: vi.fn(() => destination) };
  const output = { connect: vi.fn(), disconnect: vi.fn() };
  const tap = new ReviewAudioTap(
    context as unknown as AudioContext,
    output as unknown as AudioNode,
  );
  expect(tap.stream).toBe(destination.stream);
  expect(output.connect).toHaveBeenCalledWith(destination);
  tap.release();
  tap.release();
  expect(output.disconnect).toHaveBeenCalledExactlyOnceWith(destination);
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(destination.disconnect).toHaveBeenCalledTimes(1);
});
it('releases destination tracks on a failed connection and rejects uninitialized/suspended audio', () => {
  const stop = vi.fn(),
    destination = { stream: { getTracks: () => [{ stop }] } };
  const context = { state: 'running', createMediaStreamDestination: vi.fn(() => destination) };
  const output = {
    connect: vi.fn(() => {
      throw new Error('Tap refused');
    }),
  };
  expect(
    () => new ReviewAudioTap(context as unknown as AudioContext, output as unknown as AudioNode),
  ).toThrow('Tap refused');
  expect(stop).toHaveBeenCalledTimes(1);
  context.state = 'suspended';
  expect(
    () => new ReviewAudioTap(context as unknown as AudioContext, output as unknown as AudioNode),
  ).toThrow('not running');
  expect(context.createMediaStreamDestination).toHaveBeenCalledTimes(1);
});
