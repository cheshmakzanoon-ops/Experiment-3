// Band-limited twill weave in UV space. Derivatives suppress subpixel strands,
// rather than retaining a high-contrast checkerboard at grazing angles.
float carbonFootprint = max(length(dFdx(vCarbonUv)), length(dFdy(vCarbonUv)));
float carbonResolved = 1.0 - smoothstep(0.35, 1.25, carbonFootprint);
vec2 carbonPhase = 6.28318530718 * vCarbonUv;
float carbonWeave = sin(carbonPhase.x) * cos(carbonPhase.y);
roughnessFactor = clamp(roughnessFactor + carbonWeave * carbonResolved * 0.035, 0.38, 0.68);
