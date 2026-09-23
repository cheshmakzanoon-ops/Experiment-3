"""Rebuild the three retained Blender body skins without touching the runtime.

blender --background scripts/apx01-shell.blend --python scripts/hero-export.py -- \
    test-results/authoring/apx01-shell.glb.gz

The artist edits the native .blend. This exporter preserves metre coordinates,
role names and paint UVs. It emits standard KHR_mesh_quantization, not a private
geometry format. No network, third-party decoder or npm dependency is used.
"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import struct
import sys
import bpy

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) != 1 or not args[0].endswith('.glb.gz'):
    raise SystemExit('Expected one output.glb.gz path')
out = Path(args[0]).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
parts = [o for o in bpy.data.objects if o.type == 'MESH']
if len(parts) != 3 or {o.get('apex_role') for o in parts} != {'nose', 'engine', 'sidepod'}:
    raise ValueError('Expected exactly three authored skin roles')
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
raw = out.with_suffix('')
bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', use_selection=True,
    export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
    export_materials='EXPORT', export_animations=False, export_extras=True,
    export_cameras=False, export_lights=False)
b = raw.read_bytes()
if struct.unpack_from('<III', b) != (0x46546C67, 2, len(b)):
    raise ValueError('Not a glTF 2 binary')
length, kind = struct.unpack_from('<II', b, 12)
if kind != 0x4E4F534A:
    raise ValueError('Missing JSON chunk')
j = json.loads(b[20:20+length])
start = 20 + length + 8
if j.get('images') or j.get('animations') or j.get('skins') or any('uri' in v for v in j['buffers']):
    raise ValueError('Expected self-contained static geometry')
old_accessors, old_views = j['accessors'], j['bufferViews']
new_accessors, new_views, binary = [], [], bytearray()
errors = {'POSITION': 0., 'NORMAL': 0., 'TEXCOORD_0': 0.}


def values(index):
    a = old_accessors[index]
    v = old_views[a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    fmt = {5126: 'f', 5123: 'H', 5125: 'I'}[a['componentType']]
    stride = v.get('byteStride', n * struct.calcsize(fmt))
    offset = start + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt*n, b, offset+i*stride) for i in range(a['count'])]


def append(data, component_type, vector_type, count, target, stride=None, normalized=False, bounds=None):
    binary.extend(b'\0' * (-len(binary) % 4))
    offset = len(binary)
    binary.extend(data)
    v = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data), 'target': target}
    if stride:
        v['byteStride'] = stride
    new_views.append(v)
    a = {'bufferView': len(new_views)-1, 'componentType': component_type, 'count': count, 'type': vector_type}
    if normalized:
        a['normalized'] = True
    if bounds:
        a['min'], a['max'] = bounds
    new_accessors.append(a)
    return len(new_accessors)-1


for mi, mesh in enumerate(j['meshes']):
    if len(mesh['primitives']) != 1:
        raise ValueError('Unexpected material split')
    p = mesh['primitives'][0]
    attr = p['attributes']
    points, normals, uvs = [values(attr[k]) for k in ['POSITION', 'NORMAL', 'TEXCOORD_0']]
    if not all(math.isfinite(v) for channel in [points, normals, uvs] for value in channel for v in value):
        raise ValueError('Nonfinite mesh')
    lo = [min(v[a] for v in points) for a in range(3)]
    hi = [max(v[a] for v in points) for a in range(3)]
    centre = [(x+y)*.5 for x, y in zip(lo, hi)]
    scale = [(y-x)*.5 for x, y in zip(lo, hi)]
    if any(s <= 0 for s in scale):
        raise ValueError('Degenerate envelope')
    qp = []
    for point in points:
        q = tuple(round((v-c)/s*32767) for v, c, s in zip(point, centre, scale))
        qp.append(q)
        errors['POSITION'] = max(errors['POSITION'], *[abs(c+s*x/32767-v) for c, s, x, v in zip(centre, scale, q, point)])
    qn = []
    for normal in normals:
        normal_pre = [v*s for v, s in zip(normal, scale)]
        n = math.sqrt(sum(v*v for v in normal_pre))
        if n == 0:
            raise ValueError('Zero surface normal')
        q = tuple(round(v/n*127) for v in normal_pre)
        qn.append(q)
        restored = [v/127/s for v, s in zip(q, scale)]
        ln = math.sqrt(sum(v*v for v in restored))
        errors['NORMAL'] = max(errors['NORMAL'], *[abs(v-q/ln) for v, q in zip(normal, restored)])
    qu = []
    for uv in uvs:
        if any(v < -.000001 or v > 1.000001 for v in uv):
            raise ValueError('UV exceeds the paint domain')
        q = tuple(round(max(0, min(1, v))*65535) for v in uv)
        qu.append(q)
        errors['TEXCOORD_0'] = max(errors['TEXCOORD_0'], *[abs(v-x/65535) for v, x in zip(uv, q)])
    attr['POSITION'] = append(b''.join(struct.pack('<hhhxx', *q) for q in qp), 5122, 'VEC3', len(qp), 34962, 8, True,
        ([min(v[a] for v in qp) for a in range(3)], [max(v[a] for v in qp) for a in range(3)]))
    attr['NORMAL'] = append(b''.join(struct.pack('<bbbx', *q) for q in qn), 5120, 'VEC3', len(qn), 34962, 4, True)
    attr['TEXCOORD_0'] = append(b''.join(struct.pack('<HH', *q) for q in qu), 5123, 'VEC2', len(qu), 34962, 4, True)
    indices = [v[0] for v in values(p['indices'])]
    if max(indices) >= 65536:
        raise ValueError('Unexpected high-vertex skin')
    p['indices'] = append(struct.pack('<' + 'H'*len(indices), *indices), 5123, 'SCALAR', len(indices), 34963)
    nodes = [node for node in j['nodes'] if node.get('mesh') == mi]
    if len(nodes) != 1 or any(k in nodes[0] for k in ['matrix', 'translation', 'rotation', 'scale']):
        raise ValueError('Expected one identity node per modelling part')
    nodes[0]['translation'], nodes[0]['scale'] = centre, scale
j['accessors'], j['bufferViews'] = new_accessors, new_views
binary.extend(b'\0' * (-len(binary) % 4))
j['buffers'] = [{'byteLength': len(binary)}]
j.setdefault('extensionsUsed', []).append('KHR_mesh_quantization')
j.setdefault('extensionsRequired', []).append('KHR_mesh_quantization')
text = json.dumps(j, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
packed = struct.pack('<III', 0x46546C67, 2, 12+8+len(text)+8+len(binary)) + struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(binary), 0x004E4942) + binary
compressed = bytearray(gzip.compress(packed, compresslevel=9, mtime=0))
compressed[9] = 255  # Canonical OS metadata across Python/zlib versions.
out.write_bytes(compressed)
report = {'blender': bpy.app.version_string, 'parts': [o.get('apex_role') for o in parts],
    'bytes': len(packed), 'compressedBytes': len(compressed),
    'sha256': hashlib.sha256(packed).hexdigest(), 'compressedSHA256': hashlib.sha256(compressed).hexdigest(),
    'maximumComponentQuantizationError': errors, 'finalArtApproved': False}
out.with_suffix('.verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
