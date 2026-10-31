import * as T from 'three';
import { SuppliedDrawRanges } from '../../src/rendering/supplied-draw-ranges.ts';
import { createWebGLRenderer } from '../../src/rendering/webgl-renderer.ts';

const WIDTH = 192;
const HEIGHT = 144;
const BLOCK_INDICES = 128 * 3;

function subject() {
  const position: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const blocks = [
    { x: -0.45, z: -3, color: [1, 0.15, 0.05] },
    { x: -0.25, z: 3, color: [0.05, 0.2, 1] },
    { x: 0, z: -4, color: [0.1, 1, 0.15] },
    { x: 0.25, z: 4, color: [1, 0.8, 0.1] },
    { x: 0.45, z: -5, color: [0.8, 0.1, 1] },
  ];
  for (const block of blocks)
    for (let triangle = 0; triangle < 128; triangle++) {
      const first = position.length / 3;
      // The transparent overlap makes preserving source triangle ordering
      // relevant, while complete blocks remain strictly behind either camera.
      position.push(
        block.x - 0.35,
        -0.4,
        block.z,
        block.x + 0.35,
        -0.4,
        block.z,
        block.x,
        0.4,
        block.z,
      );
      for (let vertex = 0; vertex < 3; vertex++) colors.push(...block.color);
      indices.push(first, first + 1, first + 2);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new T.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.04,
    side: T.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new T.Mesh(geometry, material);
  const scene = new T.Scene();
  scene.background = new T.Color(0x102030);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  const ranges = new SuppliedDrawRanges([{ mesh, geometries: [geometry] }], true);
  // A fixture-only observer reads the temporary handle, not its GPU contents,
  // before the ordinary after-hook restores the source geometry. It does not
  // replace the selector or intercept any GL/RAF operation.
  const after = mesh.onAfterRender;
  let submitted: { buffer: WebGLBuffer; count: number } | null = null;
  mesh.onAfterRender = (...args) => {
    const index = geometry.index as unknown as T.GLBufferAttribute;
    if (!index.isGLBufferAttribute) throw new Error('Expected an interior compacted selection');
    submitted = { buffer: index.buffer, count: geometry.drawRange.count };
    after.apply(mesh, args);
  };
  return {
    scene,
    geometry,
    material,
    mesh,
    ranges,
    sourceIndex: geometry.index!,
    sourceIndices: geometry.index!.array.slice(),
    sourcePosition: geometry.attributes.position,
    submitted: () => {
      if (!submitted) throw new Error('The real renderer did not submit the compacted subject');
      return submitted;
    },
    dispose() {
      ranges.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

function image(pixels: Uint8Array) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d')!;
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let row = 0; row < HEIGHT; row++)
    flipped.set(
      pixels.subarray(row * WIDTH * 4, (row + 1) * WIDTH * 4),
      (HEIGHT - 1 - row) * WIDTH * 4,
    );
  context.putImageData(new ImageData(flipped, WIDTH, HEIGHT), 0, 0);
  return canvas.toDataURL('image/png');
}

function readIndices(gl: WebGL2RenderingContext, buffer: WebGLBuffer, count: number) {
  const previous = gl.getParameter(gl.COPY_READ_BUFFER_BINDING) as WebGLBuffer | null;
  const output = new Uint32Array(count);
  try {
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, output);
  } finally {
    gl.bindBuffer(gl.COPY_READ_BUFFER, previous);
  }
  return Array.from(output);
}

/** Small actual-WebGL selection oracle, not a native crash/performance claim.
 * Production selectors, buffer allocation/size validation and hooks are used
 * unchanged. Readbacks occur only after draw completion, never in production. */
export function suppliedIndexPreupload() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const { renderer, context: gl } = createWebGLRenderer(canvas);
  renderer.setSize(WIDTH, HEIGHT, false);
  const target = new T.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true });
  const cameras = [
    { name: 'near', position: [0, 0, 0], look: [0, 0, -4], blocks: [0, 2, 4] },
    { name: 'far', position: [0, 0, 1], look: [0, 0, -4], blocks: [0, 2, 4] },
    { name: 'rear', position: [0, 0, 0], look: [0, 0, 4], blocks: [1, 3] },
  ].map((spec) => {
    const camera = new T.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 20);
    camera.position.fromArray(spec.position);
    camera.lookAt(new T.Vector3().fromArray(spec.look));
    camera.updateMatrixWorld(true);
    return { ...spec, camera };
  });
  const run = (prepare: boolean) => {
    const s = subject();
    const unchanged = () =>
      s.geometry.index === s.sourceIndex &&
      s.geometry.attributes.position === s.sourcePosition &&
      s.geometry.drawRange.start === 0 &&
      s.geometry.drawRange.count === Infinity &&
      s.mesh.material === s.material &&
      s.material.transparent &&
      s.material.side === T.DoubleSide &&
      s.sourceIndices.every((value, i) => s.sourceIndex.array[i] === value);
    try {
      const rows = cameras.map(({ name, camera, blocks }) => {
        const before = s.ranges.diagnostics().compacted;
        const prepared = prepare ? s.ranges.prepareCamera(renderer, s.scene, camera) : null;
        const afterPreparation = s.ranges.diagnostics().compacted;
        const prepassUnchanged = unchanged();
        renderer.info.reset();
        renderer.setRenderTarget(target);
        renderer.render(s.scene, camera);
        const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
        // This readback is the completion witness before diagnostic buffer reads.
        renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
        if (gl.isContextLost()) throw new Error('WebGL context lost during index preupload oracle');
        const afterDraw = s.ranges.diagnostics().compacted;
        const submitted = s.submitted();
        const selected = readIndices(gl, submitted.buffer, submitted.count);
        const expected = blocks.flatMap((block) =>
          Array.from(s.sourceIndices.slice(block * BLOCK_INDICES, (block + 1) * BLOCK_INDICES)),
        );
        const error = gl.getError();
        return {
          name,
          prepared,
          before,
          afterPreparation,
          afterDraw,
          prepassUnchanged,
          afterDrawUnchanged: unchanged(),
          selected,
          expected,
          pixels,
          image: image(pixels),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          error,
        };
      });
      const retained = s.ranges.diagnostics().compacted;
      s.dispose();
      return { rows, retained, disposedBuffers: s.ranges.diagnostics().compacted.buffers };
    } catch (error) {
      s.dispose();
      throw error;
    }
  };
  try {
    const baseline = run(false);
    const prepared = run(true);
    return {
      rows: prepared.rows.map((row, i) => {
        const original = baseline.rows[i];
        let differentChannels = 0;
        let visibleChannels = 0;
        for (let j = 0; j < row.pixels.length; j++) {
          if (row.pixels[j] !== original.pixels[j]) differentChannels++;
          if (j % 4 !== 3 && row.pixels[j] > 100) visibleChannels++;
        }
        return {
          ...row,
          pixels: undefined,
          baseline: { ...original, pixels: undefined },
          differentChannels,
          visibleChannels,
        };
      }),
      baselineRetained: baseline.retained,
      preparedRetained: prepared.retained,
      baselineDisposedBuffers: baseline.disposedBuffers,
      preparedDisposedBuffers: prepared.disposedBuffers,
      glError: gl.getError(),
      scope: 'actual WebGL ordered index/pixel/resource oracle; not native GPU crash acceptance',
    };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    renderer.dispose();
    canvas.remove();
  }
}
