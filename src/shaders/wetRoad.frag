// R encodes millimetres / 2, G local rubber coverage. This is the same spatial
// surface state sent by the simulation worker, not a global rain tint.
vec4 roadState = texture2D(trackState, vTrackUV);
float waterMm = roadState.r * 2.0;
float wet = smoothstep(0.0, 0.65, waterMm);
float puddle = smoothstep(0.65, 1.5, waterMm);
diffuseColor.rgb *= mix(1.0, 0.58, wet) * (1.0 - roadState.g * 0.25);
