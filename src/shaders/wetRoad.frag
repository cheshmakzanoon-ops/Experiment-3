// R encodes millimetres / 2, G local laid rubber, B local loose marbles. This is the same spatial
// surface state sent by the simulation worker, not a global rain tint.
vec4 roadState = texture2D(trackState, vTrackUV);
roadState.gb *= surfaceDeposits;
float waterMm = roadState.r * 2.0;
// A fine film (fog drip, dew, a drying line: 0.004-0.05 mm) already darkens and
// glosses the asphalt as damp; the water sheet proper still starts at 0.65 mm.
float roadDamp = smoothstep(0.004, 0.05, waterMm);
float wet = max(smoothstep(0.0, 0.65, waterMm), 0.5 * roadDamp);
float puddle = smoothstep(0.65, 1.5, waterMm);
diffuseColor.rgb *= mix(1.0, 0.58, wet) * (1.0 - roadState.g * 0.08);
// Stable granular flecks: local density is from the physics cell, never rain or
// session age. Derivative filtering suppresses sub-pixel shimmer at distance.
vec2 marbleGrid = vTrackUV * vec2(360.0, 48000.0);
vec2 marbleCell = floor(marbleGrid);
float marbleHash = fract(sin(dot(marbleCell, vec2(127.1, 311.7))) * 43758.5453);
float marbleEdge = length((fract(marbleGrid) - 0.5) * vec2(1.0, 1.6));
float marbleAA = max(fwidth(marbleEdge), 0.03);
float marbleFleck = (1.0 - smoothstep(0.18 - marbleAA, 0.18 + marbleAA, marbleEdge)) *
  step(marbleHash, roadState.b) * smoothstep(0.0, 0.012, roadState.b);
float marbleDetail = 1.0 - smoothstep(0.5, 1.5,
  max(length(dFdx(marbleGrid)), length(dFdy(marbleGrid))));
float filteredMarbles = mix(roadState.b * 0.065, marbleFleck, marbleDetail);
// In a dust storm the loose film on the road (the same marble-coverage cell
// state, 0.09 at its heaviest) is sand, not rubber: it lightens and mattes the
// asphalt toward tan where it lies and shows no black pellets.
float roadDustFilm = roadDust * smoothstep(0.0, 0.07, roadState.b);
diffuseColor.rgb *= 1.0 - filteredMarbles * 0.55 * (1.0 - roadDust);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.30, 0.22, 0.13), roadDustFilm * 0.8);
