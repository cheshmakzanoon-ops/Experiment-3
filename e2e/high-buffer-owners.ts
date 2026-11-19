import type * as T from 'three';

type NativeMethod = (this: object, ...args: unknown[]) => unknown;
type Attribute = T.BufferAttribute | T.InterleavedBufferAttribute;
interface RegisteredOwner {
  object: T.Object3D;
  geometry: T.BufferGeometry;
  slot: string;
  attribute: Attribute;
  native: T.BufferAttribute | T.InterleavedBuffer;
  registeredVersion: number;
}
export interface HighBufferOwner {
  object: number;
  objectId: number;
  objectType: string;
  path: string[];
  pathTruncated: boolean;
  geometry: number;
  geometryId: number;
  geometryName: string;
  slot: string;
  attribute: number;
  nativeAttribute: number;
  versionAtCall: number;
  registeredVersion: number;
  usage: number;
  itemSize: number;
  normalized: boolean;
  interleaved: boolean;
  stride: number;
  offset: number;
}
export interface HighBufferUpload {
  upload: number;
  method: string;
  context: number;
  generation: number;
  renderer: number;
  target: number;
  buffer: number;
  bufferKnown: boolean;
  vao: number;
  view: number;
  backingBuffer: number;
  viewType: string;
  byteOffset: number;
  byteLength: number;
  sourceOffset: number | null;
  sourceLength: number | null;
  destinationOffset: number | null;
  attribution: 'exact-direct-index' | 'registered-array' | 'derived-wireframe' | 'unknown';
  exact: HighBufferOwner | null;
  candidates: HighBufferOwner[];
  aliasesTruncated: boolean;
  staleCandidates: number;
  inventoryTruncated: boolean;
  bufferDataStarts: number;
  bufferDataReturnsBeforeCall: number;
  bufferSubDataStarts: number;
  previousView: number;
  previousExactNativeAttribute: number;
  previousExactVersion: number | null;
  priorBuffersForView: {
    buffer: number;
    context: number;
    generation: number;
    deleteObserved: boolean;
    bufferDataStarts: number;
    bufferDataReturns: number;
  }[];
  priorBuffersTruncated: boolean;
}
interface Options {
  /** These callbacks must not request any GL work. */
  onUpload(record: HighBufferUpload): void;
  onUnavailable?(message: string): void;
  chaseStarted(): boolean;
  /** Test injection replaces only the GL execution surface, never Three. */
  prototype?: object;
  limits?: { views?: number; nodes?: number; renderers?: number };
}

/** Serialized as one init-script function. No runtime imports, payload reads,
 * GL queries, extra submissions, private renderer caches or dependency edits.
 * All identities are process-local observations, not content fingerprints. */
