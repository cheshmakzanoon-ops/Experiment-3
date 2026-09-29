"""A31 exact source/export receipt and self-contained GLB validation (stdlib only)."""
import hashlib
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
m = json.loads((root / 'src/rendering/wheel-gun.manifest.json').read_text())
b = (root / 'public/models/aurel-wheel-gun.glb').read_bytes()
assert hashlib.sha256((root / m['author']).read_bytes()).hexdigest() == m['sourceSHA256']
assert (root / m['editable']).stat().st_size > 10000
assert len(b) == m['bytes'] < 6 * 1024 * 1024
assert hashlib.sha256(b).hexdigest() == m['sha256']
magic, version, total, json_size, json_kind = struct.unpack_from('<5I', b)
assert (magic, version, total, json_kind) == (0x46546c67, 2, len(b), 0x4e4f534a)
d = json.loads(b[20:20 + json_size])
assert d['asset']['version'] == '2.0'
assert len(d['meshes']) == m['meshes'] == 9
assert len(d['nodes']) == m['nodes'] == 19
assert len(d['materials']) == m['materials'] == 1
assert len(d['images']) == m['images'] == 3
assert len(d['buffers']) == 1 and 'uri' not in d['buffers'][0]
for im in d['images']:
    assert 'uri' not in im and isinstance(im['bufferView'], int)
for name, spec in m['sockets'].items():
    ns = [n for n in d['nodes'] if n['name'] == name]
    assert len(ns) == 1 and ns[0]['translation'] == spec['position'] and ns[0]['rotation'] == spec['quaternion']
for level in range(3):
    nodes = [n for n in d['nodes'] if n['name'].startswith(f'A31_LOD{level}_')]
    assert len(nodes) == 3
    count = sum(d['accessors'][p['indices']]['count'] // 3 for n in nodes for p in d['meshes'][n['mesh']]['primitives'])
    assert count == m['triangles'][str(level)] <= m['triangleCeilings'][str(level)]
    for n in nodes:
        for p in d['meshes'][n['mesh']]['primitives']:
            for key in ['POSITION', 'NORMAL', 'TEXCOORD_0']:
                a = d['accessors'][p['attributes'][key]]
                bv = d['bufferViews'][a['bufferView']]
                data = b[28 + json_size + bv['byteOffset']:28 + json_size + bv['byteOffset'] + bv['byteLength']]
                import math
                assert all(math.isfinite(v[0]) for v in struct.iter_unpack('<f', data))
print(json.dumps({'assetId': 'A31', 'bytes': len(b), 'sha256': m['sha256'], 'triangles': m['triangles'], 'sourceVerified': True}))
