/** Procedural density for Festival tyre smoke and loose-ground dust. The
 * field rides the existing puff and evolves from its measured size/age; no
 * wall-clock animation, texture, extra particle or simulation force is used.
 * A world-oriented slice avoids the projected-velocity axis flip of an
 * anisotropic billboard when its motion points directly toward the camera. */
export const dryCloudDensity = `
  float dryCloudHash(vec3 p) {
    p=fract(p*0.1031);
    p+=dot(p,p.yzx+33.33);
    return fract((p.x+p.y)*p.z);
  }
  float dryCloudNoise(vec3 p) {
    vec3 cell=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(
      mix(mix(dryCloudHash(cell),dryCloudHash(cell+vec3(1,0,0)),f.x),
          mix(dryCloudHash(cell+vec3(0,1,0)),dryCloudHash(cell+vec3(1,1,0)),f.x),f.y),
      mix(mix(dryCloudHash(cell+vec3(0,0,1)),dryCloudHash(cell+vec3(1,0,1)),f.x),
          mix(dryCloudHash(cell+vec3(0,1,1)),dryCloudHash(cell+vec3(1,1,1)),f.x),f.y),f.z);
  }
  vec2 festivalDryDensity(vec2 uv, vec3 slice, float seed, float age, float smoke) {
    vec3 p=slice*mix(2.2,2.8,smoke)+vec3(seed*31.7,seed*17.3,seed*43.1);
    p.y-=age*mix(0.32,0.56,smoke);
    // Two bounded scales: rolling body and smaller entrained edge detail.
    // Unresolved scales converge to their mean instead of sparkling at range.
    vec3 fineP=p*2.17+vec3(5.1,2.7,9.2);
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    float broadResolved=1.0-smoothstep(0.6,1.6,footprint);
    float fineResolved=1.0-smoothstep(0.6,1.6,footprint*2.17);
    float broad=0.5, fine=0.5;
    if(broadResolved>0.001) broad=mix(0.5,dryCloudNoise(p),broadResolved);
    if(fineResolved>0.001) fine=mix(0.5,dryCloudNoise(fineP),fineResolved);
    float billow=broad*0.72+fine*0.28;
    float radius=length(uv);
    float edge=1.0-smoothstep(0.52+billow*0.20,0.98,radius);
    float core=exp(-dot(uv,uv)*mix(2.8,2.5,smoke));
    float structure=mix(0.38,1.65,smoothstep(0.18,0.83,billow));
    return vec2(core*edge*structure,billow);
  }
`;
