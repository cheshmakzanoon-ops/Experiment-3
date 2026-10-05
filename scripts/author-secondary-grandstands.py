"""A12 original modular secondary stands. Explicit Blender -> GLB -> runtime.

blender -b -t 2 --factory-startup --python-exit-code 1 --python
scripts/author-secondary-grandstands.py -- --output-root /tmp/a12
Reopen with --source /tmp/a12/scripts/aurel-secondary-grandstands.blend.
No install/build/startup authoring and no writes inside the application checkout.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import math
import shutil
import struct
import sys
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('deck', 'roof', 'rails', 'frame', 'aisle', 'end', 'seat', 'post', 'foot', 'trim')
TIERS = ('near', 'mid', 'far')
NAMES = [role + '_' + tier for role in ROLES for tier in TIERS]
COLLECTION = 'A12 / editable export prototypes'
REVISION = 'aurel-secondary-grandstands-r01'
COLORS = {'stone': (.30, .33, .31), 'steel': (.055, .105, .125),
          'roof': (.56, .61, .60), 'trim': (.015, .22, .27), 'seat': (.46, .07, .045)}
sha = lambda value: hashlib.sha256(value).hexdigest()
xyz = lambda p: (p[0], -p[2], p[1])


class Shape:
    def __init__(self):
        self.vertices, self.faces = [], []

    def vertex(self, p):
        self.vertices.append(tuple(p))
        return len(self.vertices) - 1

    def quad(self, a, b, c, d):
        self.faces.extend(((a, b, c), (a, c, d)))

    def section(self, profile, z0, z1):
        """Closed x/y section extruded along the eight-metre module's z axis."""
        first, n = len(self.vertices), len(profile)
        for z in (z0, z1):
            for x, y in profile:
                self.vertex((x, y, z))
        for i in range(n):
            j = (i + 1) % n
            self.quad(first+i, first+j, first+j+n, first+i+n)
        # Use Blender's polygon triangulation for concave stair/seat sections.
        self.faces.extend((tuple(first+i for i in reversed(range(n))),
                           tuple(first+n+i for i in range(n))))

    def box(self, center, size):
        x, y, z = center
        w, h, d = [s / 2 for s in size]
        self.section(((x-w,y-h),(x+w,y-h),(x+w,y+h),(x-w,y+h)),z-d,z+d)

    def beam(self, a, b, width, depth=None, sides=4):
        a, b = Vector(a), Vector(b)
        axis = (b - a).normalized()
        reference = Vector((0, 0, 1)) if abs(axis.z) < .9 else Vector((0, 1, 0))
        u = axis.cross(reference).normalized()
        v = axis.cross(u).normalized()
        start = len(self.vertices)
        depth = width if depth is None else depth
        for p in (a, b):
            for j in range(sides):
                t = math.tau * (j + .5) / sides
                self.vertex(p + u*(math.cos(t)*width*.707107) + v*(math.sin(t)*depth*.707107))
        for j in range(sides):
            self.quad(start+j,start+(j+1)%sides,start+(j+1)%sides+sides,start+j+sides)
        self.faces.extend((tuple(start+j for j in reversed(range(sides))),
                           tuple(start+sides+j for j in range(sides))))


