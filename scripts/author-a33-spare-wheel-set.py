"""A33 original spare-wheel handling library. Blender 5.2.2, metres.

blender -b --factory-startup --python-exit-code 1 --python scripts/author-a33-spare-wheel-set.py

Only A33 outputs are written. Neither supplied-player nor APX/people sources are
modified. Front/rear topology corresponds, allowing instanced shape selection
without a draw call per wheel. Runtime buffers are sampled from Blender meshes,
not a second runtime modeller. All graphics and micro-surface pixels are original.
"""
from pathlib import Path
import base64
import hashlib
import json
import math
import struct
import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-a33-r01'
assert bpy.app.version[:3] == (5, 2, 2), 'Use the pinned Blender 5.2.2 exporter'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
source = bpy.data.collections.new('A33_EDITABLE_COMPONENTS')
scene.collection.children.link(source)
runtime = bpy.data.collections.new('A33_GAME_EXPORT')
scene.collection.children.link(runtime)
preview = bpy.data.collections.new('A33_HANDLING_INSPECTION')
scene.collection.children.link(preview)

def xyz(p):
    return (p[0], -p[2], p[1])

def game(p):
    return (p[0], p[2], -p[1])

def b64(a):
    return base64.b64encode(a.tobytes()).decode('ascii')

def sha(data):
    return hashlib.sha256(data).hexdigest()

# Three horizontally separated tiles: tyre / alloy / carbon. Padding keeps
# mip filtering away from tile boundaries. Values describe surfaces, not light.
W, H = 384, 128
normal = np.full((H, W, 4), 255, dtype=np.uint8)
normal[:, :, :3] = (128, 128, 255)
orm = np.full((H, W, 4), 255, dtype=np.uint8)
yy, xx = np.mgrid[0:H, 0:128]
for tile, rough, metal in [(0, 216, 0), (1, 78, 235), (2, 116, 16)]:
    if tile == 0:
        grain = np.sin(xx * .49 + yy * .12) * np.sin(yy * .71) * 2.5
        nx, ny = grain, np.sin(yy * 1.15 + xx * .18) * 2
    elif tile == 1:
        nx, ny = np.sin(yy * 1.7) * 1.5, np.sin(xx * 1.11 + yy * .03) * .7
        grain = np.sin(yy * 1.7) * 5
    else:
        weave = np.sin(xx * math.pi / 8) * np.sin(yy * math.pi / 8)
        nx, ny = weave * 6, np.cos(xx * math.pi / 8) * np.sin(yy * math.pi / 8) * 6
        grain = weave * 6
    normal[:, tile*128:(tile+1)*128, 0] = np.rint(128 + nx).astype(np.uint8)
    normal[:, tile*128:(tile+1)*128, 1] = np.rint(128 + ny).astype(np.uint8)
    orm[:, tile*128:(tile+1)*128, 0] = 255
    orm[:, tile*128:(tile+1)*128, 1] = np.rint(rough + grain).astype(np.uint8)
    orm[:, tile*128:(tile+1)*128, 2] = metal

