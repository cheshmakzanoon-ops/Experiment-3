/** Shared single-scattering-style lighting for rain and wheel spray. Scene light
 * uniforms are linear radiance and positions/directions are in view space.
 * This adds no light sources or emitter state. Deliberately bounded phase gain
 * avoids a white wall when the camera looks through spray towards the sun. */
export const precipitationLighting = `
  vec3 precipitationEnergy(vec3 viewPosition) {
    float distance2 = dot(viewPosition, viewPosition);
    vec3 toEye = -viewPosition * inversesqrt(max(distance2, .0001));
    vec3 energy = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      for (int i=0; i<NUM_HEMI_LIGHTS; i++)
        energy += .35*(hemisphereLights[i].skyColor + hemisphereLights[i].groundColor);
    #endif
    #if NUM_DIR_LIGHTS > 0
      for (int i=0; i<NUM_DIR_LIGHTS; i++) {
        float forward = pow(max(0., dot(-directionalLights[i].direction, toEye)), 4.);
        energy += (.16 + .20*forward)*directionalLights[i].color;
      }
    #endif
    #if NUM_POINT_LIGHTS > 0
      for (int i=0; i<NUM_POINT_LIGHTS; i++) {
        vec3 delta = pointLights[i].position-viewPosition;
        float d = length(delta);
        float forward = pow(max(0., dot(-delta/max(d,.001), toEye)), 4.);
        energy += (.16 + .16*forward)*pointLights[i].color*
          getDistanceAttenuation(d,pointLights[i].distance,pointLights[i].decay);
      }
    #endif
    return max(energy,vec3(0.));
  }
`;
