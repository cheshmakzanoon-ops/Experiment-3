import { describe, expect, it, vi } from 'vitest';
import { Random, Vec3 } from '../src/core/math.ts';
import { BoxContact, ChassisBox, SweptBoxContact } from '../src/simulation/obb.ts';

type Path = [ChassisBox, ChassisBox, ChassisBox, ChassisBox];

function box(x = 0, z = 0, yaw = 0, half: readonly number[] = [0.2, 0.4, 1]) {
  const result = new ChassisBox();
  result.center.set(x, 0, z);
  result.orientation.yaw(yaw);
  result.half = half;
  return result.copy(result);
}

/** Frozen pre-cache arithmetic. copy(self) refreshes the unchanged axes/bounds. */
function originalInterpolate(out: ChassisBox, a: ChassisBox, b: ChassisBox, fraction: number) {
  out.half = a.half;
  const qa = a.orientation,
    qb = b.orientation,
    q = out.orientation;
  const dot = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w,
    sign = dot < 0 ? -1 : 1,
    cosine = Math.min(1, Math.abs(dot));
  let wa = 1 - fraction,
    wb = fraction;
  if (cosine < 1) {
    const angle = Math.acos(cosine),
      sine = Math.sin(angle);
    wa = Math.sin((1 - fraction) * angle) / sine;
    wb = Math.sin(fraction * angle) / sine;
  }
  wb *= sign;
  q.x = qa.x * wa + qb.x * wb;
  q.y = qa.y * wa + qb.y * wb;
  q.z = qa.z * wa + qb.z * wb;
  q.w = qa.w * wa + qb.w * wb;
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  q.x /= length;
  q.y /= length;
  q.z /= length;
  q.w /= length;
  out.center.set(
    a.center.x + (b.center.x - a.center.x) * fraction,
    a.center.y + (b.center.y - a.center.y) * fraction,
    a.center.z + (b.center.z - a.center.z) * fraction,
  );
  return out.copy(out);
}

/** Frozen advancement: independent of the production interpolation/cache path. */
class OriginalSweptBoxContact {
  readonly normal = new Vec3();
  readonly point = new Vec3();
  fraction = Infinity;
  iterations = 0;
  exhausted = false;
  private a = new ChassisBox();
  private b = new ChassisBox();
  private contact = new BoxContact();
  private relative = new Vec3();
  private rotationA = new Vec3();
  private rotationB = new Vec3();
  private arm = new Vec3();
  private motionA = new Vec3();
  private motionB = new Vec3();
  intersect(startA: ChassisBox, endA: ChassisBox, startB: ChassisBox, endB: ChassisBox) {
    this.fraction = Infinity;
    this.iterations = 0;
    this.exhausted = false;
    this.relative.copy(endA.center).sub(startA.center).sub(endB.center).add(startB.center);
    startA.rotationVectorTo(endA, this.rotationA);
    startB.rotationVectorTo(endB, this.rotationB);
    const angularBound =
      this.rotationA.length() * Math.hypot(...startA.half) +
      this.rotationB.length() * Math.hypot(...startB.half);
    let fraction = 0;
    for (let iteration = 0; iteration < 80; iteration++) {
      this.iterations = iteration + 1;
      originalInterpolate(this.a, startA, endA, fraction);
      originalInterpolate(this.b, startB, endB, fraction);
      const gap = this.contact.separation(this.a, this.b, 1e-5);
      if (gap <= 1e-5) {
        if (fraction === 0 && !this.approachingStart(startA, endA, startB, endB)) return false;
        this.fraction = fraction;
        this.normal.copy(this.contact.normal);
        this.point.copy(this.contact.point);
        return true;
      }
      const closing = -this.relative.dot(this.contact.normal) + angularBound;
      if (!(closing > 0)) return false;
      const next = fraction + gap / closing;
      if (next > 1) return false;
      if (!(next > fraction)) {
        this.exhausted = true;
        return false;
      }
      fraction = next;
    }
    this.exhausted = true;
    return false;
  }
  private approachingStart(a: ChassisBox, endA: ChassisBox, b: ChassisBox, endB: ChassisBox) {
    this.arm.copy(this.contact.point).sub(a.center);
    this.motionA.cross(this.rotationA, this.arm).add(endA.center).sub(a.center);
    this.arm.copy(this.contact.point).sub(b.center);
    this.motionB.cross(this.rotationB, this.arm).add(endB.center).sub(b.center);
    return this.motionA.sub(this.motionB).dot(this.contact.normal) < -1e-9;
  }
}

