vec3 carbonDx = dFdx(-vViewPosition);
vec3 carbonDy = dFdy(-vViewPosition);
vec2 carbonUvDx = dFdx(vCarbonUv);
vec2 carbonUvDy = dFdy(vCarbonUv);
vec3 carbonTangent = carbonDx * carbonUvDy.y - carbonDy * carbonUvDx.y;
vec3 carbonBitangent = -carbonDx * carbonUvDy.x + carbonDy * carbonUvDx.x;
float carbonLength = max(length(carbonTangent), length(carbonBitangent));
if (carbonLength > 0.000001) {
  vec2 carbonSlope = vec2(cos(carbonPhase.x) * cos(carbonPhase.y),
    -sin(carbonPhase.x) * sin(carbonPhase.y));
  normal = normalize(normal - 0.085 * carbonResolved *
    (carbonSlope.x * carbonTangent + carbonSlope.y * carbonBitangent) / carbonLength);
}
