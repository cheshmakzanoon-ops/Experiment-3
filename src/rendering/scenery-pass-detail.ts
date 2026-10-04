import {
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector4,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { cameraDetailDistance } from './camera-detail.ts';

/** Equivalent 58-degree main-view distance, using the actual pass's texel scale.
 * The near sun map can retain detailed silhouettes while a whole-circuit map
 * uses far geometry. This only chooses an existing range; it never hides casters.
 */
export function sceneryPassDistance(
  distance: number,
  camera: Camera,
  pixelWidth: number,
  pixelHeight: number,
  viewHeight: number,
): number {
  if (
    ![distance, pixelWidth, pixelHeight, viewHeight].every(Number.isFinite) ||
    distance < 0 ||
    Math.min(pixelWidth, pixelHeight, viewHeight) <= 0
  )
    throw new Error('Invalid scenery pass dimensions');
  if (camera instanceof PerspectiveCamera)
    return cameraDetailDistance(distance, camera) * Math.max(1, viewHeight / pixelHeight);
  if (camera instanceof OrthographicCamera) {
    const width = (camera.right - camera.left) / camera.zoom;
    const height = (camera.top - camera.bottom) / camera.zoom;
    if (
      ![width, height, camera.zoom].every(Number.isFinite) ||
      Math.min(width, height, camera.zoom) <= 0
    )
      throw new Error('Invalid orthographic scenery lens');
    // Use the finer of the two axes, conservatively retaining detail in an
    // asymmetric shadow viewport. Point-light atlas faces use their own viewport.
    const metresPerPixel = Math.min(width / pixelWidth, height / pixelHeight);
    return (metresPerPixel * viewHeight) / (2 * Math.tan((58 * Math.PI) / 360));
  }
  throw new Error('Unsupported scenery pass camera');
}

/** Per-owner scratch storage; no vectors or geometry are allocated per draw. */
export class SceneryPassDetail {
  private readonly viewport = new Vector4();
  private readonly drawingSize = new Vector2();
  distance(distance: number, camera: Camera, renderer: WebGLRenderer): number {
    renderer.getCurrentViewport(this.viewport);
    renderer.getDrawingBufferSize(this.drawingSize);
    return sceneryPassDistance(
      distance,
      camera,
      this.viewport.z,
      this.viewport.w,
      this.drawingSize.y,
    );
  }
}
