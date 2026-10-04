"""Original A55-A60 Aurel limestone, verge and understory kit.

Explicit asset authoring only. Blender 5.2.2; metres, Z-up editable source,
Y-up self-contained GLB. No application installation or test invokes Blender.
Re-export with --source to verify the saved native file independently.
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
import bmesh
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--output-root', required=True)
parser.add_argument('--source')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = Path(args.output_root).resolve()
ROOT = Path(__file__).resolve().parents[1]
if OUT == ROOT or ROOT in OUT.parents:
    raise ValueError('Author outside the checkout; review outputs before integration.')
if bpy.app.version[:3] != (5, 2, 2):
    raise RuntimeError('Use pinned Blender 5.2.2 LTS.')
for folder in ('scripts', 'public/models', 'src/rendering'):
    (OUT / folder).mkdir(parents=True, exist_ok=True)
VARIANTS = ['cliff-bench', 'cliff-cut', 'retaining-wall', 'talus', 'boulder',
            'drain-collar', 'verge-edge', 'shrub', 'hedge', 'tussock', 'ridge']
REVISION = 'aurel-a55-a60-r01'

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def xyz(p):
    return (p[0], -p[2], p[1])

def game(p):
    return [round(p[0], 6), round(p[2], 6), round(-p[1], 6)]

def png(p):
    h, w, _ = p.shape
    def chunk(k, data):
        return struct.pack('>I', len(data)) + k + data + struct.pack('>I', zlib.crc32(k + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row.tobytes() for row in p), 9)) + chunk(b'IEND', b''))

def image(name, pixels, color=True):
    with tempfile.TemporaryDirectory(prefix='aurel-quarry-') as tmp:
        p = Path(tmp) / (name + '.png')
        p.write_bytes(png(pixels))
        im = bpy.data.images.load(str(p), check_existing=False)
        im.name = name
        im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        im.pack()
        im.filepath = '//' + name + '.png'
    return im

def materials():
    y, x = np.mgrid[:512, :512]
    rng = np.random.default_rng(5759)
    # Limestone bedding, pore-scale relief and restrained mineral variation.
    # Albedo contains no baked directional illumination or ambient shadows.
    grain = rng.normal(0, 1, (512, 512))
    band = np.sin(y * 2 * math.pi / 64 + .5 * np.sin(x * 2 * math.pi / 512))
    fine = np.sin(y * 2 * math.pi / 16 + .28 * np.cos(x * 2 * math.pi / 128))
    relief = band * .65 + fine * .13 + grain * .05
    base = np.zeros((512, 512, 4), dtype=np.uint8)
    for c, (tone, amount) in enumerate([(156, 10), (150, 10), (130, 8)]):
        base[:, :, c] = np.clip(tone + band * amount + fine * 3 + grain * 3, 0, 255)
    base[:, :, 3] = 255
    normal = np.zeros_like(base)
    dx = np.roll(relief, -1, 1) - np.roll(relief, 1, 1)
    dy = np.roll(relief, -1, 0) - np.roll(relief, 1, 0)
    vectors = np.stack([-dx * 1.8, -dy * 1.8, np.ones_like(dx)], axis=-1)
    vectors /= np.linalg.norm(vectors, axis=-1)[:, :, None]
    normal[:, :, :3] = np.clip((vectors * .5 + .5) * 255, 0, 255).astype(np.uint8)
    normal[:, :, 3] = 255
    rough = np.zeros_like(base)
    rough[:, :, :3] = np.clip(206 + grain[:, :, None] * 7, 0, 255)
    rough[:, :, 3] = 255
    rock_color = image('A55_A60_original_limestone', base)
    rock_normal = image('A55_A60_original_limestone_normal', normal, False)
    rock_rough = image('A55_A60_original_limestone_roughness', rough, False)
    yy, xx = np.mgrid[:256, :256]
    foliage = np.zeros((256, 256, 4), dtype=np.uint8)
    foliage[:, :, :3] = [53, 70, 35]  # sensible transparent-edge RGB
    for twig in range(9):
        side = -1 if twig % 2 else 1
        ax, ay = 128, 220 - twig * 18
        bx, by = ax + side * (68 - twig * 2), ay - 55
        vx, vy = bx - ax, by - ay
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        stem = (xx - ax - t * vx) ** 2 + (yy - ay - t * vy) ** 2 < 1.4
        foliage[stem] = [84, 77, 46, 255]
        for leaf in range(12):
            t = .12 + (leaf // 2) * .15
            hand = -1 if leaf % 2 else 1
            cx, cy = ax + vx * t + hand * 6, ay + vy * t + hand * 6
            angle = side * .7 + hand * .65
            u = (xx - cx) * math.cos(angle) + (yy - cy) * math.sin(angle)
            v = -(xx - cx) * math.sin(angle) + (yy - cy) * math.cos(angle)
            mask = (u / 9) ** 2 + (v / 3.8) ** 2 < 1
            foliage[mask] = [59 + leaf % 3 * 6, 86 + twig % 3 * 7, 38, 255]
    foliage[:8, :, 3] = foliage[-8:, :, 3] = 0
    foliage[:, :8, 3] = foliage[:, -8:, 3] = 0
    leaves = image('A55_A60_original_understory_spray', foliage)
    def material(name, color, texture=None, leaf=False):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        ns, links = m.node_tree.nodes, m.node_tree.links
        bsdf = ns.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = .88
        if texture:
            node = ns.new('ShaderNodeTexImage'); node.image = texture
            links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
            if leaf:
                links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
                m.surface_render_method = 'DITHERED'
        return m
    stone = material('A55_A60_LIMESTONE', (.55, .53, .45), rock_color)
    ns, links = stone.node_tree.nodes, stone.node_tree.links
    bsdf = ns.get('Principled BSDF')
    normal_tex = ns.new('ShaderNodeTexImage'); normal_tex.image = rock_normal
    normal_map = ns.new('ShaderNodeNormalMap'); normal_map.inputs['Strength'].default_value = .45
    links.new(normal_tex.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
    rough_tex = ns.new('ShaderNodeTexImage'); rough_tex.image = rock_rough
    links.new(rough_tex.outputs['Color'], bsdf.inputs['Roughness'])
    return stone, material('A55_A60_UNDERSTORY', (.2, .3, .12), leaves, True), material('A55_A60_GRASS', (.19, .24, .09))

class Shape:
    def __init__(self):
        self.vertices, self.faces, self.uvs = [], [], []
    def face(self, points, uv=None):
        start = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(start, start + len(points))))
        self.uvs.extend(uv or [(p[2] / 5, p[1] / 5) for p in points])
    def box(self, centre, size, bevel=0):
        # Two inset rings give cap edges a real narrow bevel, even in a far tier.
        x, y, z = centre; w, h, d = size
        b = min(bevel, w * .2, h * .2, d * .2)
        rings = []
        for yy, inset in [(y-h/2, b), (y-h/2+b, 0), (y+h/2-b, 0), (y+h/2, b)]:
            rings.append([(x-w/2+inset, yy, z-d/2+inset), (x+w/2-inset, yy, z-d/2+inset),
                          (x+w/2-inset, yy, z+d/2-inset), (x-w/2+inset, yy, z+d/2-inset)])
        if not b: rings = [rings[0], rings[-1]]
        self.face(rings[0][::-1]); self.face(rings[-1])
        for a, b in zip(rings, rings[1:]):
            for i in range(4): self.face([a[i], a[(i+1)%4], b[(i+1)%4], b[i]])
    def rock(self, centre, size, segments, rings, seed, strata=False):
        x, y, z = centre; w, h, d = size
        points = []
        for j, t in enumerate(rings):
            ring = []
            # Coherent benches along the face; top narrows rather than making a box.
            radius = (1 - .54 * t) if strata else math.sin(.24 + t * 2.60) * .86
            if strata: radius += .07 * math.sin(t * math.pi * 7)
            for k in range(segments):
                a = k / segments * 2 * math.pi
                uneven = 1 + .07 * math.sin(a*3+seed) + .04 * math.sin(a*5-seed*.3)
                yy = y + t*h + (0 if j == 0 else h*.025*math.sin(a*4+seed) * t)
                ring.append((x + math.cos(a)*w/2*radius*uneven,
                             yy, z + math.sin(a)*d/2*radius*uneven))
            points.append(ring)
        self.face(points[0][::-1]); self.face(points[-1])
        for a, b in zip(points, points[1:]):
            for k in range(segments): self.face([a[k], a[(k+1)%segments], b[(k+1)%segments], b[k]])
    def object(self, name, parent, material, leafy=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata([xyz(p) for p in self.vertices], [], self.faces)
        data.update()
        uv = data.uv_layers.new(name='UVMap')
        for poly in data.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = self.uvs[data.loops[li].vertex_index]
        if not leafy:
            bm = bmesh.new(); bm.from_mesh(data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(data); bm.free()
        ob = bpy.data.objects.new(name, data)
        bpy.data.collections['A55_A60_EDITABLE_LIBRARY'].objects.link(ob)
        ob.parent = parent; ob.data.materials.append(material)
        return ob

def make_variant(name, level):
    s = Shape()
    if name.startswith('cliff'):
        tall = name == 'cliff-cut'
        rings = [[0, .16, .19, .34, .38, .54, .58, .77, .81, 1], [0, .18, .36, .56, .8, 1], [0, .36, .8, 1]][level]
        s.rock((0, -.6, 0), (18 if tall else 16, 17 if tall else 12, 26 if tall else 24), [24, 14, 8][level], rings, 3 if tall else 9, True)
        if level < 2:
            for i in range(3 if level == 0 else 2):
                s.rock((-5.8 + i*2.6, -.5, -8.4+i*7.2), (4.5, 2.2, 5.6), [9, 6][level], [0,.5,1], 5+i)
    elif name in ('boulder', 'talus'):
        for i in range(1 if name == 'boulder' else [7,4,2][level]):
            x, z = ((0, 0) if name == 'boulder' else ((i%3-1)*1.4, (i//3-1)*1.5))
            size = (3.2, 2.4, 2.8) if name == 'boulder' else (2.5, 1.2+(i%2)*.6, 2.2)
            s.rock((x,-.28,z), size, [12,8,5][level], [[0,.3,.68,1],[0,.55,1],[0,1]][level], 4+i)
    elif name == 'retaining-wall':
        courses = [6,4,2][level]
        for row in range(courses):
            h = 3.6/courses
            blocks = [5,3,1][level]
            for col in range(blocks):
                s.box((.15-row/courses*.22, (row+.5)*h-.35, (col+.5)*6/blocks-3),
                      (1.9-row/courses*.35, h-.028, 6/blocks-.027), .025 if level<2 else 0)
        s.box((-.05,3.36,0),(1.95,.24,6.12),.05 if level<2 else 0)
    elif name == 'drain-collar':
        # Hole deliberately larger than the retained 0.405 x 1.635 m drain bed.
        for hand in [-1,1]:
            s.box((hand*.258, .029, 0),(.085,.02,1.88), .006 if level==0 else 0)
            s.box((0,.029,hand*.888),(.43,.02,.105), .006 if level==0 else 0)
        if level==0:
            for z in [-.46,.46]: s.box((.31,.027,z),(.035,.013,.09))
    elif name == 'verge-edge':
        for i in range([8,4,1][level]):
            n=[8,4,1][level]
            s.box((0,-.007,(i+.5)*4/n-2),(1.15,.036,4/n-.018),.007 if level==0 else 0)
    elif name in ('shrub','hedge'):
        count = ([22,12,5] if name=='shrub' else [40,18,7])[level]
        for i in range(count):
            a=i*2.399963; t=(i+.5)/count
            radius=.85*math.sqrt(max(0,1-(t*.85)**2))
            x=math.cos(a)*radius; z=math.sin(a)*radius
            if name=='hedge': z=z*.55 + ((i%5)/4-.5)*3.0; x*=.72
            y=.22+t*1.05
            dx,dz=math.cos(a)*.48,math.sin(a)*.48
            s.face([(x-dx,y-.22,z-dz),(x+dx,y-.22,z+dz),
                    (x+dx*.72,y+.5,z+dz*.72),(x-dx*.72,y+.5,z-dz*.72)],
                   [(0,0),(1,0),(1,1),(0,1)])
    elif name=='tussock':
        for i in range([30,14,5][level]):
            a=i*2.399963; r=.05+(i%4)*.033; h=.26+(i%7)*.033
            x,z=math.cos(a)*r,math.sin(a)*r
            dx,dz=math.cos(a)*.018,math.sin(a)*.018
            s.face([(x-dx,-.025,z-dz),(x+dx,-.025,z+dz),
                    (x+dx+math.sin(a)*.055,h*.65,z+dz+math.cos(a)*.055),
                    (x+math.sin(a)*.14,h,z+math.cos(a)*.14),
                    (x-dx+math.sin(a)*.055,h*.65,z-dz+math.cos(a)*.055)])
    elif name=='ridge':
        s.rock((0,-4,0),(240,68,160),[28,16,10][level],[[0,.28,.48,.68,1],[0,.38,.68,1],[0,.65,1]][level],13,True)
    return s

def author():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
    library=bpy.data.collections.new('A55_A60_EDITABLE_LIBRARY'); scene.collection.children.link(library)
    stone, leaf, grass=materials()
    for i,name in enumerate(VARIANTS):
        root=bpy.data.objects.new('KIT_'+name,None); library.objects.link(root)
        root.location=xyz(((i%4)*44,0,(i//4)*48))
        root['assetIds']='A55-A60'; root['units']='metres'; root['front']='negative game X'
        for level in range(3):
            mat=leaf if name in ('shrub','hedge') else grass if name=='tussock' else stone
            ob=make_variant(name,level).object(f'{name}_LOD{level}',root,mat,name in ('shrub','hedge','tussock'))
            ob['tier']=level; ob.hide_render=level!=0; ob.hide_set(level!=0)
    scene['productionBrief']='Aurel limestone benches, quarry cut, coursed retaining wall, talus, stones, drain collars, jointed verge, understory and distant ridge. Original editable geometry and packed maps.'
    scene['acceptance']='First authored revision; final-art, human lap and physical GPU approval are separate.'
    bpy.context.preferences.filepaths.save_version=0
    path=OUT/'scripts/aurel-quarry.blend'; bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    return path

source=Path(args.source).resolve() if args.source else author()
if args.source: bpy.ops.wm.open_mainfile(filepath=str(source))
if bpy.context.scene.unit_settings.scale_length!=1: raise ValueError('Expected metre source')
images=[im for im in bpy.data.images if im.name.startswith('A55_A60_original')]
if len(images)!=4 or any(not im.packed_file for im in images): raise ValueError('Missing packed maps')
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.data.collections['A55_A60_EDITABLE_LIBRARY'].objects:
    if ob.type=='EMPTY': ob.location=(0,0,0)
    ob.hide_render=False; ob.hide_set(False); ob.select_set(True)
bpy.context.view_layer.update()
path=OUT/'public/models/aurel-quarry.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True)
raw=path.read_bytes(); n=struct.unpack_from('<I',raw,12)[0]; doc=json.loads(raw[20:20+n])
for m in doc['materials']:
    if m['name']=='A55_A60_UNDERSTORY': m.update(alphaMode='MASK',alphaCutoff=.45,doubleSided=True)
    if m['name']=='A55_A60_GRASS': m['doubleSided']=True
payload=json.dumps(doc,separators=(',',':')).encode(); payload+=b' '*(-len(payload)%4)
tail=raw[20+n:]; raw=struct.pack('<III',0x46546c67,2,20+len(payload)+len(tail))+struct.pack('<II',len(payload),0x4e4f534a)+payload+tail
path.write_bytes(raw)
triangles,bounds={},{}
for name in VARIANTS:
    counts=[]
    for level in range(3):
        node=next(n for n in doc['nodes'] if n.get('name')==f'{name}_LOD{level}')
        ps=doc['meshes'][node['mesh']]['primitives']
        if len(ps)!=1: raise ValueError('Expected one material per family')
        counts.append(doc['accessors'][ps[0]['indices']]['count']//3)
    if not counts[0]>=counts[1]>=counts[2]>0 or counts[0]==counts[2]: raise ValueError('Invalid LOD budget: '+name)
    triangles[name]=counts
    points=[game(v.co) for level in range(3) for v in bpy.data.objects[f'{name}_LOD{level}'].data.vertices]
    bounds[name]={'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]}
manifest={'revision':REVISION,'assetIds':['A55','A56','A57','A58','A59','A60'],
          'url':'models/aurel-quarry.glb','bytes':len(raw),'sha256':sha(path),
          'author':'scripts/author-aurel-quarry.py','sourceSHA256':sha(__file__),
          'editable':'scripts/aurel-quarry.blend','editableSHA256':sha(source),'blender':'5.2.2',
          'variants':VARIANTS,'triangles':triangles,'bounds':bounds,
          'materials':len(doc['materials']),'images':len(doc.get('images',[])),
          'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),
          'textureSizes':[[int(v) for v in im.size] for im in images],
          'finalArtApproved':False,'provenance':'Original authored limestone profiles, mortared coursing, ground fittings and plant silhouettes; original packed maps. No third-party models, photographs, brands or extracted game assets.'}
(OUT/'src/rendering/aurel-quarry.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('A55_A60_AUTHORING_RECEIPT',json.dumps(manifest))
