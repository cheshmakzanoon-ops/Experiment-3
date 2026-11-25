/** Bundled by engine-followup-contact.mjs; imports are pinned git snapshots. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { TrackContactMesh as BaselineMesh } from "engine-followup:baseline-contact";
import { TrackContactMesh as CandidateMesh } from "engine-followup:candidate-contact";
import { RoadContactFrame as BaselineFrame } from "engine-followup:baseline-frame";
import { RoadContactFrame as CandidateFrame } from "engine-followup:candidate-frame";
import { Vehicle as BaselineVehicle } from "engine-followup:baseline-vehicle";
import { Vehicle as CandidateVehicle } from "engine-followup:candidate-vehicle";
import { Vec3, Quat } from "engine-followup:math";
import { Track, trackPoint, surfaceSample } from "engine-followup:track";
import { circuitDefinition } from "engine-followup:circuits";
import { CATALOGUE } from "engine-followup:catalogue";
import { DEFAULT_SETUP } from "engine-followup:config";
import { DynamicsTrack } from "engine-followup:fixtures";

const task = process.argv[2],
  scratch = process.argv[3];
const DT = 1 / 240;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const arrayBytes = (value) =>
  Buffer.from(value.buffer, value.byteOffset, value.byteLength);
const frameValues = (frame) =>
  [frame.normal, frame.axle, frame.forward, frame.lateral]
    .flatMap((v) => [v.x, v.y, v.z])
    .concat(frame.inclination);
const encodedNumber = (value) =>
  Object.is(value, -0) ? "-0" : Number.isFinite(value) ? value : String(value);
function canonical(value) {
  const parts = [],
    seen = new Map();
  function visit(item) {
    if (typeof item === "number") {
      const bytes = Buffer.allocUnsafe(9);
      bytes[0] = 110;
      bytes.writeDoubleLE(item, 1);
      parts.push(bytes);
    } else if (item === null) parts.push(Buffer.from("z"));
    else if (item === undefined) parts.push(Buffer.from("u"));
    else if (typeof item === "boolean")
      parts.push(Buffer.from(item ? "t" : "f"));
    else if (typeof item === "string")
      parts.push(Buffer.from(`s${Buffer.byteLength(item)}:${item}`));
    else {
      if (seen.has(item)) {
        parts.push(Buffer.from(`r${seen.get(item)}:`));
        return;
      }
      seen.set(item, seen.size);
      if (ArrayBuffer.isView(item)) {
        parts.push(
          Buffer.from(`v${item.constructor.name}:${item.byteLength}:`),
          arrayBytes(item),
        );
      } else if (item instanceof Set) {
        parts.push(Buffer.from(`s${item.size}:`));
        for (const entry of item) visit(entry);
      } else if (item instanceof Map) {
        parts.push(Buffer.from(`m${item.size}:`));
        for (const entry of item) visit(entry);
      } else if (Array.isArray(item)) {
        parts.push(Buffer.from(`a${item.length}:`));
        for (const entry of item) visit(entry);
      } else {
        const keys = Object.keys(item)
          .filter((key) => typeof item[key] !== "function")
          .sort();
        parts.push(Buffer.from(`o${keys.length}:`));
        for (const key of keys) {
          visit(key);
          visit(item[key]);
        }
      }
    }
  }
  visit(value);
  return Buffer.concat(parts);
}
function sameBytes(actual, expected, label) {
  assert.equal(actual.byteLength, expected.byteLength, `${label}: byte length`);
  assert.equal(Buffer.compare(actual, expected), 0, `${label}: exact bytes`);
}
function resourceUsage() {
  return {
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    resource: process.resourceUsage(),
    memory: process.memoryUsage(),
  };
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (fraction) => {
    const position = (sorted.length - 1) * fraction;
    const lo = Math.floor(position),
      hi = Math.ceil(position);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
  };
  return {
    minimum: sorted[0],
    q1: quantile(0.25),
    median: quantile(0.5),
    q3: quantile(0.75),
    maximum: sorted.at(-1),
  };
}
function paired(
  run,
  operationsPerSample,
  warmupOperations = operationsPerSample,
  warmupPairs = 2,
) {
  const warmups = [],
    samples = [];
  function pair(index, operations) {
    const order =
      index % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    const item = { index, order };
    for (const role of order) {
      global.gc();
      item[role] = run(role, operations);
    }
    assert.equal(
      item.baseline.checksum,
      item.candidate.checksum,
      "Timed workload final state differs",
    );
    return item;
  }
  for (let i = 0; i < warmupPairs; i++) warmups.push(pair(i, warmupOperations));
  for (let i = 0; i < 10; i++) samples.push(pair(i, operationsPerSample));
  const before = distribution(samples.map((s) => s.baseline.elapsedMs));
  const after = distribution(samples.map((s) => s.candidate.elapsedMs));
  return {
    operationsPerSample,
    warmupOperations,
    warmupPairs,
    samplePairs: 10,
    warmups,
    samples,
    summary: {
      baseline: { ...before, medianMs: before.median },
      candidate: { ...after, medianMs: after.median },
      pairedChangePercent: distribution(
        samples.map(
          (s) => (s.candidate.elapsedMs / s.baseline.elapsedMs - 1) * 100,
        ),
      ),
      candidateFasterPairs: samples.filter(
        (s) => s.candidate.elapsedMs < s.baseline.elapsedMs,
      ).length,
    },
  };
}
function withArrayCounts(run) {
  const counts = {
    normalArrays: 0,
    normalEntries: 0,
    indexArrays: 0,
    indexEntries: 0,
  };
  const floatSet = Float64Array.prototype.set,
    uintSet = Uint32Array.prototype.set;
  Float64Array.prototype.set = function (source, offset) {
    if (Array.isArray(source)) {
      counts.normalArrays++;
      counts.normalEntries += source.length;
    }
    return floatSet.call(this, source, offset);
  };
  Uint32Array.prototype.set = function (source, offset) {
    if (Array.isArray(source)) {
      counts.indexArrays++;
      counts.indexEntries += source.length;
    }
    return uintSet.call(this, source, offset);
  };
  try {
    return { value: run(), counts };
  } finally {
    Float64Array.prototype.set = floatSet;
    Uint32Array.prototype.set = uintSet;
  }
}
function treeBytes(mesh) {
  const tree = mesh.bvh,
    nodes = new Float64Array(tree.nodes.length * 10);
  for (let i = 0; i < tree.nodes.length; i++) {
    const n = tree.nodes[i],
      at = i * 10;
    for (let k = 0; k < 3; k++) {
      nodes[at + k] = n.min[k];
      nodes[at + 3 + k] = n.max[k];
    }
    nodes[at + 6] = n.left;
    nodes[at + 7] = n.right;
    nodes[at + 8] = n.start;
    nodes[at + 9] = n.end;
  }
  const order = new Uint32Array(mesh.indices.length / 3);
  for (let i = 0; i < order.length; i++) order[i] = tree.orderedTriangle(i);
  return { nodes, order };
}
function queryBytes(mesh) {
  const point = trackPoint(),
    results = [];
  for (let station = 0; station < 12; station++) {
    mesh.track.at((station * mesh.track.length) / 12, point);
    for (const lateral of [-point.width - 0.55, 0, point.width + 0.55]) {
      const origin = new Vec3(
        point.x + point.nx * lateral,
        point.y + 3,
        point.z + point.nz * lateral,
      );
      for (const direction of [
        new Vec3(0, -1, 0),
        new Vec3(0.12 * point.tx, -1, 0.12 * point.tz).normalize(),
      ]) {
        const sample = surfaceSample();
        const distance = mesh.cast(origin, direction, 7, sample);
        results.push({
          station,
          lateral,
          distance,
          sample,
          triangles: mesh.bvh.trianglesTested,
        });
      }
    }
  }
  return { count: results.length, bytes: canonical(results) };
}
function geometryProof() {
  const cases = [
    ["aurel", 1],
    ["aurel", 2],
    ["aurel", 31],
    ["ardennes", 128],
    ["poggio-alto", 257],
    ["aurel", 8192],
    ["poggio-alto", 8192],
    ["vellamar", 8192],
  ];
  return cases.map(([circuitId, rows], index) => {
    function one(role) {
      const track = new Track(
        "rain",
        false,
        undefined,
        circuitDefinition(circuitId),
      );
      const Mesh = role === "baseline" ? BaselineMesh : CandidateMesh;
      const { value: mesh, counts } = withArrayCounts(() =>
        rows === 8192 ? new Mesh(track) : new Mesh(track, rows),
      );
      const expected =
        role === "baseline"
          ? {
              normalArrays: (rows + 1) * 15,
              normalEntries: (rows + 1) * 45,
              indexArrays: rows * 14,
              indexEntries: rows * 84,
            }
          : {
              normalArrays: 0,
              normalEntries: 0,
              indexArrays: 0,
              indexEntries: 0,
            };
      assert.deepEqual(counts, expected);
      const arrays = {
        vertices: mesh.vertices,
        normals: mesh.normals,
        indices: mesh.indices,
        ...treeBytes(mesh),
      };
      const hashes = {},
        byteLengths = {};
      for (const [name, value] of Object.entries(arrays)) {
        const bytes = arrayBytes(value),
          path = resolve(scratch, `geometry-${index}-${name}.bin`);
        if (role === "baseline") writeFileSync(path, bytes);
        else
          sameBytes(bytes, readFileSync(path), `${circuitId}/${rows}/${name}`);
        hashes[name] = sha(bytes);
        byteLengths[name] = bytes.length;
      }
      const queries = queryBytes(mesh),
        path = resolve(scratch, `geometry-${index}-queries.bin`);
      if (role === "baseline") writeFileSync(path, queries.bytes);
      else
        sameBytes(
          queries.bytes,
          readFileSync(path),
          `${circuitId}/${rows}/queries`,
        );
      return {
        counts,
        hashes,
        byteLengths,
        queryCount: queries.count,
        querySHA256: sha(queries.bytes),
        vertices: mesh.vertices.length / 3,
        triangles: mesh.indices.length / 3,
        nodes: mesh.bvh.nodes.length,
      };
    }
    const baseline = one("baseline");
    global.gc();
    const candidate = one("candidate");
    global.gc();
    assert.deepEqual(candidate.hashes, baseline.hashes);
    return { circuitId, rows, exactBytesEqual: true, baseline, candidate };
  });
}
function frameInputs(count) {
  return Array.from({ length: count }, (_, i) => {
    const orientation = new Quat();
    orientation.integrateWorld(
      new Vec3(
        Math.sin(i * 0.17) * 0.5,
        Math.cos(i * 0.13),
        Math.sin(i * 0.11) * 0.4,
      ),
      0.8,
    );
    const scale = [1, 1e-8, 1e-6, 100, 1e120][i % 5];
    return {
      label: `ordinary-${i}`,
      orientation,
      steering: Math.sin(i * 0.19) * 0.7,
      normal: new Vec3(
        Math.sin(i * 0.23) * scale * 0.4,
        scale,
        Math.cos(i * 0.29) * scale * 0.3,
      ),
      camber: Math.sin(i * 0.31) * 0.2,
    };
  });
}
function frameProof() {
  const inputs = frameInputs(2048);
  const add = (
    label,
    normal = new Vec3(0, 1, 0),
    steering = 0,
    camber = 0,
    orientation = new Quat(),
  ) => inputs.push({ label, normal, steering, camber, orientation });
  add("zero", new Vec3(-0, 0, -0));
  add("subnormal", new Vec3(-0, Number.MIN_VALUE, -0));
  add("normal-below-threshold", new Vec3(-0, 1e-8 * (1 - Number.EPSILON), -0));
  add("normal-at-threshold-signed-zero", new Vec3(-0, 1e-8, -0));
  add("normal-above-threshold", new Vec3(-0, 1e-8 * (1 + Number.EPSILON), -0));
  add("degenerate-tangent", new Vec3(1, 0, -0));
  add("tangent-below-threshold", new Vec3(1, 1e-8 * (1 - Number.EPSILON), -0));
  add("tangent-at-threshold", new Vec3(1, 1e-8, -0));
  add(
    "finite-cancelling-overflow-length",
    new Vec3(Number.MAX_VALUE, -Number.MAX_VALUE, -0),
  );
  add(
    "overflow-finite-sum-rejected",
    new Vec3(Number.MAX_VALUE, Number.MAX_VALUE, 0),
  );
  add("large-single-component", new Vec3(Number.MAX_VALUE, 1, -0));
  add("nonfinite-normal-nan", new Vec3(NaN, 1, 0));
  add("nonfinite-normal-infinity", new Vec3(Infinity, 1, 0));
  add("nonfinite-steering-nan", undefined, NaN);
  add("nonfinite-steering-infinity", undefined, Infinity);
  add("nonfinite-camber-nan", undefined, 0, NaN);
  add("nonfinite-camber-infinity", undefined, 0, Infinity);
  add("invalid-orientation-nan", undefined, 0, 0, new Quat(NaN));
  add(
    "invalid-orientation-overflow",
    undefined,
    0.3,
    0.2,
    new Quat(1e308, 1e308, 1e308, 1e308),
  );
  add(
    "zero-quaternion-existing-behavior",
    undefined,
    0.3,
    0.2,
    new Quat(0, 0, 0, 0),
  );
  add("wheel-flat-camber", undefined, 0, Math.PI / 2);
  add("normal-negative-up", new Vec3(-0, -1, -0));
  const before = new BaselineFrame(),
    after = new CandidateFrame();
  const totals = { baselineHypot: 0, candidateHypot: 0 },
    specialCases = [],
    digest = createHash("sha256");
  function invoke(frame, input) {
    const original = Math.hypot;
    let hypotCalls = 0,
      returned,
      error;
    Math.hypot = (...values) => {
      hypotCalls++;
      return original(...values);
    };
    try {
      returned = frame.set(
        input.orientation,
        input.steering,
        input.normal,
        input.camber,
      );
    } catch (caught) {
      error = { name: caught.name, message: caught.message };
    } finally {
      Math.hypot = original;
    }
    return { returned, error, values: frameValues(frame), hypotCalls };
  }
  for (let i = 0; i < inputs.length; i++) {
    const a = invoke(before, inputs[i]),
      b = invoke(after, inputs[i]);
    const av = canonical({
      returned: a.returned,
      error: a.error,
      values: a.values,
    });
    const bv = canonical({
      returned: b.returned,
      error: b.error,
      values: b.values,
    });
    sameBytes(av, bv, inputs[i].label);
    digest.update(av);
    totals.baselineHypot += a.hypotCalls;
    totals.candidateHypot += b.hypotCalls;
    if (i < 2048) {
      assert.equal(a.hypotCalls, 5);
      assert.equal(b.hypotCalls, 4);
      assert.equal(a.returned, true);
    } else
      specialCases.push({
        label: inputs[i].label,
        returned: a.returned,
        error: a.error,
        baselineHypotCalls: a.hypotCalls,
        candidateHypotCalls: b.hypotCalls,
        exactValues: a.values.map(encodedNumber),
      });
  }
  return {
    cases: inputs.length,
    ordinaryCases: 2048,
    exactStateAndOutcomeEqual: true,
    stateSHA256: digest.digest("hex"),
    ...totals,
    specialCases,
  };
}
function makeCar(role, definition) {
  const Constructor = role === "baseline" ? BaselineVehicle : CandidateVehicle;
  const car = new Constructor(0, "medium", DEFAULT_SETUP, "raw", definition);
  return car;
}
function mapCount(car, run) {
  const original = car.tires.map;
  let calls = 0;
  Object.defineProperty(car.tires, "map", {
    configurable: true,
    value: function (...args) {
      calls++;
      return original.apply(this, args);
    },
  });
  try {
    run();
    return calls;
  } finally {
    delete car.tires.map;
  }
}
function clutchProof() {
  const definitions = [
    CATALOGUE.sk125,
    Object.values(CATALOGUE).find((d) => d.drivetrain === "fwd"),
    CATALOGUE.rl2,
  ];
  const digest = createHash("sha256"),
    layouts = [];
  let cases = 0;
  for (const definition of definitions) {
    assert.ok(definition);
    const before = makeCar("baseline", definition),
      after = makeCar("candidate", definition);
    let baselineMaps = 0,
      candidateMaps = 0,
      layoutCases = 0;
    for (let corner = 0; corner < 4; corner++) {
      for (const slip of [
        -0,
        0,
        -0.06,
        0.06,
        -0.12,
        0.12,
        -Infinity,
        Infinity,
        NaN,
      ]) {
        for (const load of [0, 1, 1 + Number.EPSILON, 1000, NaN]) {
          for (const car of [before, after]) {
            for (let wheel = 0; wheel < 4; wheel++) {
              car.tires[wheel].slip = wheel === corner ? slip : -0;
              car.tires[wheel].load = wheel === corner ? load : 1000;
            }
            car.clutch.engineOmega = 180;
            car.clutch.wheelInertia = -1;
          }
          baselineMaps += mapCount(before, () => before.coupleClutch(0.15));
          candidateMaps += mapCount(after, () => after.coupleClutch(0.15));
          assert.ok(
            Object.is(before.clutch.wheelInertia, after.clutch.wheelInertia),
          );
          const args = [
            DT,
            50,
            7,
            definition.spec.gearRatios[2] * definition.spec.finalDrive,
            0.1,
            false,
            false,
          ];
          const torqueA = before.clutch.step(...args),
            torqueB = after.clutch.step(...args);
          const a = canonical({ torque: torqueA, clutch: before.clutch });
          const b = canonical({ torque: torqueB, clutch: after.clutch });
          sameBytes(a, b, `clutch ${definition.id}/${corner}/${slip}/${load}`);
          digest.update(a);
          cases++;
          layoutCases++;
        }
      }
    }
    assert.equal(
      baselineMaps,
      definition.drivetrain === "awd" ? layoutCases : 0,
    );
    assert.equal(candidateMaps, 0);
    layouts.push({
      id: definition.id,
      drivetrain: definition.drivetrain,
      cases: layoutCases,
      baselineMaps,
      candidateMaps,
    });
  }
  return {
    cases,
    exactInertiaTorqueAndClutchStateEqual: true,
    layouts,
    stateSHA256: digest.digest("hex"),
  };
}
class ContactTrack extends DynamicsTrack {
  supported = true;
  castTire(...args) {
    return this.supported ? super.castTire(...args) : Infinity;
  }
}
function prepareCar(role, id, track) {
  const car = makeCar(role, CATALOGUE[id]);
  car.place(track, 0);
  car.body.position.y -= 0.01;
  car.gear = 1;
  car.autoShift = false;
  car.input.manualClutch = true;
  car.input.clutch = 0;
  return car;
}
function inputsForStep(car, track, step) {
  track.supported = !(step % 240 >= 80 && step % 240 < 88);
  car.input.throttle = step % 240 < 160 ? 0.35 : 0.08;
  car.input.brake = step % 240 < 160 ? 0 : 0.1;
  car.input.steer = Math.sin(step * 0.01) * 0.025;
}
function carState(car) {
  // Include every enumerable dynamic field and scratch object; omit shared
  // authored definitions/configuration and method-instrumentation functions.
  const skip = new Set([
    "definition",
    "spec",
    "physics",
    "setup",
    "wheelPositions",
  ]);
  return Object.fromEntries(
    Object.entries(car).filter(
      ([key, value]) => !skip.has(key) && typeof value !== "function",
    ),
  );
}
function trajectoryProof() {
  return [
    { id: "sk125", explicitAWDCoupling: false },
    { id: "dk100", explicitAWDCoupling: false },
    { id: "rl2", explicitAWDCoupling: false },
    { id: "rl2", explicitAWDCoupling: true },
  ].map(({ id, explicitAWDCoupling }) => {
    const tracks = {
      baseline: new ContactTrack(),
      candidate: new ContactTrack(),
    };
    const cars = {
      baseline: prepareCar("baseline", id, tracks.baseline),
      candidate: prepareCar("candidate", id, tracks.candidate),
    };
    const counts = {},
      stateHash = createHash("sha256");
    let comparedBytes = 0;
    for (const role of ["baseline", "candidate"]) {
      const car = cars[role],
        original = car.coupleClutch;
      counts[role] = { couplingCalls: 0, frameCalls: 0, substeps: 0 };
      car.coupleClutch = function (share) {
        counts[role].couplingCalls++;
        return original.call(this, share);
      };
      const integrate = car.integrate;
      car.integrate = function (...args) {
        counts[role].substeps++;
        return integrate.apply(this, args);
      };
      for (const frame of car.contactFrames) {
        const set = frame.set;
        frame.set = function (...args) {
          counts[role].frameCalls++;
          return set.apply(this, args);
        };
      }
    }
    for (let step = 0; step < 240; step++) {
      for (const role of ["baseline", "candidate"]) {
        inputsForStep(cars[role], tracks[role], step);
        // Harness-only call; no catalogue definition, engine or tuning edit.
        if (explicitAWDCoupling) cars[role].coupleClutch(0.15);
        cars[role].step(DT, tracks[role]);
      }
      const a = canonical(carState(cars.baseline)),
        b = canonical(carState(cars.candidate));
      sameBytes(a, b, `trajectory ${id}/${explicitAWDCoupling}/${step}`);
      stateHash.update(a);
      comparedBytes += a.length;
    }
    assert.deepEqual(counts.baseline, counts.candidate);
    assert.equal(counts.baseline.substeps, 240);
    assert.equal(
      counts.baseline.couplingCalls,
      id === "rl2" && !explicitAWDCoupling ? 0 : 240,
    );
    return {
      id,
      explicitAWDCoupling,
      substeps: 240,
      simulatedSeconds: 1,
      exactCapturedStateAtEverySubstep: true,
      comparedBytes,
      stateSHA256: stateHash.digest("hex"),
      counts,
    };
  });
}
function constructionTiming() {
  return {
    scenarios: ["aurel", "poggio-alto"].map((circuitId) => {
      const rows = 8192,
        track = new Track(
          "rain",
          false,
          undefined,
          circuitDefinition(circuitId),
        );
      const result = paired(
        (role) => {
          const Mesh = role === "baseline" ? BaselineMesh : CandidateMesh;
          const start = performance.now();
          const mesh = new Mesh(track);
          const elapsedMs = performance.now() - start;
          const hash = createHash("sha256");
          for (const key of ["vertices", "normals", "indices"])
            hash.update(arrayBytes(mesh[key]));
          return { elapsedMs, checksum: hash.digest("hex") };
        },
        1,
        1,
        2,
      );
      return {
        circuitId,
        rows,
        commonBVH: true,
        vertices: (rows + 1) * 15,
        triangles: rows * 28,
        ...result,
      };
    }),
  };
}
function frameTiming() {
  const inputs = frameInputs(128);
  return {
    description:
      "Actual set calls over 128 prebuilt pitch/roll/bank/steer/camber frames; checksum accumulation included.",
    ...paired(
      (role, count) => {
        const frame =
          role === "baseline" ? new BaselineFrame() : new CandidateFrame();
        let sum = 0;
        const start = performance.now();
        for (let i = 0; i < count; i++) {
          const input = inputs[i & 127];
          frame.set(
            input.orientation,
            input.steering,
            input.normal,
            input.camber,
          );
          sum += frame.forward.z + frame.inclination;
        }
        const elapsedMs = performance.now() - start;
        return { elapsedMs, checksum: sum };
      },
      500000,
      100000,
      3,
    ),
  };
}
function clutchTiming() {
  return {
    description:
      "Explicit dormant AWD method on a real rl2 Vehicle; four slip writes, four load writes and checksum accumulation per call. No authored coupling change.",
    vehicleId: "rl2",
    authoredCouplingEnabled: Boolean(CATALOGUE.rl2.spec.engine?.clutchCoupling),
    ...paired(
      (role, count) => {
        const car = makeCar(role, CATALOGUE.rl2),
          t = car.tires;
        let sum = 0;
        const start = performance.now();
        for (let i = 0; i < count; i++) {
          t[0].slip = ((i & 31) - 16) * 0.004;
          t[1].slip = ((i & 15) - 8) * 0.003;
          t[2].slip = ((i & 7) - 4) * 0.007;
          t[3].slip = ((i & 63) - 32) * 0.002;
          t[0].load = i % 53 ? 1500 : 0;
          t[1].load = 1400;
          t[2].load = 1200;
          t[3].load = 1300;
          car.coupleClutch(0.15);
          sum += car.clutch.wheelInertia;
        }
        const elapsedMs = performance.now() - start;
        return { elapsedMs, checksum: sum };
      },
      1000000,
      200000,
      3,
    ),
  };
}
function substepTiming() {
  return {
    fixture:
      "Unmodified DynamicsTrack analytic runway with deterministic support loss; real catalogue definitions, no explicit AWD coupling.",
    scenarios: ["sk125", "rl2"].map((vehicleId) => ({
      vehicleId,
      authoredCouplingEnabled: Boolean(
        CATALOGUE[vehicleId].spec.engine?.clutchCoupling,
      ),
      ...paired(
        (role, count) => {
          const track = new ContactTrack(),
            car = prepareCar(role, vehicleId, track);
          const start = performance.now();
          for (let step = 0; step < count; step++) {
            inputsForStep(car, track, step);
            car.step(DT, track);
          }
          const elapsedMs = performance.now() - start;
          return { elapsedMs, checksum: sha(canonical(carState(car))) };
        },
        1200,
        600,
        2,
      ),
    })),
  };
}
let result;
if (task === "proof") {
  const enabled = Object.values(CATALOGUE)
    .filter((d) => d.spec.engine?.clutchCoupling)
    .map((d) => ({
      id: d.id,
      drivetrain: d.drivetrain,
      clutchCoupling: d.spec.engine.clutchCoupling,
    }));
  assert.deepEqual(enabled.map((d) => d.id).sort(), ["dk100", "sk125"]);
  assert.ok(enabled.every((d) => d.drivetrain !== "awd"));
  result = {
    geometry: geometryProof(),
    frames: frameProof(),
    clutch: clutchProof(),
    trajectories: trajectoryProof(),
    authoredCouplingEnabled: enabled,
  };
} else if (task === "construction") result = constructionTiming();
else if (task === "frame") result = frameTiming();
else if (task === "clutch") result = clutchTiming();
else if (task === "substeps") result = substepTiming();
else throw new Error(`Unknown worker task ${task}`);
process.stdout.write(
  `${JSON.stringify({ ...result, resources: resourceUsage() })}\n`,
);
