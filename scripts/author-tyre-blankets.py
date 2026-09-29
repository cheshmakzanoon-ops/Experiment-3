"""A34 original thermal blankets, controllers and cable kit. Blender 5.2.2 LTS.
Metre-space game coordinates: +Y up, wheel axle +X. No imported art or wheels.
Run: blender -b --factory-startup --python-exit-code 1 --python scripts/author-tyre-blankets.py
Optional -- --render writes an authoring contact sheet, not gameplay evidence.
"""
import bpy
import bmesh
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-a34-r01'
SEED = 3401
if bpy.app.version[:3] != (5, 2, 2):
    raise RuntimeError('A34 authoring requires Blender 5.2.2')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
source = bpy.data.collections.new('A34_EDITABLE_COMPONENTS')
export = bpy.data.collections.new('A34_RUNTIME_EXPORT')
scene.collection.children.link(source)
scene.collection.children.link(export)
parts = []
variants = {}
current = None
level = 0

def xyz(p):
    return (p[0], -p[2], p[1])

def mat(name, color, rough=.6, metal=0, emit=0):
    m = bpy.data.materials.new('A34_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emit
    return m

fabric = mat('ThermalFabric', (.031, .060, .064), .89)
teal = mat('ReinforcedPanels', (.019, .205, .182), .8)
webbing = mat('WebbingAndSeams', (.012, .020, .022), .95)
lining = mat('InsulatedLining', (.30, .36, .37), .58, .32)
shell = mat('ControllerShell', (.18, .23, .25), .43, .42)
metal = mat('Hardware', (.40, .46, .47), .32, .78)
rubber = mat('CableRubber', (.011, .018, .020), .74)
letters = mat('OriginalMarkings', (.76, .84, .78), .69)
amber = mat('SafetyTabs', (.94, .32, .035), .65)
status = mat('StandbyIndicators', (.14, .37, .31), .45, 0, .5)
# Original periodic weave. Texture pixels, not a procedural Blender-only shader.
import numpy as np
n = 128
x, y = np.meshgrid(np.arange(n), np.arange(n))
h = .42 * np.sin(x * pi / 2) * (.7 + .3 * np.cos(y * pi / 2))
h += .32 * np.sin(y * pi / 2) * (.7 - .3 * np.cos(x * pi / 2))
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .13
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .13
pixels = np.ones((n, n, 4), dtype=np.float32)
pixels[:, :, 0] = .5 - dx
pixels[:, :, 1] = .5 - dy
pixels[:, :, 2] = np.sqrt(np.maximum(0, 1 - (2*dx)**2 - (2*dy)**2)) * .5 + .5
image = bpy.data.images.new('A34_original_128_weave', width=n, height=n, alpha=True)
image.colorspace_settings.name = 'Non-Color'
image.pixels.foreach_set(pixels.ravel())
image.pack()
for m in [fabric, teal, webbing, lining]:
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .26 if m != lining else .11
    links.new(tex.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])

def own(o, name, material):
    o.name = f'{current}_L{level}_{name}'
    for c in list(o.users_collection):
        c.objects.unlink(o)
    source.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(material)
    o['a34_variant'] = current
    o['a34_lod'] = level
    parts.append(o)
    return o

