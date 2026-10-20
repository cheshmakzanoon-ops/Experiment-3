import * as T from 'three';
import {
  RECORDED_TIRE_GLSL,
  RECORDED_TIRE_NORMAL_GLSL,
  RecordedTire,
} from '../../src/rendering/recorded-tire.ts';
import { WheelAssembly, type WheelSheet } from '../../src/rendering/vehicle-bodies/wheel.ts';
import {
  sampleWheelContact,
  wheelContactPose,
  type WheelContactPose,
} from '../../src/rendering/wheel-contact.ts';
import {
  C,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  WHEEL_CONTACT_BASE,
  carBase,
  wheelContactBase,
} from '../../src/simulation/protocol.ts';

/** Run the production vertex/normal functions on actual WebGL2 transform
 * feedback, then compile and photograph the catalogue wheel's lit/depth paths.
 * The plane/bead/sign witnesses do not reconstruct the implementation formula. */
export function captureTireContact() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(600, 440);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  document.body.append(renderer.domElement);
  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext))
    throw new Error('Tire contact probe requires WebGL2');
  const gl = context;
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0),
    p = wheelContactBase(o, 0);
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + WHEEL_CONTACT_BASE] = 1;
  frame[p + C.RADIAL] = 0.02;
  frame[p + C.HUB_LENGTH] = 0.23;
  frame[p + C.NORMAL_Y] = 1;
  frame[p + C.PLANE_DISTANCE] = 0.315;
  frame[p + C.LONGITUDINAL] = 0.006;
  frame[p + C.LATERAL] = 0.008;
  const measured = sampleWheelContact(frame, frame, o, 0, 1, wheelContactPose());
  const control = new RecordedTire(0.335, 0.245);
  const vertex = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
