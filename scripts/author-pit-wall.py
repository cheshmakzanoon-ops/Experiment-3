"""A24: original four-position Aurel pit-wall station, metre-space Blender source.
Run: blender --background --factory-startup --python scripts/author-pit-wall.py
No external meshes, textures, fonts or fabricated telemetry. Runtime screen UVs
address eight tiles of one atlas; the game supplies the actual presented data.
"""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-pit-wall-r01'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
source = bpy.data.collections.new('EDITABLE_A24_COMPONENTS')
runtime = bpy.data.collections.new('A24_GAME_EXPORT')
scene.collection.children.link(source)
scene.collection.children.link(runtime)
parts = []

def xyz(p):
    """Game +X/outward, +Y/up, +Z/track tangent -> Blender Z-up."""
    return (p[0], -p[2], p[1])

def material(name, color, metal=0.0, rough=0.5, emission=0):
    m = bpy.data.materials.new('PITWALL_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

shell = material('CeramicShell', (0.66, 0.72, 0.72), 0.18, 0.38)
steel = material('GraphiteMetal', (0.036, 0.051, 0.064), 0.63, 0.37)
alloy = material('BrushedAlloy', (0.32, 0.39, 0.43), 0.82, 0.31)
teal = material('AurelEnamel', (0.016, 0.245, 0.218), 0.23, 0.33)
black = material('RubberPolymer', (0.009, 0.015, 0.019), 0, 0.64)
fabric = material('WovenUpholstery', (0.043, 0.065, 0.071), 0, 0.88)
amber = material('SafetyAmber', (0.93, 0.40, 0.037), 0.10, 0.44)
lettering = material('Lettering', (0.83, 0.90, 0.85), 0, 0.6)
light = material('LightDiffusers', (0.6, 0.85, 0.9), 0, 0.45, 0.7)
screen = material('ScreenSurface', (0.003, 0.012, 0.017), 0, 0.5, 0.2)

# One original packed tangent-space micro-normal map shared by the materials.
import numpy as np
rng = np.random.default_rng(2401)
n = 128
noise = rng.uniform(-1, 1, (n, n)).astype(np.float32)
g = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1)) / 3
normal = np.ones((n, n, 4), dtype=np.float32)
dx, dy = (np.roll(g, 1, 1) - g) * .08, (np.roll(g, 1, 0) - g) * .08
normal[:, :, 0] = dx * .5 + .5
normal[:, :, 1] = dy * .5 + .5
normal[:, :, 2] = np.sqrt(1 - dx * dx - dy * dy) * .5 + .5
img = bpy.data.images.new('A24_original_micro_normal', width=n, height=n, alpha=True)
img.colorspace_settings.name = 'Non-Color'
img.pixels.foreach_set(normal.ravel())
img.pack()
for m in [shell, steel, alloy, teal, fabric]:
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tex, norm = nodes.new('ShaderNodeTexImage'), nodes.new('ShaderNodeNormalMap')
    tex.image = img
    norm.inputs['Strength'].default_value = .35 if m == fabric else .15
    links.new(tex.outputs['Color'], norm.inputs['Color'])
    links.new(norm.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])

def own(o, name, m, tier=0):
    o.name = name
    for c in list(o.users_collection):
        c.objects.unlink(o)
    source.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(m)
    o['detail_tier'] = tier
    parts.append(o)
    return o

def bevel(o, width, segments=3):
    mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
    mod.width, mod.segments = width, segments
    o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
    return o

def box(name, p, size, m, radius=.012, tier=0, segments=3):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel(o, min(radius, min(size) * .45), segments)
    return own(o, name, m, tier)

def extrude(name, profile, lo, hi, m, radius=.01, tier=0):
    """Closed X/Y profile swept in game Z; useful for bent sheet/console shells."""
    verts = [xyz((x, y, z)) for z in [lo, hi] for x, y in profile]
    n = len(profile)
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    source.objects.link(o)
    # Normalize face orientation before export and weighted-normal evaluation.
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if radius:
        bevel(o, radius)
    return own(o, name, m, tier)

def rod(name, a, b, radius, m, tier=1, vertices=10):
    bpy.ops.object.select_all(action='DESELECT')
    av, bv = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(bv-av).length,
                                       location=(av+bv)*.5)
    o = bpy.context.object
    o.rotation_euler = (bv-av).to_track_quat('Z', 'Y').to_euler()
    return own(o, name, m, tier)