def mesh(name, vertices, faces, material, uv=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([xyz(v) for v in vertices], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    source.objects.link(o)
    for p in me.polygons:
        p.use_smooth = smooth
    layer = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            v = vertices[vi]
            layer.data[li].uv = uv[vi] if uv else (v[2]*4, v[1]*4)
    return own(o, name, material)

def box(name, p, size, material, bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width = min(bevel, min(size)*.42)
        mod.segments = 1 if min(size) < .02 else [3, 2, 1][level]
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    layer = o.data.uv_layers.active
    if layer:
        for v in layer.data:
            v.uv *= 3
    return own(o, name, material)

def tube(name, points, radius, material, segments=None):
    seg = segments or [8, 6, 4][level]
    verts, uv, faces = [], [], []
    for i, point in enumerate(points):
        p = Vector(point)
        direction = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])
        direction.normalize()
        up = Vector((0, 1, 0)) if abs(direction.y) < .95 else Vector((1, 0, 0))
        u = direction.cross(up).normalized()
        v = direction.cross(u)
        r = radius[i] if isinstance(radius, list) else radius
        for j in range(seg):
            a = 2*pi*j/seg
            verts.append(tuple(p + r*(u*cos(a)+v*sin(a))))
            uv.append((j/seg, i/max(1, len(points)-1)))
    for i in range(len(points)-1):
        for j in range(seg):
            a, b = i*seg+j, i*seg+(j+1)%seg
            faces.append((a, b, b+seg, a+seg))
    faces.extend([tuple(reversed(range(seg))), tuple((len(points)-1)*seg+j for j in range(seg))])
    return mesh(name, verts, faces, material, uv)

def ribbon(name, points, width=.025, thickness=.004, material=webbing):
    verts, faces = [], []
    for i, p in enumerate(points):
        tangent = (Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])).normalized()
        u = tangent.cross(Vector((0, 1, 0))).normalized()
        v = tangent.cross(u).normalized()
        for a, b in [(-1,-1), (1,-1), (1,1), (-1,1)]:
            verts.append(tuple(Vector(p) + u*a*thickness/2 + v*b*width/2))
        if i:
            for j in range(4):
                a = (i-1)*4+j
                b = (i-1)*4+(j+1)%4
                faces.append((a,b,b+4,a+4))
    faces.extend([(3,2,1,0), tuple((len(points)-1)*4+j for j in range(4))])
    return mesh(name, verts, faces, material)

def text(name, body, p, size, material=letters, normal=(1,0,0)):
    c = bpy.data.curves.new(name, 'FONT')
    c.body, c.size, c.align_x = body, size, 'CENTER'
    c.extrude, c.resolution_u = .00015, 1
    o = bpy.data.objects.new(name, c)
    source.objects.link(o)
    o.location = xyz(p)
    nn = Vector(xyz(normal))
    yy = Vector((0, 0, 1))
    xx = yy.cross(nn).normalized()
    o.rotation_euler = Matrix((xx, yy, nn)).transposed().to_euler()
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, material)

def socket(name, p):
    variants[current]['sockets'][name] = list(p)

