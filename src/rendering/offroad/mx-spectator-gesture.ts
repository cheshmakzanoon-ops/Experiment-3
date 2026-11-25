import type * as T from 'three';
import { chainShaderHook, injectAfter, injectBefore, injectDeclarations } from '../studio/shader-hooks.ts';

/** Look slightly down the rider's path. A spectator lifts the first hand
 * later, and the other can follow it. Projecting the displayed velocity
 * keeps the timing deterministic on a held frame, a camera cut or a seek. */
export const MX_SPECTATOR_GESTURE_GLSL = `
uniform vec4 crowdPassA, crowdPassB, crowdPassVelocity;
float mxLookLead(float phase) { return 0.075 + 0.105 * fract(phase * 3.13); }
float mxCheerLag(float phase, float hand) {
  float second = abs(step(1.5, hand) - step(0.5, fract(phase * 4.13)));
  return 0.21 + 0.24 * fract(phase * 2.73) + 0.085 * second;
}
vec2 mxRiderFocus(vec4 racer, vec2 velocity, vec2 seat, vec2 side, vec2 forward, float offset) {
  vec2 delta = racer.xy + velocity * offset - seat;
  float d2 = dot(delta, delta);
  if (racer.z <= 0.0 || d2 * racer.w >= 1.0) return vec2(0.0);
  vec2 dir = delta * inversesqrt(max(d2, 0.01));
  float interest = racer.z * (1.0 - smoothstep(0.04, 1.0, d2 * racer.w))
    * smoothstep(-0.3, 0.25, dot(forward, dir));
  return vec2(dot(side, dir) * interest, interest);
}
vec2 mxFocusAt(vec2 seat, vec2 side, vec2 forward, float offset) {
  vec2 pair = mxRiderFocus(crowdPassA, crowdPassVelocity.xy, seat, side, forward, offset)
            + mxRiderFocus(crowdPassB, crowdPassVelocity.zw, seat, side, forward, offset);
  return pair / max(1.0, pair.y);
}
vec2 mxAudienceFocus(float offset) {
  #ifdef USE_INSTANCING
    if (crowdPassA.z + crowdPassB.z > 0.0) {
      vec2 seat = (modelMatrix * instanceMatrix[3]).xz;
      // The sculpt faces local -X; its left shoulder is on local +Z.
      vec2 side = normalize((mat3(modelMatrix) * instanceMatrix[2].xyz).xz);
      vec2 forward = normalize(-(mat3(modelMatrix) * instanceMatrix[0].xyz).xz);
      return mxFocusAt(seat, side, forward, offset);
    }
  #endif
  return vec2(0.0);
}
float mxRaisedHand(float phase, float hand, float interest, vec2 clock, vec2 reaction) {
  if (fract(phase * 6.71) >= 0.66) return 0.0;
  float chosen = fract(phase * 4.13);
  float activeHand = chosen < 0.34 ? step(1.5, hand) : chosen < 0.68 ? 1.0 - step(1.5, hand) : 1.0;
  float reach = smoothstep(0.18, 0.5, fract(phase * 2.17)) * activeHand;
  float beat = 0.86 + 0.10 * sin(3.0 * clock.x + 1.9 * phase - 0.37 * hand)
                    + 0.04 * sin(2.0 * clock.y + 3.2 * phase + 0.56 * hand);
  return reach * min(1.05, (0.78 * reaction.x + 0.90 * interest) * beat + 0.44 * reaction.y);
}`;

interface MxAudienceUniforms {
  crowdPassA: T.IUniform<T.Vector4>;
  crowdPassB: T.IUniform<T.Vector4>;
  crowdPassVelocity: T.IUniform<T.Vector4>;
  crowdClock: T.IUniform<T.Vector2>;
  crowdReaction: T.IUniform<T.Vector2>;
}

/** The distant arena crowd keeps its two-triangle cards. A neck turn and
 * hinged sleeves use the same seat identity and reaction as its near sculpt.
 * All action fits inside the original card, above the seated or standing feet. */
