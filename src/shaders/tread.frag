// Bind-space metric grain avoids glTF lettering UV islands and survives live
// carcass deformation. Derive angular footprint BEFORE wrapping the phase.
vec2 tireRadial = vTireBind.yz;
float tireRadius = max(length(tireRadial), .001);
float tireAngle = atan(tireRadial.y, tireRadial.x) / 6.28318530718;
vec2 tireDx = dFdx(tireRadial), tireDy = dFdy(tireRadial);
float tireAngularPixel = (abs(tireRadial.x * tireDx.y - tireRadial.y * tireDx.x) +
  abs(tireRadial.x * tireDy.y - tireRadial.y * tireDy.x)) /
  max(6.28318530718 * dot(tireRadial, tireRadial), .00001);
float tireAcross = vTireBind.x / max(treadSurface.z, .1);
float tireAcrossPixel = max(fwidth(tireAcross), .00001);
float tireWet = clamp(treadSurface.x, 0., 1.);
float tireStyle = clamp(treadSurface.y, 0., 2.);
float tireCrown = smoothstep(.314, .329, tireRadius) *
  (1. - smoothstep(.70, .90, abs(tireAcross)));
float tireGroove = 0.;
if (tireStyle > .5) {
  float wetStyle = step(1.5, tireStyle);
  float channels = mix(2., 3., wetStyle);
  float longitudinal = apexStripeCoverage((tireAcross + 1.) * channels,
    tireAcrossPixel * channels, mix(.028, .048, wetStyle));
  float crossPhase = tireAngle * 36. + abs(tireAcross) * mix(1.5, 2.5, wetStyle);
  float crossPixel = tireAngularPixel * 36. + tireAcrossPixel * mix(1.5, 2.5, wetStyle);
  float drainage = apexStripeCoverage(crossPhase, crossPixel, mix(.042, .068, wetStyle));
  tireGroove = (1. - (1. - longitudinal) * (1. - drainage)) * tireCrown;
}
vec2 grainUv = vec2(tireAcross * 45., tireAngle * 180.);
float grainHash = fract(sin(dot(vec2(floor(grainUv.x), mod(floor(grainUv.y), 180.)), vec2(12.9898, 78.233))) * 43758.5453);
float grainWidth = max(tireAcrossPixel * 45., tireAngularPixel * 180.);
float grainDetail = 1. - smoothstep(.5, 1.8, grainWidth);
float speck = 1. - smoothstep(.22, .46, length(fract(grainUv) - .5));
float dirt = clamp(treadCondition.x, 0., 1.);
float dirtMask = mix(dirt * .36, (1. - step(dirt, grainHash)) * speck, grainDetail);
speck = mix(.36, speck, grainDetail);
float wearDetail = 1. - smoothstep(.4, 2., tireAcrossPixel * 55.);
float wearLines = .5 + .5 * sin(tireAcross * 55.) * wearDetail;
float damage = clamp(treadCondition.z + treadCondition.w, 0., 1.);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.10, .073, .042), dirtMask * .85);
diffuseColor.rgb *= 1. - (clamp(treadCondition.y, 0., 1.) * wearLines * .22 + damage * speck * .35);
diffuseColor.rgb *= (1. - tireGroove * .56) * (1. - tireWet * .12);
