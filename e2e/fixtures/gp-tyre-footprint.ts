import * as T from 'three';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { roadTyreSection } from '../../src/simulation/bike-tyre-profile.ts';
import { tyreGeometry } from '../../src/rendering/bike.ts';
import { GpTyreCarcass } from '../../src/rendering/gp-tyre-carcass.ts';
import { RoadBikeContactPose, RoadBikeWheelPose } from '../../src/rendering/road-bike-pose.ts';

/** An orthographic profile through the actual spinning rear slick. Read
 * coverage just above the road so shading and exposure cannot affect the
 * measured length; the sketch has no ground mesh to conceal penetration. */
export function captureGpTyreFootprint() {
  const width = 640,
    height = 400,
    span = 0.64,
    cameraY = 0.164;
  const renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-span / 2, span / 2, 0.2, -0.2, 0.02, 6);
  const ground = new T.DirectionalLight(0xffffff, 2);
  ground.position.set(2, 3, -2);
  ground.castShadow = true;
  ground.shadow.mapSize.set(128, 128);
  const lamp = new T.PointLight(0xffdfb5, 5);
  lamp.position.set(-0.5, 1, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(64, 64);
  scene.add(new T.HemisphereLight(0xd8eaff, 0x676158, 1.8), ground, lamp);
  const definition = VEHICLES.gpr2,
    spec = definition.bike!,
    section = roadTyreSection(definition.classId);
  const geometry = tyreGeometry(
    spec.rearWheelRadius,
    section.rearHalfWidth,
    section.rearCrown,
    0.2199,
    40,
  );
  const rubber = new T.MeshStandardMaterial({ color: 0x62646a, roughness: 0.73 });
  const paint = new T.MeshStandardMaterial();
  const skin = new GpTyreCarcass(rubber, paint),
    mesh = new T.Mesh(geometry, rubber);
  mesh.customDepthMaterial = skin.depth;
  mesh.customDistanceMaterial = skin.distance;
  mesh.castShadow = true;
  scene.add(mesh);
  const road = new RoadBikeContactPose(),
    wheels = new RoadBikeWheelPose();
  road.valid = true;
  road.points[0].z = spec.cgToFront;
  road.points[1].z = -spec.cgToRear;
  const orientation = new T.Quaternion(),
    spin = new T.Quaternion(),
    x = new T.Vector3(1, 0, 0),
    z = new T.Vector3(0, 0, 1);
  const centre = new T.Vector3(),
    pixels = new Uint8Array(width * height * 4);
  const samples = [
    { name: 'unloaded', load: 0, lean: 0, phase: 0, pressure: 180, gap: 0 },
    { name: 'drive', load: 1650, lean: 0, phase: 0, pressure: 180, gap: 0 },
    { name: 'drive-rotated', load: 1650, lean: 0, phase: 1.35, pressure: 180, gap: 0 },
    { name: 'higher-pressure', load: 1650, lean: 0, phase: 0, pressure: 275, gap: 0 },
    { name: 'corner', load: 2050, lean: 0.73, phase: 0.29, pressure: 170, gap: 0 },
    { name: 'lift', load: 0, lean: 0.73, phase: 0.29, pressure: 170, gap: 0.063 },
    { name: 'rewound', load: 1650, lean: 0, phase: 0, pressure: 180, gap: 0 },
  ];
  try {
    const result = samples.map((s) => {
      road.loads[1] = s.load;
      road.pressures[1] = s.pressure;
      road.gaps[1] = s.gap;
      orientation.setFromAxisAngle(z, s.lean);
      centre.set(0, spec.cgHeight * Math.cos(s.lean), 0);
      wheels.solve(definition, 0, centre, orientation, road);
      mesh.position.copy(wheels.hubs[1]);
      mesh.quaternion.copy(orientation).multiply(spin.setFromAxisAngle(x, s.phase));
      skin.update(wheels);
      camera.position.set(2, cameraY, wheels.patches[1].z);
      camera.lookAt(0, cameraY, wheels.patches[1].z);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const roadRow = Math.round(((0.2 - cameraY) / 0.4) * height);
      let contactPixels = 0,
        belowRoad = 0,
        lowest = height,
        hash = 2166136261;
      for (let i = 0; i < width * height; i++) {
        const covered = pixels[i * 4 + 3] > 127,
          row = Math.floor(i / width);
        if (covered) {
          lowest = Math.min(lowest, row);
          if (row === roadRow + 1) contactPixels++;
          if (row < roadRow - 1) belowRoad++;
        }
        hash = Math.imul(hash ^ (covered ? 1 : 0), 16777619) >>> 0;
      }
      return {
        ...s,
        contactPixels,
        belowRoad,
        minimumClearanceMm: lowest - roadRow,
        hash,
        deflectionMm: wheels.carcassDeflection.y * 1000,
        image: renderer.domElement.toDataURL('image/png'),
      };
    });
    return {
      samples: result,
      glError: renderer.getContext().getError(),
      programs: renderer.info.programs?.length ?? 0,
    };
  } finally {
    geometry.dispose();
    rubber.dispose();
    paint.dispose();
    skin.dispose();
    ground.shadow.dispose();
    lamp.shadow.dispose();
    renderer.dispose();
  }
}
