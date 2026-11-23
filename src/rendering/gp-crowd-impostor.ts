import * as T from 'three';
import { CROWD_WARDROBE_GLSL } from './crowd-wardrobe.ts';
import {
  acquireGpCrowdAtlas,
  releaseGpCrowdAtlas,
  GP_FAN_VIEWS,
  GP_FAN_CARD_WIDTH,
  GP_FAN_CARD_HEIGHT,
  GP_FAN_CARD_Y,
} from './gp-crowd-atlas.ts';

export function gpCrowdCardGeometry() {
  return new T.PlaneGeometry(GP_FAN_CARD_WIDTH, GP_FAN_CARD_HEIGHT).translate(0, GP_FAN_CARD_Y, 0);
}

/** All fan shapes, normals and fabric regions come from the live sculpt.
 * Blend neighbouring azimuths as the broadcast lens moves past the stand.
 * A vertical card keeps the shoes planted under high and rolled cameras. */
export function installGpCrowdCard(
  material: T.MeshStandardMaterial,
  range: T.Vector2,
  family: number,
) {
  const atlas = acquireGpCrowdAtlas();
  const release = () => {
    material.removeEventListener('dispose', release);
    releaseGpCrowdAtlas();
  };
  material.addEventListener('dispose', release);
  material.vertexColors = false;
  material.alphaTest = 0.49;
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gpFanAtlas = { value: atlas };
    shader.uniforms.crowdLodRange = { value: range };
    shader.uniforms.gpFanFamily = { value: family };
    shader.vertexShader =
      `
attribute float spectatorPhase; attribute vec3 spectatorSkin; attribute vec4 spectatorStyle;
varying float vFanPhase; varying vec3 vFanSkin; varying vec4 vFanFrame;
varying vec2 vFanLocal; varying vec3 vFanX; varying vec3 vFanY; varying vec3 vFanZ;
uniform float gpFanFamily;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal=vec3(0.,0.,1.);')
      .replace(
        '#include <project_vertex>',
        `
mat4 basis=modelMatrix*instanceMatrix;
vFanX=normalize(basis[0].xyz);vFanY=normalize(basis[1].xyz);vFanZ=normalize(basis[2].xyz);
float stand=spectatorStyle.z;
vec3 centre=(basis*vec4(mix(-.14,-.48,stand),0.,0.,1.)).xyz;
vec3 toEye=cameraPosition-centre;
float side=dot(toEye,vFanX), forward=dot(toEye,vFanZ);
float angle=atan(side,forward)*${(GP_FAN_VIEWS / (2 * Math.PI)).toFixed(9)};
float viewIdx=floor(angle);
float row=gpFanFamily*8.+stand*4.+step(.66,fract(spectatorPhase*6.71))*2.+step(.55,spectatorStyle.w);
vFanFrame=vec4(mod(viewIdx,${GP_FAN_VIEWS}.),mod(viewIdx+1.,${GP_FAN_VIEWS}.),fract(angle),row);
vFanPhase=spectatorPhase;vFanSkin=spectatorSkin;
vFanLocal=vec2(position.x/${GP_FAN_CARD_WIDTH}+.5,(position.y-${GP_FAN_CARD_Y})/${GP_FAN_CARD_HEIGHT}+.5);
vec3 across=normalize(cross(vFanY,toEye)+vec3(.000001,0.,0.));
float h=position.y>.1 ? .1+(position.y-.1)*spectatorStyle.y : position.y;
float projectedWidth=length(vec2(forward,side*spectatorStyle.x))/max(.0001,length(vec2(forward,side)));
float restLean=(fract(spectatorPhase*1.93)-.5)*.09;
vec3 billWorld=centre+across*position.x*projectedWidth*length(basis[0].xyz)
  +vFanY*h*length(basis[1].xyz)+vFanX*restLean*max(0.,h-.12)*length(basis[0].xyz);
vec4 mvPosition=viewMatrix*vec4(billWorld,1.);gl_Position=projectionMatrix*mvPosition;`,
      )
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition=vec4(billWorld,1.);');
    shader.fragmentShader =
      CROWD_WARDROBE_GLSL +
      `
uniform sampler2D gpFanAtlas; uniform vec2 crowdLodRange;
varying float vFanPhase; varying vec3 vFanSkin; varying vec4 vFanFrame;
varying vec2 vFanLocal; varying vec3 vFanX; varying vec3 vFanY; varying vec3 vFanZ;
` +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `
#include <color_fragment>
float rank=min(.9999999,vFanPhase/6.28318530718);
if(rank<crowdLodRange.x || rank>=crowdLodRange.y)discard;
// Explicit gradients avoid angular tile changes selecting an unrelated mip.
vec2 unit=vec2(${1 / GP_FAN_VIEWS},.03125), dx=dFdx(vFanLocal)*unit, dy=dFdy(vFanLocal)*unit;
float lodFoot=max(length(dx*vec2(${GP_FAN_VIEWS * 32}.,2048.)),length(dy*vec2(${GP_FAN_VIEWS * 32}.,2048.)));
float filterScale=min(1.,6./max(lodFoot,.01));dx*=filterScale;dy*=filterScale;
vec2 a=(vec2(vFanFrame.x,vFanFrame.w)+vFanLocal)*unit;
vec2 b=(vec2(vFanFrame.y,vFanFrame.w)+vFanLocal)*unit;
vec4 sampleA=textureGrad(gpFanAtlas,a,dx,dy),sampleB=textureGrad(gpFanAtlas,b,dx,dy);
vec4 surface=mix(sampleA,sampleB,vFanFrame.z);
float coverage=max(surface.a,.001);
vec3 localNormal=surface.rgb/coverage*2.-1.;
vec3 cloth=mix(textureGrad(gpFanAtlas,a+vec2(0.,.5),dx,dy).rgb,
  textureGrad(gpFanAtlas,b+vec2(0.,.5),dx,dy).rgb,vFanFrame.z)/coverage;
vec3 shirt=crowdGarmentColour(diffuseColor.rgb,vFanPhase);
vec3 jeans=mix(vec3(.026,.038,.056),vec3(.21,.17,.12),step(.7,fract(vFanPhase*2.43)));
vec3 dark=mix(vec3(.024,.014,.010),vec3(.085,.057,.036),fract(vFanPhase*3.9));
float headMask = clamp(cloth.g,0.,1.);
diffuseColor.rgb=shirt*cloth.r+vFanSkin*headMask+jeans*cloth.b+dark*max(0.,1.-dot(cloth,vec3(1.)));
diffuseColor.a*=surface.a;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `
#include <normal_fragment_begin>
vec3 worldFanNormal=vFanX*localNormal.x+vFanY*localNormal.y+vFanZ*localNormal.z;
normal=normalize(mat3(viewMatrix)*worldFanNormal+vec3(0.,.00001,0.)); nonPerturbedNormal=normal;`,
      );
  };
  material.customProgramCacheKey = () => 'gp-angular-spectator-v1';
}
