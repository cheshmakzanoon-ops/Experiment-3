import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SceneAmbientPass } from '../../src/rendering/scene-ambient-pass.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import type { TemporalAA } from '../../src/rendering/studio/temporal-aa.ts';

type HistoryOwner = { history: [T.WebGLRenderTarget, T.WebGLRenderTarget] };
const vertexShader = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Real production scene/TAA/composite shaders. This tiny scene has a moving
 * foreground plane and a high-variance background: colour clipping alone
 * cannot identify which surface occupied a pixel in the previous frame.
 * The control changes history DEPTH only, preserving the exact history RGB.
 * These are correctness captures, not a gameplay or GPU performance benchmark. */
export function capture() {
  const width = 160,
    height = 96;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context: gl });
  if (!renderer.extensions.has('EXT_color_buffer_float'))
    throw new Error('Temporal depth fixture requires float colour attachments');
  renderer.setSize(width, height, false);
  renderer.toneMapping = T.NoToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0.18, 0.24, 0.32);
  const camera = new T.PerspectiveCamera(60, width / height, 0.3, 26000);
  camera.updateMatrixWorld(true);
  const checker = new T.ShaderMaterial({
    name: 'Temporal fixture checker',
    vertexShader,
    fragmentShader: /* glsl */ `
      void main() {
        float checker = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
        gl_FragColor = vec4(vec3(mix(0.12, 0.82, checker)), 1.0);
      }
    `,
    toneMapped: false,
  });
  const grey = new T.MeshBasicMaterial({ color: new T.Color(0.46, 0.46, 0.46), toneMapped: false });
  const backdrop = new T.Mesh<T.PlaneGeometry, T.Material>(new T.PlaneGeometry(30, 30), checker);
  backdrop.position.z = -10;
  const foreground = new T.Mesh<T.PlaneGeometry, T.Material>(new T.PlaneGeometry(2, 4), grey);
  foreground.position.z = -4;
  scene.add(backdrop, foreground);
  const pass = new SceneAmbientPass(scene, camera, 0),
    control = new SceneAmbientPass(scene, camera, 0);
  for (const p of [pass, control]) {
    p.ambientOcclusion = false;
    p.temporal.enabled = true;
    p.setSize(width, height);
  }
  const target = () =>
    new T.WebGLRenderTarget(width, height, {
      type: T.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  const output = target(),
    controlOutput = target(),
    scratch = target();
  const copy = new T.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:
      'uniform sampler2D source; uniform float forcedDepth; varying vec2 vUv; void main(){vec4 c=texture2D(source,vUv); gl_FragColor=vec4(c.rgb,forcedDepth>=0.0?forcedDepth:c.a);}',
    uniforms: { source: { value: null }, forcedDepth: { value: -1 } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: T.NoBlending,
  });
  const quad = new FullScreenQuad(copy);
  const history = (taa: TemporalAA) => (taa as unknown as HistoryOwner).history[0];
  const read = (target: T.WebGLRenderTarget) => {
    const values = new Uint16Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, values);
    return Float32Array.from(values, T.DataUtils.fromHalfFloat);
  };
  const draw = (p = pass, write = output, dt = 1 / 60) => {
    studioUniforms.studioFrameDt.value = dt;
    camera.updateMatrixWorld(true);
    p.render(renderer, write);
    return read(write);
  };
  const reset = () => {
    pass.temporal.reset();
    control.temporal.reset();
    studioUniforms.studioCarCount.value = 0;
    foreground.visible = true;
    foreground.material = grey;
    foreground.position.set(0, 0, -4);
    foreground.rotation.set(0, 0, 0);
    foreground.scale.set(1, 1, 1);
    backdrop.visible = true;
    backdrop.position.z = -10;
    backdrop.scale.setScalar(1);
    backdrop.material = checker;
  };
  const compare = (
    actual: Float32Array,
    expected: Float32Array,
    cx = width / 2,
    cy = height / 2,
    radius = 8,
  ) => {
    let maximum = 0,
      total = 0,
      pixels = 0;
    for (let y = Math.floor(cy - radius); y < Math.floor(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x < Math.floor(cx + radius); x++) {
        const p = (y * width + x) * 4;
        let difference = 0;
        for (let c = 0; c < 3; c++) difference += Math.abs(actual[p + c] - expected[p + c]);
        maximum = Math.max(maximum, difference / 3);
        total += difference / 3;
        pixels++;
      }
    return { maximum, mean: total / pixels, pixels };
  };
  const image = (texture: T.Texture) => {
    copy.uniforms.source.value = texture;
    copy.uniforms.forcedDepth.value = 1;
    renderer.setRenderTarget(null);
    quad.render(renderer);
    return canvas.toDataURL('image/png');
  };
  const images: Record<string, string> = {};

  reset();
  const first = draw();
  const firstCapture = compare(first, read(pass.target));
  const firstDepth = read(history(pass.temporal))[((height / 2) * width + width / 2) * 4 + 3];
  draw(control, controlOutput);
  // Identical colour history, but claim that it came from the background.
  // No shader text or rejection threshold is altered for this control.
  copy.uniforms.source.value = history(control.temporal).texture;
  copy.uniforms.forcedDepth.value = 10;
  renderer.setRenderTarget(scratch);
  quad.render(renderer);
  copy.uniforms.source.value = scratch.texture;
  renderer.setRenderTarget(history(control.temporal));
  quad.render(renderer);
  images.before = image(output.texture);
  foreground.visible = false;
  const revealed = draw(),
    current = read(pass.target);
  const wrongDepth = draw(control, controlOutput);
  const disocclusion = compare(revealed, current),
    depthControl = compare(wrongDepth, current);
  images.current = image(pass.target.texture);
  images.rejected = image(output.texture);
  images.wrongDepthControl = image(controlOutput.texture);

  reset();
  foreground.visible = false;
  backdrop.material = grey;
  draw();
  backdrop.material = checker;
  const compatible = draw(),
    compatibleCurrent = read(pass.target);
  const accumulation = compare(compatible, compatibleCurrent);

  reset();
  // A small rigid vehicle-like panel moves toward and across the camera.
  // Comparing against current view distance would reject its valid old surface.
  foreground.scale.set(0.4, 0.2, 1);
  foreground.position.set(-0.25, 0.6, -4);
  const chassis = () => {
    foreground.updateMatrixWorld(true);
    studioUniforms.studioCarCount.value = 1;
    studioUniforms.studioCarNow.value[0].compose(
      foreground.position,
      foreground.quaternion,
      new T.Vector3(1, 1, 1),
    );
    studioUniforms.studioCarPose.value[0].set(
      foreground.position.x,
      foreground.position.z,
      foreground.rotation.y,
      0,
    );
  };
  chassis();
  draw();
  foreground.position.set(0.5, 0.6, -3.5);
  foreground.rotation.y = 0.1;
  foreground.material = checker;
  chassis();
  const rigid = draw(),
    rigidCurrent = read(pass.target);
  const center = foreground.position.clone().project(camera);
  const rigidAccumulation = compare(
    rigid,
    rigidCurrent,
    (center.x * 0.5 + 0.5) * width,
    (center.y * 0.5 + 0.5) * height,
    3,
  );
  images.rigid = image(output.texture);

  reset();
  backdrop.visible = false;
  draw();
  foreground.visible = false;
  const sky = draw();
  const skyError = compare(sky, read(pass.target));
  const skyHistory = read(history(pass.temporal));
  const skyDepth = skyHistory[((height / 2) * width + width / 2) * 4 + 3];
  const heldA = draw(pass, output, 0),
    heldB = draw(pass, output, 0);
  const heldDifference = compare(heldA, heldB);
  const resumed = draw();
  const resumedError = compare(resumed, read(pass.target));

  reset();
  foreground.visible = false;
  backdrop.material = grey;
  backdrop.position.z = -24000;
  backdrop.scale.setScalar(3000);
  const distant = draw();
  const distantHistory = read(history(pass.temporal));
  const farDepth = distantHistory[((height / 2) * width + width / 2) * 4 + 3];
  const alphaValues = [first, revealed, compatible, rigid, sky, heldA, resumed, distant].flatMap(
    (buffer) => Array.from(buffer).filter((_, i) => i % 4 === 3),
  );
  const finite = [revealed, compatible, rigid, sky, distant, distantHistory].every((buffer) =>
    buffer.every(Number.isFinite),
  );
  const diagnostics = pass.temporal.diagnostics();
  const glErrors: number[] = [];
  for (
    let i = 0, error = gl.getError();
    error !== gl.NO_ERROR && i < 16;
    i++, error = gl.getError()
  )
    glErrors.push(error);
  const backend = renderer.getContext().getParameter(gl.RENDERER) as string;
  pass.dispose();
  control.dispose();
  for (const target of [output, controlOutput, scratch]) target.dispose();
  for (const mesh of [backdrop, foreground]) mesh.geometry.dispose();
  checker.dispose();
  grey.dispose();
  copy.dispose();
  quad.dispose();
  studioUniforms.studioCarCount.value = 0;
  studioUniforms.studioFrameDt.value = 0;
  renderer.dispose();
  return {
    images,
    backend,
    width,
    height,
    firstCapture,
    firstDepth,
    disocclusion,
    depthControl,
    accumulation,
    rigidAccumulation,
    skyError,
    skyDepth,
    heldDifference,
    resumedError,
    farDepth,
    opaqueOutput: alphaValues.every((value) => value === 1),
    finite,
    diagnostics,
    glErrors,
    contextAlive: !gl.isContextLost(),
  };
}
