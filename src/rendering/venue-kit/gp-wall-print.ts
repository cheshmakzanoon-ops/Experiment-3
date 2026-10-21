import * as T from 'three';
import { canvasTexture } from '../geometry.ts';
import { drawWordmark, fitHeight } from '../studio/brand-atlas.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Printed advertising boards on GP venue walls (REF_018/031/037/056: the
 * walls are lined with continuous partner boards, never bare concrete).
 * Boards are 8 m long with a 0.25 m joint, 0.78 m tall above a 0.12 m
 * plinth. Each board's partner comes from its own station, so held frames
 * and replays are exact. Original fictional partners only. */
export const GP_WALL_BOARD = Object.freeze({ length: 8, joint: 0.25, base: 0.12, height: 0.78 });

const BOARDS = [
  ['APEX CORSA', '#a9262b', '#f1efe8'],
  ['ORBITEL', '#1d3f80', '#f1efe8'],
  ['SLICK 18', '#151719', '#efc23a'],
  ['MERIDIAN OIL', '#e6e3da', '#1b2a33'],
] as const;

function boardAtlas() {
  if (typeof document === 'undefined') {
    const blank = new T.DataTexture(new Uint8Array(4), 1, 1);
    blank.needsUpdate = true;
    return blank;
  }
  const texture = canvasTexture(2048, 512, (c) => {
    BOARDS.forEach(([name, ground, ink], b) => {
      const top = (3 - b) * 128,
        style = { weight: 0.2, width: 0.9, tracking: 0.14, slant: 0.12, corner: 0.08 };
      c.fillStyle = ground;
      c.fillRect(0, top, 2048, 128);
      c.fillStyle = ink;
      c.fillRect(0, top + 6, 2048, 4);
      c.fillRect(0, top + 118, 2048, 4);
      c.strokeStyle = ink;
      // Two repeats per board, as boards are read at speed from either end.
      for (const x of [512, 1536])
        drawWordmark(c, name, x, top + 64 - 30, fitHeight(name, 820, 60, style), style);
    });
  });
  texture.wrapS = T.RepeatWrapping;
  texture.userData.textureBudgetScale = 2;
  return texture;
}

/** Install the board print on a wall material whose geometry carries
 * uv = (station / 5, height / 5), oriented to read from the circuit. */
export function installGpWallPrint(material: T.MeshStandardMaterial) {
  const atlas = boardAtlas();
  material.userData.gpWallPrint = atlas;
  material.addEventListener('dispose', () => atlas.dispose());
  return chainShaderHook(material, 'gp-wall-print-v1', (shader) => {
    shader.uniforms.gpWallBoards = { value: atlas };
    injectDeclarations(shader, 'common', 'varying vec2 vGpWallMetres;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpWallMetres = uv * 5.;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      'uniform sampler2D gpWallBoards;\nvarying vec2 vGpWallMetres;',
      'fragment',
    );
    const b = GP_WALL_BOARD,
      pitch = (b.length + b.joint).toFixed(3);
    injectAfter(
      shader,
      'color_fragment',
      `{
  float along = vGpWallMetres.x / ${pitch};
  float board = floor(along);
  float local = fract(along) * ${pitch};
  float row = floor(fract(sin(board * 12.9898 + 4.1) * 43758.5453) * 4.);
  vec2 boardUv = vec2(local / ${b.length.toFixed(1)}, (vGpWallMetres.y - ${b.base.toFixed(2)}) / ${b.height.toFixed(2)});
  float covered = step(local, ${b.length.toFixed(1)}) * step(0., boardUv.y) * step(boardUv.y, 1.);
  vec4 print = texture2D(gpWallBoards, vec2(boardUv.x, (row + clamp(boardUv.y, 0., 1.)) / 4.));
  // Printed vinyl over concrete: slightly darker where the plinth splashes it.
  diffuseColor.rgb = mix(diffuseColor.rgb, print.rgb * (.86 + .14 * smoothstep(.0, .3, boardUv.y)), covered);
}`,
      'fragment',
    );
  });
}