function snapshot(query: SweptBoxContact | OriginalSweptBoxContact, path: Path) {
  return {
    hit: query.intersect(...path),
    fraction: query.fraction,
    iterations: query.iterations,
    exhausted: query.exhausted,
    // Include retained contact outputs on misses, as well as actual hits.
    normal: [query.normal.x, query.normal.y, query.normal.z],
    point: [query.point.x, query.point.y, query.point.z],
  };
}

function sameResult(actual: ReturnType<typeof snapshot>, expected: ReturnType<typeof snapshot>) {
  expect(actual.hit).toBe(expected.hit);
  expect(actual.fraction).toBe(expected.fraction);
  expect(actual.iterations).toBe(expected.iterations);
  expect(actual.exhausted).toBe(expected.exhausted);
  // toBe uses Object.is: even signed-zero changes must fail this comparison.
  for (let i = 0; i < 3; i++) {
    expect(actual.normal[i]).toBe(expected.normal[i]);
    expect(actual.point[i]).toBe(expected.point[i]);
  }
}

function measured(query: SweptBoxContact | OriginalSweptBoxContact, path: Path) {
  const acos = vi.spyOn(Math, 'acos'),
    sin = vi.spyOn(Math, 'sin'),
    hypot = vi.spyOn(Math, 'hypot');
  try {
    const result = snapshot(query, path);
    return {
      result,
      calls: {
        acos: acos.mock.calls.length,
        sin: sin.mock.calls.length,
        hypot: hypot.mock.calls.length,
      },
    };
  } finally {
    acos.mockRestore();
    sin.mockRestore();
    hypot.mockRestore();
  }
}

function rotatingCorner(): Path {
  return [
    box(0, 0, 0, [0.1, 0.1, 2]),
    box(0, 0, Math.PI / 2, [0.1, 0.1, 2]),
    box(1.3, 1.3, 0, [0.15, 0.15, 0.15]),
    box(1.3, 1.3, 0, [0.15, 0.15, 0.15]),
  ];
}

function negateRotation(target: ChassisBox) {
  target.orientation.x *= -1;
  target.orientation.y *= -1;
  target.orientation.z *= -1;
  target.orientation.w *= -1;
  target.copy(target);
}