export function installMxAudienceCardMotion(material: T.MeshStandardMaterial, uniforms: MxAudienceUniforms) {
  chainShaderHook(material, 'mx-arena-audience-motion-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', `
      varying vec4 vMxAudience;
      uniform vec2 crowdClock, crowdReaction;
      ${MX_SPECTATOR_GESTURE_GLSL}`, 'vertex');
    injectAfter(shader, 'begin_vertex', `
      float mxPhase = spectatorPhase;
      float mxLook = 0.0, leftInterest = 0.0, rightInterest = 0.0;
      float mxFolded = step(0.66, fract(mxPhase * 6.71));
      vec3 mxShoulder = normalize(mat3(modelMatrix) * instanceMatrix[2].xyz);
      if (crowdPassA.z + crowdPassB.z > 0.0) {
        vec2 seat = (modelMatrix * instanceMatrix[3]).xz;
        vec2 side = normalize(mxShoulder.xz);
        vec2 forward = normalize(-(mat3(modelMatrix) * instanceMatrix[0].xyz).xz);
        mxLook = mxFocusAt(seat, side, forward, mxLookLead(mxPhase)).x;
        if (mxFolded < 0.5) {
          leftInterest = mxFocusAt(seat, side, forward, -mxCheerLag(mxPhase, 1.0)).y;
          rightInterest = mxFocusAt(seat, side, forward, -mxCheerLag(mxPhase, 2.0)).y;
        }
      }
      float mxLeft = mxRaisedHand(mxPhase, 1.0, leftInterest, crowdClock, crowdReaction);
      float mxRight = mxRaisedHand(mxPhase, 2.0, rightInterest, crowdClock, crowdReaction);
      // An oblique lens foreshortens the shoulder axis. Ease the handedness
      // across its end-on view when the camera passes behind the stand.
      float mxSideView = (mat3(viewMatrix) * mxShoulder).x;
      vec2 mxHands = mix(vec2(mxRight, mxLeft), vec2(mxLeft, mxRight), smoothstep(-0.2, 0.2, mxSideView));
      vMxAudience = vec4(mxLook * mxSideView, mxHands, mxFolded);`, 'vertex');
    injectDeclarations(shader, 'common', `
      varying vec4 vMxAudience;
      float mxArmSegment(vec2 p, vec2 a, vec2 b, float radius) {
        vec2 v = b - a;
        float u = clamp(dot(p - a, v) / max(dot(v, v), 0.00001), 0.0, 1.0);
        return length(p - (a + u * v)) - radius;
      }
      vec2 mxCardArm(vec2 p, float side, float lift, float folded) {
        vec2 shoulder = vec2(side * 0.135, 0.475);
        float up = clamp(lift, 0.0, 1.0);
        float follow = smoothstep(0.10, 0.95, up);
        vec2 elbow = shoulder + vec2(side * (0.040 + 0.24 * up * (1.0 - up)), -0.15 + 0.27 * up);
        vec2 wrist = elbow + vec2(side * (-0.033 + 0.14 * follow * (1.0 - follow)), -0.13 + 0.30 * follow);
        wrist = mix(wrist, vec2(-side * 0.045, 0.405), folded);
        return vec2(mxArmSegment(p, shoulder, elbow, 0.035), mxArmSegment(p, elbow, wrist, 0.023));
      }`, 'fragment');
    injectAfter(shader, 'float stand = vSpectatorStyle.z;', `
      vec2 mxArmPoint = p - vec2(0.0, stand * 0.5);
      p.x -= 0.052 * vMxAudience.x * smoothstep(0.48 + stand * 0.5, 0.69 + stand * 0.5, p.y);`, 'fragment');
    injectBefore(shader, 'alphatest_fragment', `
      vec2 mxLeftArm = mxCardArm(mxArmPoint, -1.0, vMxAudience.y, vMxAudience.w);
      vec2 mxRightArm = mxCardArm(mxArmPoint, 1.0, vMxAudience.z, vMxAudience.w);
      vec2 mxArm = min(mxLeftArm, mxRightArm);
      vec2 mxAA = max(fwidth(mxArm), vec2(0.0001));
      vec2 mxCover = 1.0 - smoothstep(-mxAA, mxAA, mxArm);
      diffuseColor.rgb = mix(diffuseColor.rgb, shirt, mxCover.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, vSkin, mxCover.y);
      diffuseColor.a = max(diffuseColor.a, opacity * max(mxCover.x, mxCover.y));`, 'fragment');
  });
}