def fitted(half, opened=False):
    seg = [40, 20, 12][level]
    # Padded closed wrap follows the APX spare-tyre envelope, not the supplied RB19.
    outer = [(-half-.018,.231),(-half-.02,.273),(-half-.017,.309),(-half-.007,.333),
             (-half+.012,.349),(-half+.042,.355),(0,.357),
             (half-.042,.355),(half-.012,.349),(half+.007,.333),(half+.017,.309),(half+.02,.273),(half+.018,.231)]
    if level > 0: outer = outer[::2]
    inner = [(x-(.007 if x>0 else -.007), r-.006 if r>.32 else r) for x,r in outer]
    profile = outer + list(reversed(inner))
    verts, uv, faces = [], [], []
    stride = len(profile)
    for j in range(seg):
        a = 2*pi*j/seg
        for i, (x, r) in enumerate(profile):
            wrinkle = (.0013*sin(11*a+x*29) + .0009*sin(19*a-x*13)) * (1 if r>.32 else .35)
            rr = r + wrinkle
            verts.append((x, rr*cos(a), rr*sin(a)))
            uv.append((j/seg*6, i/stride*3))
    for j in range(seg):
        for i in range(stride):
            a, b = j*stride+i, j*stride+(i+1)%stride
            faces.append((a,b,((j+1)%seg)*stride+(i+1)%stride,((j+1)%seg)*stride+i))
    mesh('Padded_tread_wrap', verts, faces, fabric, uv)
    # Removable insulated side panels cover the wheel, no replacement wheel mesh.
    for side in [-1,1]:
        rings = [0.0,.055,.13,.215,.29,.333] if level<2 else [0,.17,.33]
        verts, uv, faces = [], [], []
        # Thin closed discs. A single centre vertex avoids zero-area ring triangles.
        for back in [False, True]:
            offset = len(verts)
            # Central allowance clears the APX locking hub, not only the tyre sidewall.
            verts.append((side*(half+.084)-side*(.006 if back else 0),0,0))
            uv.append((.5,.5))
            for r in rings[1:]:
                for j in range(seg):
                    a=2*pi*j/seg
                    x=side*(half+.028+.008*(1-r/.333)+.048*max(0,1-(r/.08)**2)+.0017*sin(9*a+r*21))
                    if back: x-=side*.006
                    if opened and side==1:
                        x += .12*max(0,sin(a))**2*(r/.333)**2
                    verts.append((x,r*cos(a),r*sin(a)))
                    uv.append((.5+r*cos(a)*5,.5+r*sin(a)*5))
            for j in range(seg):
                faces.append((offset,offset+1+j,offset+1+(j+1)%seg))
            for k in range(len(rings)-2):
                for j in range(seg):
                    a=offset+1+k*seg+j;b=offset+1+k*seg+(j+1)%seg
                    faces.append((a,b,b+seg,a+seg))
        skin=1+(len(rings)-1)*seg
        edge=1+(len(rings)-2)*seg
        for j in range(seg):
            a=edge+j;b=edge+(j+1)%seg
            faces.append((a,a+skin,b+skin,b))
        panel=mesh('Insulated_side_panel_'+str(side),verts,faces,teal if side==1 else fabric,uv)
        if opened and side==1:
            panel.data.materials.append(lining)
            for p in panel.data.polygons:
                if p.center.x < half+.031: p.material_index=1
        if level<2:
            for r in [.22,.321]:
                pts=[(side*(half+.034),r*cos(2*pi*j/seg),r*sin(2*pi*j/seg)) for j in range(seg+1)]
                tube('Bound_panel_seam',pts,.0018,webbing,4)
            for z in [-.092,.092]:
                box('Reinforced_handle_patch',(side*(half+.039),.257,z),(.008,.047,.041),webbing,.003)
            pts=[(side*(half+.042+.054*sin(pi*j/12)),.257+.025*sin(pi*j/12),-.092+.184*j/12) for j in range(13)]
            ribbon('Woven_lift_handle',pts)
            if side==1:
                box('Original_ID_patch',(half+.045,.148,0),(.003,.06,.205),webbing,.002)
                text('Identity','AUREL',(half+.048,.146,0),.029)
                if level==0:
                    text('Sizing','REAR / 380' if half>.17 else 'FRONT / 310',(half+.048,.124,0),.010)
                    text('Thermal_panel','THERMAL  /  A34',(half+.041,-.14,0),.017)
    # Long overlapping closure across tread, sewn down, with a pull tab.
    pts=[(-half+.04+2*(half-.04)*j/12,.36+.003*sin(pi*j/12),.015) for j in range(13)]
    ribbon('Overlapping_closure_flap',pts,.058,.006,webbing)
    if level<2:
        box('Closure_release_tab',(half-.025,.37,.023),(.067,.007,.025),amber,.002)
        lead=[(half+.025,-.07,.267),(half+.082,-.13,.287),(half+.105,-.23,.30),(half+.135,-.30,.28)]
        tube('Blanket_power_tail',lead,.006,rubber)
        tube('Moulded_strain_relief',lead[:2],.010,rubber)
        tube('Power_connector',[(half+.135,-.30,.28),(half+.166,-.30,.28)],.014,metal)
    if level==0:
        # Visible short stitches, only on the near closure; rest lives in weave map.
        for j in range(18):
            xx=-half+.042+2*(half-.042)*j/17
            box('Closure_stitch',(xx,.366,-.009),(.004,.001,.0015),letters,0)
    socket('WHEEL_CENTER',(0,0,0))
    socket('BLANKET_POWER',(half+.166,-.30,.28))
    socket('HANDLE_OUTBOARD',(half+.096,.282,0))
    socket('HANDLE_INBOARD',(-half-.096,.282,0))
    variants[current]['fit']={'radius':.335,'width':half*2,'axle':'+X','floorLift':.36}

