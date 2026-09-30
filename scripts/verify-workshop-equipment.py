"""Check the committed A36 receipt and serialized mesh contract without Blender."""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def verify():
    manifest = json.loads((ROOT/'src/rendering/workshop-equipment.manifest.json').read_text())
    for path, key in [(manifest['author'],'sourceSHA256'), (manifest['editable'],'blendSHA256'), ('public/'+manifest['url'],'sha256')]:
        actual = hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
        assert actual == manifest[key], (path, 'hash mismatch')
    raw = (ROOT/'public'/manifest['url']).read_bytes()
    assert len(raw) == manifest['bytes'] < 4_500_000
    assert struct.unpack_from('<III', raw) == (0x46546c67,2,len(raw))
    size, tag = struct.unpack_from('<II', raw, 12)
    assert tag == 0x4e4f534a and size % 4 == 0
    document = json.loads(raw[20:20+size])
    bin_size, bin_tag = struct.unpack_from('<II',raw,20+size)
    assert bin_tag == 0x004e4942 and 28+size+bin_size == len(raw)
    assert len(document['materials']) == 1 and len(document['images']) == 3
    assert len(document['nodes']) == manifest['nodes'] and len(document['meshes']) == 12
    assert 'uri' not in document['buffers'][0]
    for image in document['images']:
        assert image['mimeType'] == 'image/png' and 'uri' not in image
        view = document['bufferViews'][image['bufferView']]
        png = raw[28+size+view['byteOffset']:28+size+view['byteOffset']+view['byteLength']]
        assert png[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack_from('>II',png,16) == (512,256)
    names = [n.get('name') for n in document['nodes']]
    assert len(set(names)) == len(names)
    for kind, variant in manifest['variants'].items():
        assert variant['triangles'][0] > variant['triangles'][1] > variant['triangles'][2] > 0
        assert abs(variant['bounds']['min'][1]) < .001
        for level in range(3):
            node = next(n for n in document['nodes'] if n['name'] == f'A36_{kind}_LOD{level}')
            primitives = document['meshes'][node['mesh']]['primitives']
            assert len(primitives) == 1
            primitive = primitives[0]
            assert document['accessors'][primitive['indices']]['count'] == variant['triangles'][level]*3
            assert set(primitive['attributes']) == {'POSITION','NORMAL','TEXCOORD_0'}
        for role, point in variant['sockets'].items():
            node = next(n for n in document['nodes'] if n['name'] == f'SOCKET_A36_{kind}_{role}')
            assert node['translation'] == point
    assert manifest['triangles'] == [sum(v['triangles'][i] for v in manifest['variants'].values()) for i in range(3)]
    assert not manifest['finalArtApproved'] and not manifest['collision']['enabled']
    print(json.dumps({'assetId':'A36','verified':True,'bytes':len(raw),'sha256':manifest['sha256'],'triangles':manifest['triangles'],'sourceComponents':manifest['sourceComponents']}))

if __name__ == '__main__':
    verify()
