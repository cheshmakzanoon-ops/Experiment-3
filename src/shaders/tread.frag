// UVs stay attached to the rolling lathe mesh. No simulation-time or screen-space noise.
vec2 grainUv = vTreadUV * vec2(180.0, 55.0);
vec2 grainCell = floor(grainUv);
float grainHash = fract(sin(dot(grainCell, vec2(113.1, 271.9))) * 43758.5453);
float grainWidth = max(fwidth(grainUv.x), fwidth(grainUv.y));
float grainDetail = 1.0 - smoothstep(0.5, 1.8, grainWidth);
float speck = 1.0 - smoothstep(0.22, 0.46, length(fract(grainUv) - 0.5));
// Resolve to the mean coverage instead of erasing dirt on sub-pixel grains.
float dirtMask = mix(treadCondition.x * 0.36, step(grainHash, treadCondition.x) * speck, grainDetail);
speck = mix(0.36, speck, grainDetail);
float wearLines = (0.5 + 0.5 * sin(vTreadUV.y * 460.0)) *
  (1.0 - smoothstep(0.4, 2.0, fwidth(vTreadUV.y * 460.0)));
float damage = clamp(treadCondition.z + treadCondition.w, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.073, 0.042), dirtMask * 0.85);
diffuseColor.rgb *= 1.0 - (treadCondition.y * wearLines * 0.22 + damage * speck * 0.35);
