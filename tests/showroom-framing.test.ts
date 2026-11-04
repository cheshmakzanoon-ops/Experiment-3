import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  BIKE_SHOWROOM,
  SHOWROOM,
  SHOWROOM_FILL,
  showroomFor,
  showroomRadius,
  showroomShift,
  showroomSpan,
  type ShowroomBox,
  type ShowroomWindow,
} from '../src/rendering/menu-preview.ts';
import { measureShowroomBox } from '../src/rendering/showroom-bounds.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

/** The strip between the board and the paddock rail at the review viewports, from the layout rules in
 * front-end.css (board 488 px, rail 204 px, or 184 px at 1440 wide and under, 32 px margins and a
 * 16 px gap; everything x1.2 from 1600x900). */
const VIEWPORTS: Record<string, { width: number; height: number; free: ShowroomWindow }> = {
  '1280x720': { width: 1280, height: 720, free: { left: 520 / 1280, right: 1064 / 1280 } },
  '1280x800': { width: 1280, height: 800, free: { left: 520 / 1280, right: 1064 / 1280 } },
  '1920x1080': { width: 1920, height: 1080, free: { left: 624 / 1920, right: 1637 / 1920 } },
  '1024x600': { width: 1024, height: 600, free: { left: 520 / 1024, right: 992 / 1024 } },
};
const halfBox = (id: string): ShowroomBox => {
  const [hx, , hz] = VEHICLES[id].halfExtents;
  return { minX: -hx, maxX: hx, minZ: -hz, maxZ: hz };
};
const lensFor = (id: string) =>
  VEHICLES[id].bike ? BIKE_SHOWROOM : showroomFor(VEHICLES[id].halfExtents[2] * 2);
const angles = (lens: { angle: number; sway: number }) =>
  [-1, -0.5, 0, 0.5, 1].map((k) => lens.angle + k * lens.sway);

describe('showroom framing: the machine fits the strip the menu leaves free', () => {
  it('keeps the authored camera when the layout was not measured', () => {
    expect(showroomRadius(SHOWROOM, halfBox('apx01'), 16 / 9, null)).toBe(SHOWROOM.radius);
    expect(showroomRadius(SHOWROOM, halfBox('apx01'), 16 / 9, { left: 0.5, right: 0.55 })).toBe(
      SHOWROOM.radius,
    );
  });
  it('is the original composition where the machine already fits', () => {
    // A very wide strip (nothing in the way): the authored radius is kept.
    const wide = { left: 0.05, right: 0.95 };
    expect(showroomRadius(SHOWROOM, halfBox('apx01'), 16 / 9, wide)).toBe(SHOWROOM.radius);
  });
  for (const [name, vp] of Object.entries(VIEWPORTS))
    for (const id of ['apx01', 'eh3', 'gpr1', 'mx450', 'sc7', 'fx26']) {
      if (!VEHICLES[id]) continue;
      it(`${id} sits inside the free strip at ${name} through the whole orbit`, () => {
        const lens = lensFor(id),
          box = halfBox(id),
          aspect = vp.width / vp.height;
        const radius = showroomRadius(lens, box, aspect, vp.free);
        expect(radius).toBeGreaterThanOrEqual(lens.radius);
        for (const angle of angles(lens)) {
          const shift = showroomShift(lens, box, aspect, vp.free, radius, angle);
          const span = showroomSpan(box, angle, radius, shift, lens.fov, aspect);
          const left = (span.left + 1) / 2,
            right = (span.right + 1) / 2;
          // Inside the strip, with the margin the fill share leaves, and centred in it.
          expect(left, `${id} ${name} left edge`).toBeGreaterThan(vp.free.left);
          expect(right, `${id} ${name} right edge`).toBeLessThan(vp.free.right);
          expect((left + right) / 2, `${id} ${name} centre`).toBeCloseTo(
            (vp.free.left + vp.free.right) / 2,
            2,
          );
          // A machine that needed the camera to back off fills the strip to the fill share.
          if (radius > lens.radius + 1e-6 && angle === angles(lens)[0])
            expect(right - left).toBeLessThanOrEqual(
              (vp.free.right - vp.free.left) * SHOWROOM_FILL + 1e-3,
            );
        }
      });
    }
  it('backs the camera off for a wide car in a narrow strip, but never past the limit', () => {
    const lens = SHOWROOM;
    const strip = { left: 0.41, right: 0.83 };
    const r = showroomRadius(lens, halfBox('apx01'), 16 / 9, strip);
    expect(r).toBeGreaterThan(lens.radius * 1.3);
    expect(r).toBeLessThanOrEqual(lens.radius * 2.2 + 1e-9);
    // An absurdly thin strip is capped, not chased.
    expect(showroomRadius(lens, halfBox('apx01'), 16 / 9, { left: 0.5, right: 0.62 })).toBeCloseTo(
      lens.radius * 2.2,
      6,
    );
  });
  it('aims further left of the car for a strip right of the middle', () => {
    const box = halfBox('apx01');
    const near = showroomShift(SHOWROOM, box, 16 / 9, { left: 0.45, right: 0.65 }, 9.4, 0.72);
    const far = showroomShift(SHOWROOM, box, 16 / 9, { left: 0.65, right: 0.95 }, 9.4, 0.72);
    expect(far).toBeGreaterThan(near);
    expect(showroomShift(SHOWROOM, box, 16 / 9, { left: 0.3, right: 0.7 }, 9.4, 0.72)).toBeCloseTo(
      0,
      0,
    );
  });
});

describe('measureShowroomBox reads the drawn meshes', () => {
  const part = (w: number, h: number, d: number, x = 0, z = 0, y = 0.4) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial());
    mesh.position.set(x, y, z);
    return mesh;
  };
  const fallback = { halfWidth: 0.94, halfLength: 2.5 };
  it('measures the extent in the machine frame whatever its pose', () => {
    const root = new T.Group();
    // Nose 0.2 m further forward than the tail, like a formula car's wing.
    root.add(part(1.8, 0.5, 4.8, 0, 0.1));
    root.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), 1.1);
    root.position.set(40, 0.3, -12);
    const box = measureShowroomBox(root, fallback);
    expect(box.minX).toBeCloseTo(-0.9, 5);
    expect(box.maxX).toBeCloseTo(0.9, 5);
    expect(box.minZ).toBeCloseTo(-2.3, 5);
    expect(box.maxZ).toBeCloseTo(2.5, 5);
    // The pose was put back.
    expect(root.position.x).toBe(40);
    expect(
      root.quaternion.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 1.1)),
    ).toBeLessThan(1e-6);
  });
  it('ignores hidden parts and flat translucent shadow planes', () => {
    const root = new T.Group();
    root.add(part(1.8, 0.5, 4.8));
    const hidden = part(1.8, 0.5, 9);
    hidden.visible = false;
    const shadow = new T.Mesh(
      new T.PlaneGeometry(4, 9).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ transparent: true, opacity: 0.4 }),
    );
    root.add(hidden, shadow);
    const box = measureShowroomBox(root, fallback);
    expect(box.maxZ - box.minZ).toBeCloseTo(4.8, 5);
    expect(box.maxX - box.minX).toBeCloseTo(1.8, 5);
  });
  it('falls back to the collision box for an empty or implausible measurement', () => {
    const empty = measureShowroomBox(new T.Group(), fallback);
    expect(empty).toEqual({ minX: -0.94, maxX: 0.94, minZ: -2.5, maxZ: 2.5 });
    const huge = new T.Group();
    huge.add(part(1.8, 0.5, 20));
    expect(measureShowroomBox(huge, fallback)).toEqual(empty);
  });
});
