import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MxDustMaterial } from '../src/rendering/offroad/mx-dust-material.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { Roost } from '../src/rendering/offroad/roost.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
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
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

afterEach(() => setMxQuality('high'));

describe('MX dust fades into the soil it was thrown from', () => {
  it('reads each puff birth floor and fades its lower part only on High and Ultra', () => {
    const dust = new MxDustMaterial();
    expect(dust.vertexShader).toContain('attribute float mxParticleFloor;');
    expect(dust.vertexShader).toContain(
      'vMxDustHeight = ( modelMatrix * vec4( position, 1.0 ) ).y - mxParticleFloor;',
    );
    const fragment = dust.fragmentShader;
    const gate = fragment.indexOf('#ifdef MX_HIGH_DETAIL', fragment.indexOf('float opacity'));
    const fade = fragment.indexOf('vMxDustHeight - p.y * vMxDustRadius');
    expect(gate).toBeGreaterThan(0);
    // The ground fade sits inside the High/Ultra gate, ahead of the discard.
    expect(fade).toBeGreaterThan(gate);
    expect(fade).toBeLessThan(fragment.indexOf('if ( opacity < 0.008 ) discard;'));
    expect((dust as T.Material & { defines: Record<string, string> }).defines).toHaveProperty(
      'MX_HIGH_DETAIL',
    );
    setMxQuality('low');
    expect((dust as T.Material & { defines: Record<string, string> }).defines).not.toHaveProperty(
      'MX_HIGH_DETAIL',
    );
    dust.dispose();
  });

  it('publishes the floor of every live particle with the pool', () => {
    const track = rigTrack('valley-ridge-mx'),
      roost = new Roost(track),
      frame = new Float32Array(HEADER + CAR_STRIDE),
      p = track.at(100, trackPoint()),
      b = carBase(0),
      yaw = Math.atan2(p.tx, p.tz);
    frame[H.CARS] = 1;
    frame[b + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    frame[b + F.X] = p.x;
    frame[b + F.Y] = p.y + 0.55;
    frame[b + F.Z] = p.z;
    frame[b + F.QY] = Math.sin(yaw / 2);
    frame[b + F.QW] = Math.cos(yaw / 2);
    frame[b + F.SPEED] = 15;
    frame[b + F.VX] = p.tx * 15;
    frame[b + F.VZ] = p.tz * 15;
    for (const wheel of [0, 2]) {
      const w = b + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[w + W.LOAD] = 600;
      frame[w + W.SLIP] = 0.3;
      frame[w + W.SURFACE] = MATERIAL.DIRT;
    }
    for (let i = 0; i < 30; i++) roost.update(frame, 1 / 60);
    const floor = roost.points.geometry.getAttribute('mxParticleFloor') as T.BufferAttribute,
      position = roost.points.geometry.getAttribute('position') as T.BufferAttribute;
    expect(floor.itemSize).toBe(1);
    expect(floor.count).toBe(position.count);
    let live = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < -1000) continue;
      live++;
      // A puff is born a few centimetres over the soil it left.
      expect(position.getY(i) - floor.getX(i)).toBeGreaterThan(-0.2);
      expect(position.getY(i) - floor.getX(i)).toBeLessThan(4);
    }
    expect(live).toBeGreaterThan(10);
    roost.dispose();
  });
});