def folded(loose=False):
    # Each layer is a closed cushioned sheet with a different crease field.
    nx,nz=[(9,11),(5,7),(3,4)][level]
    for layer in range(3):
        verts,uv,faces=[],[],[]
        for bottom in [False,True]:
            for i in range(nx+1):
                u=i/nx
                for j in range(nz+1):
                    v=j/nz
                    xx=(u-.5)*.47 + layer*.009
                    zz=(v-.5)*.64 + layer*.014
                    edge=sin(pi*u)**.5*sin(pi*v)**.5
                    yy=.012+layer*.034+edge*(.013+.007*sin(3*pi*v+layer))
                    if loose: yy+=.025*sin(pi*u)*sin(2*pi*v+.4*layer)**2
                    yy+=.017 if not bottom else 0
                    verts.append((xx,yy,zz));uv.append((u*3,v*4))
        skin=(nx+1)*(nz+1)
        for i in range(nx):
            for j in range(nz):
                a=i*(nz+1)+j;b=a+nz+1
                faces.extend([(a,a+1,b+1,b),(a+skin,b+skin,b+1+skin,a+1+skin)])
        rim=list(range(nz+1))+[i*(nz+1)+nz for i in range(1,nx+1)]+[nx*(nz+1)+j for j in range(nz-1,-1,-1)]+[i*(nz+1) for i in range(nx-1,0,-1)]
        for a,b in zip(rim,rim[1:]+rim[:1]):faces.append((a,b,b+skin,a+skin))
        mesh('Layered_fold_'+str(layer),verts,faces,fabric if layer!=1 else lining,uv)
    if level<2:
        for zz in [-.20,.20]:
            pts=[(-.225+.49*j/16,.135+.012*sin(pi*j/16),zz) for j in range(17)]
            ribbon('Folded_retaining_webbing',pts,.03)
        ribbon('Loose_carry_handle',[(.13+.07*sin(pi*j/12),.14+.04*sin(pi*j/12),-.08+.16*j/12) for j in range(13)])
        tube('Stored_power_tail',[(.2,.07,.25),(.27,.028,.35),(.31,.017,.26),(.24,.017,.18)],.006,rubber)
    socket('FLOOR',(0,0,0));socket('CARRY',(.17,.17,0))

def controller(portable=False):
    w=.22 if portable else .45
    h=.22 if portable else .32
    d=.18 if portable else .265
    box('Sealed_controller_enclosure',(0,h/2+.018,0),(w,h,d),shell,.018)
    box('Recessed_control_face',(w/2+.005,h/2+.018,0),(.015,h-.044,d-.031),rubber,.007)
    channels=2 if portable else 4
    for k in range(channels):
        zz=(k-(channels-1)/2)*(d-.05)/channels
        box('Channel_display',(w/2+.015,h*.68,zz),(.008,.033,(d-.059)/channels),status,.003)
        if level<2:
            tube('Panel_output_socket',[(w/2+.014,.072,zz),(w/2+.038,.072,zz)],.012,metal)
            tube('Connector_recess',[(w/2+.039,.072,zz),(w/2+.04,.072,zz)],.007,rubber)
            box('Channel_key',(w/2+.022,h*.46,zz),(.011,.016,.02),teal,.003)
        if level==0:
            text('Channel_number',str(k+1),(w/2+.027,h*.83,zz),.014)
            text('Standby_dashes','--',(w/2+.022,h*.655,zz),.012)
        socket('CHANNEL_'+str(k+1),(w/2+.041,.072,zz))
    for x in [-w*.36,w*.36]:
        for z in [-d*.34,d*.34]:
            box('Rubber_foot',(x,.011,z),(.037,.022,.037),rubber,.006)
    if level<2:
        for x in [-w*.48,w*.48]:
            for z in [-d*.44,d*.44]:
                box('Corner_protector',(x,h/2+.018,z),(.032,h+.006,.034),rubber,.009)
        tube('Rigid_carry_handle',[(-w*.24,h+.02,0),(-w*.24,h+.077,0),(w*.24,h+.077,0),(w*.24,h+.02,0)],.012,rubber)
        for j in range(5):
            box('Recessed_back_vent',(-w/2-.001,h*.30+j*.023,0),(.003,.006,d*.55),rubber,.002)
        tube('Master_power_port',[(-w/2-.006,.055,.05),(-w/2-.024,.055,.05)],.016,rubber)
    if level==0:
        text('Controller_identity','AUREL',(w/2+.017,h*.93,0),.021)
        text('Controller_status','STANDBY',(w/2+.02,.025,0),.014)
        for z in [-d*.37,d*.37]:
            for yy in [.041,h-.004]:tube('Captive_face_screw',[(w/2+.014,yy,z),(w/2+.016,yy,z)],.0035,metal,6)
    socket('MASTER_POWER',(-w/2-.024,.055,.05));socket('CARRY',(0,h+.077,0));socket('FLOOR',(0,0,0))

def cable_kit():
    seg=[64,32,16][level]
    pts=[]
    for j in range(seg+1):
        t=j/seg;a=2*pi*2.7*t
        pts.append((.125*cos(a),.008+.018*t,.125*sin(a)))
    tube('Coiled_three_turn_lead',pts,.0055,rubber)
    if level<2:
        p=pts[-1];q=(p[0]+.055,p[1],p[2])
        tube('Coiled_lead_connector',[p,q],.012,metal)
    socket('LEAD_START',pts[0]);socket('LEAD_END',pts[-1])