describe('swept quaternion interpolation work', () => {
  it('reduces the six-iteration rotating fixture from 6 acos / 18 sin to 1 / 13', () => {
    const path = rotatingCorner(),
      original = measured(new OriginalSweptBoxContact(), path),
      actual = measured(new SweptBoxContact(), path);
    expect(original.result.hit).toBe(true);
    expect(original.result.fraction).toBe(0.39244887098081277);
    expect(original.result.iterations).toBe(6);
    expect(original.result.exhausted).toBe(false);
    expect(original.calls).toStrictEqual({ acos: 6, sin: 18, hypot: 108 });
    expect(actual.calls).toStrictEqual({ acos: 1, sin: 13, hypot: 108 });
    sameResult(actual.result, original.result);
  });

  it('prepares at most two arcs when both boxes rotate', () => {
    const path = rotatingCorner();
    path[3].orientation.yaw(-Math.PI / 3);
    path[3].copy(path[3]);
    const original = measured(new OriginalSweptBoxContact(), path),
      actual = measured(new SweptBoxContact(), path),
      iterations = original.result.iterations;
    expect(iterations).toBeGreaterThan(2);
    expect(original.calls.acos).toBe(2 * iterations);
    expect(original.calls.sin).toBe(6 * iterations);
    expect(actual.calls.acos).toBe(2);
    expect(actual.calls.sin).toBe(4 * iterations + 2);
    expect(actual.calls.hypot).toBe(original.calls.hypot);
    sameResult(actual.result, original.result);
  });

  it.each([
    ['identical', 0, 0],
    ['near-identical rounded to the linear branch', 1e-8, 0],
    ['near-identical on the arc branch', 1e-7, 1],
    ['negative-dot shortest arc', 1.5 * Math.PI, 1],
  ] as const)('retains exact %s rotation behavior', (_name, angle, preparations) => {
    const path: Path = [box(-2), box(2, 0, angle), box(), box()],
      original = measured(new OriginalSweptBoxContact(), path),
      actual = measured(new SweptBoxContact(), path);
    expect(actual.result.hit).toBe(true);
    expect(actual.calls.acos).toBe(preparations);
    expect(actual.calls.sin).toBe(preparations * (1 + 2 * actual.result.iterations));
    sameResult(actual.result, original.result);
  });

  it('keeps antipodal endpoints on the same rotation without an invented turn', () => {
    const a = box(-2, 0, 0.7),
      endA = new ChassisBox().copy(a),
      b = box(0, 0, -0.4),
      endB = new ChassisBox().copy(b);
    endA.center.x = 2;
    negateRotation(endA);
    negateRotation(endB);
    const path: Path = [a, endA, b, endB],
      original = measured(new OriginalSweptBoxContact(), path),
      actual = measured(new SweptBoxContact(), path);
    expect(actual.result.hit).toBe(true);
    expect(actual.calls.acos).toBe(0);
    expect(actual.calls.sin).toBe(0);
    sameResult(actual.result, original.result);
  });

  it('refreshes both arcs when the same endpoint objects are changed between queries', () => {
    const path = rotatingCorner(),
      original = new OriginalSweptBoxContact(),
      actual = new SweptBoxContact();
    for (const [angleA, angleB] of [
      [Math.PI / 2, -Math.PI / 3],
      [0, 0],
      [1e-7, 1e-8],
      [1.5 * Math.PI, -Math.PI / 2],
      [Math.PI / 2, 0],
      [0, 0],
    ]) {
      path[1].orientation.yaw(angleA);
      path[3].orientation.yaw(angleB);
      path[1].copy(path[1]);
      path[3].copy(path[3]);
      sameResult(snapshot(actual, path), snapshot(original, path));
    }
  });

  it('preserves the 80-iteration exhaustion result for a tiny constant separating gap', () => {
    const path = rotatingCorner();
    for (const index of [2, 3]) {
      path[index].center.set(0, 0.25002, 0);
      path[index].copy(path[index]);
    }
    const original = measured(new OriginalSweptBoxContact(), path),
      actual = measured(new SweptBoxContact(), path);
    expect(original.result.hit).toBe(false);
    expect(original.result.exhausted).toBe(true);
    expect(original.result.iterations).toBe(80);
    expect(actual.calls.acos).toBe(1);
    expect(actual.calls.sin).toBe(161);
    sameResult(actual.result, original.result);
  });

  it.each(['approaching', 'resting', 'separating'] as const)(
    'preserves %s time-zero contact and its signed-zero outputs',
    (motion) => {
      const a = box(-0.2),
        b = box(0.2),
        endA = box(motion === 'approaching' ? 2 : motion === 'separating' ? -2 : -0.2),
        endB = box(-endA.center.x),
        path: Path = [a, endA, b, endB],
        original = snapshot(new OriginalSweptBoxContact(), path),
        actual = snapshot(new SweptBoxContact(), path);
      expect(actual.hit).toBe(motion === 'approaching');
      expect(actual.iterations).toBe(1);
      expect(actual.exhausted).toBe(false);
      sameResult(actual, original);
    },
  );

  it('matches exact outputs over 512 seeded 3D paths, including large coordinates and reuse', () => {
    const random = new Random(34819),
      sample = (scale: number) => (random.next() - 0.5) * scale,
      original = new OriginalSweptBoxContact(),
      actual = new SweptBoxContact();
    let hits = 0,
      misses = 0;
    for (let index = 0; index < 512; index++) {
      const offset = [0, 1e6, 1e12, 1e14][index % 4],
        path: Path = [box(), box(), box(), box()];
      for (const pair of [0, 2]) {
        const start = path[pair],
          end = path[pair + 1];
        start.half = [0.1 + random.next(), 0.1 + random.next(), 0.2 + 2 * random.next()];
        start.center.set(sample(8), offset + sample(8), -offset + sample(8));
        start.orientation.integrateWorld(new Vec3(sample(6), sample(6), sample(6)), 1);
        start.copy(start);
        end.copy(start);
        end.center.add(new Vec3(sample(10), sample(10), sample(10)));
        end.orientation.integrateWorld(new Vec3(sample(6), sample(6), sample(6)), 1);
        end.copy(end);
      }
      const expected = snapshot(original, path),
        result = snapshot(actual, path);
      sameResult(result, expected);
      if (result.hit) hits++;
      else misses++;
    }
    expect(hits).toBeGreaterThan(30);
    expect(misses).toBeGreaterThan(30);
  });

  it.each(['start', 'end'] as const)(
    'retains the public three-argument interpolation API with an aliased %s',
    (alias) => {
      for (const angle of [0, 1e-8, 1e-7, Math.PI / 2, 1.5 * Math.PI]) {
        for (const fraction of [0, 0.125, 0.5, 0.999, 1]) {
          const a = box(-3, 1e12, 0),
            b = box(7, 1e12 + 0.5, angle),
            expected = originalInterpolate(new ChassisBox(), a, b, fraction),
            actual = alias === 'start' ? a : b;
          actual.interpolate(a, b, fraction);
          expect(actual).toStrictEqual(expected);
        }
      }
    },
  );
});