def cable(name, points, radius=.012, m=black, tier=2):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions, curve.resolution_u = '3D', 1
    curve.bevel_depth, curve.bevel_resolution = radius, 1
    sp = curve.splines.new('POLY')
    sp.points.add(len(points)-1)
    for v, p in zip(sp.points, points):
        v.co = (*xyz(p), 1)
    o = bpy.data.objects.new(name, curve)
    source.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, m, tier)

def text(name, body, p, size, m=lettering, front=True, tier=1):
    c = bpy.data.curves.new(name, 'FONT')
    c.body, c.size, c.align_x = body, size, 'CENTER'
    c.extrude, c.resolution_u = .0005, 2
    o = bpy.data.objects.new(name, c)
    source.objects.link(o)
    o.location = xyz(p)
    o.rotation_euler = (math.pi/2, 0, -math.pi/2 if front else math.pi/2)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, m, tier)

# A low platform and slim roof establish a bounded 3.0 x 7.8 m median footprint.
box('Floating-edge service plinth', (0, -.035, 0), (2.80, .19, 7.65), steel, .018)
box('Non-slip deck', (0, .068, 0), (2.73, .022, 7.58), black, .008)
for z in [-3.65, 3.65]:
    box('Amber entry edge', (0, .083, z), (2.7, .006, .055), amber, .002, 1)
    for x in [-1.18, 1.18]:
        box('Portal mounting plate', (x, .10, z), (.27, .035, .26), alloy, .01, 1)
        rod('Tapered portal upright', (x, .12, z), (x*.88, 2.65, z), .045, alloy, 0)
        for dz in [-.08,.08]:
            rod('Anchor stud', (x, .12, z+dz), (x, .14, z+dz), .018, steel, 2, 6)
        rod('Angled roof brace', (x,2.1,z), (x*.55,2.64,z), .025, steel, 1)
profile = [(-1.49,2.61),(-1.49,2.70),(-.72,2.85),(.75,2.86),(1.49,2.71),
           (1.49,2.62),(.74,2.76),(-.72,2.75)]
extrude('Formed double-skin canopy', profile, -3.91, 3.91, shell, .018)
for z in [-3.84,3.84]:
    extrude('Roof endcap enamel', profile, z-.032,z+.032, teal, .006)
for x in [-1.48,1.48]:
    box('Roof continuous fascia', (x,2.655,0), (.055,.17,7.75), teal, .014)
    box('Drip channel extrusion', (x,2.555,0), (.075,.04,7.78), alloy, .008,1)
box('Roof service spine', (0,2.665,0), (.16,.11,7.35),steel,.018,1)
for z in [-2.625,-.875,.875,2.625]:
    rod('Canopy transverse rib',(-1.32,2.60,z),(1.32,2.60,z),.025,alloy,1)
    box('Sealed task-light housing',(.25,2.62,z),(.15,.065,1.2),steel,.018,1)
    box('Frosted task-light insert',(.25,2.583,z),(.11,.015,1.1),light,.006,1)