library=bpy.data.objects.new('A34_LIBRARY',None)
export.objects.link(library)
library['assetId']='A34';library['revision']=REVISION;library['seed']=SEED
specs=[('FRONT_FITTED',lambda:fitted(.155)),('REAR_FITTED',lambda:fitted(.19)),
       ('FRONT_OPEN',lambda:fitted(.155,True)),('REAR_OPEN',lambda:fitted(.19,True)),
       ('FOLDED_NEAT',lambda:folded()),('FOLDED_LOOSE',lambda:folded(True)),
       ('CONTROLLER_MAIN',lambda:controller()),('CONTROLLER_PORTABLE',lambda:controller(True)),
       ('CABLE_COIL',cable_kit)]
for current,builder in specs:
    variants[current]={'sockets':{},'triangles':{},'bounds':{},'draws':{}}
    root=bpy.data.objects.new('A34_'+current,None)
    root.parent=library;export.objects.link(root)
    root['variant']=current
    for level in range(3):
        begin=len(parts)
        builder()
        lod=bpy.data.objects.new('A34_'+current+'_LOD'+str(level),None)
        lod.parent=root;export.objects.link(lod)
        # Evaluate, triangulate and batch by material. Editable components stay intact.
        deps=bpy.context.evaluated_depsgraph_get()
        buckets={}
        bounds=[]
        for original in parts[begin:]:
            evaluated=original.evaluated_get(deps)
            me=bpy.data.meshes.new_from_object(evaluated,depsgraph=deps)
            me.transform(original.matrix_world)
            bm=bmesh.new();bm.from_mesh(me)
            bmesh.ops.triangulate(bm,faces=list(bm.faces))
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
            bm.to_mesh(me);bm.free()
            copy=bpy.data.objects.new(original.name+'_export',me)
            export.objects.link(copy)
            buckets.setdefault(original.data.materials[0].name,[]).append(copy)
        triangles=0
        for material_name,objects in sorted(buckets.items()):
            bpy.ops.object.select_all(action='DESELECT')
            for o in objects:o.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            if len(objects)>1:bpy.ops.object.join()
            o=bpy.context.object
            o.name='A34_'+current+'_L'+str(level)+'_'+material_name
            o.parent=lod
            for v in o.data.vertices:bounds.append((v.co.x,v.co.z,-v.co.y))
            triangles+=sum(len(p.vertices)-2 for p in o.data.polygons)
        variants[current]['triangles'][str(level)]=triangles
        variants[current]['draws'][str(level)]=len(buckets)
        variants[current]['bounds'][str(level)]={
            'min':[round(min(v[a] for v in bounds),6) for a in range(3)],
            'max':[round(max(v[a] for v in bounds),6) for a in range(3)]}
    for name,p in variants[current]['sockets'].items():
        o=bpy.data.objects.new('A34_'+current+'_SOCKET_'+name,None)
        o.parent=root;o.location=xyz(p);o.empty_display_size=.025
        export.objects.link(o)