def author():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    materials = {}
    for name, color in COLORS.items():
        material = bpy.data.materials.new('A12 / ' + name)
        material.use_nodes = True
        principled = material.node_tree.nodes.get('Principled BSDF')
        principled.inputs['Base Color'].default_value = (*color, 1)
        principled.inputs['Roughness'].default_value = {'stone': .9, 'steel': .43, 'roof': .55, 'trim': .5, 'seat': .58}[name]
        principled.inputs['Metallic'].default_value = .65 if name == 'steel' else .4 if name == 'roof' else 0
        material['runtime_finish'] = name
        materials[name] = material
    prototypes = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(prototypes)
    objects = {}

    def mesh(role, tier, shape, material):
        name = role + '_' + tier
        data = bpy.data.meshes.new('A12_' + name)
        data.from_pydata([xyz(p) for p in shape.vertices], [], shape.faces)
        data.update()
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        uv = data.uv_layers.new(name='Original metric UV')
        for loop in data.loops:
            p = data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (p.x - p.y*.17, p.z - p.y*.11)
        obj = bpy.data.objects.new('A12_' + name, data)
        prototypes.objects.link(obj)
        data.materials.append(materials[material])
        obj['role'], obj['tier'], obj['units'] = role, tier, 'metres'
        obj['module_length'] = 8.0
        obj['final_art_approved'] = False
        objects[name] = obj

    for tier in TIERS:
        near, far = tier == 'near', tier == 'far'
        g = Shape()
        g.box((.3,-.12,0),(2.5,.24,8))
        for row in range(8):
            x, y = 1.7+row*.98, row*.49+.1
            if near:
                g.section(((x-.51,y-.1),(x+.51,y-.1),(x+.51,y+.07),
                           (x+.48,y+.1),(x-.48,y+.1),(x-.51,y+.07)),-4,4)
            else:
                g.box((x,y,0),(1.02,.2,8))
        g.box((9.5,3.53,0),(1.25,.2,8))
        mesh('deck',tier,g,'stone')
        g = Shape()
        # Keep the tested original roof pitch/envelope. Recess the skin below
        # its raised seams; do not lift the whole roof into existing camera rays.
        slope, half = math.tan(.166), .06 / math.cos(.166)
        low = lambda x: 6.58 + (x-4.5)*slope - half
        high = lambda x: 6.58 + (x-4.5)*slope + half
        g.section(((-1.75,low(-1.75)),(10.75,low(10.75)),
                   (10.75,high(10.75)-.035),(-1.75,high(-1.75)-.035)),-4,4)
        if not far:
            # Support the canopy behind the front cantilever sightline, not
            # across the protected broadcast-camera view under its leading edge.
            for x in ([1.6,3.6,5.6,7.8,10.1] if near else [2.1,7.9]):
                g.box((x,low(x)-.10,0),(.08,.16,8))
            g.section(((-1.75,high(-1.75)-.035),(10.75,high(10.75)-.035),
                       (10.75,high(10.75)),(-1.75,high(-1.75))), -3.98, -3.94)
        mesh('roof',tier,g,'roof')
        g = Shape()
        for x,y in ((-.8,1.05),(10,4.82),(10,4.27)):
            g.box((x,y,0),(.045,.045,8))
        for z in (-4,0):
            for x,y,h in ((-.8,.54,1.1),(10,4.2,1.3)):
                g.box((x,y,z),(.045,h,.045))
        if not far:
            g.beam((9.8,1,-4),(9.8,6.1,4),.065)
            g.beam((9.8,6.1,-4),(9.8,1,4),.065)
        else:
            g.beam((9.8,1,-4),(9.8,6.1,4),.065)
        mesh('rails',tier,g,'steel')
        g = Shape()
        g.beam((-1.6,5.45,0),(10.65,7.5,0),.16,.12)
        g.beam((2.1,4.6,0),(10.65,7.5,0),.1,.085)
        if not far:
            for k in range(5):
                x, xx = -1.6+k*2.45, -1.6+(k+1)*2.45
                g.beam((x,5.45+(x+1.6)*.167,0),(xx,5.05+(xx+1.6)*.167,0),.045)
            if near:
                for x,y in ((2.1,5.98),(9.8,7.36)):
                    g.box((x,y,0),(.3,.23,.21))
        mesh('frame',tier,g,'steel')
        g = Shape()
        if far:
            g.section(((1.15,.0),(1.15,.2),(8.81,3.63),(8.81,3.43)),-.59,.59)
        else:
            for step in range(15):
                g.box((1.7+step*.49,.15+step*.245,0),(.5,.1,1.18))
            g.box((9.04,3.58,0),(.49,.1,1.18))
        # Rails stay within the already empty +/-0.7m spectator aisles.
        for z in (-.62,.62):
            g.beam((1.15,1.05,z),(9.0,4.62,z),.045)
            for x,y in ((1.15,.525),(5.08,2.31),(9.0,4.095)):
                g.box((x,y,z),(.045,1.05,.045))
        mesh('aisle',tier,g,'steel')
        g = Shape()
        # Thin, stepped end-return wall: not an opaque side across the walkway.
        profile = [(1.19,-.12),(9.03,-.12),(9.03,3.63)]
        for row in reversed(range(8)):
            left, top = round(1.19+row*.98,6), round(.2+row*.49,6)
            profile.append((left,top))
            if row > 0:
                profile.append((left,round(top-.49,6)))
        g.section(profile,-.06,.06)
        mesh('end',tier,g,'stone')
        g = Shape()
        if near:
            profile = ((-.2,-.025),(.20,-.025),(.225,.39),(.19,.41),
                       (.16,.355),(.145,.035),(-.12,.035),(-.2,.015))
        elif not far:
            profile = ((-.2,-.025),(.20,-.025),(.225,.39),(.18,.41),(.145,.035),(-.2,.015))
        else:
            profile = ((-.2,0),(.20,0),(.20,.40),(.15,.40),(.15,.04),(-.2,.04))
        g.section(profile,-.20,.20)
        if near:
            # Retained seat anchors are 0.30m above the terrace. A pedestal and
            # bolted mounting shoe bridge that gap instead of floating shells.
            g.box((.07,-.1625,0),(.075,.275,.09))
            g.box((.07,-.2875,0),(.19,.025,.18))
        elif not far:
            g.box((.07,-.1625,0),(.075,.275,.09))
        mesh('seat',tier,g,'seat')
        g = Shape()
        # Unit-height post; terrain-to-roof length is determined at integration.
        g.box((0,.5,0),(.16,1,.16))
        mesh('post',tier,g,'steel')
        g = Shape()
        if near:
            # Chamfered footing plan, y 0..1, runtime scaled to 0.34m height.
            plan = ((-.345,-.425),(.345,-.425),(.425,-.345),(.425,.345),
                    (.345,.425),(-.345,.425),(-.425,.345),(-.425,-.345))
            for y in (0,1):
                for x,z in plan:
                    g.vertex((x,y,z))
            for i in range(8):
                g.quad(i,(i+1)%8,(i+1)%8+8,i+8)
            g.faces.extend((tuple(reversed(range(8))),tuple(range(8,16))))
        else:
            g.box((0,.5,0),(.85,1,.85))
        mesh('foot',tier,g,'stone')
        g = Shape()
        # Folded front fascia and rear gutter form a continuous modular edge.
        g.section(((-1.81,5.22),(-1.69,5.22),(-1.69,high(-1.75)),(-1.81,high(-1.75))),-4,4)
        g.section(((10.64,7.62),(10.84,7.62),(10.84,7.86),(10.77,7.86),
                   (10.77,7.69),(10.64,7.69)),-4,4)
        mesh('trim',tier,g,'trim')

    assembly = bpy.data.collections.new('A12 / assembled 48m stand')
    bpy.context.scene.collection.children.link(assembly)
    def place(role, p=(0,0,0), scale=(1,1,1)):
        original = objects[role+'_near']
        obj = original.copy()
        obj.data = original.data
        assembly.objects.link(obj)
        obj.name = 'Assembly / '+role
        obj.location = xyz(p)
        obj.scale = (scale[0],scale[2],scale[1])
    for z in range(-20,21,8):
        for role in ('deck','roof','rails','trim'):
            place(role,(0,0,z))
    for z in range(-24,25,8):
        place('frame',(0,0,z))
        for x,top in ((2.1,6.07),(9.8,7.36)):
            place('foot',(x,-.35,z),(1,.34,1))
            place('post',(x,-.01,z),(1,top+.01,1))
    for z in (-23.94,23.94):
        place('end',(0,0,z))
    for z in (-12,12):
        place('aisle',(0,0,z))
        socket = bpy.data.objects.new('A12_AISLE_'+str(z), None)
        assembly.objects.link(socket)
        socket.location = xyz((1.15,0,z))
        socket['clear_width'] = 1.18
    columns = math.floor(48/.65)
    for row in range(8):
        for col in range(columns):
            z = (col-(columns-1)/2)*.65
            if abs(z-12)<.7 or abs(z+12)<.7:
                continue
            place('seat',(1.55+row*.98,row*.49+.5,z))
    prototypes.hide_render = prototypes.hide_viewport = True
    scene = bpy.context.scene
    scene['asset_id'], scene['revision'] = 'A12', REVISION
    scene['scope'] = 'Six existing Aurel secondary stands; unchanged seat/aisle/site/physics geometry.'
    scene['final_art_approved'] = False