out vec3 capturedPosition;
out vec3 capturedNormal;
${RECORDED_TIRE_GLSL}
void main() {
  vec3 objectNormal = normal;
  ${RECORDED_TIRE_NORMAL_GLSL}
  capturedPosition = recordedTirePosition(position);
  capturedNormal = objectNormal;
  gl_Position = vec4(capturedPosition, 1.0);
}`;
  const fragment =
    '#version 300 es\nprecision highp float; out vec4 color; void main(){color=vec4(1.0);}';
  const shader = (source: string, type: number) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'Contact shader failed');
    return s;
  };
  const vs = shader(vertex, gl.VERTEX_SHADER),
    fs = shader(fragment, gl.FRAGMENT_SHADER),
    program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.transformFeedbackVaryings(
    program,
    ['capturedPosition', 'capturedNormal'],
    gl.INTERLEAVED_ATTRIBS,
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'Contact shader link failed');
  const input = gl.createBuffer()!,
    output = gl.createBuffer()!,
    vao = gl.createVertexArray()!,
    feedback = gl.createTransformFeedback()!;
  const location = (name: string) => gl.getUniformLocation(program, name);
  function probe(contact: WheelContactPose, phase = 0, toWheel = new T.Matrix4()) {
    control.update(phase, 0.335, 0, contact);
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -phase);
    const fromWheel = toWheel.clone().invert(),
      sourceNormal = new T.Matrix3().setFromMatrix4(toWheel).transpose();
    const points = [
      [0.09, -0.335, 0],
      [-0.09, -0.335, 0],
      [0.155, -0.245, 0],
      [-0.155, -0.245, 0],
      [0, 0.335, 0],
    ];
    const values = new Float32Array(points.length * 6);
    points.forEach((point, i) => {
      new T.Vector3()
        .fromArray(point)
        .applyQuaternion(spin)
        .applyMatrix4(fromWheel)
        .toArray(values, i * 6);
      new T.Vector3(0, point[1] < 0 ? -1 : 1, 0)
        .applyQuaternion(spin)
        .applyMatrix3(sourceNormal)
        .normalize()
        .toArray(values, i * 6 + 3);
    });
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, input);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    for (const [name, offset] of [
      ['position', 0],
      ['normal', 12],
    ] as const) {
      const at = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 24, offset);
    }
    gl.uniformMatrix4fv(location('contactToWheel'), false, toWheel.elements);
    gl.uniformMatrix4fv(location('contactFromWheel'), false, fromWheel.elements);
    gl.uniform4fv(location('contactShape'), control.uniforms.contactShape.value.toArray());
    gl.uniform2fv(location('contactSpin'), control.uniforms.contactSpin.value.toArray());
    gl.uniform3fv(
      location('contactCompression'),
      control.uniforms.contactCompression.value.toArray(),
    );
    gl.uniform3fv(location('contactNormal'), control.uniforms.contactNormal.value.toArray());
    gl.uniform2fv(location('contactShear'), control.uniforms.contactShear.value.toArray());
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, values.byteLength, gl.DYNAMIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, points.length);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    const result = new Float32Array(values.length);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    const normalToWheel = new T.Matrix3().getNormalMatrix(toWheel),
      restoreSpin = spin.clone().invert();
    return points.map((original, index) => ({
      original,
      position: new T.Vector3()
        .fromArray(result, index * 6)
        .applyMatrix4(toWheel)
        .applyQuaternion(restoreSpin)
        .toArray(),
      normal: new T.Vector3()
        .fromArray(result, index * 6 + 3)
        .applyMatrix3(normalToWheel)
        .applyQuaternion(restoreSpin)
        .normalize()
        .toArray(),
      rawNormalLength: Math.hypot(
        result[index * 6 + 3],
        result[index * 6 + 4],
        result[index * 6 + 5],
      ),
    }));
  }
  const bind = new T.Matrix4().compose(
    new T.Vector3(0.7, -0.34, -1.6),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2),
    new T.Vector3(0.9636, 0.9636, 0.9636),
  );
  const flat = probe(measured),
    spinningAuthored = probe(measured, 1.1, bind);
  const normal = new T.Vector3(0.12, 1, -0.08).normalize();
  const inclined = probe({ ...measured, normalX: normal.x, normalY: normal.y, normalZ: normal.z });
  const unloaded = probe(
    {
      ...measured,
      radial: 0,
      longitudinal: 0,
      lateral: 0,
      planeDistance: 0.26,
      normalX: normal.x,
      normalY: -normal.y,
      normalZ: normal.z,
    },
    0.7,
    bind,
  );
  const fallback = probe(wheelContactPose());
  gl.deleteTransformFeedback(feedback);
  gl.deleteVertexArray(vao);
  gl.deleteBuffer(input);
  gl.deleteBuffer(output);
  gl.deleteProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  renderer.resetState();

  const sheet: WheelSheet = {
    width: [0.31, 0.38],
    rimRadius: 0.245,
    spokes: 8,
    style: 'split',
    rimColor: 0xa7abb0,
    caliperColor: 0xbb2424,
    tread: 'slick',
    centreLock: true,
    disc: 0.8,
  };
  const wheel = new WheelAssembly(0.335, 1, true, sheet, 0);
  const scene = new T.Scene();
  scene.background = new T.Color(0x38414c);
  scene.add(wheel.pivot);
  scene.add(new T.HemisphereLight(0xdde9ff, 0x5e5046, 2.5));
  const sun = new T.DirectionalLight(0xffeed5, 3);
  sun.position.set(2, 4, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -1;
  sun.shadow.camera.right = sun.shadow.camera.top = 1;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 10;
  scene.add(sun);
  const ground = new T.Mesh(
    new T.PlaneGeometry(3, 3),
    new T.MeshStandardMaterial({ color: 0x7d848b, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new T.PerspectiveCamera(35, 600 / 440, 0.02, 10);
  camera.position.set(1.3, 0.7, 1.5);
  camera.lookAt(0, 0.3, 0);
  const compilation = { lit: 0, depth: 0 };
  for (const [material, key] of [
    [wheel.tyre.material as T.Material, 'lit'],
    [wheel.tyre.customDepthMaterial!, 'depth'],
  ] as const) {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, r) {
      previous.call(this, shader, r);
      if (shader.uniforms.contactShape.value.w !== 1)
        throw new Error('Measured contact was not active');
      compilation[key]++;
    };
  }
  const pixels = () => {
    const out = new Uint8Array(600 * 440 * 4);
    gl.readPixels(0, 0, 600, 440, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  function render(contact: WheelContactPose) {
    wheel.update(0.315, 0, 0, 0.8, 5000, 155, 400, contact, 0.335);
    renderer.render(scene, camera);
    return pixels();
  }
  const original = render({ ...measured, longitudinal: 0, lateral: 0 });
  const strained = render(measured),
    image = renderer.domElement.toDataURL('image/png');
  const replay = render({ ...measured, longitudinal: 0, lateral: 0 });
  let changed = 0,
    largest = 0,
    replayDelta = 0;
  for (let i = 0; i < original.length; i++) {
    const delta = Math.abs(original[i] - strained[i]);
    if (delta) changed++;
    largest = Math.max(largest, delta);
    replayDelta = Math.max(replayDelta, Math.abs(original[i] - replay[i]));
  }
  const result = {
    flat,
    spinningAuthored,
    inclined,
    unloaded,
    fallback,
    normal: normal.toArray(),
    compilation,
    changed,
    largest,
    replayDelta,
    shadow: !!sun.shadow.map,
    glError: gl.getError(),
    image,
  };
  const geometry = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometry.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) materials.add(o.customDistanceMaterial);
  });
  geometry.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  sun.shadow.map?.dispose();
  renderer.dispose();
  return result;
}
