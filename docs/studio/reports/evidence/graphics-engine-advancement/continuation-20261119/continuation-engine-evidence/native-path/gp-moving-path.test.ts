import { afterEach, describe, expect, it, vi } from "vitest";
import { BikeAIDriver } from "../src/simulation/bike-ai.ts";
import { GP_R1 } from "../src/simulation/bike-definitions.ts";
import { BikeVehicle } from "../src/simulation/bike-vehicle.ts";
import { DEFAULT_SETUP } from "../src/simulation/config.ts";
import { racingLineFor, RACING_LINE } from "../src/simulation/racing-line.ts";
import { Track, trackPoint } from "../src/simulation/track.ts";

class MovingPathProbe extends BikeAIDriver {
  select(lane: number, previousLane: number, dt: number) {
    Object.assign(this.selectedRoadPath, {
      valid: true,
      width: 1,
      lane,
      previousLane,
      dt,
    });
  }

  selectedOffsetForTest(track: Track, station: number) {
    return this.selectedRoadOffset(track, station);
  }

  correction(track: Track) {
    return this.pathCorrection(track, this.selectedRoadPath.lane, false);
  }
}

const native = (driver: MovingPathProbe) =>
  driver as unknown as {
    steerIntent(track: Track, steer: number): number;
    steeringTarget: number;
    steeringCorrection: number;
  };

const origin = 100,
  reach = 8 - RACING_LINE.edgeMargin;

/** Prescribe an independent straight centreline and a world path
 * x(s,t) = slope * (s-origin) + lane(t), z(s,t) = s. Only road geometry
 * is controlled; the production selected path and GP correction run intact. */
function fixture(slope = 0) {
  const track = new Track("clear", true),
    line = racingLineFor(track),
    bike = new BikeVehicle(0, "medium", DEFAULT_SETUP, "sport", GP_R1),
    driver = new MovingPathProbe(bike);
  vi.spyOn(track, "at").mockImplementation((s, out = trackPoint()) =>
    Object.assign(out, {
      s,
      x: 0,
      y: 0,
      z: s,
      tx: 0,
      tz: 1,
      nx: 1,
      nz: 0,
      width: 8,
      curvature: 0,
      gradient: 0,
      bank: 0,
    }),
  );
  vi.spyOn(line, "offsetAt").mockImplementation((s) => slope * (s - origin));
  vi.spyOn(line, "curvatureAt").mockReturnValue(0);
  return { track, bike, driver };
}

/** Set actual world velocity first, then encode it in the chassis frame.
 * Expected zero correction therefore does not reuse the controller's
 * inverse trigonometric expression for the moving reference heading. */
function follow(
  bike: BikeVehicle,
  station: number,
  offset: number,
  worldX: number,
  worldZ: number,
  sideslip = 0,
) {
  const groundSpeed = Math.hypot(worldX, worldZ),
    forwardSpeed = Math.sqrt(groundSpeed * groundSpeed - sideslip * sideslip);
  bike.s = station;
  bike.lateral = offset;
  bike.speed = bike.dynamics.speed = forwardSpeed;
  bike.dynamics.motoGP!.reset(forwardSpeed);
  bike.dynamics.motoGP!.lateralSpeed = sideslip;
  bike.dynamics.heading =
    Math.atan2(worldX, worldZ) - Math.atan2(sideslip, forwardSpeed);
}

function acceleration(
  driver: MovingPathProbe,
  bike: BikeVehicle,
  track: Track,
) {
  return driver.correction(track) * bike.dynamics.speed ** 2;
}

afterEach(() => vi.restoreAllMocks());

describe("GP tracking follows the selected path in space and time", () => {
  it.each([1 / 120, 1 / 240])(
    "requests no correction on a moving world path at dt=%s",
    (dt) => {
      for (const slope of [0, 0.25, -0.25]) {
        const { track, bike, driver } = fixture(slope);
        for (const rate of [-1.6, 1.6]) {
          driver.select(0, -rate * dt, dt);
          follow(bike, origin, 0, slope * 30 + rate, 30);
          expect(Math.abs(acceleration(driver, bike, track))).toBeLessThan(
            1e-10,
          );
          expect(native(driver).steeringTarget).toBe(0);
        }
      }
    },
  );

  it("does not count travel along a stationary authored lane as temporal lane motion", () => {
    const slope = 0.25,
      lane = 1,
      { track, bike, driver } = fixture(slope);
    for (const station of [origin, origin + 9]) {
      driver.select(lane, lane, 1 / 120);
      follow(bike, station, slope * (station - origin) + lane, slope * 30, 30);
      expect(Math.abs(acceleration(driver, bike, track))).toBeLessThan(1e-10);
    }
  });

  it("retains the current selected lane when the same lane clips at the preview", () => {
    const slope = 0.2,
      lane = 3,
      { track, bike, driver } = fixture(slope),
      speed = 30,
      near = 6 + 0.48 * speed;
    driver.select(lane, lane, 1 / 120);
    // Native steering reads forward speed for this lookahead. Construct a
    // stationary diagonal world path at that same physical speed.
    const alongSpeed = speed / Math.hypot(1, slope);
    follow(bike, origin, lane, slope * alongSpeed, alongSpeed);
    bike.aiOffset = reach;
    native(driver).steerIntent(track, 0);
    expect(driver.selectedOffsetForTest(track, origin)).toBe(lane);
    expect(driver.selectedOffsetForTest(track, origin + near)).toBe(reach);
    expect(native(driver).steeringTarget).toBe(lane);
    expect(Math.abs(native(driver).steeringCorrection)).toBeLessThan(1e-10);
  });

  it.each([1 / 120, 1 / 240])(
    "uses the realized local target rate at a road edge at dt=%s",
    (dt) => {
      const { track, bike, driver } = fixture(),
        clampToRoad = (offset: number) =>
          Math.max(-reach, Math.min(reach, offset));
      for (const side of [-1, 1]) {
        for (const [oldLane, requestedRate] of [
          [side * (reach + 0.1), side * 1.6],
          [side * (reach - 0.004), side * 1.6],
          [side * reach, -side * 1.6],
        ]) {
          const nextLane = oldLane + requestedRate * dt,
            before = clampToRoad(oldLane),
            after = clampToRoad(nextLane),
            actualRate = (after - before) / dt;
          driver.select(nextLane, oldLane, dt);
          follow(bike, origin, after, actualRate, 30);
          expect(Math.abs(acceleration(driver, bike, track))).toBeLessThan(
            1e-10,
          );
          expect(native(driver).steeringTarget).toBe(after);
        }
      }
    },
  );

  it("uses ground speed when body sideslip represents the same moving world course", () => {
    const slope = 0.25,
      rate = 1.6,
      dt = 1 / 120,
      { track, bike, driver } = fixture(slope);
    driver.select(0, -rate * dt, dt);
    for (const sideslip of [-2, 0, 2]) {
      follow(bike, origin, 0, slope * 30 + rate, 30, sideslip);
      expect(Math.abs(acceleration(driver, bike, track))).toBeLessThan(1e-10);
    }
  });
});
