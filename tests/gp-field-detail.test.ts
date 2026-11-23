import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { gpOpponentDetail } from '../src/rendering/gp-field-detail.ts';

const bike = new Vector3();
function view(fov = 50) {
  const camera = new PerspectiveCamera(fov, 16 / 9, 0.03, 2000);
  camera.position.set(25, 4, 50);
  camera.lookAt(bike);
  camera.updateWorldMatrix(true, false);
  return camera;
}

it('retains close mechanical detail when a broadcast lens or a larger framebuffer resolves it', () => {
  const camera = view();
  expect(gpOpponentDetail(camera, bike, 576, -1)).toBe(1);
  expect(gpOpponentDetail(camera, bike, 2160, -1)).toBe(0);
  expect(gpOpponentDetail(view(8), bike, 576, -1)).toBe(0);
  expect(gpOpponentDetail(camera, bike, 240, -1)).toBe(2);
});

it('holds both transition bands, including off-axis riders after the camera turns', () => {
  const camera = view();
  // Normalised camera space fixes projected depth when a rider moves laterally.
  const atSpan = (pixels: number, lateral = 0) => {
    const depth = 1.12 + (720 * camera.projectionMatrix.elements[5] * 1.12) / pixels;
    return new Vector3(lateral, 0, -depth).applyMatrix4(camera.matrixWorld);
  };
  for (const lateral of [0, 6]) {
    expect(gpOpponentDetail(camera, atSpan(84, lateral), 720, 0)).toBe(0);
    expect(gpOpponentDetail(camera, atSpan(84, lateral), 720, 1)).toBe(1);
    expect(gpOpponentDetail(camera, atSpan(19, lateral), 720, 1)).toBe(1);
    expect(gpOpponentDetail(camera, atSpan(19, lateral), 720, 2)).toBe(2);
  }
});
