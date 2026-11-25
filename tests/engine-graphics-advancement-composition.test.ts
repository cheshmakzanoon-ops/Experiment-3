import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markItems } from '../src/rendering/attribute-ranges.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { FestivalTrails } from '../src/rendering/open-world/festival-trails.ts';
import { acquireGpuFrameGate, type GpuFrameLease } from '../src/rendering/shared-gpu-frame-gate.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleAt, vehicleIndex } from '../src/simulation/vehicles.ts';
import { minimapHeading } from '../src/ui/festival-map.ts';

/** Select complete production methods, not copied cadence/admission logic. */
function methods(path: string, name: string, wanted: string[]) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  if (!owner) throw new Error(`Missing ${name}`);
  return wanted
    .map((key) => {
      const member = owner.members.find((node) => node.name?.getText(source) === key);
      if (!member) throw new Error(`Missing ${name}.${key}`);
      return member.getText(source);
    })
    .join('\n');
}
function compile(body: string, bindings: Record<string, unknown> = {}) {
  const source = ts.transpileModule(`class Owner { ${body} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${source}; return Owner;`)(
    ...Object.values(bindings),
  );
}
const Session = compile(
  methods('../src/session/free-roam.ts', 'FestivalSession', ['frame', 'resize', 'isPaused']),
  { carBase, F, H, R, RACE_BASE, vehicleAt, minimapHeading },
) as new () => SessionState;
const Admission = compile(
  methods('../src/rendering/open-world/festival-renderer.ts', 'FestivalRenderer', [
    'canSubmitFrame',
  ]),
) as new () => {
  disposed: boolean;
  gpuFrames: GpuFrameLease;
  canSubmitFrame(): boolean;
};

const leases: GpuFrameLease[] = [];
const trails: FestivalTrails[] = [];
let now = 0;
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { hidden: false });
});
afterEach(() => {
  for (const owner of trails.splice(0)) owner.dispose();
  for (const lease of leases.splice(0)) lease.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function lease(gl: WebGL2RenderingContext) {
  const owner = acquireGpuFrameGate(gl);
  leases.push(owner);
  return owner;
}
function bytes(array: T.TypedArray) {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
function sameBytes(actual: Uint8Array, expected: T.TypedArray) {
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(bytes(expected)))).toBe(0);
}

/** Native driver boundary only: actual Three owns versions/ranges, and the
 * real shared gate owns fence decisions. This does not measure native GPU work. */
function gpu() {
  const buffers = new Map<object, Uint8Array>();
  const transfers: { buffer: object; offset: number; bytes: number }[] = [];
  const deleted: object[] = [];
  const waits: { flags: number; timeout: number }[] = [];
  let bound: object | null = null,
    issued = 0,
    completed = -1;
  const gl = {
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c,
    ALREADY_SIGNALED: 0x911a,
    createBuffer: () => ({}),
    bindBuffer: (_target: number, buffer: object) => {
      bound = buffer;
    },
    bufferData: (_target: number, array: T.TypedArray) => {
      if (!bound) throw new Error('No bound buffer');
      buffers.set(bound, bytes(array).slice());
      issued++;
    },
    bufferSubData: (
      _target: number,
      offset: number,
      array: T.TypedArray,
      first = 0,
      count = array.length - first,
    ) => {
      const mirror = bound && buffers.get(bound);
      if (!mirror || !bound) throw new Error('Missing buffer storage');
      const length = count * array.BYTES_PER_ELEMENT;
      mirror.set(
        new Uint8Array(array.buffer, array.byteOffset + first * array.BYTES_PER_ELEMENT, length),
        offset,
      );
      transfers.push({ buffer: bound, offset, bytes: length });
      issued++;
    },
    deleteBuffer: (buffer: object) => {
      buffers.delete(buffer);
    },
    drawArrays: () => {
      issued++;
    },
    fenceSync: () => ({ through: issued }),
    clientWaitSync: (fence: { through: number }, flags: number, timeout: number) => {
      waits.push({ flags, timeout });
      return completed >= fence.through ? 0x911c : 0x911b;
    },
    deleteSync: (fence: object) => {
      deleted.push(fence);
    },
    flush: vi.fn(),
    finish: vi.fn(),
    isContextLost: () => false,
  };
  const context = gl as unknown as WebGL2RenderingContext;
  const uploader = new WebGLAttributes(context);
  const upload = (attribute: T.BufferAttribute) => uploader.update(attribute, gl.ARRAY_BUFFER);
  const mirror = (attribute: T.BufferAttribute) => {
    const buffer = uploader.get(attribute)?.buffer;
    const value = buffer && buffers.get(buffer);
    if (!value) throw new Error('Attribute has no uploaded storage');
    return value;
  };
  return {
    context,
    gl,
    uploader,
    upload,
    mirror,
    transfers,
    deleted,
    waits,
    complete: () => {
      completed = issued;
    },
  };
}

function snapshot(time = 0, z = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame[H.TICK] = Math.round(time * 120);
  frame[o + F.QW] = 1;
  frame[o + F.Z] = z;
  frame[o + F.Y] = 1;
  frame[o + F.GEAR] = 2;
  frame[o + F.RPM] = 3000;
  frame[o + F.SPEED] = frame[o + F.VZ] = 25;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('tc1');
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = 2000;
    frame[p + W.SLIP] = 0.5;
    frame[p + W.SLIP_POWER] = 12000;
    frame[p + W.RADIUS] = frame[p + W.LENGTH] = 0.3;
  }
  return frame;
}

