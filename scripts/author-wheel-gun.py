"""A31 original Aurel pneumatic wheel gun. Blender 5.2.2, metres, +Z drive.

Rebuild: blender -b --factory-startup --python scripts/author-wheel-gun.py
Re-export editable source: append -- --export-only
Studio/contact inspection: append -- --render-dir /absolute/output/path
Source/reference collections never enter the runtime GLB. No external art.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import zlib

import bpy
from mathutils import Matrix, Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ARGS = argparse.ArgumentParser()
ARGS.add_argument('--output-root', type=Path, default=ROOT)
ARGS.add_argument('--export-only', action='store_true')
ARGS.add_argument('--check-source', action='store_true')
ARGS.add_argument('--render-dir', type=Path)
args = ARGS.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.output_root
REV = 'aurel-wheel-gun-r01'
if bpy.app.version[:3] != (5, 2, 2):
    raise RuntimeError('A31 requires the repository-pinned Blender 5.2.2')

# Author in game coordinates; convert only at the Blender boundary.
def xyz(p):
    return (p[0], -p[2], p[1])

def game(p):
    return (p[0], p[2], -p[1])

PALETTE = [
    ((.026, .23, .205), .34, .15),  # painted alloy, dielectric coating
    ((.044, .054, .066), .39, .68),  # oxidized metal
    ((.40, .46, .49), .25, .95),  # machined steel
    ((.012, .017, .021), .78, .0),  # rubber
    ((.86, .38, .047), .38, .03),  # amber controls
    ((.74, .81, .78), .51, .0),  # original lettering
    ((.082, .093, .10), .56, .12),  # cast housing
    ((.17, .21, .22), .45, .80),  # coupler
]
SOCKETS = {
    'SOCKET_WHEEL_NUT': {'position': [0, 0, 0], 'quaternion': [0, 0, 0, 1]},
    'SOCKET_HAND_PRIMARY': {'position': [0, -.083, -.203], 'quaternion': [0, 0, .7071067812, .7071067812]},
    'SOCKET_HAND_SUPPORT': {'position': [0, 0, -.1], 'quaternion': [0, -.7071067812, 0, .7071067812]},
    'SOCKET_TRIGGER_FINGER': {'position': [-.026, -.041, -.169], 'quaternion': [0, 0, 0, 1]},
    'SOCKET_HOSE': {'position': [0, -.172, -.267], 'quaternion': [0, 0, 0, 1]},
    'SOCKET_STOW': {'position': [0, -.151, -.213], 'quaternion': [0, 0, 0, 1]},
}
PIVOTS = {'BODY': [0, 0, 0], 'TRIGGER': [0, -.03, -.174], 'SOCKET': [0, 0, 0]}

# Original deterministic PNGs, without host metadata or absolute paths.
def png(pixels):
    h, w, _ = pixels.shape
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    scan = b''.join(b'\0' + row.tobytes() for row in pixels)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scan, 9)) + chunk(b'IEND', b''))

def atlas_pixels():
    n = 256
    base = np.zeros((n, n, 4), dtype=np.uint8)
    orm = np.zeros_like(base)
    normal = np.zeros_like(base)
    yy, xx = np.mgrid[:128, :64]
    # Integer noise avoids random library/version dependence.
    noise = ((xx * 127 + yy * 71 + xx * yy * 13) % 97) / 96.0 - .5
    for role, (color, rough, metal) in enumerate(PALETTE):
        x, y = (role % 4) * 64, (role // 4) * 128
        sl = np.s_[y:y+128, x:x+64]
        lin = np.asarray(color)
        srgb = np.where(lin <= .0031308, lin * 12.92, 1.055 * lin ** (1/2.4) - .055)
        base[sl][:, :, :3] = np.clip((srgb[None, None, :] + noise[:, :, None] * .003) * 255, 0, 255)
        base[sl][:, :, 3] = 255
        orm[sl][:, :, 0] = 255
        orm[sl][:, :, 1] = np.clip((rough + noise * .02) * 255, 0, 255)
        orm[sl][:, :, 2] = int(metal * 255)
        orm[sl][:, :, 3] = 255
        normal[sl] = [128, 128, 255, 255]
        normal[sl][:, :, 0] = np.clip(128 + noise * (4 if role == 3 else 1), 0, 255)
        normal[sl][:, :, 1] = np.clip(128 + np.roll(noise, 1, 0) * 3, 0, 255)
    return {'base': base, 'orm': orm, 'normal': normal}

ATLAS = atlas_pixels()

if args.check_source:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'scripts/aurel-wheel-gun.blend'))
    assert bpy.context.scene.unit_settings.scale_length == 1
    assert len(bpy.data.collections['EDITABLE_A31_COMPONENTS'].objects) > 20
    for name, pixels in ATLAS.items():
        image = bpy.data.images['A31_original_' + name]
        assert image.source == 'FILE' and image.packed_file
        actual = np.asarray(image.pixels[:], dtype=np.float32)
        expected = pixels[::-1].astype(np.float32).ravel() / 255
        assert actual.shape == expected.shape
        assert np.max(np.abs(actual - expected)) < .00001, name
    print('A31_SOURCE_ROUNDTRIP_OK: editable source and all packed PBR pixels retained')
    sys.exit(0)

def make_material():
    m = bpy.data.materials.new('A31_Original_PBR_Atlas')
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = 1
    p.inputs['Metallic'].default_value = 1
    for name, pix in ATLAS.items():
        # A GENERATED image with arbitrary packed bytes reloads as a blank canvas.
        # Load actual PNG bytes before packing, so reopening the source retains
        # both the image source type and its pixels. No external file is needed.
        with tempfile.TemporaryDirectory(prefix='a31-surface-') as temporary:
            path = Path(temporary) / ('A31_original_' + name + '.png')
            path.write_bytes(png(pix))
            image = bpy.data.images.load(str(path), check_existing=False)
            image.name = 'A31_original_' + name
            image.colorspace_settings.name = 'sRGB' if name == 'base' else 'Non-Color'
            image.pack()
            image.filepath = '//A31_original_' + name + '.png'
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'EXTEND'
        if name == 'base':
            links.new(tex.outputs['Color'], p.inputs['Base Color'])
        elif name == 'orm':
            sep = nodes.new('ShaderNodeSeparateColor')
            links.new(tex.outputs['Color'], sep.inputs[0])
            links.new(sep.outputs['Green'], p.inputs['Roughness'])
            links.new(sep.outputs['Blue'], p.inputs['Metallic'])
        else:
            norm = nodes.new('ShaderNodeNormalMap')
            norm.inputs['Strength'].default_value = .35
            links.new(tex.outputs['Color'], norm.inputs['Color'])
            links.new(norm.outputs[0], p.inputs['Normal'])
    return m

if not args.export_only:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    source = bpy.data.collections.new('EDITABLE_A31_COMPONENTS')
    refs = bpy.data.collections.new('A31_REFERENCES_NO_EXPORT')
    scene.collection.children.link(source)
    scene.collection.children.link(refs)
    mat = make_material()
    parts = []
    def own(o, name, role, tier=0, part='BODY'):
        o.name = 'A31_' + name
        for c in list(o.users_collection):
            c.objects.unlink(o)
        source.objects.link(o)
        o.data.materials.clear()
        o.data.materials.append(mat)
        o['a31_role'], o['a31_tier'], o['a31_part'] = role, tier, part
        parts.append(o)
        return o
    def bevel(o, width=.001, segments=3):
        mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width, mod.segments = width, segments
        mod = o.modifiers.new('Area weighted corner normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    def box(name, p, size, role, radius=.001, tier=0, part='BODY'):
        bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
        o = bpy.context.object
        o.dimensions = (size[0], size[2], size[1])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if radius:
            bevel(o, radius)
        return own(o, name, role, tier, part)
    def mesh(name, verts, faces, role, tier=0, part='BODY', smooth=False):
        me = bpy.data.meshes.new('A31_' + name)
        me.from_pydata([xyz(p) for p in verts], [], faces)
        me.update()
        o = bpy.data.objects.new('A31_' + name, me)
        source.objects.link(o)
        for f in me.polygons:
            f.use_smooth = smooth
        return own(o, name, role, tier, part)
    def lathe(name, profile, role, tier=0, part='BODY', segments=48):
        # Closed (z,r) cross-section, including explicit hollow walls where needed.
        verts = [(r * math.cos(i * 2 * math.pi / segments), r * math.sin(i * 2 * math.pi / segments), z)
                 for z, r in profile for i in range(segments)]
        faces = []
        for j in range(len(profile)):
            j2 = (j + 1) % len(profile)
            for i in range(segments):
                i2 = (i + 1) % segments
                faces.append((j * segments + i, j * segments + i2, j2 * segments + i2, j2 * segments + i))
        return mesh(name, verts, faces, role, tier, part, True)
    def rod(name, a, b, r, role, tier=0, segments=12):
        av, bv = Vector(xyz(a)), Vector(xyz(b))
        bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=r, depth=(bv-av).length, location=(av+bv)/2)
        o = bpy.context.object
        o.rotation_quaternion = (bv-av).to_track_quat('Z', 'Y')
        o.rotation_mode = 'QUATERNION'
        bevel(o, min(.0008, r*.2), 2)
        return own(o, name, role, tier)
    def grip(name, profile, role, depth=.038):
        # Deliberately shaped finger/palm contour; not a scaled cube handle.
        verts = [(x, y, z) for x in [-depth/2, depth/2] for y,z in profile]
        n = len(profile)
        faces = [tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        o = mesh(name,verts,faces,role)
        bevel(o,.0032,4)
        return o
    # Body shell, with a silhouette-readable shoulder and separate rear cap.
    lathe('Motor_shell',[(-.301,.001),(-.301,.028),(-.294,.040),(-.279,.046),(-.178,.046),(-.165,.041),(-.165,.001)],0)
    lathe('Rear_impact_cap',[(-.313,.001),(-.313,.026),(-.309,.036),(-.301,.041),(-.295,.041),(-.295,.001)],3)
    lathe('Hammer_housing',[(-.167,.001),(-.167,.041),(-.159,.044),(-.144,.044),(-.130,.031),(-.117,.026),(-.065,.026),(-.063,.022),(-.063,.001)],6)
    # Nose support is intentionally narrow enough for the second glove.
    lathe('Nose_bearing',[(-.070,.001),(-.070,.025),(-.063,.028),(-.051,.028),(-.047,.025),(-.047,.001)],2)
    for j,z in enumerate([-.289,-.174]):
        lathe('Shell_seal_%d'%j,[(z-.002,.044),(z-.002,.047),(z+.002,.047),(z+.002,.044)],3,1)
    lathe('Front_lock_ring',[(-.060,.025),(-.060,.031),(-.056,.032),(-.052,.031),(-.052,.025)],4,1)
    # Interchangeable hex socket. Bore wall and back stop are real geometry.
    seg=48
    vs=[]
    for z,outer in [(-.050,.024),(-.045,.039),(-.038,.043),(0.010,.043),(0.014,.041)]:
        for i in range(seg):
            a=i*2*math.pi/seg;vs.append((math.cos(a)*outer,math.sin(a)*outer,z))
    for z in [.014,-.023]:
        for i in range(seg):
            a=i*2*math.pi/seg
            # Circumradius .0375, 6 wrench flats. Phase matches the native nut.
            delta=((a+math.pi/6)%(math.pi/3))-math.pi/6
            rr=(.0375*math.cos(math.pi/6))/math.cos(delta)
            vs.append((math.cos(a)*rr,math.sin(a)*rr,z))
    fs=[]
    for j in range(6):
        for i in range(seg):
            k=(i+1)%seg;fs.append((j*seg+i,j*seg+k,(j+1)*seg+k,(j+1)*seg+i))
    fs.extend([tuple(reversed(range(seg))),tuple(range(6*seg,7*seg))])
    socket=mesh('Socket_replaceable_hex',vs,fs,2,0,'SOCKET')
    bevel(socket,.0005,2)
    lathe('Socket_retaining_band',[(-.041,.040),(-.041,.044),(-.037,.044),(-.037,.040)],1,1,'SOCKET')
    for i in range(6):
        a=i*math.pi/3
        rod('Socket_drive_pin_%d'%i,(.041*math.cos(a),.041*math.sin(a),-.019),(.044*math.cos(a),.044*math.sin(a),-.019),.0014,7,2,8)['a31_part']='SOCKET'
    grip('Ergonomic_grip',[(-.030,-.222),(-.034,-.179),(-.052,-.180),(-.095,-.188),(-.139,-.195),(-.149,-.207),(-.147,-.230),(-.128,-.225),(-.080,-.218),(-.046,-.226)],3,.029)
    box('Heel_bumper',(0,-.147,-.211),(.044,.012,.058),3,.003)
    # Trigger has its own pivot and a true gap ahead of the grip.
    box('Trigger_paddle',(0,-.052,-.174),(.024,.043,.009),4,.003,0,'TRIGGER')
    rod('Trigger_hinge',(-.016,-.030,-.174),(.016,-.030,-.174),.0024,2,1)
    for side in [-1,1]:
        for k in range(5):
            y=-.066-k*.013
            box('Grip_rib_%d_%d'%(side,k),(side*.0155,y,-.204),(.0018,.003,.026),1,.0007,2)
        box('Casing_panel_%d'%side,(side*.046,0,-.229),(.003,.036,.077),1,.003,1)
        box('Identity_inset_%d'%side,(side*.048,0,-.23),(.0012,.024,.061),0,.0005,1)
        box('Direction_paddle_%d'%side,(side*.049,.020,-.191),(.006,.012,.023),4,.002,1)
        for z in [-.259,-.194]:
            for y in [-.013,.013]:
                rod('Panel_screw', (side*.047,y,z),(side*.050,y,z),.002,2,2,6)
    for i in range(12):
        a=2*math.pi*i/12
        # Recessed rear vents read against a dark solid back, not alpha cards.
        o=box('Rear_vent_%02d'%i,(.030*math.cos(a),.030*math.sin(a),-.311),(.004,.009,.002),1,.0007,2)
        o.rotation_euler[1]=a
    # Swivel elbow exits behind the heel, clear of wrist and curled fingers.
    rod('Air_inlet_stem',(0,-.145,-.224),(0,-.164,-.231),.009,7,0,24)
    rod('Air_swivel_elbow',(0,-.164,-.231),(0,-.174,-.249),.011,2,0,24)
    rod('Quick_release_coupler',(0,-.174,-.245),(0,-.172,-.267),.013,7,0,24)
    for z in [-.250,-.257,-.264]:
        rod('Connector_collar',(0,-.172,z-.0008),(0,-.172,z+.0008),.014,1,1,24)
    # Minimal original engraved identification converted into geometry.
    for side in [-1,1]:
        cu=bpy.data.curves.new('A31_original_identity','FONT');cu.body='AUREL\nA31 / AIR';cu.align_x='CENTER';cu.align_y='CENTER';cu.size=.007;cu.space_line=1.2;cu.extrude=.00004;cu.resolution_u=2
        o=bpy.data.objects.new('identity',cu);source.objects.link(o)
        o.location=xyz((side*.049,0,-.233))
        o.rotation_euler=(math.pi/2,0,side*math.pi/2)
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH');own(bpy.context.object,'Original_Aurel_identity',5,2)
    # UV seams for atlas roles; coordinates remain inside padded tiles at all LODs.
    for o in parts:
        uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
        coords=[v.co.copy() for v in o.data.vertices]
        lo=Vector([min(p[i] for p in coords) for i in range(3)])
        hi=Vector([max(p[i] for p in coords) for i in range(3)])
        role=int(o['a31_role']);tx,ty=role%4,role//4
        for f in o.data.polygons:
            axis=max(range(3),key=lambda i:abs(f.normal[i]));axes=[i for i in range(3) if i!=axis]
            for li in f.loop_indices:
                co=o.data.vertices[o.data.loops[li].vertex_index].co
                a=[(co[i]-lo[i])/max(hi[i]-lo[i],1e-5) for i in axes]
                uv.data[li].uv=((tx+.09+.82*a[0])/4,1-(ty+.07+.86*a[1])/2)
    # Reference sockets and non-exporting measured glove proxies.
    for name, spec in SOCKETS.items():
        o=bpy.data.objects.new(name,None);source.objects.link(o);o.location=xyz(spec['position']);o.empty_display_type='ARROWS';o.empty_display_size=.026
        o['game_quaternion']=spec['quaternion'];o['a31_socket']=True
    people=json.loads((ROOT/'src/rendering/aurel-people.geometry.json').read_text())
    gm=people['meshes']['glove']
    for hand in [0,1]:
        from mathutils import Quaternion
        spec=SOCKETS['SOCKET_HAND_PRIMARY' if hand==0 else 'SOCKET_HAND_SUPPORT']
        q=Quaternion((spec['quaternion'][3],*spec['quaternion'][:3]))
        anchor=Vector(spec['position'])
        verts=[]
        for i in range(0,len(gm['position']),3):
            p=Vector(gm['position'][i:i+3])
            if hand==0:p.x=-p.x
            p=q@(p-Vector((0,.034,.041)))+anchor;verts.append(xyz(p))
        inds=gm['index'];faces=[tuple(inds[i:i+3][::-1] if hand==0 else inds[i:i+3]) for i in range(0,len(inds),3)]
        me=bpy.data.meshes.new('Measured existing glove');me.from_pydata(verts,[],faces)
        o=bpy.data.objects.new('A31_Hand_contact_reference_%d'%hand,me);refs.objects.link(o)
        pm=bpy.data.materials.get('A31_Reference_Glove') or bpy.data.materials.new('A31_Reference_Glove');pm.diffuse_color=(.09,.115,.13,1);pm.use_nodes=True;pm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.09,.115,.13,1);pm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8;me.materials.append(pm)
    refs.hide_render=True;refs.hide_viewport=True
    for o in parts:
        # Normalize closed mesh orientation, including profile sweeps.
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
else:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'scripts/aurel-wheel-gun.blend'))
    scene=bpy.context.scene
    source=bpy.data.collections['EDITABLE_A31_COMPONENTS']
    refs=bpy.data.collections['A31_REFERENCES_NO_EXPORT']
    parts=[o for o in source.objects if o.type=='MESH' and 'a31_part' in o]
    mat=bpy.data.materials['A31_Original_PBR_Atlas']

# Evaluate actual Blender meshes and canonicalize attributes/triangles before
# writing standard glTF 2.0. No host-dependent exporter vertex packing.
for coll in list(bpy.data.collections):
    if coll.name=='A31_GAME_EXPORT':
        for o in list(coll.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(coll)
runtime=bpy.data.collections.new('A31_GAME_EXPORT');scene.collection.children.link(runtime)
root=bpy.data.objects.new('AUREL_WHEEL_GUN',None);runtime.objects.link(root)
root['assetId']='A31';root['revision']=REV;root['finalArtApproved']=False
root['units']='metres';root['driveAxis']='+Z'
meshes=[]
for level in range(3):
    levelroot=bpy.data.objects.new('A31_LOD%d'%level,None);runtime.objects.link(levelroot);levelroot.parent=root
    for part,pivot in PIVOTS.items():
        rows=[];triangles=[]
        for original in sorted(parts,key=lambda o:o.name):
            if original['a31_part']!=part or original['a31_tier']>2-level:continue
            o=original.copy();o.data=original.data.copy();runtime.objects.link(o)
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            for mod in list(o.modifiers):
                if mod.type=='BEVEL':mod.segments=max(1,mod.segments-level)
                bpy.ops.object.modifier_apply(modifier=mod.name)
            if level:
                dec=o.modifiers.new('Authored LOD reduction','DECIMATE');dec.ratio=.43 if level==1 else .16
                dec.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=dec.name)
            me=o.data;me.calc_loop_triangles()
            normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
            for tri in me.loop_triangles:
                face=[]
                for li in tri.loops:
                    loop=me.loops[li]
                    p=game(o.matrix_world@me.vertices[loop.vertex_index].co)
                    normal=game((normal_matrix@me.corner_normals[li].vector).normalized())
                    uv=me.uv_layers.active.data[li].uv
                    # Float32 with a 1-micron spatial grid; stable and more precise
                    # than the 2-mm operational fit gate. UVs are rounded to a quarter
                    # texel on the 256px atlas, avoiding bevel interpolation ULP drift.
                    row=tuple(round(v,6) for v in [p[0]-pivot[0],p[1]-pivot[1],p[2]-pivot[2],*normal]) + (round(uv.x,3),round(1-uv.y,3))
                    face.append(row)
                if len(set(face))==3:triangles.append(tuple(face))
            bpy.data.objects.remove(o,do_unlink=True)
        unique=sorted(set(v for t in triangles for v in t));lookup={r:i for i,r in enumerate(unique)}
        faces=[]
        for t in triangles:
            f=tuple(lookup[r] for r in t);f=min(f,f[1:]+f[:1],f[2:]+f[:2]);faces.append(f)
        faces=sorted(set(faces))
        if not unique or not faces:raise RuntimeError('Empty A31 part')
        data=np.asarray(unique,dtype='<f4');indices=np.asarray(faces,dtype='<u2' if len(unique)<65536 else '<u4').reshape(-1)
        name='A31_LOD%d_%s'%(level,part)
        meshes.append({'name':name,'part':part,'level':level,'data':data,'indices':indices,'pivot':pivot})
        me=bpy.data.meshes.new(name);me.from_pydata([xyz(v[:3]) for v in unique],[],faces);me.update()
        uv=me.uv_layers.new(name='UVMap')
        for face in me.polygons:
            face.use_smooth=True
            for li in face.loop_indices:
                row=unique[me.loops[li].vertex_index];uv.data[li].uv=(row[6],1-row[7])
        me.normals_split_custom_set_from_vertices([xyz(v[3:6]) for v in unique]);me.materials.append(mat)
        obj=bpy.data.objects.new(name,me);runtime.objects.link(obj);obj.parent=levelroot;obj.location=xyz(pivot)
        if level:obj.hide_render=True;obj.hide_set(True)
source.hide_render=True;source.hide_viewport=True

blob=bytearray();views=[];accessors=[]
def buffer_view(raw,target=None):
    while len(blob)%4:blob.append(0)
    i=len(views);v={'buffer':0,'byteOffset':len(blob),'byteLength':len(raw)}
    if target:v['target']=target
    views.append(v);blob.extend(raw);return i

def accessor(arr,component,kind,shape,target,bounds=False):
    arr=np.ascontiguousarray(arr)
    a={'bufferView':buffer_view(arr.tobytes(),target),'componentType':component,'count':arr.size//shape,'type':kind}
    if bounds:
        a['min']=arr.reshape(-1,shape).min(0).tolist();a['max']=arr.reshape(-1,shape).max(0).tolist()
    accessors.append(a);return len(accessors)-1

nodes=[{'name':'AUREL_WHEEL_GUN','children':[1,2,3],'extras':{'assetId':'A31','revision':REV,'units':'metres','driveAxis':'+Z','finalArtApproved':False}}]
nodes += [{'name':'A31_LOD%d'%i,'children':[]} for i in range(3)]
gltfmeshes=[];counts={str(i):0 for i in range(3)}
for m in meshes:
    data=m['data'];indices=m['indices']
    p={'attributes':{'POSITION':accessor(data[:,:3],5126,'VEC3',3,34962,True),'NORMAL':accessor(data[:,3:6],5126,'VEC3',3,34962),'TEXCOORD_0':accessor(data[:,6:8],5126,'VEC2',2,34962)},'indices':accessor(indices,5123 if indices.dtype.itemsize==2 else 5125,'SCALAR',1,34963),'material':0,'mode':4}
    ni=len(nodes);nodes.append({'name':m['name'],'mesh':len(gltfmeshes),'translation':m['pivot'],'extras':{'part':m['part'],'lod':m['level']}});nodes[m['level']+1]['children'].append(ni)
    gltfmeshes.append({'name':m['name'],'primitives':[p]});counts[str(m['level'])]+=indices.size//3
for name,s in SOCKETS.items():
    nodes[0]['children'].append(len(nodes));nodes.append({'name':name,'translation':s['position'],'rotation':s['quaternion'],'extras':{'purpose':'contact/placement only'}})
    empty=bpy.data.objects.new('EXPORT_'+name,None);runtime.objects.link(empty);empty.parent=root;empty.location=xyz(s['position']);empty.empty_display_size=.025
images=[]
for name,pix in ATLAS.items():images.append({'name':'A31_original_'+name,'bufferView':buffer_view(png(pix)),'mimeType':'image/png'})
while len(blob)%4:blob.append(0)
doc={'asset':{'version':'2.0','generator':'Blender 5.2.2 / A31 canonical evaluated-mesh exporter'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'meshes':gltfmeshes,'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(blob)}],'images':images,'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],'textures':[{'sampler':0,'source':i} for i in range(3)],'materials':[{'name':'A31_Original_PBR_Atlas','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':1},'metallicFactor':1,'roughnessFactor':1},'normalTexture':{'index':2,'scale':.35}}]}
js=json.dumps(doc,separators=(',',':'),sort_keys=True).encode();js+=b' '*((-len(js))%4)
raw=struct.pack('<III',0x46546c67,2,28+len(js)+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob
out=OUT/'public/models/aurel-wheel-gun.glb';out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(raw)
allpos=np.concatenate([m['data'][:,:3]+np.asarray(m['pivot']) for m in meshes])
manifest={'assetId':'A31','revision':REV,'author':'scripts/author-wheel-gun.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-wheel-gun.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-wheel-gun.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'triangleCeilings':{'0':24000,'1':11000,'2':3500},'materials':1,'images':3,'meshes':len(gltfmeshes),'nodes':len(nodes),'atlasSize':[256,256],'bounds':{'min':allpos.min(0).tolist(),'max':allpos.max(0).tolist()},'units':'metres-Y-up-Z-drive','sockets':SOCKETS,'pivots':PIVOTS,'triggerRadians':.18,'socketInnerCircumradius':.0375,'socketEngagementDepth':.037,'colliders':[{'shape':'box','center':[0,0,-.230],'halfExtents':[.051,.049,.086]},{'shape':'box','center':[0,-.087,-.207],'halfExtents':[.023,.067,.03]},{'shape':'box','center':[0,0,-.018],'halfExtents':[.047,.047,.034]}],'provenance':'Original scripted meshes, labels and surface maps; existing repository gloves used only as non-exported contact references.','finalArtApproved':False}
assert 0<counts['2']<counts['1']<counts['0']
for i in counts:assert counts[i]<=manifest['triangleCeilings'][i],counts
assert len(raw)<6*1024*1024
(OUT/'src/rendering').mkdir(parents=True,exist_ok=True)
(OUT/'src/rendering/wheel-gun.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(OUT/'scripts').mkdir(parents=True,exist_ok=True)
scene['A31_handoff']='Use editable source collection; export-only preserves mesh and UV edits. Socket and surface-atlas parameters are in the author script. References never export.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'scripts/aurel-wheel-gun.blend'),compress=True)
print('A31_RECEIPT '+json.dumps(manifest))

if args.render_dir:
    args.render_dir.mkdir(parents=True,exist_ok=True)
    scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
    scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('A31 Inspection World');scene.world.use_nodes=True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.12,.12,.12,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.45
    def area(name,p,energy,size):
        d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=xyz(p);o.rotation_euler=(Vector(xyz((0,-.04,-.15)))-o.location).to_track_quat('-Z','Y').to_euler()
    area('A31 inspection key',(.35,.5,.2),12,.40)
    area('A31 inspection rim',(-.4,.25,-.25),10,.35)
    area('A31 inspection fill',(.1,-.2,-.6),4,.30)
    camd=bpy.data.cameras.new('A31 inspection camera');cam=bpy.data.objects.new('A31 inspection camera',camd);scene.collection.objects.link(cam);scene.camera=cam;camd.lens=60;camd.clip_start=.005
    for name,p,target,contact in [('three-quarter',(.48,.29,.35),(0,-.06,-.16),False),('contact',(.45,.23,.33),(0,-.06,-.18),True),('contact-reverse',(-.45,.20,.33),(0,-.06,-.18),True)]:
        refs.hide_render=not contact
        cam.location=xyz(p);cam.rotation_euler=(Vector(xyz(target))-cam.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(args.render_dir/(name+'.png'));bpy.ops.render.render(write_still=True)