text('Circuit-facing fascia identity','A U R E L   /   R A C E   O P S',(-1.518,2.64,0),.09)
text('Operator-facing fascia identity','A U R E L     E N G I N E E R I N G',(1.522,2.64,0),.09,front=False)
# Four consoles; individual structural bodies retain real knee and access openings.
sockets = {}
for k,z in enumerate([-2.625,-.875,.875,2.625]):
    profile=[(-1.06,.16),(-1.06,1.1),(-.87,1.18),(.02,1.18),(.06,1.09),(-.12,.97),
             (-.55,.97),(-.71,.84),(-.71,.16)]
    extrude('Position %d folded console'%k,profile,z-.77,z+.77,shell,.025)
    box('Inset front enclosure',(-1.082,.61,z),(.032,.79,1.34),teal,.035,1)
    box('Rear service enclosure',(-.678,.58,z),(.044,.63,1.23),steel,.022,1)
    box('Console wrist rest',(.052,1.174,z),(.14,.07,1.41),black,.032,1)
    box('Console work surface',(-.38,1.194,z),(.75,.022,1.49),steel,.012,1)
    box('Recessed intercom',(-.06,1.213,z+.49),(.15,.023,.24),black,.009,1)
    for j in range(4):
        box('Intercom illuminated key',(-.03,1.232,z+.415+j*.045),(.047,.009,.026),amber,.006,2)
    # Screen backs, articulation brackets and hoods; emissive tiles are independent planes.
    for side in [-1,1]:
        tile = k*2+(1 if side==1 else 0)
        sz=z+side*.352
        rod('Monitor post',(-.81,1.21,sz),(-.81,1.58,sz),.022,alloy,1)
        rod('Monitor VESA standoff',(-.81,1.53,sz),(-.69,1.53,sz),.035,steel,1)
        box('Monitor rounded enclosure',(-.665,1.605,sz),(.092,.474,.659),black,.024)
        box('Rear service cover',(-.728,1.59,sz),(.035,.27,.39),steel,.018,1)
        box('Screen recess',(-.609,1.605,sz),(.022,.425,.61),alloy,.013,1)
        # Plane winding is +X. UV 0 is left to the seated engineer looking -X.
        w,h=.59,.397
        vs=[(-.594,1.605-h/2,sz+w/2),(-.594,1.605-h/2,sz-w/2),
            (-.594,1.605+h/2,sz-w/2),(-.594,1.605+h/2,sz+w/2)]
        me=bpy.data.meshes.new('Screen atlas tile %d'%tile)
        me.from_pydata([xyz(p) for p in vs],[],[(0,1,2,3)])
        uv=me.uv_layers.new(name='UVMap')
        col,row=tile%4,tile//4
        coords=[(col/4,(1-row)/2),((col+1)/4,(1-row)/2),((col+1)/4,(2-row)/2),(col/4,(2-row)/2)]
        for i,co in enumerate(coords): uv.data[i].uv=co
        o=bpy.data.objects.new('Screen tile %d'%tile,me)
        source.objects.link(o)
        own(o,o.name,screen)
        o['screen_tile']=tile
        box('Monitor upper sunshade',(-.56,1.85,sz),(.27,.024,.685),steel,.008,1)
        for dz in [-.338,.338]:
            box('Monitor side hood',(-.58,1.64,sz+dz),(.22,.42,.019),steel,.006,1)
        for v in range(5):
            box('Rear cooling fin',(-.75,1.63+(v-2)*.025,sz),(.016,.008,.28),alloy,.003,2)
        cable('Monitor power/data',[(-.73,1.46,sz),(-.82,1.40,sz),(-.86,1.26,sz),(-.90,.96,sz)],.009)
    # Ergonomic seat: shaped side profile + padded, radiused seat/back shell.
    rod('Seat pedestal',(.72,.09,z),(.72,.51,z),.074,alloy,0,12)
    box('Seat anchor base',(.72,.12,z),(.50,.06,.53),steel,.06)
    box('Formed seat pan',(.67,.57,z),(.57,.085,.54),steel,.038,0)
    box('Contoured seat cushion',(.66,.64,z),(.54,.13,.50),fabric,.055,0,4)
    back=box('Reclined ergonomic back shell',(.978,.965,z),(.11,.65,.50),steel,.044,0)
    back.rotation_euler.y=-.12
    pad=box('Shaped back upholstery',(.902,.965,z),(.115,.56,.446),fabric,.05,0,4)
    pad.rotation_euler.y=-.12
    box('Lumbar cushion',(.805,.81,z),(.12,.18,.41),fabric,.04,1)
    for side in [-1,1]:
        rod('Armrest support',(.76,.49,z+side*.29),(.70,.82,z+side*.29),.018,alloy,1)
        box('Padded armrest',(.62,.84,z+side*.29),(.36,.065,.073),black,.022,1)
    rod('Foot rest',(.20,.24,z-.3),(.20,.24,z+.3),.025,alloy,1)
    # Stored headset, continuous headband and paired ear cups.
    rod('Headset hook',(-.62,1.27,z+.765),(-.48,1.27,z+.765),.012,alloy,1)
    points=[(-.44+.10*math.sin(t*math.pi),1.18+.12*math.cos(t*math.pi),z+.77) for t in np.linspace(0,1,13)]
    cable('Headset padded band',points,.017,black,1)
    for y in [1.06,1.30]:
        box('Headset ear cup',(-.44,y,z+.775),(.08,.09,.055),black,.024,1)
    cable('Headset mic boom',[(-.45,1.06,z+.8),(-.36,1.04,z+.80),(-.31,1.03,z+.85)],.006,alloy,2)
    text('Position number',str(k+1).zfill(2),(-1.106,.77,z),.20,lettering,tier=1)
    # Game-space sockets are not populated by static human stand-ins.
    sockets['SOCKET_ENGINEER_%02d'%(k+1)]=[.70,.71,z]
    sockets['SOCKET_HAND_L_%02d'%(k+1)]=[.02,1.225,z+.23]
    sockets['SOCKET_HAND_R_%02d'%(k+1)]=[.02,1.225,z-.23]
    sockets['SOCKET_HEADSET_%02d'%(k+1)]=[-.48,1.27,z+.77]