interface SessionState {
  frame(time: number): void;
  resize(): void;
  renderer: ReturnType<typeof view>;
  current: Float32Array;
  liveFrames: LiveFrameClock;
  lastTime: number;
  renderedState: string | null;
  redrawRevision: number;
  renderedRevision: number;
  resizeRevision: number;
  renderedResizeRevision: number;
  pageEpoch: number;
  disposed: boolean;
  pageSuspended: boolean;
  travelling: boolean;
}

/** The rendering body is an explicit seam: real Three upload plus real gate
 * submission, not the full Festival scene. Admission and session methods are
 * production source. Separate ownership tests cover the full render transaction. */
function view(g: ReturnType<typeof gpu>, attribute: T.BufferAttribute) {
  const owner = Object.assign(new Admission(), { disposed: false, gpuFrames: lease(g.context) });
  const presented = new PresentedFrame();
  const value = Object.assign(owner, {
    presented,
    camera: {},
    photo: false,
    night: 0,
    mode: 'chase',
    guidance: { cue: null },
    driftCue: null,
    audioView: { value: {} },
    resize: vi.fn(),
    afterUpload: () => {},
    cars: { navigation: { detach: vi.fn() } },
    draw: vi.fn(function (
      this: { afterUpload(): void },
      a: Float32Array,
      b: Float32Array,
      alpha: number,
    ) {
      if (!owner.canSubmitFrame()) return false;
      presented.sample(a, b, alpha);
      g.upload(attribute);
      g.gl.drawArrays();
      this.afterUpload();
      owner.gpuFrames.submittedFrame();
      return true;
    }),
  });
  return value;
}

function session(g: ReturnType<typeof gpu>, attribute: T.BufferAttribute) {
  const renderer = view(g, attribute),
    frame = snapshot(),
    clock = new LiveFrameClock();
  clock.observe(frame, 0);
  renderer.presented.sample(frame, frame, 1);
  const hud = { update: vi.fn(), minimap: {} };
  const controls = { paused: true, syncInput: vi.fn() };
  const riders = { update: vi.fn() },
    traffic = { update: vi.fn() };
  const audio = { update: vi.fn() },
    fail = vi.fn();
  const owner = Object.assign(new Session(), {
    renderer,
    current: frame,
    liveFrames: clock,
    lastTime: 0,
    renderedState: null,
    redrawRevision: 0,
    renderedRevision: -1,
    resizeRevision: 0,
    renderedResizeRevision: 0,
    pageEpoch: 0,
    disposed: false,
    pageSuspended: false,
    travelling: false,
    hud,
    controls,
    riders,
    traffic,
    status: { road: 'fixture', discovered: [] },
    host: { quality: 'low', canvas: { height: 720 }, audio },
    fail,
  });
  const at = (time: number) => {
    now = time;
    owner.frame(time);
  };
  return { owner, renderer, hud, controls, riders, traffic, audio, fail, at };
}

