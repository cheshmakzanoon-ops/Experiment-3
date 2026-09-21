import * as T from 'three';

/** One instanced draw over Effects' existing contact pool. This changes only
 * presentation: wheel water/load, births, advection and lifetime still belong
 * to Effects and its recorded simulation-time playback. No second emitter. */
export class SprayClouds {
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
    if (!count || positions.length !== count * 3 || velocities.length !== count * 3 ||
        sizes.length !== count || kinds.length !== count)
      throw new Error('Spray instance arrays must have matching nonzero lengths');
    this.geometry.setAttribute('position', new T.Float32BufferAttribute([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, array, stride] of [
      ['center', positions, 3], ['velocity', velocities, 3], ['size', sizes, 1],
      ['opacity', opacity, 1], ['kind', kinds, 1],
    ] as const) this.geometry.setAttribute(name,
      new T.InstancedBufferAttribute(array, stride).setUsage(T.DynamicDrawUsage));
    // Stable slot variation; neither frames nor camera movement reseed the mist.
    const variation = Float32Array.from({ length: count }, (_, i) => ((i * 73 + 19) % 251) / 251);
    this.geometry.setAttribute('variation', new T.InstancedBufferAttribute(variation, 1));
    this.geometry.instanceCount = count;
    this.material = new T.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, lights: true,
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, T.UniformsLib.lights, {
        nearPlane: { value: 0.1 },
      }]),
      vertexShader: `
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
          vec3 energy=ambientLightColor;
          #if NUM_HEMI_LIGHTS > 0
          for(int i=0;i<NUM_HEMI_LIGHTS;i++)
            energy+=0.35*(hemisphereLights[i].skyColor+hemisphereLights[i].groundColor);
          #endif
          #if NUM_DIR_LIGHTS > 0
          for(int i=0;i<NUM_DIR_LIGHTS;i++) energy+=0.22*directionalLights[i].color;
          #endif
          #if NUM_POINT_LIGHTS > 0
          for(int i=0;i<NUM_POINT_LIGHTS;i++) {
            float d=length(pointLights[i].position-(modelViewMatrix*vec4(center,1.0)).xyz);
            energy+=0.22*pointLights[i].color*getDistanceAttenuation(d,pointLights[i].distance,pointLights[i].decay);
          }
          #endif
          vLight=vec3(0.65,0.73,0.73)*energy;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying float vOpacity;
        varying float vVariation;
        varying float vAnisotropy;
        varying vec3 vLight;
        #include <fog_pars_fragment>
        void main() {
          // Compact, overlapping density lobes with a zero-valued rectangular
          // boundary. No visible sprite corners or expensive noise texture.
          vec2 p=vUv;
          float skew=(vVariation-0.5)*0.42;
          vec2 core=vec2(p.x+skew*p.y,p.y*1.10);
          vec2 shoulder=vec2((p.x-skew)*1.35,(p.y+0.24)*0.86);
          float lobes=0.62*exp(-dot(core,core)*3.6)+0.38*exp(-dot(shoulder,shoulder)*4.2);
          float density=mix(exp(-dot(p,p)*3.6),lobes,vAnisotropy);
          density*=1.0-smoothstep(0.48,1.0,max(abs(p.x),abs(p.y)));
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
    this.geometry.getAttribute('opacity').needsUpdate = true;
  }
}
