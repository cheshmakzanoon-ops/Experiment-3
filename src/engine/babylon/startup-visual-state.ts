import type { BabylonCircuitScene } from './circuit-scene.ts';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';

/** A conservative CPU fingerprint for the audited static startup scene only.
 * Not general scene equivalence: original geometry and shader plugins are immutable
 * in this phase; the caller must separately retain the authoritative frame and
 * preparation-owner identity. Never asks readiness, computes matrices or polls GL.
 */
export function captureStartupVisualState(
  view: Pick<BabylonCircuitScene, 'scene' | 'camera' | 'entrants'>,
): string | null {
  try {
    const { scene, camera } = view;
    const zero = (v: { x: number; y: number; z: number }) => v.x === 0 && v.y === 0 && v.z === 0;
    const movement = camera.movement;
    if (
      scene.isDisposed ||
      camera.isDisposed() ||
      scene.activeCamera !== camera ||
      camera.inputs.attachedToElement ||
      camera.behaviors.length ||
      movement.activeInput ||
      movement.isInterpolating ||
      !zero(movement.panAccumulatedPixels) ||
      !zero(movement.rotationAccumulatedPixels) ||
      !zero(movement.panDeltaCurrentFrame) ||
      !zero(movement.rotationDeltaCurrentFrame) ||
      movement.zoomAccumulatedPixels !== 0 ||
      movement.zoomDeltaCurrentFrame !== 0 ||
      camera.applyGravity ||
      camera.checkCollisions ||
      camera.cameraDirection.x !== 0 ||
      camera.cameraDirection.y !== 0 ||
      camera.cameraDirection.z !== 0 ||
      camera.cameraRotation.x !== 0 ||
      camera.cameraRotation.y !== 0 ||
      camera.lockedTarget ||
      camera.parent ||
      scene.animatables.length ||
      scene.animationGroups.length ||
      scene.particleSystems.length ||
      scene.skeletons.length ||
      scene.cameras.length !== 1 ||
      view.entrants.length > 128 ||
      scene.meshes.length > 1024 ||
      scene.transformNodes.length > 1024 ||
      scene.materials.length > 256 ||
      scene.textures.length > 256 ||
      scene.lights.length > 8
    )
      return null;
    const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
    const rgb = (v: { r: number; g: number; b: number }) => [v.r, v.g, v.b];
    const transform = (node: typeof camera | (typeof scene.transformNodes)[number]) => {
      if (node.isDisposed() || node.animations.length) throw new Error('Unproven node');
      const q = node.rotationQuaternion;
      return [
        node.uniqueId,
        node.parent?.uniqueId ?? null,
        xyz(node.position),
        xyz(node.rotation),
        q ? [q.x, q.y, q.z, q.w] : null,
        node.isEnabled(),
      ];
    };
    const materials = scene.materials.map((m) => {
      if (!(m instanceof StandardMaterial) && !(m instanceof PBRMaterial))
        throw new Error('Unsupported material');
      const base = [
        m.uniqueId,
        m.alpha,
        m.backFaceCulling,
        m.sideOrientation,
        m.fillMode,
        m.transparencyMode,
        m.disableDepthWrite,
        m.disableColorWrite,
        m.zOffset,
        m.zOffsetUnits,
      ];
      if (m instanceof StandardMaterial)
        return [
          ...base,
          rgb(m.diffuseColor),
          rgb(m.emissiveColor),
          rgb(m.specularColor),
          rgb(m.ambientColor),
          m.specularPower,
          m.disableLighting,
          m.diffuseTexture?.uniqueId ?? null,
          m.emissiveTexture?.uniqueId ?? null,
          m.bumpTexture?.uniqueId ?? null,
          m.opacityTexture?.uniqueId ?? null,
        ];
      return [
        ...base,
        rgb(m.albedoColor),
        rgb(m.emissiveColor),
        rgb(m.reflectivityColor),
        m.metallic,
        m.roughness,
        m.microSurface,
        m.emissiveIntensity,
        m.directIntensity,
        m.environmentIntensity,
        m.specularIntensity,
        m.unlit,
        m.albedoTexture?.uniqueId ?? null,
        m.emissiveTexture?.uniqueId ?? null,
        m.bumpTexture?.uniqueId ?? null,
        m.metallicTexture?.uniqueId ?? null,
        m.reflectivityTexture?.uniqueId ?? null,
        m.opacityTexture?.uniqueId ?? null,
      ];
    });
    const textures = scene.textures.map((t) => {
      if (!(t instanceof Texture) || t.animations.length || t.isRenderTarget)
        throw new Error('Unsupported texture');
      return [
        t.uniqueId,
        t.level,
        t.hasAlpha,
        t.gammaSpace,
        t.coordinatesIndex,
        t.coordinatesMode,
        t.wrapU,
        t.wrapV,
        t.uOffset,
        t.vOffset,
        t.uScale,
        t.vScale,
        t.uAng,
        t.vAng,
        t.wAng,
        t.uRotationCenter,
        t.vRotationCenter,
        t.wRotationCenter,
      ];
    });
    const meshes = scene.meshes.map((m) => {
      if (
        !(m instanceof Mesh) ||
        m.skeleton ||
        m.morphTargetManager ||
        m.hasInstances ||
        m.hasThinInstances ||
        m.subMeshes.length > 128
      )
        throw new Error('Unsupported mesh');
      return [
        transform(m),
        xyz(m.scaling),
        m.geometry?.uniqueId ?? null,
        m.material?.uniqueId ?? null,
        m.isVisible,
        m.visibility,
        m.layerMask,
        m.renderingGroupId,
        m.sideOrientation,
        m.receiveShadows,
        m.subMeshes?.map((s) => [
          s.materialIndex,
          s.verticesStart,
          s.verticesCount,
          s.indexStart,
          s.indexCount,
        ]),
        // Pinned Node/Matrix getters return their cached buffers directly.
        m.isWorldMatrixFrozen,
        Array.from(m.worldMatrixFromCache.m),
      ];
    });
    const nodes = scene.transformNodes.map((n) => [
      transform(n),
      xyz(n.scaling),
      n.isWorldMatrixFrozen,
      Array.from(n.worldMatrixFromCache.m),
    ]);
    const lights = scene.lights.map((l) => {
      if (
        l.animations.length ||
        l.parent ||
        (!(l instanceof DirectionalLight) && !(l instanceof HemisphericLight))
      )
        throw new Error('Unsupported light');
      return [
        l.uniqueId,
        l.isEnabled(),
        l.intensity,
        rgb(l.diffuse),
        rgb(l.specular),
        xyz(l.direction),
        l instanceof HemisphericLight ? rgb(l.groundColor) : xyz(l.position),
      ];
    });
    const state = [
      transform(camera),
      xyz(camera.upVector),
      camera.fov,
      camera.fovMode,
      camera.mode,
      camera.minZ,
      camera.maxZ,
      camera.orthoLeft,
      camera.orthoRight,
      camera.orthoTop,
      camera.orthoBottom,
      camera.viewport.x,
      camera.viewport.y,
      camera.viewport.width,
      camera.viewport.height,
      scene.useRightHandedSystem,
      rgb(scene.clearColor),
      scene.clearColor.a,
      scene.environmentIntensity,
      view.entrants.map((e) => e.uniqueId),
      nodes,
      meshes,
      materials,
      textures,
      lights,
    ];
    let valid = true;
    const signature = JSON.stringify(state, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) valid = false;
      if (typeof value === 'string' && value.length > 2048) valid = false;
      return value;
    });
    return valid && signature.length <= 262144 ? signature : null;
  } catch {
    return null;
  }
}
