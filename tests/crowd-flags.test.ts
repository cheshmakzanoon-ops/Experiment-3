import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  COHORT_SHARE,
  CROWD_NEUTRALS,
  CROWD_PALETTE,
  CROWD_TEAM_COLOURS,
  FLAG_EVERY,
  FLAG_RANGE,
  buildCrowdFlags,
  crowdColour,
  flagGeometry,
  flagMaterial,
} from '../src/rendering/studio/crowd-flags.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

describe('crowd palette', () => {
  it('has 14 colours, half of the picks in team kits', () => {
    expect(CROWD_PALETTE).toHaveLength(14);
    expect(CROWD_TEAM_COLOURS.map((c) => c.toString(16).padStart(6, '0'))).toEqual([
      'c8102e',
      'ff8000',
      '1e3a8a',
      'f2f2f2',
      '0b6e4f',
      'ffd200',
      '111111',
      'e5007d',
    ]);
    for (const n of [0xe8e8e6, 0x3a4f6e, 0x1c1c1e]) expect(CROWD_NEUTRALS).toContain(n);
    let team = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = crowdColour((i * 0.618034) % 1, (i * 0.414214) % 1);
      expect(CROWD_PALETTE).toContain(c);
      if ((CROWD_TEAM_COLOURS as readonly number[]).includes(c)) team++;
    }
    expect(team / N).toBeGreaterThan(0.45);
    expect(team / N).toBeLessThan(0.55);
    expect(COHORT_SHARE).toBe(0.75);
  });
});

describe('crowd flags', () => {
  it('gives every 13th spectator a waving team flag, in one instanced draw', () => {
    const people = Array.from({ length: 260 }, (_, i) =>
      new T.Matrix4().makeTranslation(i * 0.65, 0, 0),
    );
    const material = flagMaterial();
    const flags = buildCrowdFlags(people, 55, material)!;
    expect(flags).toBeInstanceOf(T.InstancedMesh);
    expect(flags.count).toBe(260 / FLAG_EVERY);
    expect(flags.castShadow).toBe(false);
    for (let i = 0; i < flags.count; i++) {
      const c = new T.Color();
      flags.getColorAt(i, c);
      expect(CROWD_TEAM_COLOURS as readonly number[]).toContain(c.getHex());
    }
    expect(buildCrowdFlags([], 1, material)).toBeNull();
    const g = flagGeometry();
    expect(g.getAttribute('flagFly').count).toBe(g.getAttribute('position').count);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioTime).toBe(studioUniforms.studioTime);
    expect(shader.vertexShader).toContain('D21 flag wave');
    expect(shader.vertexShader).toContain(`> ${FLAG_RANGE.toFixed(1)} )`);
  });
});