export function installHighBufferOwners(options: Options) {
  const scope = globalThis as typeof globalThis & { __THREE_DEVTOOLS__?: EventTarget };
  const prototype = (options.prototype ??
    (typeof WebGL2RenderingContext === 'undefined'
      ? null
      : WebGL2RenderingContext.prototype)) as Record<string, NativeMethod> | null;
  const maxViews = options.limits?.views ?? 16384,
    maxNodes = options.limits?.nodes ?? 20000,
    maxRenderers = options.limits?.renderers ?? 8,
    maxAliases = 4,
    maxAttributes = 64;
  const ids = new WeakMap<object, number>();
  let nextId = 0,
    nextUpload = 0,
    viewCount = 0,
    rendererCount = 0,
    inventoryTruncated = false,
    stopped = false,
    warnings = 0;
  const id = (value: object | null | undefined) => {
    if (!value) return 0;
    let found = ids.get(value);
    if (!found) ids.set(value, (found = ++nextId));
    return found;
  };
  const safely = <R>(read: () => R, fallback: R): R => {
    try {
      return read();
    } catch (error) {
      if (warnings++ < 8) {
        try {
          options.onUnavailable?.(`Buffer owner observer: ${String(error).slice(0, 256)}`);
        } catch {
          // Diagnostic failures never replace application return/throw behavior.
        }
      }
      return fallback;
    }
  };
  interface BufferRecord {
    id: number;
    context: number;
    generation: number;
    deleted: boolean;
    starts: number;
    returns: number;
    updates: number;
    view: number;
    attribute: number;
    version: number | null;
  }
  interface Direct {
    renderer: number;
    object: T.Object3D;
    geometry: T.BufferGeometry;
    material: T.Material & { wireframe?: boolean };
  }
  interface Context {
    id: number;
    generation: number;
    lost: boolean;
    array: object | null;
    defaultElement: object | null;
    vao: object | null;
    elements: WeakMap<object, object | null>;
    deletedVaos: WeakSet<object>;
    direct: Direct | null;
    renderer: number;
    upload: HighBufferUpload | null;
  }
  const buffers = new WeakMap<object, BufferRecord>();
  // Values retain bounded numeric lifecycle records, never WebGLBuffer handles.
  const viewBuffers = new WeakMap<
    ArrayBufferView,
    { buffers: BufferRecord[]; truncated: boolean }
  >();
  let historyViews = 0;
  const contexts = new WeakMap<object, Context>();
  const renderers = new WeakSet<object>();
  const views = new WeakMap<ArrayBufferView, { owners: RegisteredOwner[]; truncated: boolean }>();
  const restore = new Set<() => void>();
  const context = (gl: object) => {
    const found = contexts.get(gl);
    if (found) return found;
    const state: Context = {
      id: id(gl),
      generation: 1,
      lost: false,
      array: null,
      defaultElement: null,
      vao: null,
      elements: new WeakMap(),
      deletedVaos: new WeakSet(),
      direct: null,
      renderer: 0,
      upload: null,
    };
    contexts.set(gl, state);
    const canvas = (gl as WebGL2RenderingContext).canvas;
    if (canvas?.addEventListener) {
      const lost = () => {
        state.lost = true;
      };
      const restored = () => {
        state.generation++;
        state.lost = false;
        state.array = state.defaultElement = state.vao = null;
        state.elements = new WeakMap();
        state.deletedVaos = new WeakSet();
      };
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      restore.add(() => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
      });
    }
    return state;
  };
  const nativeAttribute = (attribute: Attribute) =>
    (attribute as T.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (attribute as T.InterleavedBufferAttribute).data
      : (attribute as T.BufferAttribute);
  const liveAttribute = (owner: RegisteredOwner): Attribute | undefined => {
    if (owner.slot === 'index') return owner.geometry.index ?? undefined;
    if (owner.slot === 'instanceMatrix' || owner.slot === 'instanceColor')
      return (owner.object as T.InstancedMesh)[owner.slot] ?? undefined;
    return owner.geometry.attributes[owner.slot] as Attribute | undefined;
  };
  const register = (
    object: T.Object3D,
    geometry: T.BufferGeometry,
    slot: string,
    attribute: Attribute,
  ) => {
    if (
      !attribute ||
      (attribute as unknown as { isGLBufferAttribute?: boolean }).isGLBufferAttribute
    )
      return;
    const native = nativeAttribute(attribute),
      array = native.array;
    if (!ArrayBuffer.isView(array)) return;
    let entry = views.get(array);
    if (!entry) {
      if (viewCount >= maxViews) {
        inventoryTruncated = true;
        return;
      }
      viewCount++;
      views.set(array, (entry = { owners: [], truncated: false }));
    }
    const retained = entry.owners.find(
      (owner) =>
        owner.object === object &&
        owner.geometry === geometry &&
        owner.slot === slot &&
        owner.attribute === attribute &&
        owner.native === native,
    );
    if (retained) {
      retained.registeredVersion = native.version;
      return;
    }
    if (entry.owners.length >= maxAliases) {
      entry.truncated = true;
      return;
    }
    entry.owners.push({
      object,
      geometry,
      slot,
      attribute,
      native,
      registeredVersion: native.version,
    });
  };
  const registerGeometry = (object: T.Object3D, geometry: T.BufferGeometry | undefined) => {
    if (!geometry?.isBufferGeometry) return;
    if (geometry.index) register(object, geometry, 'index', geometry.index);
    let count = 0;
    for (const slot in geometry.attributes) {
      if (count++ >= maxAttributes) {
        inventoryTruncated = true;
        break;
      }
      register(object, geometry, slot, geometry.attributes[slot] as Attribute);
    }
    if ((object as T.InstancedMesh).isInstancedMesh) {
      const mesh = object as T.InstancedMesh;
      register(object, geometry, 'instanceMatrix', mesh.instanceMatrix);
      if (mesh.instanceColor) register(object, geometry, 'instanceColor', mesh.instanceColor);
    }
  };
  const inventory = (scene: T.Object3D) => {
    const pending = [scene];
    let count = 0;
    while (pending.length && count++ < maxNodes) {
      const object = pending.pop()!;
      const mesh = object as T.Mesh;
      if (mesh.isMesh || (object as T.Line).isLine || (object as T.Points).isPoints)
        registerGeometry(object, mesh.geometry);
      // Read only public graph fields: do not call traversal/matrix hooks.
      for (const child of object.children ?? []) {
        if (pending.length + count >= maxNodes) {
          inventoryTruncated = true;
          break;
        }
        pending.push(child);
      }
    }
    if (pending.length) inventoryTruncated = true;
  };
  const describe = (owner: RegisteredOwner): HighBufferOwner => {
    const path: string[] = [];
    let ancestor: T.Object3D | null = owner.object;
    for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parent)
      path.push(`${ancestor.type}:${ancestor.name.slice(0, 64)}#${ancestor.id}`);
    const interleaved = !!(owner.attribute as T.InterleavedBufferAttribute)
      .isInterleavedBufferAttribute;
    return {
      object: id(owner.object),
      objectId: owner.object.id,
      objectType: owner.object.type.slice(0, 64),
      path: path.reverse(),
      pathTruncated: !!ancestor,
      geometry: id(owner.geometry),
      geometryId: owner.geometry.id,
      geometryName: owner.geometry.name.slice(0, 96),
      slot: owner.slot.slice(0, 64),
      attribute: id(owner.attribute),
      nativeAttribute: id(owner.native),
      versionAtCall: owner.native.version,
      registeredVersion: owner.registeredVersion,
      usage: owner.native.usage,
      itemSize: owner.attribute.itemSize,
      normalized: owner.attribute.normalized,
      interleaved,
      stride: interleaved ? (owner.native as T.InterleavedBuffer).stride : 0,
      offset: interleaved ? (owner.attribute as T.InterleavedBufferAttribute).offset : 0,
    };
  };
  const observeUpload = (gl: object, method: string, args: unknown[]) => {
    const state = context(gl),
      target = Number(args[0]);
    const handle =
      target === 34962
        ? state.array
        : target === 34963
          ? state.vao
            ? (state.elements.get(state.vao) ?? null)
            : state.defaultElement
          : null;
    const retained = handle && buffers.get(handle);
    const known =
      !!retained &&
      !retained.deleted &&
      !state.lost &&
      retained.context === state.id &&
      retained.generation === state.generation &&
      (!state.vao || !state.deletedVaos.has(state.vao));
    const payload = args[method === 'bufferData' ? 1 : 2];
    const view = ArrayBuffer.isView(payload) ? payload : null;
    const entry = view && views.get(view);
    const prior = view && viewBuffers.get(view);
    const candidates: HighBufferOwner[] = [];
    let staleCandidates = 0;
    for (const owner of entry?.owners ?? []) {
      const live = liveAttribute(owner);
      if (
        (owner.object as T.Mesh).geometry !== owner.geometry ||
        live !== owner.attribute ||
        nativeAttribute(live) !== owner.native ||
        owner.native.array !== view
      )
        staleCandidates++;
      else candidates.push(describe(owner));
    }
    let exact: HighBufferOwner | null = null;
    const direct = state.direct,
      rawIndex = direct?.geometry.index;
    // Wireframe uses Three's separate generated index, not geometry.index.
    const wireframe = target === 34963 && !!direct?.material.wireframe;
    if (target === 34963 && !wireframe && direct && rawIndex && rawIndex.array === view)
      exact = describe({
        object: direct.object,
        geometry: direct.geometry,
        slot: 'index',
        attribute: rawIndex,
        native: rawIndex,
        registeredVersion: rawIndex.version,
      });
    const result: HighBufferUpload = {
      upload: ++nextUpload,
      method,
      context: state.id,
      generation: state.generation,
      renderer: direct?.renderer ?? state.renderer,
      target,
      buffer: id(handle),
      bufferKnown: known,
      vao: id(state.vao),
      view: id(view),
      backingBuffer: view ? id(view.buffer) : 0,
      viewType: view?.constructor.name.slice(0, 48) ?? '',
      byteOffset: view?.byteOffset ?? 0,
      byteLength: view?.byteLength ?? (typeof payload === 'number' ? payload : 0),
      sourceOffset: typeof args[3] === 'number' ? args[3] : null,
      sourceLength: typeof args[4] === 'number' ? args[4] : null,
      destinationOffset: method === 'bufferSubData' && typeof args[1] === 'number' ? args[1] : null,
      attribution: wireframe
        ? 'derived-wireframe'
        : exact
          ? 'exact-direct-index'
          : candidates.length
            ? 'registered-array'
            : 'unknown',
      exact,
      candidates,
      aliasesTruncated: entry?.truncated ?? false,
      staleCandidates,
      inventoryTruncated,
      bufferDataStarts: known ? retained.starts + Number(method === 'bufferData') : 0,
      bufferDataReturnsBeforeCall: known ? retained.returns : 0,
      bufferSubDataStarts: known ? retained.updates + Number(method === 'bufferSubData') : 0,
      previousView: known ? retained.view : 0,
      previousExactNativeAttribute: known ? retained.attribute : 0,
      previousExactVersion: known ? retained.version : null,
      priorBuffersForView: (prior?.buffers ?? []).map((buffer) => ({
        buffer: buffer.id,
        context: buffer.context,
        generation: buffer.generation,
        deleteObserved: buffer.deleted,
        bufferDataStarts: buffer.starts,
        bufferDataReturns: buffer.returns,
      })),
      priorBuffersTruncated: prior?.truncated ?? false,
    };
    if (known) {
      if (method === 'bufferData') retained.starts++;
      else retained.updates++;
      if (view) {
        let history = prior;
        if (!history && historyViews < maxViews) {
          historyViews++;
          viewBuffers.set(view, (history = { buffers: [], truncated: false }));
        }
        if (!history) result.priorBuffersTruncated = true;
        else if (!history.buffers.includes(retained)) {
          if (history.buffers.length < maxAliases) history.buffers.push(retained);
          else history.truncated = result.priorBuffersTruncated = true;
        }
      }
    }
    return { state, result, retained: known ? retained : null };
  };
  const wrap = (
    owner: Record<string, NativeMethod>,
    name: string,
    wrapper: (original: NativeMethod) => NativeMethod,
  ) => {
    const original = owner[name];
    if (typeof original !== 'function') throw new Error(`Missing native ${name}`);
    const next = wrapper(original);
    owner[name] = next;
    const undo = () => {
      if (owner[name] === next) owner[name] = original;
    };
    restore.add(undo);
    return undo;
  };
  const observeRenderer = (event: Event) =>
    safely(() => {
      const renderer = (event as CustomEvent<T.WebGLRenderer & { isWebGLRenderer?: boolean }>)
        .detail;
      if (!renderer?.isWebGLRenderer || renderers.has(renderer)) return;
      renderers.add(renderer);
      if (rendererCount++ >= maxRenderers) {
        inventoryTruncated = true;
        return;
      }
      // This public getter returns the existing JS context; it issues no GL query.
      const gl = renderer.getContext(),
        state = context(gl),
        rendererId = id(renderer);
      const owner = renderer as unknown as Record<string, NativeMethod>;
      const scanned = new WeakMap<T.Object3D, boolean>();
      let retired = false;
      const ownedRestores: (() => void)[] = [];
      ownedRestores.push(
        wrap(
          owner,
          'render',
          (original) =>
            function (...args) {
              if (stopped || retired) return Reflect.apply(original, this, args);
              const previous = state.renderer,
                previousDirect = state.direct;
              state.renderer = rendererId;
              state.direct = null;
              safely(() => {
                const scene = args[0] as T.Object3D,
                  chase = options.chaseStarted();
                if (scene?.isObject3D && (!scanned.has(scene) || (chase && !scanned.get(scene)))) {
                  inventory(scene);
                  scanned.set(scene, chase);
                }
              }, undefined);
              try {
                return Reflect.apply(original, this, args);
              } finally {
                state.renderer = previous;
                state.direct = previousDirect;
              }
            },
        ),
      );
      ownedRestores.push(
        wrap(
          owner,
          'renderBufferDirect',
          (original) =>
            function (...args) {
              if (stopped || retired) return Reflect.apply(original, this, args);
              const previous = state.direct;
              state.direct = safely(() => {
                const geometry = args[2] as T.BufferGeometry,
                  object = args[4] as T.Object3D;
                registerGeometry(object, geometry);
                return { renderer: rendererId, geometry, object, material: args[3] as T.Material };
              }, null);
              try {
                return Reflect.apply(original, this, args);
              } finally {
                state.direct = previous;
              }
            },
        ),
      );
      const retire = () => {
        retired = true;
        for (const undo of ownedRestores) {
          undo();
          restore.delete(undo);
        }
      };
      ownedRestores.push(
        wrap(
          owner,
          'dispose',
          (original) =>
            function (...args) {
              try {
                return Reflect.apply(original, this, args);
              } finally {
                safely(retire, undefined);
              }
            },
        ),
      );
    }, undefined);
  if (prototype)
    safely(() => {
      wrap(
        prototype,
        'createBuffer',
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args);
            if (!stopped && result)
              safely(() => {
                const state = context(this);
                buffers.set(result as object, {
                  id: id(result as object),
                  context: state.id,
                  generation: state.generation,
                  deleted: false,
                  starts: 0,
                  returns: 0,
                  updates: 0,
                  view: 0,
                  attribute: 0,
                  version: null,
                });
              }, undefined);
            return result;
          },
      );
      wrap(
        prototype,
        'bindBuffer',
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args);
            if (!stopped)
              safely(() => {
                const state = context(this),
                  buffer = args[1] as object | null;
                if (args[0] === 34962) state.array = buffer;
                else if (args[0] === 34963) {
                  if (state.vao) state.elements.set(state.vao, buffer);
                  else state.defaultElement = buffer;
                }
              }, undefined);
            return result;
          },
      );
      wrap(
        prototype,
        'deleteBuffer',
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args);
            if (!stopped && args[0])
              safely(() => {
                const found = buffers.get(args[0] as object);
                if (found) found.deleted = true;
              }, undefined);
            return result;
          },
      );
      wrap(
        prototype,
        'bindVertexArray',
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args);
            if (!stopped)
              safely(() => {
                context(this).vao = args[0] as object | null;
              }, undefined);
            return result;
          },
      );
      wrap(
        prototype,
        'deleteVertexArray',
        (original) =>
          function (...args) {
            const result = Reflect.apply(original, this, args);
            if (!stopped && args[0])
              safely(() => {
                const state = context(this),
                  vao = args[0] as object;
                state.deletedVaos.add(vao);
                if (state.vao === vao) state.vao = null;
              }, undefined);
            return result;
          },
      );
      for (const method of ['bufferData', 'bufferSubData'])
        wrap(
          prototype,
          method,
          (original) =>
            function (...args) {
              if (stopped) return Reflect.apply(original, this, args);
              const observation = safely(() => observeUpload(this, method, args), null);
              const previous = observation?.state.upload ?? null;
              if (observation) {
                observation.state.upload = observation.result;
                safely(() => options.onUpload(observation.result), undefined);
              }
              let returned = false;
              try {
                const result = Reflect.apply(original, this, args);
                returned = true;
                return result;
              } finally {
                if (observation) {
                  observation.state.upload = previous;
                  if (returned && observation.retained) {
                    const { retained, result } = observation;
                    if (method === 'bufferData') retained.returns++;
                    retained.view = result.view;
                    // Even one registered array candidate is not proof that no
                    // unregistered owner exists. Only the live direct-index path
                    // identifies an exact native attribute owner here.
                    retained.attribute = result.exact?.nativeAttribute ?? 0;
                    retained.version = result.exact?.versionAtCall ?? null;
                  }
                }
              }
            },
        );
    }, undefined);
  else
    safely(() => {
      throw new Error('WebGL2 prototype unavailable');
    }, undefined);
  let target: EventTarget | undefined;
  safely(() => {
    if (scope.__THREE_DEVTOOLS__ === undefined) scope.__THREE_DEVTOOLS__ = new EventTarget();
    target = scope.__THREE_DEVTOOLS__;
    if (typeof target?.addEventListener !== 'function')
      throw new Error('Existing devtools target is not observable');
    target.addEventListener('observe', observeRenderer);
    restore.add(() => target?.removeEventListener('observe', observeRenderer));
  }, undefined);
  return {
    currentUpload(gl: object) {
      return contexts.get(gl)?.upload ?? null;
    },
    stop() {
      stopped = true;
      for (const undo of restore) safely(undo, undefined);
      restore.clear();
      // Preserve the original target and every other listener, including when
      // this observer created the otherwise empty target before Three loaded.
    },
  };
}
