import { expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { screenImageDigest } from '../e2e/fixtures/motocross-screen-capture.ts';

it('rejects a cleared display and requires both visible Resume button samples for a pause photograph', () => {
  const viewport = { width: 80, height: 48 };
  const image = new PNG(viewport);
  const write = () => PNG.sync.write(image);
  image.data.fill(8);
  expect(screenImageDigest(write(), viewport)).toBeNull();

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      image.data.set([x * 3, y * 4, 32, 255], i);
    }
  }
  expect(screenImageDigest(write(), viewport)).toHaveLength(64);
  const button = { x: [14, 54], y: 8, rgb: [250, 180, 42] };
  expect(screenImageDigest(write(), viewport, button)).toBeNull();
  const paintButton = (x: number) =>
    image.data.set([...button.rgb, 255], (button.y * image.width + x) * 4);
  paintButton(button.x[0]);
  expect(screenImageDigest(write(), viewport, button)).toBeNull();
  paintButton(button.x[1]);
  expect(screenImageDigest(write(), viewport, button)).toHaveLength(64);
  expect(() => screenImageDigest(write(), { width: 40, height: 48 })).toThrow('viewport');
});
