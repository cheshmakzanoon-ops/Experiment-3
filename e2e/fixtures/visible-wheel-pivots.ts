import * as T from 'three';

/** Inspect the presented reduced model, not the first visible root child. Common
 * meshes (suspension and the rear lamp) survive body LOD changes. Fail explicitly
 * on ambiguous/missing model ownership instead of silently measuring an empty set. */
export function visibleReducedWheelPivots(root: T.Group): T.Group[] {
  if (!root.visible) throw new Error('Car root is not visible');
  const models = root.children.filter(
    (child): child is T.Group => child instanceof T.Group && child.visible,
  );
  if (models.length !== 1)
    throw new Error(`Expected one visible reduced model, found ${models.length}`);
  const wheels = models[0].children.filter(
    (child): child is T.Group =>
      child instanceof T.Group && child.children.some((part) => part instanceof T.Group),
  );
  if (wheels.length !== 4 || wheels.some((wheel) => !wheel.visible))
    throw new Error('Expected four visible reduced wheel pivots');
  return wheels;
}
