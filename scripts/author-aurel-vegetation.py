"""Original A51-A54 tree library. Explicit authoring only; never run by npm.

Blender 5.2.2 LTS. Six authored tree forms, three coherent tiers, shared packed
leaf/bark PBR images. Metres in Blender; self-contained Y-up glTF at runtime.
Usage: blender -b -t 2 --python-exit-code 1 --python scripts/author-aurel-vegetation.py -- --output-root /tmp/aurel-trees
Re-export a retained source: append --source /path/to/aurel-vegetation.blend.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
import zlib

import bpy
import numpy as np
from mathutils import Vector

ARGS = argparse.ArgumentParser()
ARGS.add_argument('--output-root', required=True)
ARGS.add_argument('--source')
args = ARGS.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = Path(args.output_root).resolve()
ROOT = Path(__file__).resolve().parents[1]
if OUT == ROOT or ROOT in OUT.parents:
    raise ValueError('Author outside the checkout, then review and import the matched outputs.')
if bpy.app.version[:3] != (5, 2, 2):
    raise RuntimeError('This library is pinned to Blender 5.2.2 LTS.')
for folder in ('scripts', 'public/models', 'src/rendering'):
    (OUT / folder).mkdir(parents=True, exist_ok=True)
REV = 'aurel-a51-a54-r01'
VARIANTS = ['broadleaf-young', 'broadleaf-mature', 'columnar-young',
            'columnar-mature', 'orchard-open', 'orchard-row-end']
DIMENSIONS = [(9.0, 7.0), (12.0, 10.2), (11.5, 3.7), (14.0, 4.2), (4.8, 5.1), (5.4, 5.9)]

def xyz(p):
    return (p[0], -p[2], p[1])

def game(p):
    return [round(p[0], 6), round(p[2], 6), round(-p[1], 6)]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def png(pixels):
    height, width, _ = pixels.shape
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    scan = b''.join(b'\0' + row.tobytes() for row in pixels)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scan, 9)) + chunk(b'IEND', b''))

def image(name, pixels, color=True):
    with tempfile.TemporaryDirectory(prefix='aurel-vegetation-') as tmp:
        p = Path(tmp) / (name + '.png')
        p.write_bytes(png(pixels))
        im = bpy.data.images.load(str(p), check_existing=False)
        im.name = name
        im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        im.pack()
        im.filepath = '//' + name + '.png'
    return im

def textures():
    # Flat original albedo: leaf veins and age variation, no directional light.
    # Each padded tile is one branching spray, not a pre-lit whole-tree billboard.
    atlas = np.zeros((1024, 1024, 4), dtype=np.uint8)
    yy, xx = np.mgrid[:512, :512]
    for tile in range(4):
        rng = np.random.default_rng(5100 + tile)
        patch = np.zeros((512, 512, 4), dtype=np.uint8)
        patch[:, :, :3] = [53, 81, 35]
        # A branched spray with hundreds of small leaves, not a few metre-sized
        # leaves stretched across a crown. At a 3 m card, blades are ~6-14 cm.
        def stem(ax, ay, bx, by, width):
            vx, vy = bx - ax, by - ay
            t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
            mask = (xx - ax - t * vx) ** 2 + (yy - ay - t * vy) ** 2 < width * width
            patch[mask] = [83, 73, 44, 255]
        stem(257, 480, 247, 48, 2)
        for twig in range(19):
            ay = 76 + twig * 20
            side = -1 if twig % 2 else 1
            reach = (125 + rng.uniform(-25, 35)) * math.sin(math.pi * (ay + 30) / 590)
            ax, bx, by = 252, 252 + side * reach, ay - 32 - rng.uniform(10, 24)
            stem(ax, ay, bx, by, 1.0)
            for blade in range(18):
                t = .12 + (blade // 2) / 9 * .88
                hand = -1 if blade % 2 else 1
                cx = ax + (bx - ax) * t + hand * 8
                cy = ay + (by - ay) * t + hand * 9
                angle = side * (.5 + hand * .45) + rng.uniform(-.25, .25)
                dx, dy = xx - cx, yy - cy
                u = dx * math.cos(angle) + dy * math.sin(angle)
                v = -dx * math.sin(angle) + dy * math.cos(angle)
                rx = (10 if tile == 1 else 12) + rng.uniform(-2, 3)
                ry = (3.5 if tile == 1 else 6.0) + rng.uniform(-1, 1)
                profile = (u / rx) ** 2 + (v / ry) ** 2
                mask = profile < 1 + .03 * np.cos(np.arctan2(v / ry, u / rx) * 14)
                color = np.array([59, 94, 43] if tile == 1 else [70, 109, 46] if tile == 2 else [64, 103, 40], float)
                color += rng.uniform(-13, 13)
                vein = np.abs(v) < .55
                fill = np.clip(color[None, None, :] + vein[:, :, None] * 7, 0, 255).astype(np.uint8)
                patch[:, :, :3][mask] = fill[mask]
                patch[:, :, 3][mask] = 255
        patch[:16, :, 3] = patch[-16:, :, 3] = 0
        patch[:, :16, 3] = patch[:, -16:, 3] = 0
        atlas[(tile // 2) * 512:(tile // 2 + 1) * 512, (tile % 2) * 512:(tile % 2 + 1) * 512] = patch
    yy, xx = np.mgrid[:256, :256]
    furrow = np.sin(xx * .27 + np.sin(yy * .043) * 1.2) + .35 * np.sin(xx * .83 + yy * .023)
    coarse = np.clip(np.floor((furrow + 1.4) * 3), 0, 8)
    base = np.empty((256, 256, 4), dtype=np.uint8)
    base[:, :, :3] = np.stack([76 + coarse * 5, 69 + coarse * 4, 53 + coarse * 3], axis=-1)
    base[:, :, 3] = 255
    normal = np.empty_like(base)
    normal[:, :, 0] = np.clip(128 + np.gradient(furrow, axis=1) * 42, 0, 255)
    normal[:, :, 1] = np.clip(128 + np.gradient(furrow, axis=0) * 42, 0, 255)
    normal[:, :, 2:] = 255
    return image('A51_A54_original_leaf_sprays', atlas), image('A51_A54_original_bark', base), image('A51_A54_original_bark_normal', normal, False)

def material(name, base, roughness, normal=None, leaves=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = 0
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = base
    links.new(tex.outputs['Color'], p.inputs['Base Color'])
    if leaves:
        links.new(tex.outputs['Alpha'], p.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'
        m.use_backface_culling = False
        m['runtimeAlphaMode'] = 'MASK'
        m['runtimeAlphaCutoff'] = .45
    if normal:
        ntex = nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        n = nodes.new('ShaderNodeNormalMap')
        n.inputs['Strength'].default_value = .3
        links.new(ntex.outputs['Color'], n.inputs['Color'])
        links.new(n.outputs['Normal'], p.inputs['Normal'])
    return m

class Mesh:
    def __init__(self):
        self.vertices, self.faces, self.uv = [], [], []

    def face(self, points, uv):
        first = len(self.vertices)
        self.vertices.extend([xyz(p) for p in points])
        self.faces.append(tuple(range(first, first + len(points))))
        self.uv.extend(uv)

    def tube(self, points, radii, sides):
        # A transported frame avoids arbitrary cylinder joints on curved limbs.
        rings = []
        for i, point in enumerate(points):
            tangent = Vector(points[min(len(points) - 1, i + 1)]) - Vector(points[max(0, i - 1)])
            tangent.normalize()
            ref = Vector((0, 0, 1)) if abs(tangent.z) < .85 else Vector((1, 0, 0))
            a = tangent.cross(ref).normalized()
            b = tangent.cross(a).normalized()
            rings.append([Vector(point) + radii[i] * (a * math.cos(k * math.tau / sides) + b * math.sin(k * math.tau / sides)) for k in range(sides)])
        for j in range(len(rings) - 1):
            for k in range(sides):
                n = (k + 1) % sides
                self.face([rings[j][k], rings[j][n], rings[j + 1][n], rings[j + 1][k]],
                          [(k / sides, j / (len(rings) - 1)), ((k + 1) / sides, j / (len(rings) - 1)),
                           ((k + 1) / sides, (j + 1) / (len(rings) - 1)), (k / sides, (j + 1) / (len(rings) - 1))])
        self.face(list(reversed(rings[0])), [(0, 0)] * sides)
        self.face(rings[-1], [(1, 1)] * sides)

    def spray(self, centre, width, height, yaw, tilt, tile):
        # Four vertices per spray, with irregular edge clipping from the shared map.
        right = Vector((math.cos(yaw), 0, math.sin(yaw)))
        up = Vector((-math.sin(yaw) * math.sin(tilt), math.cos(tilt), math.cos(yaw) * math.sin(tilt)))
        c = Vector(centre)
        points = [c - right * width / 2 - up * height / 2,
                  c + right * width / 2 - up * height / 2,
                  c + right * width / 2 + up * height / 2,
                  c - right * width / 2 + up * height / 2]
        # 16-pixel gutters match opaque sprites; atlas never bleeds into neighbours.
        x, y = tile % 2 * .5, 1 - (tile // 2 + 1) * .5
        self.face(points, [(x + .016, y + .016), (x + .484, y + .016),
                          (x + .484, y + .484), (x + .016, y + .484)])

    def object(self, name, parent, mat, collection, canopy=False, crown_y=0):
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.vertices, [], self.faces)
        data.update()
        uv = data.uv_layers.new(name='UVMap')
        for i, loop in enumerate(uv.data):
            loop.uv = self.uv[i]
        o = bpy.data.objects.new(name, data)
        collection.objects.link(o)
        o.parent = parent
        data.materials.append(mat)
        for p in data.polygons:
            p.use_smooth = True
        # Aggregate crown normals keep crossed twig sprays from lighting like cards.
        # These are explicitly authored loop normals and exported unchanged.
        if canopy:
            normals = []
            for p in data.vertices:
                q = Vector((p.co.x, p.co.y, max(.16, (p.co.z - crown_y) * .6)))
                q.normalize()
                normals.append(q)
            data.normals_split_custom_set_from_vertices(normals)
        o['part'] = 'foliage' if canopy else 'bark'
        return o

def author():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene['assetIds'] = 'A51,A52,A53,A54'
    scene['finalArtApproved'] = False
    scene['handoff'] = 'Six original tree forms. Metres, root contact at ground. Preview offsets belong to variant roots only. Export resets these offsets, never mesh data. A54 composes instances of the same library, not duplicate geometry.'
    coll = bpy.data.collections.new('A51_A54_EDITABLE_TREES')
    scene.collection.children.link(coll)
    leaf, bark, normal = textures()
    leafmat = material('A51_A54_LEAVES', leaf, .86, leaves=True)
    barkmat = material('A51_A54_BARK', bark, .93, normal)
    for variant, name in enumerate(VARIANTS):
        H, W = DIMENSIONS[variant]
        narrow, orchard = variant in (2, 3), variant >= 4
        parent = bpy.data.objects.new('TREE_' + name, None)
        coll.objects.link(parent)
        parent.location.x = (variant - 2.5) * 15
        parent['nominalHeight'] = H
        parent['nominalWidth'] = W
        for level in range(3):
            root = bpy.data.objects.new(f'{name}_LOD{level}', None)
            coll.objects.link(root)
            root.parent = parent
            wood, leaves = Mesh(), Mesh()
            rng = np.random.default_rng(5154 + variant * 97)
            steps, sides = [(7, 8), (4, 6), (2, 4)][level]
            trunk_top = H * (.94 if narrow else .46 if orchard else .70)
            bend = .09 if orchard else .12 if variant % 2 == 0 else .36
            trunk = [(math.sin(i / steps * 2.1 + variant) * bend * i / steps, trunk_top * i / steps,
                      math.sin(i / steps * 2.4) * bend * i / steps) for i in range(steps + 1)]
            wood.tube(trunk, [H * (.033 if orchard else .023) * (1 - .82 * i / steps) for i in range(steps + 1)], sides)
            if level < 2:
                for k in range(5 if level == 0 else 3):
                    a = k * math.tau / 5 + variant
                    wood.tube([(0, H * .055, 0), (math.cos(a) * H * .05, H * .014, math.sin(a) * H * .05),
                               (math.cos(a) * H * .085, 0, math.sin(a) * H * .085)], [H * .016, H * .012, H * .002], sides)
            lobes = 13 if narrow else 11 if orchard else 15
            for k in range(lobes):
                a = k * 2.399963 + variant * .83
                f = k / (lobes - 1)
                if narrow:
                    y = H * (.22 + f * .68)
                    radius = W * .31 * (1 - .60 * f)
                    centre = (math.cos(a) * radius, y, math.sin(a) * radius)
                    sh, sw = H * (.25 - f * .06), W * (.75 - f * .33)
                    attach = H * (.14 + f * .70)
                elif orchard:
                    y = H * (.63 + .13 * math.sin(k * 1.43))
                    radius = W * (.22 + .055 * math.sin(k * 2.1))
                    centre = (math.cos(a) * radius, y, math.sin(a) * radius)
                    sh, sw = H * .42, W * .49
                    attach = H * (.26 + f * .14)
                else:
                    y = H * (.47 + f * .34 + .025 * math.sin(k * 1.7 + variant))
                    radius = W * (.27 * math.sin(math.pi * (.13 + .78 * f)))
                    centre = (math.cos(a) * radius, y, math.sin(a) * radius)
                    sh, sw = H * (.33 - .07 * f), W * (.51 - .10 * f)
                    attach = H * (.29 + .30 * f)
                # All tiers share the same scaffolds and lobe centres. Simplification
                # removes sub-branches/cards rather than inventing another silhouette.
                if level < 2 and (level == 0 or k % 2 == 0):
                    p0, end = Vector((0, attach, 0)), Vector(centre)
                    mid = p0.lerp(end, .58)
                    mid.y -= H * .05
                    wood.tube([p0, mid, end], [H * (.017 if orchard else .009), H * .007, H * .0015], sides)
                    if level == 0:
                        twig = end + Vector((math.cos(a + .8) * W * .08, H * .065, math.sin(a + .8) * W * .08))
                        wood.tube([mid, end, twig], [H * .004, H * .002, H * .0007], 4)
                base_yaw = float(rng.uniform(0, math.tau))
                # Sampling angles are nested across levels for calm handoffs.
                angles = [0, 1, 2, 3, 4, 5] if level == 0 else [0, 2, 4] if level == 1 else [0, 3]
                for j in angles:
                    yaw = base_yaw + j * math.pi / 3
                    tilt = [-.55, .55, -.15, .72, -.72, .15][j]
                    leaves.spray(centre, sw, sh, yaw, tilt, 1 if narrow else 2 if orchard else 0 if variant == 0 else 3)
            wood.object(f'{name}_LOD{level}_BARK', root, barkmat, coll)
            leaves.object(f'{name}_LOD{level}_LEAVES', root, leafmat, coll, True, H * .45)
            root.hide_viewport = level != 0
            root.hide_render = level != 0
        socket = bpy.data.objects.new('ROOT_' + name, None)
        coll.objects.link(socket)
        socket.parent = parent
        socket.empty_display_type = 'PLAIN_AXES'
        socket.empty_display_size = .3
    # Native A54 arrangement references the existing LOD0 mesh datablocks.
    # It is an editable composition preview, excluded from the runtime export.
    composition = bpy.data.collections.new('A54_GROVE_AND_ORCHARD_COMPOSITIONS')
    scene.collection.children.link(composition)
    grove = [(-9, -5, 1), (0, 0, 0), (7, -7, 3), (-4, 8, 0), (9, 7, 2)]
    layouts = [('GROVE', x, z + 28, kind) for x, z, kind in grove]
    layouts += [('ORCHARD', col * 8.5 - 17, row * 10 + 60, 5 if col in (0, 4) else 4)
                for row in range(2) for col in range(5)]
    for i, (family, x, z, kind) in enumerate(layouts):
        parent = bpy.data.objects.new(f'A54_{family}_{i:02}', None)
        composition.objects.link(parent)
        parent.location = xyz((x, 0, z))
        parent['libraryVariant'] = VARIANTS[kind]
        for part in ('BARK', 'LEAVES'):
            original = bpy.data.objects[f'{VARIANTS[kind]}_LOD0_{part}']
            instance = bpy.data.objects.new(parent.name + '_' + part, original.data)
            composition.objects.link(instance)
            instance.parent = parent
    scene['A54_composition'] = json.dumps({'grove': grove, 'orchardSpacing': [8.5, 10.0], 'seed': 5154})
    bpy.context.preferences.filepaths.save_version = 0
    source = OUT / 'scripts/aurel-vegetation.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    return source

if args.source:
    source = Path(args.source).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(source))
else:
    source = author()
if bpy.context.scene.unit_settings.scale_length != 1:
    raise ValueError('Invalid metre source')
images = [im for im in bpy.data.images if im.name.startswith('A51_A54_original')]
if len(images) != 3 or not all(im.packed_file for im in images):
    raise ValueError('Source must retain all three packed original maps')
parents = [bpy.data.objects.get('TREE_' + v) for v in VARIANTS]
if any(p is None for p in parents):
    raise ValueError('Missing authored tree family')
for p in parents:
    p.location = (0, 0, 0)
    for root in p.children:
        root.hide_viewport = False
        root.hide_render = False
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.collections['A51_A54_EDITABLE_TREES'].objects:
    o.hide_set(False)
    o.select_set(True)
path = OUT / 'public/models/aurel-vegetation.glb'
bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False, export_extras=True)
# Explicit masked-leaf contract independent of Blender's viewport transparency UI.
raw = path.read_bytes()
jsonlen = struct.unpack_from('<I', raw, 12)[0]
d = json.loads(raw[20:20 + jsonlen])
for m in d['materials']:
    if m['name'] == 'A51_A54_LEAVES':
        m.update(alphaMode='MASK', alphaCutoff=.45, doubleSided=True)
        m['pbrMetallicRoughness']['metallicFactor'] = 0
payload = json.dumps(d, separators=(',', ':')).encode()
payload += b' ' * (-len(payload) % 4)
tail = raw[20 + jsonlen:]
raw = struct.pack('<III', 0x46546c67, 2, 20 + len(payload) + len(tail)) + struct.pack('<II', len(payload), 0x4e4f534a) + payload + tail
path.write_bytes(raw)
triangles, bounds = {}, {}
for name in VARIANTS:
    triangles[name] = []
    for level in range(3):
        children = next(n['children'] for n in d['nodes'] if n['name'] == f'{name}_LOD{level}')
        if len(children) != 2:
            raise ValueError('Each tier must have exactly bark and foliage')
        triangles[name].append(sum(d['accessors'][p['indices']]['count'] // 3
                                   for child in children for p in d['meshes'][d['nodes'][child]['mesh']]['primitives']))
    if not triangles[name][0] > triangles[name][1] > triangles[name][2]:
        raise ValueError('Non-decreasing detail budget')
    points = [o.matrix_world @ v.co for o in bpy.data.objects if o.name.startswith(name + '_LOD') and o.type == 'MESH' for v in o.data.vertices]
    coords = [game(v) for v in points]
    bounds[name] = {'min': [min(p[i] for p in coords) for i in range(3)], 'max': [max(p[i] for p in coords) for i in range(3)]}
manifest = {'revision': REV, 'assetIds': ['A51', 'A52', 'A53', 'A54'], 'url': 'models/aurel-vegetation.glb',
            'bytes': len(raw), 'sha256': sha(path), 'author': 'scripts/author-aurel-vegetation.py',
            'sourceSHA256': sha(Path(__file__)), 'editable': 'scripts/aurel-vegetation.blend',
            'editableSHA256': sha(source), 'blender': '5.2.2', 'variants': VARIANTS,
            'dimensions': dict(zip(VARIANTS, [{'height': h, 'width': w} for h, w in DIMENSIONS])),
            'triangles': triangles, 'bounds': bounds, 'materials': len(d['materials']),
            'images': len(d['images']), 'meshes': len(d['meshes']), 'nodes': len(d['nodes']),
            'textureSizes': [[int(v) for v in im.size] for im in images], 'alphaCutoff': .45,
            'finalArtApproved': False, 'provenance': 'Original authored scaffolds, foliage sprays and bark maps. No downloaded third-party model, photograph or commercial-game asset.'}
(OUT / 'src/rendering/aurel-vegetation.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('A51_A54_AUTHORING_RECEIPT', json.dumps(manifest))
