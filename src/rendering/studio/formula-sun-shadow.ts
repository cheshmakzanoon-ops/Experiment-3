/** Low-cost directional shadow when the selected preset has no shadow map.
 * The existing receiver projects back toward the sun at the floor, hub and
 * wing heights. Separated front/rear wings leave the silhouette immediately. */
export const FORMULA_SUN_SHADOW = /* glsl */ `
#ifndef USE_SHADOWMAP
float apexFormulaCast(vec2 local, float heading, vec4 axles, vec4 parts) {
  float sn = sin(heading), cs = cos(heading);
  vec2 sun = vec2(studioSunDir.x * cs - studioSunDir.z * sn,
                  studioSunDir.x * sn + studioSunDir.z * cs) / max(studioSunDir.y, .28);
  vec2 floorRay = local + sun * (.19 + parts.w);
  float occlusion = apexGroundBox(floorRay, vec2(0., -.22), vec2(.64, 1.36), .16);
  vec2 podRay = local + sun * (.49 + parts.w);
  occlusion = max(occlusion, apexGroundBox(vec2(abs(podRay.x), podRay.y),
                                  vec2(.40, -.38), vec2(.32, .88), .19));
  // The wheel silhouette is separate from the floor. Steer only the fronts
  // and use this model's axle stations, including a narrower feeder chassis.
  vec2 hub = local + sun * (.335 + parts.w);
  vec2 front = vec2(hub.x - (hub.x < 0. ? -axles.x : axles.x), hub.y - axles.y);
  float ws = sin(parts.z), wc = cos(parts.z);
  front = vec2(wc * front.x - ws * front.y, ws * front.x + wc * front.y);
  occlusion = max(occlusion, apexGroundBox(front, vec2(0.), vec2(.145, .29), .11));
  occlusion = max(occlusion, apexGroundBox(vec2(abs(hub.x),hub.y), vec2(axles.z,axles.w), vec2(.183,.30), .11));
  if (parts.x > .0) occlusion = max(occlusion, apexGroundBox(local + sun * (.26 + parts.w),
                      vec2(0.,axles.y + .50), vec2(.91 * (.35 + .65 * parts.x),.20), .14));
  if (parts.y > .0) occlusion = max(occlusion, apexGroundBox(local + sun * (1.01 + parts.w),
                      vec2(0.,axles.w - .56), vec2(.68,.20), .22));
  return occlusion * smoothstep(.03, .23, studioSunDir.y);
}
#endif
`;
