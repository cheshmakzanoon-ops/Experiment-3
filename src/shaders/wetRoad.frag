// R encodes millimetres / 2, G local laid rubber, B local loose marbles. This is the same spatial
// surface state sent by the simulation worker, not a global rain tint.
vec4 roadState = texture2D(trackState, vTrackUV);
float waterMm = roadState.r * 2.0;
float wet = smoothstep(0.0, 0.65, waterMm);
float puddle = smoothstep(0.65, 1.5, waterMm);
diffuseColor.rgb *= mix(1.0, 0.58, wet) * (1.0 - roadState.g * 0.25);
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
diffuseColor.rgb *= 1.0 - filteredMarbles * 0.55;
