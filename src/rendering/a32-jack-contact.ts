import * as T from 'three';
import type { FormulaCar } from './car.ts';
import type { JackPoint, PitJackFits } from './a32-jack-pose.ts';

/** Sample actual chassis surfaces once at loading time. The nose and tail are
 * selected separately from wings, tyres and people. No imported mesh is edited.
 * A small footprint uses its lowest sample so the horizontal pad does not cut
 * through a curved underside. This is visual fitting, not a structural rating. */
export function measurePitJackFits(car: FormulaCar): PitJackFits {
  car.root.updateMatrixWorld(true);
  const supplied = car.suppliedPlayer;
  const body = supplied?.root.getObjectByName('PLAYER_BODY') ?? car.staticBody;
  if (!body) throw new Error('Missing car body for A32 fitting');
  const inverse = car.root.matrixWorld.clone().invert();
  const origin = new T.Vector3(),
    direction = new T.Vector3(0, 1, 0).transformDirection(car.root.matrixWorld);
  const local = new T.Vector3(),
    ray = new T.Raycaster();
  const source: PitJackFits['source'] = supplied
    ? 'supplied-player'
    : car.root.userData.authoredBodywork
      ? 'authored-rival'
      : 'legacy-prototype';
  const sample = (z: number): JackPoint => {
    const heights: number[] = [];
    for (const [x, dz] of [
      [0, 0],
      [-0.025, 0],
      [0.025, 0],
      [0, -0.012],
      [0, 0.012],
    ]) {
      origin.set(x, -1, z + dz).applyMatrix4(car.root.matrixWorld);
      ray.set(origin, direction);
      const hit = ray.intersectObject(body, true).find((h) => {
        local.copy(h.point).applyMatrix4(inverse);
        return local.y > -0.425 && local.y < -0.13;
      });
      if (!hit) throw new Error(`A32 cannot locate ${source} contact at ${x}/${z + dz}`);
      heights.push(local.copy(hit.point).applyMatrix4(inverse).y);
    }
    if (Math.max(...heights) - Math.min(...heights) > 0.02)
      throw new Error('A32 contact footprint is too uneven');
    return [0, Math.min(...heights), z];
  };
  return { front: sample(supplied ? 2.8 : 2.4), rear: sample(-2.25), source };
}
