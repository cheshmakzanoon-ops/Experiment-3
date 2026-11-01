import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Track } from '../../src/simulation/track.ts';
import { decodeTrackBoards } from '../../src/rendering/track-boards.ts';

export const a09Bytes = () => new Uint8Array(readFileSync('public/models/aurel-track-boards.glb'));
export function a09SyntheticPixels(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4);
  return data;
}
/** CPU drawing-command/row-order seam only. These synthetic pixels are NOT
 * original numeral rasterization and never constitute image/GPU evidence. */
export function installA09CanvasFixture() {
  const records: { canvas: HTMLCanvasElement; commands: unknown[][]; reads: unknown[][] }[] = [];
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error('Unexpected canvas fixture element');
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement,
      commands: unknown[][] = [],
      reads: unknown[][] = [];
    const target: Record<string, unknown> = {};
    for (const name of [
      'fillRect',
      'strokeRect',
      'save',
      'restore',
      'translate',
      'transform',
      'beginPath',
      'rect',
      'clip',
      'moveTo',
      'lineTo',
      'arcTo',
      'stroke',
      'closePath',
      'fill',
    ])
      target[name] = (...args: unknown[]) => commands.push([name, ...args]);
    target.getImageData = (...args: unknown[]) => {
      reads.push(args);
      return {
        data: a09SyntheticPixels(canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height,
      };
    };
    const context = new Proxy(target, {
      set(object, key, value) {
        commands.push([String(key), value]);
        return Reflect.set(object, key, value);
      },
    });
    canvas.getContext = vi.fn(() => context) as unknown as HTMLCanvasElement['getContext'];
    records.push({ canvas, commands, reads });
    return canvas;
  });
  vi.stubGlobal('document', {
    createElement,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return { records, createElement };
}
/** NullEngine allocation seam emulates the specified sRGB storage flag only. */
export function allocateA09Texture(data: Uint8Array, width: number, height: number, scene: Scene) {
  const texture = new RawTexture(
    data,
    width,
    height,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    0,
    true,
  );
  texture.getInternalTexture()!._useSRGBBuffer = true;
  texture.gammaSpace = false;
  return texture;
}
/** Unchanged Three kit is an independent construction oracle. Its source texture
 * placeholders deliberately make no source-pixel comparison claim. */
export async function originalA09Triplet(track: Track) {
  const loader = new GLTFLoader().register(() => ({
    name: 'A09_CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
  const kit = await decodeTrackBoards(a09Bytes(), loader, () => new T.Texture());
  const parent = new T.Group();
  kit.build(track, parent);
  parent.updateMatrixWorld(true);
  const parts: {
    mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
    text: string;
    station: number;
    kind: 'structure' | 'print';
  }[] = [];
  for (const [station, text] of [
    [420, '150'],
    [470, '100'],
    [520, '50'],
  ] as const) {
    const group = kit.root.getObjectByName(`A09 ${text} ${station}m LOD0`);
    if (!group) throw new Error('Original triplet missing');
    for (const child of group.children)
      if (child instanceof T.Mesh)
        parts.push({
          mesh: child,
          text,
          station,
          kind: child.name.endsWith('structure') ? 'structure' : 'print',
        });
  }
  return { kit, parts, dispose: () => kit.dispose() };
}
