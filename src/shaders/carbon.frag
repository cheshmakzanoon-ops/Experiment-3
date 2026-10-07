// Band-limited twill weave in metre-scaled object coordinates (3 mm tows). Derivatives suppress
// subpixel strands, rather than retaining a high-contrast checkerboard at grazing angles.
float carbonFootprint = max(length(dFdx(vCarbonUv)), length(dFdy(vCarbonUv)));
float carbonResolved = 1.0 - smoothstep(0.35, 1.25, carbonFootprint);
vec2 carbonPhase = 6.28318530718 * vCarbonUv;
float carbonWeave = sin(carbonPhase.x) * cos(carbonPhase.y);
// Alternating two-over/two-under bundles, filtered to a neutral mean at distance.
float twillCell = mod(floor(vCarbonUv.x) - floor(vCarbonUv.y), 4.0);
float twillWarp = step(2.0, twillCell);
float twillStrand = mix(sin(carbonPhase.x), sin(carbonPhase.y), twillWarp);
roughnessFactor = clamp(roughnessFactor + (carbonWeave * 0.018 + twillStrand * 0.035) * carbonResolved, 0.28, 0.6);
// Weave contrast (CARBON_WEAVE: +-18 % lacquered, +-8 % satin) and the bright crown of each tow.
diffuseColor.rgb *= 1.0 + twillStrand * carbonResolved * CARBON_WEAVE;
diffuseColor.rgb += 0.012 * (CARBON_WEAVE / 0.18) * max(0.0, twillStrand) * carbonResolved;
