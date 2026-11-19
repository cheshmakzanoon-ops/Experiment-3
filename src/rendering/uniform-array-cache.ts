import type * as T from 'three';

type GLContext = ReturnType<T.WebGLRenderer['getContext']>;

interface NativeArrayUniform {
  id: string;
  type: number;
  size?: number;
  setValue: (gl: GLContext, value: unknown, textures?: unknown) => unknown;
}

const wrapped = new WeakSet<NativeArrayUniform>();
// These retained scene arrays were observed at slow native call boundaries.
// Single matrices/scalars already have native caches; samplers retain their
// original texture binding and allocation behavior.
const selected = new Map([
  ['apexFogVolumes', 0x8b52],
  ['studioGpShape', 0x8b52],
  ['studioGpFront', 0x8b52],
  ['directionalShadowMatrix', 0x8b5c],
]);

/** Keep r180's original flattening and native uniform owner. Its pure-array
 * setters otherwise upload identical values on every material switch. Compare
 * the actual flattened Float32 bytes, per native owner/context/location, and
 * omit only a write that cannot change that owner's current uniform value.
 * The native program owns this wrapper and its CPU snapshot; disposal/relink
 * or context restoration creates fresh native uniform owners and cold caches. */
export function cacheRetainedArrayUniforms(
  renderer: Pick<T.WebGLRenderer, 'getContext'>,
  uniforms: unknown,
) {
  // r180 exposes seq at runtime; its installed types omit the runtime fields.
  const seq = (uniforms as { seq?: NativeArrayUniform[] } | undefined)?.seq;
  if (!Array.isArray(seq)) return 0;
  let context: GLContext | undefined;
  let count = 0;
  for (const owner of seq) {
    if (
      wrapped.has(owner) ||
      !selected.has(owner.id) ||
      selected.get(owner.id) !== owner.type ||
      typeof owner.size !== 'number' ||
      !Number.isInteger(owner.size) ||
      owner.size < 1 ||
      typeof owner.setValue !== 'function'
    )
      continue;
    context ??= renderer.getContext();
    const gl = context;
    const matrix = owner.type === 0x8b5c;
    const method = matrix ? 'uniformMatrix4fv' : 'uniform4fv';
    const length = owner.size * (matrix ? 16 : 4);
    const original = owner.setValue;
    let snapshot: Uint32Array | null = null;
    let address: unknown = null;
    const invalidate = () => {
      snapshot = null;
      address = null;
    };
    // This adapter is passed only to the selected native pure-array setter,
    // whose sole GL call is this method. No context/prototype is modified.
    const adapter = {
      [method](...args: unknown[]) {
        const data = args[matrix ? 2 : 1];
        if (
          !(data instanceof Float32Array) ||
          !(data.buffer instanceof ArrayBuffer) ||
          data.length !== length ||
          (matrix && args[1] !== false)
        ) {
          // A bypass can change the value too. Never retain A across native B.
          invalidate();
          return Reflect.apply(gl[method], gl, args);
        }
        const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
        let equal = snapshot !== null && address === args[0];
        if (equal)
          for (let i = 0; i < bits.length; i++) {
            if (snapshot![i] !== bits[i]) {
              equal = false;
              break;
            }
          }
        if (equal) return;
        // Native flatten uses shared scratch arrays. Own the submitted bytes,
        // and publish them only after a successful native return. A throw leaves
        // this cache invalid even if a wrapper changed native state first.
        const pending = bits.slice();
        invalidate();
        const result = Reflect.apply(gl[method], gl, args);
        snapshot = pending;
        address = args[0];
        return result;
      },
    };
    owner.setValue = function (this: NativeArrayUniform, source, value, textures) {
      if (source !== gl || this !== owner) {
        invalidate();
        return original.call(this, source, value, textures);
      }
      return original.call(this, adapter as unknown as GLContext, value, textures);
    };
    wrapped.add(owner);
    count++;
  }
  return count;
}
