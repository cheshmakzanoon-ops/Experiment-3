import { precipitationLighting } from './precipitation-light.ts';
import { RearSignalField } from './rear-signal.ts';
import * as T from 'three';

/** One instanced draw over Effects' existing contact pool. This changes only
 * presentation: wheel water/load, births, advection and lifetime still belong
 * to Effects and its recorded simulation-time playback. No second emitter. */
export class SprayClouds {
  readonly signals = new RearSignalField();
  readonly geometry = new T.InstancedBufferGeometry();
  readonly material: T.ShaderMaterial;
  readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
  constructor(
    positions: Float32Array,
    velocities: Float32Array,
    sizes: Float32Array,
    opacity: Float32Array,
    kinds: Uint8Array,
  ) {
    const count = opacity.length;
    if (
      !count ||
      positions.length !== count * 3 ||
      velocities.length !== count * 3 ||
      sizes.length !== count ||
      kinds.length !== count
    )
      throw new Error('Spray instance arrays must have matching nonzero lengths');
    this.geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, array, stride] of [
      ['center', positions, 3],
      ['velocity', velocities, 3],
      ['size', sizes, 1],
      ['opacity', opacity, 1],
      ['kind', kinds, 1],
    ] as const)
      this.geometry.setAttribute(
        name,
        new T.InstancedBufferAttribute(array, stride).setUsage(T.DynamicDrawUsage),
      );
    // Stable slot variation; neither frames nor camera movement reseed the mist.
    const variation = Float32Array.from({ length: count }, (_, i) => ((i * 73 + 19) % 251) / 251);
    this.geometry.setAttribute('variation', new T.InstancedBufferAttribute(variation, 1));
    this.geometry.instanceCount = count;
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      lights: true,
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        T.UniformsLib.lights,
        {
          nearPlane: { value: 0.1 },
        },
      ]),
      vertexShader: `
        uniform int signalCount;
        uniform vec4 signalPositions[12];
        uniform vec3 signalDirections[12];
        attribute vec3 center;
        attribute vec3 velocity;
        attribute float size;
        attribute float opacity;
        attribute float kind;
        attribute float variation;
        uniform float nearPlane;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vVariation;
        varying float vAnisotropy;
        varying vec3 vLight;
        #include <common>
        #include <lights_pars_begin>
        #include <fog_pars_vertex>
        ${precipitationLighting}
        void main() {
          vUv=position.xy; vVariation=variation;
          vOpacity=0.0; vLight=vec3(0.0); vAnisotropy=0.0;
          vec4 mvPosition=modelViewMatrix*vec4(center,1.0);
          #include <fog_vertex>
          float depth=-mvPosition.z;
          float nearFade=smoothstep(max(0.2,nearPlane*1.5),max(0.8,nearPlane*4.0),depth);
          if(kind>0.5 || opacity<=0.0 || nearFade<=0.0) {
            gl_Position=vec4(2.0,2.0,2.0,1.0); return;
          }
          vOpacity=opacity*nearFade;
          // View-plane footprint in metres, not capped GL_POINTS pixels. The
          // projected velocity gives a continuous wake direction at any aspect.
          vec3 motion=(modelViewMatrix*vec4(velocity,0.0)).xyz;
          vec2 projected=motion.xy-mvPosition.xy*motion.z/mvPosition.z;
          float speed=length(projected);
          vec2 along=speed>0.001?projected/speed:vec2(0.0,1.0);
          vec2 across=vec2(along.y,-along.x);
          float radius=max(0.01,size)*0.72;
          // A wake viewed along its motion has no defined screen-space axis.
          // Collapse to a radial footprint before that axis can flip or spin.
          float stretch=1.0+min(1.1,speed*0.12);
          vAnisotropy=smoothstep(0.05,1.0,speed);
          mvPosition.xy+=radius*(across*position.x+along*position.y*stretch);
          gl_Position=projectionMatrix*mvPosition;
          // Use the scene's real light state. Unlike the old unlit point color,
          // spray cannot remain luminous when the venue lights are switched off.
          vec3 energy=precipitationEnergy((modelViewMatrix*vec4(center,1.0)).xyz);
          vLight=vec3(0.65,0.73,0.73)*energy;
          vec3 worldCenter=(modelMatrix*vec4(center,1.0)).xyz;
          for(int i=0;i<12;i++) {
            if(i>=signalCount) break;
            vec3 delta=worldCenter-signalPositions[i].xyz;
            float d2=dot(delta,delta);
            float rear=smoothstep(-0.08,0.5,dot(delta,signalDirections[i])/sqrt(max(0.0001,d2)));
            float attenuation=exp(-d2*0.35)*rear;
            vLight+=vec3(0.34,0.004,0.001)*signalPositions[i].w*attenuation;
          }
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vOpacity;
        varying float vVariation;
        varying float vAnisotropy;
        varying vec3 vLight;
        #include <fog_pars_fragment>
        void main() {
          // A connected dense core, entrained mist and filtered turbulent
          // filaments replace the two visibly separate circular lobes. Slot
          // identity and physical advection provide variation; no wall clock.
          vec2 p=vUv;
          float phase=vVariation*6.2831853;
          vec2 q=vec2(p.x+0.09*sin(p.y*4.0+phase),p.y);
          float broad=exp(-dot(q*vec2(1.12,0.97),q*vec2(1.12,0.97))*3.0);
          float core=exp(-dot(q*vec2(1.70,0.88),q*vec2(1.70,0.88))*3.0);
          vec2 noiseP=q*vec2(11.0,7.0);
          float footprint=max(length(dFdx(noiseP)),length(dFdy(noiseP)));
          float resolved=1.0-smoothstep(0.7,2.0,footprint);
          float filaments=0.5+0.5*sin(noiseP.x+sin(noiseP.y+phase))*sin(noiseP.y*0.73-phase);
          float turbulent=(0.60*core+0.40*broad)*(1.0+resolved*(filaments-0.5)*0.42);
          float density=mix(exp(-dot(p,p)*3.6),turbulent,vAnisotropy);
          // The cutoff must become radial as well; a square cutoff still
          // rotates visibly when near-axial motion changes to a diagonal.
          float edge=mix(length(p),max(abs(p.x),abs(p.y)),vAnisotropy);
          density*=1.0-smoothstep(0.48,1.0,edge);
          // Optical-depth alpha composes into a continuous cloud. This remains
          // bounded billboards, not a claim of volumetric multiple scattering.
          float alpha=1.0-exp(-density*vOpacity*1.25);
          if(alpha<0.003) discard;
          gl_FragColor=vec4(vLight,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // Install after UniformsUtils.merge so this field retains the actual shared
    // uniform objects instead of silently cloning the source arrays.
    this.material.uniforms.signalCount = this.signals.count;
    this.material.uniforms.signalPositions = { value: this.signals.positions };
    this.material.uniforms.signalDirections = { value: this.signals.directions };
    this.material.userData.localWeatherPosition = 'center';
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.name = 'Lit wheel-water spray clouds';
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.material.uniforms.nearPlane.value = 'near' in camera ? camera.near : 0.1;
    };
  }
  upload() {
    for (const name of ['center', 'velocity', 'size', 'opacity', 'kind'])
      this.geometry.getAttribute(name).needsUpdate = true;
  }
  clear() {
    this.signals.count.value = 0;
    this.geometry.getAttribute('opacity').needsUpdate = true;
  }
}