# A separate editable inspection gallery; never included in the GLB.
source.hide_render=True
source.hide_viewport=True
bpy.ops.object.select_all(action='DESELECT')
for o in export.objects:o.select_set(True)
path=ROOT/'public/models/aurel-tyre-blankets-and-controllers.glb'
path.parent.mkdir(parents=True,exist_ok=True)
# Stable writer: evaluated Blender triangles are canonically ordered and rounded
# to micrometre / 1e-6-normal / 1e-4-UV precision before glTF packing. The stock exporter
# can permute its vertex packing across identical processes; integrity is exact.
def write_glb(path):
    blob=bytearray()
    document={'asset':{'version':'2.0','generator':'A34 Blender evaluated-mesh deterministic exporter v1'},
              'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],
              'accessors':[],'bufferViews':[], 'buffers':[{}]}
    def view(data,target=None):
        while len(blob)%4:blob.append(0)
        start=len(blob);blob.extend(data)
        d={'buffer':0,'byteOffset':start,'byteLength':len(data)}
        if target:d['target']=target
        document['bufferViews'].append(d)
        return len(document['bufferViews'])-1
    png=bytes(image.packed_file.data)
    if png[:8] != b'\x89PNG\r\n\x1a\n':raise ValueError('Expected packed PNG')
    document['images']=[{'bufferView':view(png),'mimeType':'image/png','name':image.name}]
    document['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]
    document['textures']=[{'source':0,'sampler':0}]
    mats=sorted([fabric,teal,webbing,lining,shell,metal,rubber,letters,amber,status],key=lambda m:m.name)
    mat_ids={m.name:i for i,m in enumerate(mats)}
    for m in mats:
        p=m.node_tree.nodes.get('Principled BSDF')
        material={'name':m.name,'pbrMetallicRoughness':{
          'baseColorFactor':[round(v,6) for v in p.inputs['Base Color'].default_value],
          'roughnessFactor':round(p.inputs['Roughness'].default_value,6),
          'metallicFactor':round(p.inputs['Metallic'].default_value,6)}}
        if m in [fabric,teal,webbing,lining]:material['normalTexture']={'index':0,'scale':.11 if m==lining else .26}
        if m==status:material['emissiveFactor']=[round(v*.5,6) for v in m.diffuse_color[:3]]
        document['materials'].append(material)
    def accessor(values,kind,size,component=5126,minimum=False):
        flat=[x for v in values for x in (v if isinstance(v,tuple) else (v,))]
        packed=struct.pack('<'+('f' if component==5126 else 'I')*len(flat),*flat)
        d={'bufferView':view(packed,34963 if component!=5126 else 34962),
           'componentType':component,'count':len(values),'type':kind}
        if minimum:
            d['min']=[min(v[i] for v in values) for i in range(size)]
            d['max']=[max(v[i] for v in values) for i in range(size)]
        document['accessors'].append(d)
        return len(document['accessors'])-1
    objects=sorted(export.objects,key=lambda o:o.name)
    ids={o.name:i for i,o in enumerate(objects)}
    for o in objects:
        node={'name':o.name}
        if o.children:node['children']=sorted(ids[c.name] for c in o.children)
        if o==library:document['scenes'][0]['nodes']=[ids[o.name]]
        if o.location.length:node['translation']=[round(o.location.x,6),round(o.location.z,6),round(-o.location.y,6)]
        extras={k:o[k] for k in o.keys() if k!='_RNA_UI'}
        if extras:node['extras']=extras
        if o.type=='MESH':
            me=o.data
            me.calc_loop_triangles()
            uv=me.uv_layers.active
            groups={}
            for tri in me.loop_triangles:
                vertices=[]
                for li in tri.loops:
                    pos=me.vertices[me.loops[li].vertex_index].co
                    no=me.corner_normals[li].vector
                    tex=uv.data[li].uv if uv else (0,0)
                    value=tuple(round(float(v),6) or 0.0 for v in (pos.x,pos.z,-pos.y,no.x,no.z,-no.y))
                    value+=tuple(round(float(v)+1e-7,4) or 0.0 for v in (tex[0],1-tex[1]))
                    vertices.append(value)
                # Cyclic rotation preserves winding while producing canonical order.
                t=tuple(vertices)
                t=min(t,t[1:]+t[:1],t[2:]+t[:2])
                name=me.materials[tri.material_index].name
                groups.setdefault(name,[]).append(t)
            primitives=[]
            for material_name,triangles in sorted(groups.items()):
                triangles=sorted(triangles)
                vertices=sorted({v for t in triangles for v in t})
                lookup={v:i for i,v in enumerate(vertices)}
                positions=[v[:3] for v in vertices];normals=[v[3:6] for v in vertices];uvs=[v[6:] for v in vertices]
                attributes={'POSITION':accessor(positions,'VEC3',3,minimum=True),
                            'NORMAL':accessor(normals,'VEC3',3),
                            'TEXCOORD_0':accessor(uvs,'VEC2',2)}
                indices=[lookup[v] for t in triangles for v in t]
                primitives.append({'attributes':attributes,'indices':accessor(indices,'SCALAR',1,5125),
                                   'material':mat_ids[material_name],'mode':4})
            node['mesh']=len(document['meshes'])
            document['meshes'].append({'name':o.name,'primitives':primitives})
        document['nodes'].append(node)
    while len(blob)%4:blob.append(0)
    document['buffers'][0]['byteLength']=len(blob)
    text=json.dumps(document,sort_keys=True,separators=(',',':')).encode()
    text+=b' '*((-len(text))%4)
    out=struct.pack('<III',0x46546c67,2,28+len(text)+len(blob))
    out+=struct.pack('<II',len(text),0x4e4f534a)+text
    out+=struct.pack('<II',len(blob),0x004e4942)+blob
    path.write_bytes(out)
write_glb(path)
data=path.read_bytes()
length=struct.unpack_from('<I',data,12)[0]
j=json.loads(data[20:20+length])
if len(data)>6_000_000:raise ValueError('A34 GLB exceeds 6 MB')
if any('uri' in b for b in j.get('buffers',[])+j.get('images',[])):
    raise ValueError('A34 must be self-contained')
for name,v in variants.items():
    counts=list(v['triangles'].values())
    if not counts[0]>counts[1]>counts[2]>0:raise ValueError(('Distinct descending LODs required',name,counts))
manifest={'schema':1,'assetId':'A34','revision':REVISION,'blender':bpy.app.version_string,
          'seed':SEED,'author':'scripts/author-tyre-blankets.py',
          'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'editable':'scripts/aurel-tyre-blankets-and-controllers.blend',
          'url':'models/aurel-tyre-blankets-and-controllers.glb','bytes':len(data),
          'sha256':hashlib.sha256(data).hexdigest(),
          'nodes':len(j['nodes']),'meshes':len(j['meshes']),'materials':len(j['materials']),
          'images':len(j.get('images',[])),'variants':variants,
          'fitTarget':'Existing APX spare-wheel envelope; not a supplied-RB19 dimension claim',
          'finalArtApproved':False}
p=ROOT/'src/rendering/tyre-blankets.manifest.json'
p.parent.mkdir(parents=True,exist_ok=True)
p.write_text(json.dumps(manifest,indent=2)+'\n')
# Studio is retained as a useful editable viewport, but is never gameplay evidence.
gallery=bpy.data.collections.new('A34_INSPECTION_GALLERY_NOT_EXPORTED')
scene.collection.children.link(gallery)
for k,(name,_) in enumerate(specs):
    root=bpy.data.objects.new('Inspect_'+name,None);gallery.objects.link(root)
    root.location=xyz(((k%3-1)*1.10,.36 if 'FITTED' in name or 'OPEN' in name else 0,(k//3-1)*1.02))
    lod=bpy.data.objects.get('A34_'+name+'_LOD0')
    for orig in lod.children:
        o=orig.copy();o.data=orig.data;o.parent=root;gallery.objects.link(o)
export.hide_render=True;export.hide_viewport=True
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            v=area.spaces.active
            v.region_3d.view_distance=5
            v.region_3d.view_location=(0,0,.2)
            v.region_3d.view_rotation=Vector((4,-6,4)).to_track_quat('Z','Y')
            v.shading.type='MATERIAL'
scene['A34_approval']='First authored revision; gameplay and hardware review required'
scene['A34_proxy_dimensions']='APX front 0.310 m, rear 0.380 m; radius 0.335 m'
scene['A34_provenance']='Original script, geometry, built-in converted text and periodic weave pixels'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/manifest['editable']),compress=True)
print('A34_EXPORT_RECEIPT',json.dumps({k:manifest[k] for k in ['bytes','sha256','nodes','meshes','materials','images']}))
print('A34_TRIANGLES',json.dumps({k:v['triangles'] for k,v in variants.items()}))
if '--render' in sys.argv:
    # Deliberately separate proof of Blender geometry from actual game captures.
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor=bpy.context.object;floor.data.materials.append(mat('StudioFloor',(.085,.10,.12),.9))
    bpy.ops.object.camera_add(location=xyz((4,3.8,5)))
    camera=bpy.context.object
    camera.rotation_euler=(Vector(xyz((0,.22,0)))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=4.8
    scene.camera=camera
    for pos,power,size in [((1,5,2),1300,5),((-3,3,0),1000,4),((1,3,-4),1400,3)]:
        bpy.ops.object.light_add(type='AREA',location=xyz(pos))
        lamp=bpy.context.object;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size
        lamp.rotation_euler=(-lamp.location).to_track_quat('-Z','Y').to_euler()
    scene.world=bpy.data.worlds.new('A34 Studio World')
    scene.world.color=(.23,.23,.23)
    scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
    scene.render.resolution_x=1000;scene.render.resolution_y=800;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    out=ROOT/'test-results/a34-authoring';out.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(out/'a34-blender-contact-sheet.png')
    bpy.ops.render.render(write_still=True)
