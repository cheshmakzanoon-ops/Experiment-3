import * as T from 'three';

interface Handle {
  kind: string;
  handle: number;
}
type Command = { name: string; args: unknown[] };

/** The complete installed WebGLRenderer runs unchanged, including its native
 * constructor devtools event, projectObject, WebGLObjects/Attributes and VAO
 * binding path. Only the GL execution surface is a recording test double.
 * This proves JS invocation/submission behavior, not GPU pixels or timing. */
export class GeometryGL {
  readonly commands: Command[] = [];
  readonly canvas = Object.assign(new EventTarget(), {
    width: 64,
    height: 64,
    style: {},
    setAttribute() {},
  });
  drawingBufferWidth = 64;
  drawingBufferHeight = 64;
  drawingBufferColorSpace = 'srgb';
  unpackColorSpace = 'srgb';
  failBufferData: Error | null = null;
  onBufferData: (() => void) | null = null;
  private nextHandle = 0;
  private nextConstant = 65536;
  private constants = new Map<string, number>(
    Object.entries({
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      UNSIGNED_SHORT: 5123,
      UNSIGNED_INT: 5125,
      UNSIGNED_BYTE: 5121,
      TRIANGLES: 4,
      LINES: 1,
      POINTS: 0,
      TEXTURE0: 33984,
      TEXTURE_2D: 3553,
      TEXTURE_CUBE_MAP: 34067,
      TEXTURE_CUBE_MAP_POSITIVE_X: 34069,
      RGBA: 6408,
      DEPTH_COMPONENT: 6402,
      DEPTH_STENCIL: 34041,
    }),
  );
  private fallback = new Map<string, (...args: unknown[]) => unknown>();
  constructor() {
    return new Proxy(this, {
      get: (target, key, receiver) => {
        if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
          if (!target.constants.has(key)) target.constants.set(key, target.nextConstant++);
          return target.constants.get(key);
        }
        if (!target.fallback.has(key))
          target.fallback.set(key, (...args: unknown[]) => {
            target.record(key, args);
            if (/^create/.test(key)) return target.handle(key.slice(6).toLowerCase());
            if (key === 'getContextAttributes')
              return {
                alpha: false,
                depth: true,
                stencil: false,
                antialias: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
              };
            if (key === 'getShaderPrecisionFormat')
              return { rangeMin: 127, rangeMax: 127, precision: 23 };
            if (key === 'getExtension') return null;
            if (key === 'getSupportedExtensions') return [];
            if (key === 'getShaderInfoLog' || key === 'getProgramInfoLog') return '';
            if (key === 'getShaderParameter') return true;
            if (key === 'getProgramParameter') {
              if (args[1] === target.constant('ACTIVE_UNIFORMS')) return 0;
              if (args[1] === target.constant('ACTIVE_ATTRIBUTES')) return 1;
              return true;
            }
            if (key === 'getActiveAttrib')
              return { name: 'position', size: 1, type: target.constant('FLOAT_VEC3') };
            if (key === 'getAttribLocation') return 0;
            if (key === 'getUniformLocation') return target.handle('uniform');
            if (key === 'getParameter') {
              const name = [...target.constants].find(([, value]) => value === args[0])?.[0];
              if (name === 'VERSION') return 'WebGL 2.0 native invocation recorder';
              if (name === 'SCISSOR_BOX' || name === 'VIEWPORT')
                return new Int32Array([0, 0, 64, 64]);
              if (name === 'ALIASED_LINE_WIDTH_RANGE') return new Float32Array([1, 1]);
              if (name === 'COMPRESSED_TEXTURE_FORMATS') return [];
              if (name?.includes('TEXTURE_SIZE')) return 1024;
              if (name?.includes('UNIFORM_VECTORS')) return 1024;
              if (name === 'MAX_SAMPLES') return 4;
              return 16;
            }
            if (key === 'checkFramebufferStatus') return target.constant('FRAMEBUFFER_COMPLETE');
            if (key === 'isContextLost') return false;
            if (key === 'getError') return 0;
            return undefined;
          });
        return target.fallback.get(key);
      },
    });
  }
  constant(name: string) {
    if (!this.constants.has(name)) this.constants.set(name, this.nextConstant++);
    return this.constants.get(name)!;
  }
  private handle(kind: string): Handle {
    return { kind, handle: ++this.nextHandle };
  }
  private snapshot(value: unknown): unknown {
    if (ArrayBuffer.isView(value))
      return {
        type: value.constructor.name,
        values: Array.from(value as unknown as ArrayLike<number>),
      };
    if (Array.isArray(value)) return value.map((part) => this.snapshot(part));
    return value;
  }
  record(name: string, args: unknown[]) {
    this.commands.push({ name, args: args.map((arg) => this.snapshot(arg)) });
  }
  createBuffer() {
    this.record('createBuffer', []);
    return this.handle('buffer');
  }
  bindBuffer(...args: unknown[]) {
    this.record('bindBuffer', args);
  }
  deleteBuffer(...args: unknown[]) {
    this.record('deleteBuffer', args);
  }
  createVertexArray() {
    this.record('createVertexArray', []);
    return this.handle('vao');
  }
  bindVertexArray(...args: unknown[]) {
    this.record('bindVertexArray', args);
  }
  deleteVertexArray(...args: unknown[]) {
    this.record('deleteVertexArray', args);
  }
  bufferData(...args: unknown[]) {
    this.record('bufferData', args);
    this.onBufferData?.();
    if (this.failBufferData) throw this.failBufferData;
  }
  bufferSubData(...args: unknown[]) {
    this.record('bufferSubData', args);
  }
}

export function nativeGeometryRenderer(gl = new GeometryGL()) {
  const renderer = new T.WebGLRenderer({
    canvas: gl.canvas as unknown as HTMLCanvasElement,
    context: gl as unknown as WebGL2RenderingContext,
    antialias: false,
  });
  const scene = new T.Scene();
  scene.name = 'native owner scene';
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 20);
  camera.position.z = 4;
  return { gl, renderer, scene, camera };
}

export function nativeTriangle(name = 'triangle') {
  const geometry = new T.BufferGeometry();
  geometry.name = `${name} geometry`;
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3),
  );
  geometry.setIndex(new T.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}
