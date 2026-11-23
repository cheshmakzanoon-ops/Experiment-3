import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LensBloomPass } from '../../src/rendering/lens-bloom.ts';

/** Pass a measured one-pixel metal glint and a resolved 16-pixel lamp face
 * through the production HDR pipeline. Meter the light falling outside each. */
export function captureGpFloodlightGlare() {
  const width = 192,
    height = 96;
  const renderer = new T.WebGLRenderer();
  renderer.setSize(width, height, false);
  const target = new T.WebGLRenderTarget(width, height, {
    type: T.HalfFloatType,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    depthBuffer: false,
  });
  const source = new T.ShaderMaterial({
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `void main(){
      vec2 p=floor(gl_FragCoord.xy);
      float value=0.02;
      if(all(equal(p,vec2(38.0,48.0)))) value=9000.0;
      if(max(abs(p.x-141.5),abs(p.y-47.5))<8.0) value=24.0;
      gl_FragColor=vec4(vec3(value),1.0);
    }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(source),
    bloom = new LensBloomPass();
  bloom.setSize(width, height);
  const half = new Uint16Array(width * height * 4);
  function sample(gp: boolean) {
    renderer.setRenderTarget(target);
    quad.render(renderer);
    bloom.gpFloodlights = gp;
    bloom.render(renderer, target, target);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, half);
    let glintHalo = 0,
      lampHalo = 0;
    for (let y = 24; y <= 72; y++)
      for (let x = 16; x <= 165; x++) {
        const glintDistance = Math.hypot(x - 38, y - 48);
        const lampDistance = Math.max(Math.abs(x - 141.5), Math.abs(y - 47.5));
        const glow = Math.max(0, T.DataUtils.fromHalfFloat(half[(y * width + x) * 4]) - 0.02);
        if (glintDistance >= 2 && glintDistance <= 15) glintHalo += glow;
        if (lampDistance > 8 && lampDistance < 17) lampHalo += glow;
      }
    return { glintHalo, lampHalo };
  }
  try {
    const original = sample(false),
      gp = sample(true),
      restored = sample(false);
    return { original, gp, restored, glError: renderer.getContext().getError() };
  } finally {
    target.dispose();
    source.dispose();
    quad.dispose();
    bloom.dispose();
    renderer.dispose();
  }
}
