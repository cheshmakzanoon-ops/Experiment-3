import { expect, it } from 'vitest';
import * as T from 'three';
import { ForegroundPerson, humanHeadGeometry } from '../src/rendering/foreground-person.ts';
import { newTeam } from '../src/storage/team-career.ts';
import { teamMediaScript, mediaAt, MEDIA_DURATION } from '../src/ui/team-media-script.ts';
it('authors a finite, outward head surface and a genuine shaped nose rather than a spherical head', () => {
  const g = humanHeadGeometry(),
    p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    ix = g.index!;
  expect([...p.array, ...n.array].every(Number.isFinite)).toBe(true);
  let volume = 0;
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let i = 0; i < ix.count; i += 3) {
    a.fromBufferAttribute(p, ix.getX(i));
    b.fromBufferAttribute(p, ix.getX(i + 1));
    c.fromBufferAttribute(p, ix.getX(i + 2));
    volume += a.dot(b.cross(c)) / 6;
  }
  expect(volume).toBeGreaterThan(0.004);
  expect(g.boundingBox!.max.z).toBeGreaterThan(0.117);
  expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(0.3, 6);
  g.dispose();
});
it('replays a fictional person pose exactly and keeps all limb transforms finite', () => {
  const person = new ForegroundPerson(1, 'driver');
  const matrices = () => {
    const values: number[] = [];
    person.root.traverse((o) => values.push(...o.matrixWorld.elements));
    return values;
  };
  person.pose(7, true, 0.2);
  const first = matrices();
  person.pose(7, true, 0.2);
  expect(matrices()).toEqual(first);
  person.pose(11, true, 0.2);
  expect(matrices()).not.toEqual(first);
  person.pose(7, true, 0.2);
  expect(matrices()).toEqual(first);
  expect(first.every(Number.isFinite)).toBe(true);
  expect(() => person.pose(NaN, false, 0)).toThrow();
  person.dispose();
});
it('derives each caption from the actual local save without creating a result or transaction', () => {
  const team = newTeam();
  team.points = 17;
  team.rounds = 3;
  team.week = 7;
  team.research = [{ id: 'rain', remaining: 2 }];
  const before = structuredClone(team),
    lines = teamMediaScript(team);
  expect(team).toEqual(before);
  expect(lines.map((l) => l.text).join(' ')).toContain(
    '17 local rivalry points after 3 classified rounds',
  );
  expect(lines.map((l) => l.text).join(' ')).toContain('2 research weeks remain');
  for (let i = 0; i < lines.length - 1; i++)
    expect(lines[i].start + lines[i].duration).toBe(lines[i + 1].start);
  expect(lines.at(-1)!.start + lines.at(-1)!.duration).toBe(MEDIA_DURATION);
  expect(mediaAt(lines, 6)).toBe(lines[1]);
  expect(mediaAt(lines, 0)).toBe(lines[0]);
  expect(mediaAt(lines, 47)).toBe(lines.at(-1));
  expect(() => mediaAt(lines, NaN)).toThrow();
});

it('keeps garment joint ends finite and full radius instead of detached pointed ellipsoids', async () => {
  const { garmentGeometry } = await import('../src/rendering/foreground-person.ts');
  const g = garmentGeometry([
    [-0.3, 0.04, 0.035],
    [-0.15, 0.055, 0.045],
    [0.03, 0.06, 0.05],
  ]);
  const p = g.getAttribute('position');
  expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
  const end = Array.from({ length: p.count }, (_, i) => i).filter(
    (i) => Math.abs(p.getY(i) + 0.3) < 1e-6,
  );
  expect(end.some((i) => Math.abs(p.getX(i)) > 0.039)).toBe(true);
  const q = new T.Vector3(),
    r = new T.Vector3(),
    s = new T.Vector3();
  let volume = 0;
  for (let i = 0; i < g.index!.count; i += 3) {
    q.fromBufferAttribute(p, g.index!.getX(i));
    r.fromBufferAttribute(p, g.index!.getX(i + 1));
    s.fromBufferAttribute(p, g.index!.getX(i + 2));
    volume += q.dot(r.cross(s)) / 6;
  }
  expect(volume).toBeGreaterThan(0);
  expect(() =>
    garmentGeometry([
      [0, 0.1, 0.1],
      [0, 0.2, 0.2],
    ]),
  ).toThrow();
  g.dispose();
});
