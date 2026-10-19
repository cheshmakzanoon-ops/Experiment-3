/** Analytic room volumes behind the existing inset glazing. The view ray is
 * expressed in the pane's derivative frame, so rotated walls and differently
 * sized openings retain metric depth. No room meshes, textures or render pass
 * are allocated. These rooms are a facade illusion, not enterable interiors. */
export const FACADE_INTERIORS_GLSL = /* glsl */ `
float owRoomRect(vec2 p, vec2 lo, vec2 hi, vec2 aa) {
  vec2 edge = smoothstep(lo-aa,lo+aa,p)*(1.0-smoothstep(hi-aa,hi+aa,p));
  return edge.x*edge.y;
}

vec3 owRoomSafeRay(vec3 ray) {
  return mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),ray))*max(abs(ray),vec3(0.00001));
}

// Positive entry distance, or a sentinel when the ray misses the furniture.
float owRoomBox(vec3 origin, vec3 inverseRay, vec3 lo, vec3 hi) {
  vec3 a = (lo-origin)*inverseRay, b = (hi-origin)*inverseRay;
  vec3 nearPlane = min(a,b), farPlane = max(a,b);
  float enter = max(max(nearPlane.x,nearPlane.y),nearPlane.z);
  float leave = min(min(farPlane.x,farPlane.y),farPlane.z);
  return leave >= max(enter,0.0) ? max(enter,0.0) : 100000.0;
}

vec3 owFacadeRoom(vec2 paneUv, float seed, bool shop, vec3 toCamera,
                  out float facing, out float lamp) {
  vec2 dx = dFdx(paneUv), dy = dFdy(paneUv);
  vec3 px = dFdx(-toCamera), py = dFdy(-toCamera);
  float determinant = dx.x*dy.y-dx.y*dy.x;
  facing = 0.0; lamp = 0.0;
  if (abs(determinant) < 0.0000000001) return vec3(0.06);
  vec3 paneRight = (px*dy.y-py*dx.y)/determinant;
  vec3 paneUp = (py*dx.x-px*dy.x)/determinant;
  float width = max(length(paneRight),0.1), height = max(length(paneUp),0.1);
  paneRight /= width; paneUp /= height;
  vec3 outward = normalize(cross(paneRight,paneUp));
  vec3 view = normalize(toCamera);
  facing = clamp(dot(view,outward),0.0,1.0);
  vec2 aperture = shop ? vec2(0.84,0.86) : vec2(0.66,0.66);
  vec2 offset = shop ? vec2(0.08,0.07) : vec2(0.17,0.23);
  float depth = shop ? 3.4+seed*1.2 : 2.8+seed*1.4;
  vec3 origin = vec3(offset+clamp(paneUv,0.0,1.0)*aperture,1.0);
  vec3 ray = owRoomSafeRay(vec3(-dot(view,paneRight)*aperture.x/width,
                              -dot(view,paneUp)*aperture.y/height,
                              -max(facing,0.0001)/depth));
  vec3 inverseRay = 1.0/ray;
  vec3 exits = (step(vec3(0.0),ray)-origin)*inverseRay;
  float distance = min(min(exits.x,exits.y),exits.z);
  vec3 hit = clamp(origin+ray*distance,0.0,1.0);
  bool floorHit = exits.y <= min(exits.x,exits.z) && ray.y < 0.0;
  bool ceilingHit = exits.y <= min(exits.x,exits.z) && ray.y > 0.0;
  bool backHit = exits.z <= min(exits.x,exits.y);
  vec3 plaster = mix(vec3(0.43,0.39,0.31),vec3(0.29,0.37,0.39),step(0.53,seed));
  vec3 result = plaster*(backHit ? 0.91 : 0.73);
  vec2 uv = backHit ? hit.xy : hit.zy;
  vec2 aa = max(fwidth(uv),vec2(0.001));
  if (floorHit) {
    vec2 tile = hit.xz*vec2(shop ? 9.0 : 12.0,6.0);
    vec2 edge = min(fract(tile),1.0-fract(tile));
    vec2 mask = smoothstep(vec2(0.015),vec2(0.015)+max(fwidth(tile),vec2(0.001)),edge);
    float resolve = 1.0-smoothstep(0.3,1.0,max(fwidth(tile.x),fwidth(tile.y)));
    result = (shop ? vec3(0.20,0.22,0.21) : vec3(0.19,0.13,0.075))
      *mix(0.97,0.85+0.15*mask.x*mask.y,resolve);
  } else if (ceilingHit) {
    result = vec3(0.61,0.62,0.57);
    vec2 lightUv = hit.xz;
    vec2 lightAA = max(fwidth(lightUv),vec2(0.001));
    lamp = owRoomRect(lightUv,vec2(0.18,0.30),vec2(0.31,0.72),lightAA)
         + owRoomRect(lightUv,vec2(0.69,0.30),vec2(0.82,0.72),lightAA);
    result = mix(result,vec3(0.92,0.92,0.84),lamp);
  } else {
    float edgeShade = smoothstep(0.0,0.12,min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y)));
    result *= 0.68+0.32*edgeShade;
    if (!shop && backHit) {
      float frame = owRoomRect(hit.xy,vec2(0.18,0.49),vec2(0.49,0.78),aa);
      float print = owRoomRect(hit.xy,vec2(0.20,0.51),vec2(0.47,0.76),aa);
      result = mix(result,vec3(0.055,0.047,0.034),frame);
      vec3 ink = mix(vec3(0.16,0.24,0.20),vec3(0.43,0.29,0.14),seed);
      result = mix(result,ink*(0.65+0.35*smoothstep(0.56,0.72,hit.y)),print);
    }
  }
  // A real ray/box intersection makes shelving or a sofa occlude the back
  // wall and reveal their side faces as the camera moves past the window.
  vec3 furnitureLo = shop ? vec3(0.08,0.04,0.16) : vec3(0.12,0.05,0.19);
  vec3 furnitureHi = shop ? vec3(0.92,0.77,0.34) : vec3(0.80,0.31,0.47);
  float furnitureDistance = owRoomBox(origin,inverseRay,furnitureLo,furnitureHi);
  if (furnitureDistance < distance) {
    hit = origin+ray*furnitureDistance;
    vec3 face = (hit-furnitureLo)/(furnitureHi-furnitureLo);
    bool front = abs(hit.z-furnitureHi.z) < 0.0001;
    lamp = 0.0;
    if (shop && front) {
      vec2 shelfUv = face.xy*vec2(12.0,4.0);
      vec2 cell = fract(shelfUv), shelfAA = max(fwidth(shelfUv),vec2(0.001));
      // The room seed arrives as an interpolated vertex attribute. Snap it
      // before hashing: tiny interpolation error must not change a product
      // across scanlines or switch a nearly-one hash into an empty slot.
      float productId = owHash(floor(shelfUv)+floor(seed*4096.0+0.5));
      float productHeight = 0.56+productId*0.32;
      float bottle = 1.0-step(0.48,productId);
      float shoulder = smoothstep(productHeight-0.19,productHeight-0.09,cell.y);
      float halfWidth = mix(0.32,mix(0.25,0.11,shoulder),bottle);
      float product = owRoomRect(cell,vec2(0.5-halfWidth,0.12),
        vec2(0.5+halfWidth,productHeight),shelfAA)*(1.0-step(0.96,productId));
      vec3 productColor = mix(vec3(0.41,0.23,0.12),vec3(0.18,0.37,0.31),step(0.4,productId));
      productColor = mix(productColor,vec3(0.55,0.48,0.27),step(0.76,productId));
      float label = owRoomRect(cell,vec2(0.13,0.39),vec2(0.86,0.59),shelfAA);
      productColor = mix(productColor,vec3(0.56,0.54,0.45),label*0.65);
      // Cylindrical highlights and a dark lower edge distinguish bottles
      // from cartons without adding subpixel geometry or texture noise.
      float roundness = 0.70+0.30*sqrt(max(0.0,1.0-pow((cell.x-0.5)/0.34,2.0)));
      productColor *= mix(1.0,roundness,bottle)*(0.79+0.21*smoothstep(0.12,0.25,cell.y));
      float resolve = 1.0-smoothstep(0.35,1.0,max(shelfAA.x,shelfAA.y));
      result = mix(vec3(0.22,0.23,0.18),mix(vec3(0.065),productColor,product),resolve);
      float shelf = 1.0-smoothstep(0.05,0.05+shelfAA.y,cell.y);
      result = mix(result,vec3(0.31,0.32,0.29),shelf*resolve);
    } else {
      result = shop ? vec3(0.14,0.16,0.14) : mix(vec3(0.14,0.21,0.18),vec3(0.29,0.19,0.11),seed);
      result *= front ? 1.0 : face.y > 0.99 ? 1.15 : 0.65;
    }
  }
  vec3 counterLo = shop ? vec3(0.06,0.03,0.57) : vec3(0.32,0.03,0.56);
  vec3 counterHi = shop ? vec3(0.41,0.29,0.75) : vec3(0.75,0.15,0.75);
  float counterDistance = owRoomBox(origin,inverseRay,counterLo,counterHi);
  if (counterDistance < min(distance,furnitureDistance)) {
    hit = origin+ray*counterDistance;
    result = abs(hit.y-counterHi.y) < 0.0001 ? vec3(0.32,0.28,0.20) : vec3(0.12,0.10,0.07);
    lamp = 0.0;
  }
  return result;
}
`;
