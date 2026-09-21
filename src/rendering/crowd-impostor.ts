import * as T from 'three';

/** Original analytic seated-person card, not a photograph or licensed atlas.
 * Only used beyond the geometric LODs, where a person occupies a few pixels. */
export function spectatorImpostorGeometry() {
  const geometry = new T.PlaneGeometry(0.58, 1.02).translate(0, 0.21, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A two-triangle, lit billboard. Colour and skin remain the same per-instance
 * data as the nearby mesh. It receives scene lighting/fog, but does not cast a
 * camera-facing shadow. Nearby geometric levels own real spectator shadows. */
export function installCrowdImpostorShader(material: T.MeshStandardMaterial, range: T.Vector2) {
  material.vertexColors = false;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.crowdLodRange = { value: range };
    shader.vertexShader =
      `attribute float spectatorPhase; attribute vec3 spectatorSkin;
      varying float vCrowdRank; varying vec2 vPerson; varying vec3 vSkin;
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vPerson = position.xy; vSkin = spectatorSkin;
      vCrowdRank = min(.9999999, spectatorPhase / 6.28318530718);`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      'vec3 transformedNormal = vec3(0.,0.,1.);',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      mat4 crowdBasis = modelMatrix * instanceMatrix;
      vec2 crowdScale = vec2(length(crowdBasis[0].xyz), length(crowdBasis[1].xyz));
      vec4 mvPosition = viewMatrix * crowdBasis * vec4(0.,0.,0.,1.);
      mvPosition.xy += position.xy * crowdScale;
      gl_Position = projectionMatrix * mvPosition;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `
      vec4 worldPosition = crowdBasis * vec4(0.,0.,0.,1.);
      worldPosition.xyz += inverseTransformDirection(vec3(1.,0.,0.), viewMatrix) * position.x * crowdScale.x
        + inverseTransformDirection(vec3(0.,1.,0.), viewMatrix) * position.y * crowdScale.y;`,
    );
    shader.fragmentShader =
      `uniform vec2 crowdLodRange; varying float vCrowdRank;
      varying vec2 vPerson; varying vec3 vSkin;
      float personEllipse(vec2 p, vec2 centre, vec2 radius) {
        return (length((p-centre)/radius)-1.) * min(radius.x,radius.y);
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      vec2 p = vPerson;
      float head = personEllipse(p,vec2(0.,.615),vec2(.086,.106));
      float torso = personEllipse(p,vec2(0.,.32),vec2(.163,.228));
      float lap = personEllipse(p,vec2(0.,.085),vec2(.215,.083));
      float leftLeg = personEllipse(p,vec2(-.105,-.095),vec2(.068,.19));
      float rightLeg = personEllipse(p,vec2(.105,-.095),vec2(.068,.19));
      float shape = min(head,min(torso,min(lap,min(leftLeg,rightLeg))));
      float aa = max(fwidth(shape),.0001);
      diffuseColor.a *= 1.-smoothstep(-aa,aa,shape);
      float headMask = 1.-smoothstep(-aa,aa,head);
      diffuseColor.rgb = mix(diffuseColor.rgb, vSkin, headMask);
      if(p.y < .15) diffuseColor.rgb *= vec3(.22,.25,.28);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `
      if (vCrowdRank < crowdLodRange.x || vCrowdRank >= crowdLodRange.y) discard;
      #include <alphatest_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'apex-seated-impostor-v1';
}