mat = bpy.data.materials.new('A33_Original_Atlas_PBR')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 1
bsdf.inputs['Metallic'].default_value = 1
vc = nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Color'
links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
for label, pixels in [('normal', normal), ('orm', orm)]:
    image = bpy.data.images.new('A33_original_' + label, width=W, height=H, alpha=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set((pixels.astype(np.float32) / 255).ravel())
    image.pack()
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.extension = 'EXTEND'
    if label == 'normal':
        n = nodes.new('ShaderNodeNormalMap')
        n.inputs['Strength'].default_value = .35
        links.new(tex.outputs['Color'], n.inputs['Color'])
        links.new(n.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        separate = nodes.new('ShaderNodeSeparateColor')
        links.new(tex.outputs['Color'], separate.inputs['Color'])
        links.new(separate.outputs['Green'], bsdf.inputs['Roughness'])
        links.new(separate.outputs['Blue'], bsdf.inputs['Metallic'])

PALETTE = [(5, 6, 7, 255), (115, 126, 137, 255), (8, 11, 13, 255)]
class Part:
    def __init__(self, name, role, color=None, smooth=True):
        self.name, self.role = name, role
        self.color = color or PALETTE[role]
        self.smooth = smooth
        self.v, self.f, self.uv = [], [], []
    def vertex(self, p, uv):
        self.v.append(p)
        # Interior of each atlas tile, with 8px gutters.
        self.uv.append(((self.role*128 + 8 + uv[0]*112) / W, (8 + uv[1]*112) / H))
    def quad(self, a, b, c, d):
        self.f.extend([(a, b, c), (a, c, d)])

def lathe(name, profile, segments, role, color=None):
    p = Part(name, role, color)
    n = len(profile)
    for j in range(segments+1):
        a = j * 2*math.pi / segments
        for i, (x, r) in enumerate(profile):
            p.vertex((x, r*math.cos(a), r*math.sin(a)), (j/segments, i/(n-1)))
    for j in range(segments):
        for i in range(n-1):
            a = j*n+i
            p.quad(a, a+1, a+n+1, a+n)
    return p

def tube(name, points, radii, segments, role):
    p = Part(name, role)
    for i, point in enumerate(points):
        direction = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])
        direction.normalize()
        axis = Vector((1, 0, 0)) if abs(direction.x) < .95 else Vector((0, 1, 0))
        u = direction.cross(axis).normalized()
        v = direction.cross(u).normalized()
        for j in range(segments+1):
            angle = 2*math.pi*j/segments
            point_v = Vector(point) + radii[i] * (u*math.cos(angle) + v*math.sin(angle))
            p.vertex(tuple(point_v), (j/segments, i/(len(points)-1)))
    n = segments+1
    for i in range(len(points)-1):
        for j in range(segments):
            a = i*n+j
            p.quad(a, a+n, a+n+1, a+1)
    # Small flat end faces, never a cap across the centre-lock opening.
    for i in [0, len(points)-1]:
        centre = len(p.v)
        p.vertex(points[i], (.5, .5))
        for j in range(segments):
            p.f.append((centre, i*n+j, i*n+j+1) if i else (centre, j+1, j))
    return p

GLYPHS = {}
def glyph(ch):
    if ch not in GLYPHS:
        curve = bpy.data.curves.new('A33 original lettering ' + ch, 'FONT')
        curve.body = ch
        curve.size = .016
        curve.align_x = 'CENTER'
        curve.resolution_u = 2
        curve.extrude = .00020
        obj = bpy.data.objects.new('A33 glyph construction', curve)
        source.objects.link(obj)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target='MESH')
        mesh = obj.data
        mesh.calc_loop_triangles()
        GLYPHS[ch] = ([tuple(v.co) for v in mesh.vertices], [tuple(t.vertices) for t in mesh.loop_triangles])
        bpy.data.objects.remove(obj, do_unlink=True)
    return GLYPHS[ch]

def markings(half):
    p = Part('Moulded original AUREL CONTROL and inspection marks', 0, (28, 32, 34, 255), False)
    label = 'AUREL CONTROL'
    for side in [-1, 1]:
        for i, ch in enumerate(label):
            if ch == ' ': continue
            a = (i-(len(label)-1)/2)*.082
            # Glyph right tangent, up radial, outward face. No mirrored text.
            tangent = Vector((0, side*math.sin(a), -side*math.cos(a)))
            radial = Vector((0, math.cos(a), math.sin(a)))
            outward = Vector((side, 0, 0))
            centre = Vector((side*(half+.0023), .267*math.cos(a), .267*math.sin(a)))
            vertices, faces = glyph(ch)
            offset = len(p.v)
            for x, y, z in vertices:
                p.vertex(tuple(centre+x*tangent+y*radial+z*outward), (.5, .5))
            p.f.extend(tuple(offset+k for k in f) for f in faces)
    return p