def export(root, native):
    prototypes = bpy.data.collections.get(COLLECTION)
    if not prototypes:
        raise ValueError('Missing A12 native prototypes')
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    prototypes.hide_viewport = prototypes.hide_render = False
    for name in NAMES:
        obj = bpy.data.objects.get('A12_'+name)
        if obj is None or obj.type != 'MESH' or len(obj.data.materials) != 1:
            raise ValueError('Invalid original prototype: '+name)
        if any(abs(v)>1e-8 for v in obj.location) or any(abs(v)>1e-8 for v in obj.rotation_euler) or any(abs(v-1)>1e-8 for v in obj.scale):
            raise ValueError('Unexpected native prototype transform')
        obj.select_set(True)
    output = root/'public/models/aurel-secondary-grandstands.glb'
    output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
        export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_animations=False, export_cameras=False, export_lights=False, export_extras=True)
    raw = output.read_bytes()
    size, kind = struct.unpack_from('<II',raw,12)
    if kind != 0x4e4f534a:
        raise ValueError('Invalid GLB JSON')
    doc = json.loads(raw[20:20+size])
    binary = raw[28+size:]
    def attribute(index):
        a = doc['accessors'][index]
        view = doc['bufferViews'][a['bufferView']]
        width = {5126:4,5125:4,5123:2}[a['componentType']]
        dim = {'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
        stride = view.get('byteStride',width*dim)
        start = view.get('byteOffset',0)+a.get('byteOffset',0)
        data = b''.join(binary[start+i*stride:start+i*stride+width*dim] for i in range(a['count']))
        if len(data) != width*dim*a['count']:
            raise ValueError('Truncated GLB accessor')
        return {'data':base64.b64encode(data).decode(),'count':a['count'],'itemSize':dim,'componentType':a['componentType']}
    meshes = {}
    for name in NAMES:
        node = next(n for n in doc['nodes'] if n['name']=='A12_'+name)
        primitives = doc['meshes'][node['mesh']]['primitives']
        if len(primitives)!=1 or any(key in node for key in ('matrix','translation','rotation','scale')):
            raise ValueError('Prototype transform or material split: '+name)
        p = primitives[0]
        meshes[name] = {key:attribute(p['attributes'][channel]) for key,channel in
                       (('position','POSITION'),('normal','NORMAL'),('uv','TEXCOORD_0'))}
        meshes[name]['index'] = attribute(p['indices'])
    package = {'version':1,'assetId':'A12','units':'metres-Y-up','meshes':meshes}
    text = json.dumps(package,separators=(',',':'))+'\n'
    runtime = root/'src/rendering/secondary-grandstands.geometry.json'
    runtime.parent.mkdir(parents=True,exist_ok=True)
    runtime.write_text(text)
    triangles = {k:v['index']['count']//3 for k,v in meshes.items()}
    if any(count<=0 or count>1500 for count in triangles.values()) or sum(triangles.values())>12000:
        raise ValueError('A12 prototype geometry budget exceeded')
    manifest = {'version':1,'assetId':'A12','revision':REVISION,'generator':'Blender '+bpy.app.version_string,
        'source':'scripts/author-secondary-grandstands.py','sourceSHA256':sha(Path(__file__).read_bytes()),
        'editable':'scripts/aurel-secondary-grandstands.blend','editableSHA256':sha(native.read_bytes()),
        'exchange':'public/models/aurel-secondary-grandstands.glb','exchangeSHA256':sha(raw),'exchangeBytes':len(raw),
        'runtimeSHA256':sha(text.encode()),'runtimeBytes':len(text.encode()),'triangles':triangles,
        'roles':list(ROLES),'tiers':list(TIERS),'moduleLength':8,'standLength':48,
        'sites':[450,780,1220,1670,2210,2600], 'materials':len(doc['materials']),
        'externalTextures':0,'finalArtApproved':False}
    (runtime.parent/'secondary-grandstands.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))


args = argparse.ArgumentParser()
args.add_argument('--output-root',required=True)
args.add_argument('--source')
options = args.parse_args(sys.argv[sys.argv.index('--')+1:])
out = Path(options.output_root).resolve()
if out==ROOT or ROOT in out.parents:
    raise ValueError('Author outside the application checkout')
out.mkdir(parents=True,exist_ok=True)
native = out/'scripts/aurel-secondary-grandstands.blend'
native.parent.mkdir(exist_ok=True)
if options.source:
    source = Path(options.source).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    shutil.copyfile(source,native)
else:
    author()
    bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
export(out,native)
