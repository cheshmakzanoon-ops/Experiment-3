/** Tailoring in the retained mesh's metre-scale bind coordinates. The skin
 * weights select garment regions, so a chest panel cannot slide onto an arm
 * when that arm crosses the body. No additional vertex buffer or texture. */
export const CREW_SUIT_VARYINGS = `
varying float vCrewCloth;
varying vec3 vCrewPattern;
varying vec2 vCrewRegion;
`;

export const crewSuitVertex = `
vCrewCloth = crewCloth;
vCrewPattern = position;
vec4 crewIndices = crewJoint;
vCrewRegion = vec2(
  dot(crewWeight, vec4(1.) - step(vec4(2.5), crewIndices)),
  dot(crewWeight, step(vec4(2.5), crewIndices) * (vec4(1.) - step(vec4(8.5), crewIndices)))
);
`;

/** Thin seams fade with their screen footprint; broad construction panels stay
 * legible at the middle LOD. This is dyed cloth, not emissive decoration. */
export const crewSuitFragment = `
vec3 suitP = vCrewPattern;
vec3 suitPixel = max(fwidth(suitP), vec3(.0002));
float suitCloth = clamp(vCrewCloth, 0., 1.);
float suitTorso = clamp(vCrewRegion.x, 0., 1.);
float suitSleeve = clamp(vCrewRegion.y, 0., 1.);
float suitLeg = max(0., 1. - suitTorso - suitSleeve);
float suitEdge = 1.315 + abs(suitP.x) * .18;
float suitEdgePixel = max(fwidth(suitP.y - suitEdge), .0002);
float suitYoke = smoothstep(suitEdge - suitEdgePixel, suitEdge + suitEdgePixel, suitP.y) * suitTorso;
float suitShoulder = smoothstep(1.30 - suitPixel.y, 1.30 + suitPixel.y, suitP.y) * suitSleeve;
float suitSide = smoothstep(.145 - suitPixel.x, .185 + suitPixel.x, abs(suitP.x)) * suitTorso;
float suitKnee = (1. - smoothstep(.065, .11, abs(suitP.y - .46))) * suitLeg;
float suitElbow = (1. - smoothstep(.045, .075, abs(suitP.y - 1.07))) * suitSleeve;
float suitReinforcement = clamp(suitSide + suitKnee + suitElbow, 0., 1.);
diffuseColor.rgb *= 1. - suitCloth * suitReinforcement * .24;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.30, .36, .37),
  clamp(suitYoke + suitShoulder, 0., 1.) * suitCloth * .78);
// A narrow centre closure belongs to the front of the torso, not the back.
float suitFront = smoothstep(.02, .07, suitP.z) * suitTorso;
float suitZip = (1. - smoothstep(max(0., .004 - suitPixel.x), .004 + suitPixel.x, abs(suitP.x)))
  * min(1., .004 / suitPixel.x) * suitFront;
float suitPiping = (1. - smoothstep(max(0., .003 - suitEdgePixel), .003 + suitEdgePixel,
  abs(suitP.y - suitEdge))) * min(1., .003 / suitEdgePixel) * suitTorso;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.055, .065, .07), suitZip * suitCloth * .8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.48, .44, .32), suitPiping * suitCloth * .8);
`;