# Continuous protected trunk on race-facing side, closed at both ends.
box('Protected power/data trunk',(-1.19,.25,0),(.19,.21,7.18),steel,.027,1)
for z in [-3.4,3.4]:
    box('Sealed junction box',(-1.18,.51,z),(.23,.33,.30),black,.026,1)
    cable('Junction riser',[(-1.18,.25,z),(-1.18,.47,z),(-1.06,.54,z)],.025,black,1)
for z in [-2.625,-.875,.875,2.625]:
    for i in range(3):
        cable('Bundled data loom',[(-1.18,.36,z),(-1.13,.59,z+i*.03),(-1.12,1.07,z+i*.03),(-.86,1.17,z+i*.03)],.009,black,2)
    for dz in [-.65,.65]:
        rod('Captive panel fastener',(-1.108,.97,z+dz),(-1.125,.97,z+dz),.014,alloy,2,6)
sockets['SOCKET_SUPERVISOR']=[1.16,.09,0]
# Smooth runoff to plinth at both entry ends; no geometry spans the pit driving lane.
for sign in [-1,1]:
    box('End access step',(.40,.027,sign*3.91),(1.35,.09,.22),alloy,.012,1)

root=bpy.data.objects.new('AUREL_PIT_WALL',None)
runtime.objects.link(root)
root['assetId'],root['revision'],root['finalArtApproved']='A24',REVISION,False
root['units']='metres'
root['operator_faces']='-X'
for level,maxtier in [(0,2),(1,1),(2,0)]:
    lod=bpy.data.objects.new('PIT_WALL_LOD%d'%level,None)
    runtime.objects.link(lod)
    lod.parent=root
    bins={}
    for original in parts:
        if original['detail_tier']>maxtier: continue
        o=original.copy(); o.data=original.data.copy()
        runtime.objects.link(o)
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True); bpy.context.view_layer.objects.active=o
        for mod in list(o.modifiers):
            if mod.type=='BEVEL':
                if level==2: mod.segments=1
                elif level==1: mod.segments=2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if 'screen_tile' not in original:
            uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
            for face in o.data.polygons:
                axis=max(range(3),key=lambda i:abs(face.normal[i]))
                axes=[i for i in range(3) if i!=axis]
                for loop in face.loop_indices:
                    co=o.matrix_world@o.data.vertices[o.data.loops[loop].vertex_index].co
                    uv.data[loop].uv=(co[axes[0]]/.25,co[axes[1]]/.25)
        bins.setdefault(o.data.materials[0].name,[]).append(o)
    for name,objects in bins.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        batch=bpy.context.object
        batch.name='LOD%d_%s'%(level,name)
        batch.parent=lod
        mod=batch.modifiers.new('Export triangles','TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
for name,position in sockets.items():
    o=bpy.data.objects.new(name,None)
    runtime.objects.link(o);o.parent=root;o.location=xyz(position)
    o.empty_display_type='ARROWS';o.empty_display_size=.13
source.hide_render=True;source.hide_viewport=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
out=ROOT/'public/models/aurel-pit-wall-command-station.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
 export_yup=True,export_extras=True,export_cameras=False,export_lights=False,
 export_animations=False,export_materials='EXPORT')
for o in runtime.objects:
    if o.name.startswith(('LOD1_','LOD2_')):o.hide_set(True);o.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-pit-wall-command-station.blend'),compress=True)
raw=out.read_bytes();size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size])
counts={str(level):sum(doc['accessors'][p['indices']]['count']//3 for node in doc['nodes']
 if node.get('name','').startswith('LOD%d_'%level) for p in doc['meshes'][node['mesh']]['primitives']) for level in range(3)}
receipt={'assetId':'A24','revision':REVISION,'author':'scripts/author-pit-wall.py',
 'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'editable':'scripts/aurel-pit-wall-command-station.blend','url':'models/aurel-pit-wall-command-station.glb',
 'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,
 'materials':len(doc.get('materials',[])),'images':len(doc.get('images',[])),
 'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),'trackS':106,'lateral':15.8,
 'sockets':sockets,'screenTiles':8,'atlasSize':[2048,1024],
 'maxBounds':{'min':[-1.55,-.14,-4.05],'max':[1.55,2.91,4.05]},'finalArtApproved':False}
assert counts['2']<counts['1']<counts['0']<60000,counts
assert len(raw)<10*1024*1024
(ROOT/'src/rendering/pit-wall-station.manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('A24_RECEIPT '+json.dumps(receipt))
