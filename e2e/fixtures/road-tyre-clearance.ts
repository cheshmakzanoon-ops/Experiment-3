import * as T from 'three';

/** Signed height of the visible tread above an independently measured road
 * plane. The geometry's positions remain in the unloaded shape for animation.
 * Read the physical material's uniforms to include its rounded contact patch. */
export function roadTyreClearance(
  mesh: T.Mesh,
  material: T.Material,
  normal: T.Vector3,
  road: T.Vector3,
  axle: number,
) {
  const shader = {
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  const indent = (shader.uniforms.gpFootSquash?.value as T.Vector2 | undefined)?.getComponent(axle) ?? 0;
  const plane = shader.uniforms[axle ? 'gpFootRear' : 'gpFootFront']?.value as T.Vector4 | undefined;
  const positions = mesh.geometry.getAttribute('position'), profile = mesh.geometry.getAttribute('gpTyreBind');
  const localNormal = new T.Vector3(), point = new T.Vector3(), bind = new T.Vector3();
  const contact = plane && profile && indent > 0.00001 ? { plane, profile } : undefined;
  if (contact) {
    const { plane } = contact;
    localNormal.set(plane.x, plane.y, plane.z);
    if (Math.abs(localNormal.dot(normal) - 1) > 0.000001)
      throw new Error('The projected GP contact plane and its measured road normal disagree');
    localNormal.transformDirection(new T.Matrix4().copy(mesh.matrixWorld).invert());
  }
  const r = Math.max(0.0001, 0.32 * indent);
  let clearance = Infinity, unloadedClearance = Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(road);
    let height = normal.dot(point);
    unloadedClearance = Math.min(unloadedClearance, height);
    if (contact && contact.profile.getW(i) > 0.025) {
      bind.fromBufferAttribute(contact.profile, i);
      const h = localNormal.dot(bind) + contact.plane.w;
      // Fully flat below -r, unchanged above +r, parabolic between. The
      // sidewall bulge is tangent to the road and contributes no height.
      if (h <= -r) height -= h;
      else if (h < r) height += (r - h) ** 2 / (4 * r);
    }
    clearance = Math.min(clearance, height);
  }
  return { vertices: positions.count, clearance, unloadedClearance };
}
