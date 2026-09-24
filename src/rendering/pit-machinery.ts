import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Parts {
  mesh: T.InstancedMesh;
  perCrew: number;
}

/** One indexed draw for guns, jacks, handles and release paddles. Prototypes
 * are repeated once into a bounded buffer; a small matrix texture animates
 * them without re-uploading vertices or drawing unused material groups. */
export class PitMachinery extends T.Mesh<T.BufferGeometry, T.MeshStandardMaterial> {
  readonly instanceMatrix: T.InstancedBufferAttribute;
  readonly transforms: T.DataTexture;
  readonly piecesPerCrew: number;
  readonly indicesPerCrew: number;
  count = 0;
  private readonly sources: readonly Parts[];
  private readonly capacity: number;
  constructor(sources: readonly Parts[], capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || !sources.length)
      throw new Error('Invalid pit machinery capacity');
    const pieces = sources.reduce((n, s) => n + s.perCrew, 0);
    const parts: T.BufferGeometry[] = [];
    let slot = 0;
    for (let crew = 0; crew < capacity; crew++)
      for (const { mesh, perCrew } of sources) {
        if (!Number.isInteger(perCrew) || perCrew < 1 || Array.isArray(mesh.material))
          throw new Error('Invalid pit machinery prototype');
        const material = mesh.material as T.MeshStandardMaterial;
        const original = mesh.geometry;
        for (let part = 0; part < perCrew; part++) {
          const g = new T.BufferGeometry();
          g.setAttribute('position', original.getAttribute('position'));
          g.setAttribute('normal', original.getAttribute('normal'));
          g.setIndex(original.index);
          const n = original.getAttribute('position').count;
          const color = new Float32Array(n * 3),
            surface = new Float32Array(n * 2);
          const authored = original.getAttribute('color');
          for (let i = 0; i < n; i++) {
            color.set(
              [
                material.color.r * (authored ? authored.getX(i) : 1),
                material.color.g * (authored ? authored.getY(i) : 1),
                material.color.b * (authored ? authored.getZ(i) : 1),
              ],
              i * 3,
            );
            surface.set([material.roughness, material.metalness], i * 2);
          }
          g.setAttribute('color', new T.BufferAttribute(color, 3));
          g.setAttribute('machineSurface', new T.BufferAttribute(surface, 2));
          g.setAttribute(
            'machineSlot',
            new T.Float32BufferAttribute(new Float32Array(n).fill(slot++), 1),
          );
          parts.push(g);
        }
      }
    const geometry = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!geometry || !geometry.index) throw new Error('Pit machinery merge failed');
    const material = new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.5,
    });
    super(geometry, material);
    this.sources = sources;
    this.capacity = capacity;
    this.piecesPerCrew = pieces;
    this.indicesPerCrew = geometry.index.count / capacity;
    this.instanceMatrix = new T.InstancedBufferAttribute(new Float32Array(slot * 16), 16);
    this.transforms = new T.DataTexture(
      this.instanceMatrix.array,
      4,
      slot,
      T.RGBAFormat,
      T.FloatType,
    );
    this.transforms.minFilter = this.transforms.magFilter = T.NearestFilter;
    this.transforms.generateMipmaps = false;
    this.name = 'Authored machinery: one matrix-palette batch';
    this.frustumCulled = false;
    this.castShadow = this.receiveShadow = true;
    this.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    this.customDistanceMaterial = new T.MeshDistanceMaterial();
    for (const [m, colour] of [
      [material, true],
      [this.customDepthMaterial, false],
      [this.customDistanceMaterial, false],
    ] as const) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.machineTransforms = { value: this.transforms };
        shader.uniforms.machineRows = { value: slot };
        shader.vertexShader =
          `attribute float machineSlot;
uniform sampler2D machineTransforms;
uniform float machineRows;
${colour ? 'attribute vec2 machineSurface; varying vec2 vMachineSurface;' : ''}
mat4 machineMatrix() {
 float y=(machineSlot+.5)/machineRows;
 return mat4(texture2D(machineTransforms,vec2(.125,y)),texture2D(machineTransforms,vec2(.375,y)),
 texture2D(machineTransforms,vec2(.625,y)),texture2D(machineTransforms,vec2(.875,y)));
}
` + shader.vertexShader;
        for (const hook of ['void main() {', '#include <begin_vertex>'])
          if (!shader.vertexShader.includes(hook))
            throw new Error(`Missing machinery hook: ${hook}`);
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          'void main() {\nmat4 machineTransform=machineMatrix();',
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `vec3 transformed=(machineTransform*vec4(position,1.)).xyz;${colour ? '\nvMachineSurface=machineSurface;' : ''}`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
mat3 machineBasis=mat3(machineTransform);
objectNormal/=vec3(dot(machineBasis[0],machineBasis[0]),dot(machineBasis[1],machineBasis[1]),dot(machineBasis[2],machineBasis[2]));
objectNormal=machineBasis*objectNormal;`,
        );
        if (colour) {
          shader.fragmentShader = 'varying vec2 vMachineSurface;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor=vMachineSurface.x;',
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <metalnessmap_fragment>',
            '#include <metalnessmap_fragment>\nmetalnessFactor=vMachineSurface.y;',
          );
        }
      };
      m.customProgramCacheKey = () => `aurel-machinery-palette-v1-${colour}`;
    }
    geometry.setDrawRange(0, 0);
  }
  update(crews: number) {
    if (!Number.isInteger(crews) || crews < 0 || crews > this.capacity)
      throw new Error('Invalid active machinery count');
    for (const { mesh, perCrew } of this.sources)
      if (mesh.count !== crews * perCrew) throw new Error('Incomplete state-driven machinery');
    let slot = 0;
    for (let crew = 0; crew < crews; crew++)
      for (const { mesh, perCrew } of this.sources)
        for (let i = 0; i < perCrew; i++) {
          const offset = (crew * perCrew + i) * 16;
          this.instanceMatrix.array.set(
            mesh.instanceMatrix.array.subarray(offset, offset + 16),
            slot++ * 16,
          );
        }
    this.count = slot;
    this.transforms.needsUpdate = true;
    this.geometry.setDrawRange(0, crews * this.indicesPerCrew);
  }
  dispose() {
    this.transforms.dispose();
  }
}
