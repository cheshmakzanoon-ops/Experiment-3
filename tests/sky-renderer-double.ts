import * as T from 'three';

/** CPU ownership double, not a rasterizer. Real shader compilation and browser
 * captures must be reported separately from these transaction/clock tests. */
export function skyRendererDouble() {
  const state = {
    target: null as T.WebGLRenderTarget | null,
    face: 2,
    mip: 1,
    viewport: new T.Vector4(3, 4, 32, 24),
    scissor: new T.Vector4(1, 2, 16, 12),
    scissorTest: true,
    failBlend: false,
    blends: [] as { target: T.WebGLRenderTarget | null; weight: number }[],
  };
  const renderer = {
    xr: { enabled: true },
    autoClear: false,
    toneMapping: T.ACESFilmicToneMapping,
    compile: () => {},
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip,
    getViewport: (out: T.Vector4) => out.copy(state.viewport),
    getScissor: (out: T.Vector4) => out.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    setRenderTarget: (target: T.WebGLRenderTarget | null, face = 0, mip = 0) => {
      state.target = target;
      state.face = face;
      state.mip = mip;
    },
    setViewport: (value: T.Vector4) => state.viewport.copy(value),
    setScissor: (value: T.Vector4) => state.scissor.copy(value),
    setScissorTest: (value: boolean) => {
      state.scissorTest = value;
    },
    render: (quad: T.Mesh<T.BufferGeometry, T.RawShaderMaterial>) => {
      state.blends.push({ target: state.target, weight: quad.material.uniforms.skyWeight.value });
      if (state.failBlend) throw new Error('Injected sky blend failure');
    },
  };
  return { renderer: renderer as unknown as T.WebGLRenderer, state };
}
