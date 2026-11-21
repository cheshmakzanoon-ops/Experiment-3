import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installMxArenaLighting,
  MX_ARENA_LIGHT,
  MX_ARENA_LIGHT_HOOK,
} from '../src/rendering/offroad/mx-arena-lighting.ts';
import { MxArenaBikeLight } from '../src/rendering/offroad/mx-arena-bike-light.ts';
import { MX_LAMP_OPTICS, mxFloodlightHead, mxFloodlightMount } from '../src/rendering/offroad/mx-floodlight.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { STADIUM } from '../src/rendering/offroad/stadium-dimensions.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { mxHighDetail, setMxQuality } from '../src/rendering/offroad/mx-quality.ts';

const count = (text: string, token: string) => text.split(token).length - 1;
afterEach(() => setMxQuality('high'));

describe('supercross roof floodlight grid', () => {
  it('aims the visible recessed glass into the same cone as each roof fixture', () => {
    const head = mxFloodlightHead();
    const origin = new T.Vector3(8, 23, -7);
    const down = new T.Vector3(0, -1, 0);
    for (const target of [
      new T.Vector3(-5, 1, 6),
      new T.Vector3(23, 1, -3),
      new T.Vector3(8, 0, -7),
    ]) {
      const mount = mxFloodlightMount(origin, target);
      const direction = target.clone().sub(origin).normalize();
      expect(down.clone().transformDirection(mount).dot(direction)).toBeCloseTo(1, 6);
      // The floor projects this tilted row into its reflected view. Derive
      // the same world axis directly from the visible lamp's real mesh.
      const x = new T.Vector3(1, 0, 0).transformDirection(mount);
      const { x: ax, y: ay, z: az } = direction;
      const row = new T.Vector3(1 - ax * ax / (1 - ay), ax, -az * ax / (1 - ay));
      expect(row.distanceTo(x)).toBeLessThan(1e-7);
      // A ray from inside the real light pool must hit the front of all
      // three glass cells, and their normals must face away from the truss.
      const mesh = new T.Mesh(head.glass, new T.MeshBasicMaterial());
      mesh.applyMatrix4(mount);
      mesh.updateMatrixWorld();
      for (const cell of [-0.37, 0, 0.37]) {
        const eye = new T.Vector3(cell + 0.02, -2, 0.011).applyMatrix4(mount);
        const hit = new T.Raycaster(eye, direction.clone().negate()).intersectObject(mesh)[0];
        expect(hit).toBeDefined();
        expect(hit.face!.normal.clone().transformDirection(mount).dot(direction)).toBeGreaterThan(
          0.9,
        );
      }
      mesh.material.dispose();
    }
    for (const part of Object.values(head)) part.dispose();
  });

  it('lights the same six directions as the forty roof lamps at bike height across cell edges', () => {
    const stadium = new Stadium(rigTrack('arena-nord-sx')),
      grid = stadium.lampGrid;
    const field = new MxArenaBikeLight(),
      p = new T.Vector3();
    const w = grid.spanX / grid.columns,
      d = grid.spanZ / grid.rows;
    try {
      for (const [col, row, height] of [
        [0, 0, 1.3],
        [2.5, 2.5, 4],
        [3 - 1e-5, 1, 0.6],
        [3 + 1e-5, 1, 0.6],
      ]) {
        p.set(grid.minX + col * w, grid.y - 22 + height, grid.minZ + row * d);
        field.update(grid, p);
        const plus = new T.Vector3(),
          minus = new T.Vector3();
        for (let z = 0; z < grid.rows; z++)
          for (let x = 0; x < grid.columns; x++) {
            const dir = new T.Vector3(
              grid.minX + (x + 0.5) * w,
              grid.y,
              grid.minZ + (z + 0.5) * d,
            ).sub(p);
            const radius = Math.hypot(x + 0.5 - col, z + 0.5 - row);
            const light =
              (MX_ARENA_LIGHT.intensity * (1 - T.MathUtils.smoothstep(radius, 1, 2))) /
              dir.lengthSq();
            dir.normalize().multiplyScalar(light);
            for (const axis of ['x', 'y', 'z'] as const) {
              plus[axis] += Math.max(0, dir[axis]);
              minus[axis] += Math.max(0, -dir[axis]);
            }
          }
        expect(field.positive.value.distanceTo(plus)).toBeLessThan(1e-7);
        expect(field.negative.value.distanceTo(minus)).toBeLessThan(1e-7);
      }
      field.update(undefined, p);
      expect(field.key.value.w).toBe(0);
    } finally {
      stadium.dispose();
    }
  });

  it('splits specular energy continuously across the roof, including a parked preset change and outdoor rewind', () => {
    const grid = { minX: -80, minZ: -50, spanX: 160, spanZ: 100, columns: 8, rows: 5, y: 26 };
    const light = new MxArenaBikeLight(), p = new T.Vector3(0, 1.4, 0);
    try {
      setMxQuality('high');
      light.update(grid,p);
      const west = light.west.value, east = light.east.value;
      expect(west.w + east.w).toBeCloseTo(light.key.value.w, 12);
      expect(west.w).toBeCloseTo(east.w, 10);
      expect(east.x - west.x).toBeGreaterThan(0.55);
      for (const bank of [west,east]) expect(Math.hypot(bank.x, bank.y, bank.z)).toBeCloseTo(1, 12);
      p.x = 10 - 1e-4;
      light.update(grid,p);
      const previous = west.clone();
      p.x += 2e-4;
      light.update(grid,p);
      expect(west.clone().sub(previous).length()).toBeLessThan(0.001);
      setMxQuality('medium');
      light.update(grid,p);
      expect(west.w + east.w).toBe(0);
      expect(light.key.value.w).toBeGreaterThan(0);
      setMxQuality('high');
      light.update(grid,p);
      expect(west.w + east.w).toBeCloseTo(light.key.value.w,12);
      light.update(undefined,p);
      expect(west.w + east.w + light.key.value.w).toBe(0);
    } finally {
      setMxQuality('high');
    }
  });

  it('retains its single haze draw on Medium without enabling High surface detail', () => {
    setMxQuality('medium');
    const stadium = new Stadium(rigTrack('arena-nord-sx'));
    try {
      const haze = stadium.root.getObjectByName('Arena floodlight haze beams') as T.Mesh;
      expect(haze).toBeInstanceOf(T.Mesh);
      expect(haze.visible).toBe(true);
      expect(mxHighDetail()).toBe(false);
      const geometry = haze.geometry;
      setMxQuality('low');
      expect(haze.visible).toBe(false);
      for (const preset of ['medium', 'high', 'ultra'] as const) {
        setMxQuality(preset);
        expect(haze.visible).toBe(true);
        expect(haze.geometry).toBe(geometry);
      }
    } finally {
      stadium.dispose();
    }
  });

  it('exposes the 8 x 5 lamp grid the trusses hang, over the floor and inside the bowl', () => {
    const track = rigTrack('arena-nord-sx'),
      stadium = new Stadium(track),
      grid = stadium.lampGrid;
    try {
      expect(grid.columns).toBe(8);
      expect(grid.rows).toBe(5);
      expect(grid.spanX).toBeGreaterThan(40);
      expect(grid.spanZ).toBeGreaterThan(20);
      const lenses = stadium.root.getObjectByName('Merged arena round floodlight lenses') as T.Mesh<
        T.BufferGeometry,
        T.MeshStandardMaterial
      >;
      expect(lenses.material.emissive.getHex()).toBe(MX_ARENA_LIGHT.colour);
      expect(lenses.material.emissiveIntensity).toBe(MX_LAMP_OPTICS.radiance);
      // Hung from the roof's trusses (2 m under the deck) with the housing below.
      const box = new T.Box3().setFromObject(stadium.root);
      expect(grid.y).toBeLessThan(box.min.y + STADIUM.roof);
      expect(grid.y).toBeGreaterThan(box.min.y + STADIUM.roof - 6);
      // The first and last lamps sit half a cell inside the grid's edge.
      const cellX = grid.spanX / grid.columns;
      expect(grid.minX + 0.5 * cellX).toBeGreaterThan(grid.minX);
      expect(grid.minX + (grid.columns - 0.5) * cellX).toBeLessThan(grid.minX + grid.spanX);
    } finally {
      stadium.dispose();
    }
  });

  it('chains once onto the floor and fades every lamp out before a cell edge shows', () => {
    const track = rigTrack('arena-nord-sx'),
      view = new TerrainView(track),
      grid = { minX: -40, minZ: -20, spanX: 80, spanZ: 40, y: 30, columns: 8, rows: 5 };
    const uniform = installMxArenaLighting(view.material, grid);
    expect(uniform).not.toBeNull();
    expect(installMxArenaLighting(view.material, grid)).toBeNull();
    expect(studioHookKeys(view.material)).toContain(MX_ARENA_LIGHT_HOOK);
    const source = T.ShaderLib.physical,
      shader = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as StudioShader;
    view.material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    expect(f).toContain('float mxArenaIrradiance( vec3 world, vec3 up )');
    expect(f).toContain('reflectedLight.directDiffuse *= mxArenaColour.a;');
    const highFloor = f.slice(f.indexOf('#if defined(MX_HIGH_DETAIL) && defined(MX_SOIL_HAS_WATER_FILM)'));
    expect(f).toContain('#define MX_SOIL_HAS_WATER_FILM');
    expect(highFloor.slice(0, highFloor.indexOf('#endif'))).toContain(
      'mxArenaFloorReflection(vApexWorld, filmUp, eye, gloss)',
    );
    expect(count(f, '{')).toBe(count(f, '}'));
    expect(count(f, '(')).toBe(count(f, ')'));
    // 4 x 4 lamps suffice because the fade reaches zero by the reach, two cells.
    expect(MX_ARENA_LIGHT.reachCells).toBeLessThanOrEqual(2);
    expect((shader.uniforms.mxArenaGrid.value as T.Vector4).z).toBeCloseTo(10, 6);
    expect((shader.uniforms.mxArenaLamp.value as T.Vector4).toArray()).toEqual([8, 5, 30, 1]);
    // The actual glass, photographed soil and race plastics use the same lamp white.
    const floor = shader.uniforms.mxArenaColour.value as T.Vector4;
    const lampWhite = new T.Color(
      floor.x / MX_ARENA_LIGHT.intensity,
      floor.y / MX_ARENA_LIGHT.intensity,
      floor.z / MX_ARENA_LIGHT.intensity,
    );
    expect(lampWhite.getHex()).toBe(MX_ARENA_LIGHT.colour);
    const plastic = new T.MeshPhysicalMaterial();
    const sample = new T.Mesh(new T.BoxGeometry(), plastic);
    new MxArenaBikeLight().bind(sample);
    const bikeShader = {
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms: T.UniformsUtils.clone(source.uniforms),
    } as StudioShader;
    plastic.onBeforeCompile(bikeShader, {} as T.WebGLRenderer);
    expect((bikeShader.uniforms.mxBikeRoofColour.value as T.Color).getHex()).toBe(
      lampWhite.getHex(),
    );
    sample.geometry.dispose();
    plastic.dispose();
    uniform!.value.w = 0;
    expect((shader.uniforms.mxArenaLamp.value as T.Vector4).w).toBe(0);
    view.dispose();
  });
});
