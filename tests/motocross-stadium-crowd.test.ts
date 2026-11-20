import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { crowdGarmentColour } from '../src/rendering/crowd-wardrobe.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

function compile(material: T.Material) {
  const source = T.ShaderLib.standard;
  const shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('motocross stadium audience', () => {
  it('assigns every lower-row seat to cards on Low and Medium and restores its sculpt on High', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const range = compile(arena.crowd.material as T.Material).uniforms.crowdLodRange
      .value as T.Vector2;
    const version = arena.nearCrowd.instanceMatrix.version;
    try {
      for (const preset of ['low', 'medium', 'high', 'ultra', 'medium', 'high'] as const) {
        setMxQuality(preset);
        const close = preset === 'high' || preset === 'ultra';
        expect(arena.nearCrowd.visible).toBe(close);
        expect(range.x).toBe(close ? 0.2 : 0);
        expect(arena.crowd.visible).toBe(true);
        expect(range.y).toBe(1);
      }
      expect(arena.nearCrowd.instanceMatrix.version).toBe(version);
    } finally {
      setMxQuality('high');
      arena.dispose();
    }
  });
  it('draws every occupied seat once with detailed lower rows below the previous crowd geometry cost', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const all = arena.crowd,
      close = arena.nearCrowd,
      phases = all.geometry.getAttribute('spectatorPhase'),
      closePhases = close.geometry.getAttribute('spectatorPhase');
    const shader = compile(all.material as T.Material);
    const range = shader.uniforms.crowdLodRange.value as T.Vector2;
    const chairs = arena.root.getObjectByName(
      'Moulded stadium chairs (instanced)',
    ) as T.InstancedMesh;
    const a = new T.Matrix4(),
      b = new T.Matrix4();
    let closeIndex = 0,
      distantCount = 0,
      meshes = 0,
      triangles = 0;
    for (let i = 0; i < all.count; i++) {
      const phase = phases.getX(i);
      if (phase / (Math.PI * 2) < range.x) {
        expect(closePhases.getX(closeIndex)).toBe(phase);
        all.getMatrixAt(i, a);
        close.getMatrixAt(closeIndex, b);
        expect(a.elements).toEqual(b.elements);
        closeIndex++;
      } else distantCount++;
    }
    expect(closeIndex).toBe(close.count);
    expect(close.count).toBeGreaterThan(200);
    expect(closeIndex + distantCount).toBe(all.count);
    // Empty bucket seats still belong to the bowl. Check every occupied
    // chair against the actual planned row, including a standing person's
    // different vertical offset from the pan.
    const style = all.geometry.getAttribute('spectatorStyle');
    const floorLocations = new Set<string>(),
      m = new T.Matrix4(),
      v = new T.Vector3();
    const key = (p: T.Vector3) => [p.x, p.y, p.z].map((n) => Math.round(n * 100)).join(',');
    for (let i = 0; i < chairs.count; i++) {
      chairs.getMatrixAt(i, m);
      floorLocations.add(key(v.setFromMatrixPosition(m)));
    }
    const people = new Set<string>();
    for (let i = 0; i < all.count; i++) {
      all.getMatrixAt(i, m);
      // The spectator pose faces sideways in the shared authored kit.
      const floor = v.set(0.02, style.getZ(i) > 0.5 ? -0.3 : -0.485, 0).applyMatrix4(m);
      people.add(key(floor));
    }
    expect(people.size).toBe(all.count);
    expect([...people].every((position) => floorLocations.has(position))).toBe(true);
    expect(chairs.count).toBeGreaterThan(all.count);
    expect(all.count).toBeGreaterThan(1000);
    arena.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      meshes++;
      triangles +=
        (object.geometry.index!.count / 3) * (object instanceof T.InstancedMesh ? object.count : 1);
    });
    const submittedCrowd =
      (all.geometry.index!.count / 3) * all.count + (close.geometry.index!.count / 3) * close.count;
    // The old shared person used 220 clothing triangles plus a 56-triangle
    // head for every seat. The new distant representation costs two triangles.
    const previousCrowd = 276 * all.count;
    expect(submittedCrowd).toBeLessThan(previousCrowd * 0.5);
    expect(meshes).toBeLessThanOrEqual(15);
    console.info(
      JSON.stringify({
        seats: all.count,
        sculpted: close.count,
        distant: distantCount,
        meshes,
        submittedCrowd,
        previousCrowd,
        totalStadiumTriangles: triangles,
      }),
    );
    arena.dispose();
  });

  it('submits only the resolved sculpts and restores each original seat and garment across camera cuts', () => {
    setMxQuality('high');
    const track = rigTrack('arena-nord-sx');
    const arena = new Stadium(track);
    const camera = new T.PerspectiveCamera(55, 1.6, 0.08, 700);
    const cards = arena.crowd,
      people = arena.nearCrowd;
    const occupancy = cards.count,
      possible = people.count;
    const mask = cards.geometry.getAttribute('sculptedSeat') as T.InstancedBufferAttribute;
    const cardMatrix = new T.Matrix4(),
      sculptMatrix = new T.Matrix4();
    const cardColour = new T.Color(),
      sculptColour = new T.Color();
    const seatIds = () => Array.from(mask.array).flatMap((v, i) => (v === 1 ? [i] : []));
    const candidates = seatIds();
    const verify = () => {
      const seats = seatIds();
      expect(seats).toHaveLength(people.count);
      expect(cards.count).toBe(occupancy);
      for (let i = 0; i < seats.length; i++) {
        const row = seats[i];
        cards.getMatrixAt(row, cardMatrix);
        people.getMatrixAt(i, sculptMatrix);
        expect(sculptMatrix.equals(cardMatrix)).toBe(true);
        cards.getColorAt(row, cardColour);
        people.getColorAt(i, sculptColour);
        expect(sculptColour.equals(cardColour)).toBe(true);
        for (const name of ['spectatorPhase', 'spectatorSkin', 'spectatorStyle']) {
          const a = cards.geometry.getAttribute(name),
            b = people.geometry.getAttribute(name);
          for (let j = 0; j < a.itemSize; j++)
            expect(b.array[i * b.itemSize + j]).toBe(a.array[row * a.itemSize + j]);
        }
      }
      return seats;
    };
    try {
      const gate = track.at(track.length - 8, trackPoint());
      const eye = new T.Vector3(gate.x, gate.y + 2.5, gate.z);
      camera.position.copy(eye);
      camera.lookAt(eye.x + gate.tx, eye.y - 0.03, eye.z + gate.tz);
      const forward = camera.quaternion.clone();
      arena.audience.update(camera);
      const gateSeats = verify();
      expect(gateSeats.length).toBeLessThan(possible * 0.45);
      expect(gateSeats.length).toBeGreaterThan(0);
      const unchanged = people.instanceMatrix.version;
      arena.audience.update(camera);
      expect(people.instanceMatrix.version).toBe(unchanged);
      camera.position.set(1000, 1000, 1000);
      arena.audience.update(camera);
      expect(verify()).toHaveLength(0);
      camera.position.copy(eye);
      arena.audience.update(camera);
      expect(verify()).toEqual(gateSeats);
      camera.rotateY(Math.PI);
      arena.audience.update(camera);
      const reverse = verify();
      expect(reverse).not.toEqual(gateSeats);
      expect(reverse.filter((seat) => gateSeats.includes(seat)).length).toBeLessThan(gateSeats.length / 3);
      camera.quaternion.copy(forward);
      arena.audience.update(camera);
      expect(verify()).toEqual(gateSeats);
      camera.fov = 20;
      camera.updateProjectionMatrix();
      arena.audience.update(camera);
      expect(people.count).toBeGreaterThan(gateSeats.length);
      console.info(
        JSON.stringify({
          occupied: occupancy,
          possibleSculpts: possible,
          gateSculpts: gateSeats.length,
          telephotoSculpts: people.count,
          trianglesPerSculpt: people.geometry.index!.count / 3,
        }),
      );
      const frustum = new T.Frustum(), sphere = new T.Sphere(new T.Vector3(), 1.8);
      const cell = new T.Vector3(), matrix = new T.Matrix4();
      const phases = cards.geometry.getAttribute('spectatorPhase');
      let tested = 0;
      // A banked camera, a portrait lens, an off-centre crop and motion near
      // bucket boundaries must retain every potentially visible resolved seat.
      for (const fov of [20, 55, 85]) {
        for (const aspect of [0.65, 1.6]) {
          camera.aspect = aspect;
          camera.fov = fov;
          camera.setViewOffset(1200, 740, 168, 32, 958, 673);
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
          camera.position.copy(eye).addScalar(0.92);
          camera.quaternion.copy(forward);
          camera.rotateY(0.04);
          camera.rotateZ(0.47);
          camera.updateMatrixWorld(true);
          arena.audience.update(camera);
          frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          cell.copy(camera.position).multiplyScalar(0.5).round().multiplyScalar(2);
          const focal = Math.tan(25 * Math.PI / 180) / Math.tan(fov * Math.PI / 360);
          const radius = Math.round(T.MathUtils.clamp(62 * focal, 48, 180));
          for (const i of candidates) {
            cards.getMatrixAt(i, matrix);
            sphere.center.setFromMatrixPosition(matrix);
            const reach = radius * (0.87 + 0.26 * phases.getX(i) / (0.4 * Math.PI));
            if (sphere.center.distanceToSquared(cell) > reach * reach || !frustum.intersectsSphere(sphere)) continue;
            expect(mask.getX(i)).toBe(1);
            tested++;
          }
        }
      }
      expect(tested).toBeGreaterThan(500);
      const shader = compile(cards.material as T.Material);
      expect(shader.vertexShader).toContain('sculptedSeat > .5');
      expect(shader.fragmentShader).not.toContain('vCrowdRank < crowdLodRange.x');
    } finally {
      arena.dispose();
    }
  });

  it('keeps mixed seated/standing figures and muted clothing without modifying the seat plan', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const crowd = arena.crowd,
      styles = crowd.geometry.getAttribute('spectatorStyle'),
      phases = crowd.geometry.getAttribute('spectatorPhase'),
      color = new T.Color(),
      garment = new T.Color();
    let standing = 0,
      luminance = 0;
    const tones = new Set<string>();
    for (let i = 0; i < crowd.count; i++) {
      standing += styles.getZ(i) > 0.5 ? 1 : 0;
      crowd.getColorAt(i, color);
      crowdGarmentColour(color, phases.getX(i), garment);
      luminance += garment.r * 0.2126 + garment.g * 0.7152 + garment.b * 0.0722;
      tones.add(garment.getHexString());
    }
    expect(standing / crowd.count).toBeGreaterThan(0.15);
    expect(standing / crowd.count).toBeLessThan(0.4);
    expect(tones.size).toBeGreaterThan(200);
    expect(luminance / crowd.count).toBeGreaterThan(0.04);
    expect(luminance / crowd.count).toBeLessThan(0.18);
    arena.dispose();
  });

  it('freezes on held simulation time and exactly restores all animated uniforms after seeking', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    const shader = compile(arena.nearCrowd.material as T.Material);
    const state = () => ({
      clock: (shader.uniforms.crowdClock.value as T.Vector2).toArray(),
      reaction: (shader.uniforms.crowdReaction.value as T.Vector2).toArray(),
      motion: shader.uniforms.crowdMotion.value,
    });
    const instances = Array.from(arena.nearCrowd.instanceMatrix.array);
    arena.update(17.25);
    const held = state();
    arena.update(17.25);
    expect(state()).toEqual(held);
    arena.update(45);
    expect(state()).not.toEqual(held);
    arena.update(17.25);
    expect(state()).toEqual(held);
    expect(Array.from(arena.nearCrowd.instanceMatrix.array)).toEqual(instances);
    expect(() => arena.update(Number.NaN)).toThrow('Invalid stadium presentation time');
    arena.dispose();
    expect(arena.root.children).toHaveLength(0);
  });
});