def parts_for(end, level):
    half = .155 if end == 'front' else .190
    seg = [96, 48, 24][level]
    tire = [(-half,.245),(-half-.001,.259),(-half-.002,.276),(-half-.001,.296),
            (-half+.002,.309),(-half+.009,.320),(-half+.020,.328),(-half+.035,.3325),
            (-half+.052,.3345),(-half+.068,.335),(half-.068,.335),
            (half-.052,.3345),(half-.035,.3325),(half-.020,.328),(half-.009,.320),
            (half-.002,.309),(half+.001,.296),(half+.002,.276),(half+.001,.259),
            (half,.245),(-half,.245)]
    if level == 1: tire = [tire[i] for i in [0,2,4,6,8,9,10,11,13,15,17,19,20]]
    if level == 2: tire = [tire[i] for i in [0,3,6,9,10,13,16,19,20]]
    parts = [lathe('Slick carcass with manufactured shoulders', tire, seg, 0)]
    barrel = [(-half-.003,.234),(-half-.003,.243),(-half+.003,.247),(-half+.010,.247),
              (-half+.018,.237),(half-.018,.237),(half-.010,.247),(half+.004,.247),
              (half+.009,.241),(half+.009,.234),(-half-.003,.234)]
    if level == 2: barrel = [barrel[i] for i in [0,1,4,5,7,9,10]]
    parts.append(lathe('Forged barrel and bead seats', barrel, seg, 1))
    cover = [(half+.014,.052),(half+.017,.056),(half+.024,.116),(half+.017,.202),
             (half+.015,.224),(half+.010,.231),(half+.006,.230),(half+.009,.221),
             (half+.011,.20),(half+.018,.115),(half+.011,.052),(half+.014,.052)]
    if level == 2: cover = [cover[i] for i in [0,2,5,6,9,10,11]]
    parts.append(lathe('Separate dished carbon wheel cover', cover, seg, 2))
    parts.append(lathe('Centre barrel with through bore', [(half+.034,.024),(half+.034,.038),
                 (-half+.039,.038),(-half+.039,.024),(half+.034,.024)], max(12,seg//2), 1))
    parts.append(lathe('Captive centre-lock nut with actual open bore', [
        (half+.013,.029),(half+.013,.050),(half+.022,.050),(half+.025,.040),
        (half+.048,.040),(half+.051,.035),(half+.051,.024),(half+.018,.024),(half+.013,.029)], 12, 1))
    steps = [7,4,2][level]
    for j in range(10):
        pts=[]
        for i in range(steps):
            t=i/(steps-1); r=.049+.183*t; a=2*math.pi*j/10+.18*t
            pts.append((-half+.014+.022*math.sin(math.pi*t),r*math.cos(a),r*math.sin(a)))
        parts.append(tube('Forged inboard spoke %02d'%j, pts,
                         [.012-.005*i/(steps-1) for i in range(steps)], [8,6,4][level], 1))
    if level < 2:
        parts.append(lathe('Inboard spoke root collar', [(-half+.01,.043),(-half+.01,.061),
                     (-half+.035,.061),(-half+.048,.045),(-half+.01,.043)], seg//2, 1))
        parts.append(lathe('Fine original compound identification ring', [
            (half+.002,.294),(half+.0021,.297),(half+.0018,.298),
            (half+.0017,.294),(half+.002,.294)], seg, 0, (120,102,55,255)))
        parts.append(tube('Recessed valve stem', [(half-.025,-.187,.097),(half-.002,-.192,.100)],
                          [.007,.006], 8, 1))
    if level == 0:
        parts.append(markings(half))
    return parts

def make_object(name, parts, collection):
    verts, faces, uv, colors, smooth_flags = [], [], [], [], []
    for part in parts:
        offset = len(verts)
        verts.extend(xyz(p) for p in part.v)
        uv.extend(part.uv)
        colors.extend([part.color]*len(part.v))
        faces.extend(tuple(offset+k for k in f) for f in part.f)
        smooth_flags.extend([part.smooth]*len(part.f))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uvs = mesh.uv_layers.new(name='A33 padded surface atlas')
    for loop in mesh.loops: uvs.data[loop.index].uv = uv[loop.vertex_index]
    color = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    for i,c in enumerate(colors): color.data[i].color = tuple(v/255 for v in c)
    for p,s in zip(mesh.polygons,smooth_flags): p.use_smooth=s
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.materials.append(mat)
    obj['assetId']='A33'
    obj['units']='metres'
    return obj

root = bpy.data.objects.new('A33_SPARE_WHEEL_HANDLING_SET', None)
runtime.objects.link(root)
root['assetId']='A33'
root['revision']=REVISION
root['finalArtApproved']=False
root['axis']='metres; Y up; Z forward; X axle; +X outboard prototype'
prototypes={}
meshes={}
triangles={}
for level in range(3):
    pair=[]
    for end in ['front','rear']:
        parts=parts_for(end,level)
        obj=make_object('A33_%s_LOD%d'%(end.upper(),level),parts,runtime)
        obj.parent=root
        obj['wheelEnd']=end
        obj['lod']=level
        prototypes[(end,level)]=obj
        pair.append(obj)
        if level==0:
            # Individual manufactured pieces remain editable, not just a flattened export.
            for part in parts:
                component=make_object('A33 %s / %s'%(end,part.name),[part],source)
                component['wheelEnd']=end
    # Stable paired loop correspondence; position/normal changes cannot silently
    # reorder vertices in the rear shape. Same index topology for both prototypes.
    front,rear=[o.data for o in pair]
    assert len(front.loops)==len(rear.loops)
    assert [tuple(p.vertices) for p in front.polygons]==[tuple(p.vertices) for p in rear.polygons]
    positions=[[],[]]; normals=[[],[]]; uv_values=[]; colors=[]; indices=[]; dedup={}
    for li,loop in enumerate(front.loops):
        uv=tuple(front.uv_layers.active.data[li].uv)
        n=tuple(front.corner_normals[li].vector)
        key=(loop.vertex_index,tuple(round(x,6) for x in n),uv)
        if key not in dedup:
            dedup[key]=len(uv_values)
            uv_values.append(uv)
            colors.append(front.color_attributes['Color'].data[loop.vertex_index].color)
            for k,mesh in enumerate([front,rear]):
                rloop=mesh.loops[li]
                assert rloop.vertex_index==loop.vertex_index
                positions[k].append(game(mesh.vertices[rloop.vertex_index].co))
                normals[k].append(game(mesh.corner_normals[li].vector))
        indices.append(dedup[key])
    assert len(indices)%3==0 and len(uv_values)<65536
    triangles[str(level)]=len(indices)//3
    meshes[str(level)]={
        'vertices':len(uv_values),'triangles':len(indices)//3,
        'position':b64(np.asarray(positions[0],dtype='<f4')),
        'rearPosition':b64(np.asarray(positions[1],dtype='<f4')),
        'normal':b64(np.rint(np.clip(normals[0],-1,1)*32767).astype('<i2')),
        'rearNormal':b64(np.rint(np.clip(normals[1],-1,1)*32767).astype('<i2')),
        'uv':b64(np.asarray(uv_values,dtype='<f4')),
        'color':b64(np.rint(np.asarray(colors)*255).astype('u1')),
        'index':b64(np.asarray(indices,dtype='<u2')),
    }

sockets={}
for end,half in [('front',.155),('rear',.190)]:
    sockets[end]={
        'AXLE':[0,0,0], 'HUB_APPROACH':[-half-.045,0,0],
        'GRIP_LEFT':[half+.0015,.12,-.26], 'GRIP_RIGHT':[half+.0015,.12,.26],
        'FLOOR_CONTACT':[0,-.335,0], 'STORAGE_AXIS':[0,0,0],
        'A35_RACK':[0,-.335,0], 'BLANKET_ENVELOPE':[half+.009,.335,0],
    }
    for name,pos in sockets[end].items():
        obj=bpy.data.objects.new('A33_%s_SOCKET_%s'%(end.upper(),name),None)
        runtime.objects.link(obj);obj.parent=root;obj.location=xyz(pos)
        obj['wheelEnd']=end;obj['positionGame']=pos
        obj['purpose']='attachment metadata; no simulation collider or inventory'

states={
 'carry':{'position':[0,.75,0],'rotation':[0,0,0]},
 'staged':{'position':[0,.335,0],'rotation':[0,0,0]},
 'storedVertical':{'position':[0,.335,0],'rotation':[0,0,0]},
 # Nut remains above the floor: +X outboard becomes +Y. Vertical centre uses
 # the measured inboard rim flange, not a tyre-only half-width approximation.
 'storedHorizontal':{'position':[0,0,0],'rotation':[0,0,math.pi/2]},
}
for row,(state,data) in enumerate(states.items()):
    for col,end in enumerate(['front','rear']):
        half=.155 if end=='front' else .190
        anchor=bpy.data.objects.new('A33_STATE_%s_%s'%(state,end),None)
        preview.objects.link(anchor)
        p=data['position'].copy()
        if state=='storedHorizontal':p[1]=half+.003
        p[0]+=col*1.25-1.25;p[2]+=row*1.15
        anchor.location=xyz(p)
        # Rotating around game Z corresponds to Blender -Y.
        anchor.rotation_euler.y=-data['rotation'][2]
        anchor['state']=state;anchor['wheelEnd']=end
        o=prototypes[(end,0)].copy();o.data=prototypes[(end,0)].data
        preview.objects.link(o);o.parent=anchor;o.name='A33 preview '+state+' '+end
# A four-wheel service set is a linked assembly, not four baked wheel copies.
for i,end in enumerate(['front','front','rear','rear']):
    anchor=bpy.data.objects.new('A33_SERVICE_SET_'+['FL','FR','RL','RR'][i],None)
    preview.objects.link(anchor);anchor.location=xyz(((-1 if i%2==0 else 1)*.85,.335,5.1+(0 if i<2 else 1.2)))
    if i%2==0:anchor.rotation_euler.z=math.pi
    o=prototypes[(end,0)].copy();o.data=prototypes[(end,0)].data
    preview.objects.link(o);o.parent=anchor

# Inspection collection is not exported. Explicit hierarchy contains only
# prototypes, all LODs and attachment helpers; runtime selects one LOD per wheel.
root['handlingStates']=states
source.hide_render=True;source.hide_viewport=True
bpy.ops.object.select_all(action='DESELECT')
for obj in runtime.objects: obj.select_set(True)
bpy.context.view_layer.objects.active=root
out=ROOT/'public/models/aurel-a33-spare-wheel-set.glb'
out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
    export_yup=True,export_extras=True,export_cameras=False,export_lights=False,
    export_animations=False,export_materials='EXPORT')
for o in runtime.objects:o.hide_set(True);o.hide_render=True
scene.world=bpy.data.worlds.new('A33 inspection world')
scene.world.color=(.18,.18,.18)
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
# Editable, intentionally lit contact-sheet view, saved in the source only.
camdata=bpy.data.cameras.new('A33 inspection camera');cam=bpy.data.objects.new('A33 inspection camera',camdata)
preview.objects.link(cam);cam.location=(8,9,9);target=Vector((0,-2.5,.3))
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=9
scene.camera=cam
for name,pos,power,size in [('Key',(3,2,7),2000,6),('Fill',(-4,-4,5),1400,5),('Edge',(1,-7,4),1700,4)]:
    data=bpy.data.lights.new('A33 '+name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(data.name,data);preview.objects.link(o);o.location=pos
    o.rotation_euler=(Vector((0,-2,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-a33-spare-wheel-set.blend'),compress=True)

source_doc={
    'schema':1,'assetId':'A33','revision':REVISION,'units':'metres-Y-up-X-axle',
    'radius':.335,'halfWidths':{'front':.155,'rear':.190},
    'meshes':meshes,'sockets':sockets,'states':states,
    'atlas':{'width':W,'height':H,'normal':b64(normal),'orm':b64(orm)},
}
runtime_path=ROOT/'src/rendering/a33-spare-wheel-set.geometry.json'
runtime_path.parent.mkdir(parents=True,exist_ok=True)
runtime_raw=(json.dumps(source_doc,separators=(',',':'))+'\n').encode()
runtime_path.write_bytes(runtime_raw)
raw=out.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n])
assert triangles['0']<=18000 and triangles['1']<=6500 and triangles['2']<=2200
assert triangles['0']>triangles['1']>triangles['2']
assert len(raw)<6*1024*1024 and len(runtime_raw)<5*1024*1024
manifest={
    'schema':1,'assetId':'A33','revision':REVISION,'generator':'Blender '+bpy.app.version_string,
    'author':'scripts/author-a33-spare-wheel-set.py','sourceSHA256':sha(Path(__file__).read_bytes()),
    'editable':'scripts/aurel-a33-spare-wheel-set.blend','url':'models/aurel-a33-spare-wheel-set.glb',
    'bytes':len(raw),'sha256':sha(raw),'runtimeBytes':len(runtime_raw),'runtimeSha256':sha(runtime_raw),
    'trianglesPerWheel':triangles,'triangleCeilings':{'0':18000,'1':6500,'2':2200},
    'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),'materials':len(doc['materials']),
    'images':len(doc.get('images',[])),'socketCount':sum(len(x) for x in sockets.values()),
    'runtimeShapeSelection':'front base and topology-corresponding rear position/normal target',
    'collision':'none; floor/rack/blanket envelopes are placement metadata only',
    'variation':'original static mould/compound marks; no random per-frame variation',
    'compatibility':'APX dimensions; supplied player visuals retained unchanged',
    'finalArtApproved':False,
}
(ROOT/'src/rendering/a33-spare-wheel-set.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('A33_RECEIPT '+json.dumps(manifest))