describe('graphics advancement composition', () => {
  it('retains newest dirty bytes and resize receipts across shared busy and idle callbacks', () => {
    const g = gpu(),
      circuit = lease(g.context);
    const attribute = new T.BufferAttribute(new Float32Array(4096 * 3), 3);
    g.upload(attribute);
    circuit.submittedFrame();
    const h = session(g, attribute),
      original = g.mirror(attribute).slice();
    for (let i = 1; i <= 24; i++) {
      attribute.array.fill(i + 0.25, 100 * 3, 104 * 3);
      markItems(attribute, 100, 103);
      if (i === 8 || i === 17) h.owner.resize();
      if (i === 12) h.renderer.photo = true;
      h.at(i * 10);
    }
    expect(attribute.updateRanges).toEqual([{ start: 300, count: 12 }]);
    expect(g.mirror(attribute)).toEqual(original);
    expect(g.transfers).toHaveLength(0);
    expect(h.renderer.draw).not.toHaveBeenCalled();
    expect(h.renderer.resize).not.toHaveBeenCalled();
    expect(h.riders.update).not.toHaveBeenCalled();
    expect(h.traffic.update).not.toHaveBeenCalled();
    expect(h.hud.update).toHaveBeenCalledTimes(24);
    expect(h.controls.syncInput).toHaveBeenCalledTimes(24);
    expect(h.audio.update).toHaveBeenCalledTimes(24);
    expect(h.owner.renderedResizeRevision).toBe(0);

    g.complete();
    h.at(250);
    sameBytes(g.mirror(attribute), attribute.array);
    expect(g.transfers.map(({ offset, bytes }) => ({ offset, bytes }))).toEqual([
      { offset: 1200, bytes: 48 },
    ]);
    expect(attribute.updateRanges).toEqual([]);
    expect(h.owner.renderedResizeRevision).toBe(2);
    expect(h.owner.lastTime).toBe(250);
    expect(h.renderer.resize).toHaveBeenCalledTimes(1);
    expect(circuit.diagnostics()).toMatchObject({ pending: true, submitted: 2, completed: 1 });

    // A new dirty write has no redraw permission of its own. Completed GPU
    // work and a callback before the photo cadence cannot consume its range.
    attribute.array.fill(99.5, 104 * 3, 107 * 3);
    markItems(attribute, 104, 106);
    g.complete();
    h.at(260);
    expect(g.transfers).toHaveLength(1);
    expect(attribute.updateRanges).toEqual([{ start: 312, count: 9 }]);
    expect(h.renderer.draw).toHaveBeenCalledTimes(1);

    h.owner.resize();
    h.renderer.afterUpload = () => {
      h.renderer.afterUpload = () => {};
      h.owner.resize(); // Newer than the frame's captured resize receipt.
    };
    h.at(270);
    sameBytes(g.mirror(attribute), attribute.array);
    expect(g.transfers.at(-1)).toMatchObject({ offset: 1248, bytes: 36 });
    expect(h.owner.resizeRevision).toBe(4);
    expect(h.owner.renderedResizeRevision).toBe(3);
    h.at(280); // The newer request still cannot bypass the shared pending fence.
    expect(h.renderer.draw).toHaveBeenCalledTimes(2);
    expect(h.owner.renderedResizeRevision).toBe(3);
    g.complete();
    h.at(290);
    expect(h.renderer.draw).toHaveBeenCalledTimes(3);
    expect(h.renderer.resize).toHaveBeenCalledTimes(3);
    expect(h.owner.renderedResizeRevision).toBe(4);
    expect(g.transfers).toHaveLength(2); // Unchanged version is not uploaded again.
    expect(h.hud.update).toHaveBeenCalledTimes(29);
    expect(h.controls.syncInput).toHaveBeenCalledTimes(29);
    expect(h.audio.update).toHaveBeenCalledTimes(29);
    expect(h.fail).not.toHaveBeenCalled();
    expect(g.waits.every(({ flags, timeout }) => flags === 0 && timeout === 0)).toBe(true);
    expect(g.gl.finish).not.toHaveBeenCalled();

    // Dropping this renderer's lease cannot release the circuit's pending work.
    h.renderer.gpuFrames.dispose();
    const replacement = lease(g.context);
    expect(replacement.ready()).toBe(false);
    expect(circuit.ready()).toBe(false);
    g.complete();
    expect(replacement.ready()).toBe(true);
    expect(circuit.diagnostics()).toMatchObject({ pending: false, submitted: 4, completed: 4 });
    g.uploader.remove(attribute);
  });

  it('publishes the exact latest real trail-ring bytes after long upload deferral and wrap', () => {
    const deferred = new FestivalTrails(),
      immediate = new FestivalTrails();
    trails.push(deferred, immediate);
    const g = gpu(),
      reference = gpu(),
      circuit = lease(g.context),
      festival = lease(g.context);
    const names = ['position', 'born', 'strength'] as const;
    const attrs = names.map(
      (name) => deferred.root.geometry.getAttribute(name) as T.BufferAttribute,
    );
    const references = names.map(
      (name) => immediate.root.geometry.getAttribute(name) as T.BufferAttribute,
    );
    attrs.forEach(g.upload);
    references.forEach(reference.upload);
    const initial = attrs.map((attr) => g.mirror(attr).slice());
    circuit.submittedFrame();
    const ground = (x: number, z: number) => x * 0.07 - z * 0.025;
    for (let i = 0; i <= 180; i++) {
      const frame = snapshot(2 + i * 0.05, i * 1.28);
      deferred.update(frame, ground);
      immediate.update(frame, ground);
      references.forEach(reference.upload);
      expect(festival.ready()).toBe(false);
      for (const attr of attrs) expect(attr.updateRanges.length).toBeLessThanOrEqual(16);
    }
    expect(deferred.segments).toBe(deferred.capacity);
    expect(deferred.root.geometry.drawRange).toEqual(immediate.root.geometry.drawRange);
    expect(g.transfers).toHaveLength(0);
    attrs.forEach((attr, i) => expect(g.mirror(attr)).toEqual(initial[i]));
    // At least one buffer slot was overwritten after the ring first filled.
    expect(Math.min(...attrs[1].array)).toBeGreaterThan(2);

    circuit.dispose(); // A surviving borrower still owns the original fence.
    const handback = lease(g.context);
    expect(handback.ready()).toBe(false);
    g.complete();
    expect(handback.ready()).toBe(true);
    attrs.forEach(g.upload);
    handback.submittedFrame();
    attrs.forEach((attr, i) => {
      sameBytes(g.mirror(attr), attr.array);
      expect(g.mirror(attr)).toEqual(reference.mirror(references[i]));
      expect(attr.updateRanges).toEqual([]);
    });
    expect(g.transfers.reduce((sum, transfer) => sum + transfer.bytes, 0)).toBe(81920);
    expect(g.transfers).toHaveLength(3);

    // The full-ring publication does not leave a sticky full marker behind.
    const frame = snapshot(2 + 181 * 0.05, 181 * 1.28);
    deferred.update(frame, ground);
    immediate.update(frame, ground);
    references.forEach(reference.upload);
    expect(
      attrs.every(
        (attr) =>
          attr.updateRanges.length > 0 &&
          attr.updateRanges.reduce((sum, range) => sum + range.count, 0) < attr.array.length,
      ),
    ).toBe(true);
    expect(festival.ready()).toBe(false);
    g.complete();
    expect(festival.ready()).toBe(true);
    attrs.forEach(g.upload);
    festival.submittedFrame();
    attrs.forEach((attr, i) => expect(g.mirror(attr)).toEqual(reference.mirror(references[i])));
    const secondBytes = g.transfers.slice(3).reduce((sum, transfer) => sum + transfer.bytes, 0);
    expect(secondBytes).toBeGreaterThan(0);
    expect(secondBytes).toBeLessThan(81920);
    expect(g.gl.finish).not.toHaveBeenCalled();
    attrs.forEach((attr) => g.uploader.remove(attr));
    references.forEach((attr) => reference.uploader.remove(attr));
  });
});
