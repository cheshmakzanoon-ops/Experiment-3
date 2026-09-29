"""A32 original front/rear pit jacks; Blender 5.2.2, metres, editable + GLB.

Run: blender -b --factory-startup --python scripts/author-a32-pit-jacks.py
Options after --: --output-root DIR --render-dir DIR --export-only --check-source
Four rigid parts per jack retain real pivots, four authored LODs, fourteen sockets.
No downloaded art, reference pixels, team marks or external font dependencies.
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
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
args = argparse.ArgumentParser()
args.add_argument('--output-root', type=Path, default=ROOT)
args.add_argument('--render-dir', type=Path)
args.add_argument('--export-only', action='store_true')
args.add_argument('--check-source', action='store_true')
opts = args.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = opts.output_root.resolve()
REVISION = 'aurel-a32-pit-jacks-r01'
PARTS = ('FRAME', 'LEVER', 'PAD', 'WHEELS')
SPECS = {
    'FRONT': dict(length=.50, pivot=[0,.047,0], wheelRadius=.068,
                  wheelPivot=[0,.068,-.035], width=.50, padTop=.017, padWidth=.10,
                  grip=[0,.665,-.335], gripSpacing=.29, maxAngle=.88),
    'REAR': dict(length=.48, pivot=[0,.090,0], wheelRadius=.098,
                 wheelPivot=[0,.098,-.030], width=.76, padTop=.024, padWidth=.16,
                 grip=[0,.760,-.395], gripSpacing=.34, maxAngle=.74),
}
# Linear base colours, roughness, metallic. Eight original atlas regions.
PALETTE = [((.024,.228,.202),.36,.08), ((.035,.047,.058),.40,.62),
           ((.40,.46,.49),.26,.92), ((.014,.019,.022),.80,0),
           ((.84,.36,.035),.40,0), ((.74,.81,.78),.55,0),
           ((.11,.14,.16),.50,.68), ((.047,.052,.055),.91,0)]
BLEND = OUT / 'scripts/aurel-a32-pit-jacks.blend'
GLB = OUT / 'public/models/aurel-a32-pit-jacks.glb'
MANIFEST = OUT / 'src/rendering/a32-pit-jacks.manifest.json'
for path in (BLEND, GLB, MANIFEST):
    path.parent.mkdir(parents=True, exist_ok=True)
if bpy.app.version[:3] != (5,2,2):
    raise RuntimeError('A32 authoring requires the retained Blender 5.2.2 toolchain')

def xyz(p):
    """Game +Y up, +Z insertion into car -> Blender +Z up."""
    return (p[0], -p[2], p[1])

def game(p):
    return (p[0], p[2], -p[1])

def png_bytes(pixels):
    h, w = pixels.shape[:2]
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))
    rows = b''.join(b'\0' + pixels[y].tobytes() for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',w,h,8,6,0,0,0))
            + chunk(b'IDAT', zlib.compress(rows,9)) + chunk(b'IEND',b''))

def atlas_pixels():
    y, x = np.mgrid[:256,:512]
    grain = ((x*173 + y*59 + x*y*31) % 127) / 126 - .5
    base = np.ones((256,512,4), np.uint8) * 255
    orm = base.copy(); normal = base.copy()
    for k,(colour,rough,metal) in enumerate(PALETTE):
        mask = (x//128 == k%4) & (y//128 == k//4)
        linear = np.clip(np.array(colour)[None,:]+grain[mask,None]*.004,0,1)
        srgb = np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
        base[mask,:3] = np.rint(srgb*255).astype(np.uint8)
        orm[mask,1] = np.rint(np.clip(rough+grain[mask]*.04,0,1)*255).astype(np.uint8)
        orm[mask,2] = round(metal*255)
        amp = 5 if k in (3,7) else 2
        normal[mask,0] = np.rint(128+grain[mask]*amp).astype(np.uint8)
        normal[mask,1] = np.rint(128+np.roll(grain,1,0)[mask]*amp).astype(np.uint8)
        normal[mask,2] = 255
    return {'A32_BASE':base,'A32_ORM':orm,'A32_NORMAL':normal}

if opts.check_source or opts.export_only:
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    scene = bpy.context.scene
    runtime = bpy.data.collections['A32_GAME_EXPORT']
    source = bpy.data.collections['EDITABLE_A32_COMPONENTS']
    if len(source.objects) < 100 or scene.unit_settings.scale_length != 1:
        raise RuntimeError('Incomplete editable A32 source')
    for name, pixels in atlas_pixels().items():
        image = bpy.data.images[name]
        if not image.packed_file or list(image.size) != [512,256]:
            raise RuntimeError('A32 source lost its packed image')
        # Compare packed PNG file bytes, not Blender's colour-space converted buffer.
        if bytes(image.packed_file.data) != png_bytes(pixels):
            raise RuntimeError('A32 packed source pixels differ from retained generator')
    if opts.check_source:
        print('A32_SOURCE_CHECK ' + json.dumps({'editableObjects':len(source.objects),
                                              'packedImages':3,'metres':True}))
        sys.exit(0)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    source = bpy.data.collections.new('EDITABLE_A32_COMPONENTS')
    runtime = bpy.data.collections.new('A32_GAME_EXPORT')
    scene.collection.children.link(source)
    scene.collection.children.link(runtime)
    mat = bpy.data.materials.new('A32_ORIGINAL_PBR_ATLAS')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (.06,.25,.22,1)
    images = {}
    with tempfile.TemporaryDirectory() as td:
        for name,pixels in atlas_pixels().items():
            path=Path(td)/(name+'.png'); path.write_bytes(png_bytes(pixels))
            image=bpy.data.images.load(str(path)); image.name=name
            image.colorspace_settings.name='sRGB' if name=='A32_BASE' else 'Non-Color'
            image.pack(); image.filepath='//'+name+'.png'; images[name]=image
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    def tex(name):
        n=nodes.new('ShaderNodeTexImage'); n.image=images[name]; n.interpolation='Linear'
        return n
    links.new(tex('A32_BASE').outputs['Color'],bsdf.inputs['Base Color'])
    orm=tex('A32_ORM'); sep=nodes.new('ShaderNodeSeparateColor')
    links.new(orm.outputs['Color'],sep.inputs['Color'])
    links.new(sep.outputs['Green'],bsdf.inputs['Roughness'])
    links.new(sep.outputs['Blue'],bsdf.inputs['Metallic'])
    normal=nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=.22
    links.new(tex('A32_NORMAL').outputs['Color'],normal.inputs['Color'])
    links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
    components=[]
    current=('', '', 0)
    def own(o,name,role):
        o.name=name
        for c in list(o.users_collection): c.objects.unlink(o)
        source.objects.link(o); o.data.materials.clear(); o.data.materials.append(mat)
        o['a32_material_region']=role; o['jack_role']=current[0]; o['rigid_part']=current[1]
        o['lod_level']=current[2]; components.append(o)
        return o
    def bevel(o,width,level):
        if level<3 and width>0:
            mod=o.modifiers.new('Manufactured edge radius','BEVEL')
            mod.width=width; mod.segments=[3,2,1][level]
            mod=o.modifiers.new('Area weighted highlights','WEIGHTED_NORMAL')
            mod.keep_sharp=True
        return o
    def box(name,p,size,role,edge=.003):
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p))
        o=bpy.context.object; o.dimensions=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        bevel(o,min(edge,min(size)*.2),current[2]); return own(o,name,role)
    def mesh(name,verts,faces,role,smooth=False):
        me=bpy.data.meshes.new(name); me.from_pydata([xyz(p) for p in verts],[],faces); me.update()
        o=bpy.data.objects.new(name,me); source.objects.link(o)
        # Winding is checked per closed mechanical component before custom normals.
        import bmesh
        bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(me); bm.free()
        if smooth:
            for p in me.polygons: p.use_smooth=True
        return own(o,name,role)
    def rod(name,a,b,r,role,segments=None):
        av,bv=Vector(xyz(a)),Vector(xyz(b)); length=(bv-av).length
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.mesh.primitive_cylinder_add(vertices=segments or [20,12,8,6][current[2]],
                                           radius=r,depth=length,location=(av+bv)*.5)
        o=bpy.context.object; o.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler()
        for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
        bevel(o,min(.002,r*.12),current[2]); return own(o,name,role)
    def plate(name,profile,x,w,role):
        n=len(profile); verts=[(xx,y,z) for xx in (x-w/2,x+w/2) for y,z in profile]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        return bevel(mesh(name,verts,faces,role),.002,current[2])
    def wheel(x,r,w):
        n=[48,24,14,8][current[2]]
        profile=[(-w/2,.033),(-w/2,r*.84),(-w*.36,r*.98),(-w*.20,r),
                 (w*.20,r),(w*.36,r*.98),(w/2,r*.84),(w/2,.033)]
        verts=[(x+ax,math.cos(i*math.tau/n)*rad,math.sin(i*math.tau/n)*rad)
               for ax,rad in profile for i in range(n)]
        faces=[(k*n+i,k*n+(i+1)%n,((k+1)%len(profile))*n+(i+1)%n,
                ((k+1)%len(profile))*n+i) for k in range(len(profile)) for i in range(n)]
        return mesh('Rounded polyurethane load wheel',verts,faces,3,True)
    def label(body,p,size):
        c=bpy.data.curves.new('Original equipment label','FONT'); c.body=body
        c.size=size; c.align_x='CENTER'; c.align_y='CENTER'; c.extrude=.00025; c.resolution_u=2
        o=bpy.data.objects.new(body,c); source.objects.link(o); o.location=xyz(p)
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH'); return own(bpy.context.object,body,5)

    for end,s in SPECS.items():
        front=end=='FRONT'; width=s['width']; L=s['length']; py=s['pivot'][1]
        for level in range(4):
            current=(end,'FRAME',level)
            for side in (-1,1):
                x=side*width*.33
                profile=[(.028,-.185),(.075 if front else .123,-.13),
                         (.086 if front else .138,.028),(.048,.225),(.021,.225),(.021,-.185)]
                plate('Formed side cheek',profile,x,.019,0)
                rod('Low outrigger rail',(x,.029,-.16),(x,.029,.20),.014,2)
                box('Axle carrier',(side*width*.37,s['wheelRadius'],s['wheelPivot'][2]),(.07,.052,.072),1)
                rod('Pivot collar',(side*.125,py,0),(side*.149,py,0),.029,2)
                box('Ground wear slider',(x,.014,.19),(.045,.026,.066),3,.004)
                if level<2:
                    for z in (-.135,.10,.185):
                        rod('Frame fixing',(x-.014,.041,z),(x+.014,.041,z),.008,2,6)
                if not front:
                    rod('Rear load brace',(x,.028,.20),(side*.08,.12,-.03),.014,6)
            rod('Through pivot',(-.153,py,0),(.153,py,0),.019,1)
            rod('Wheel axle',(-width/2,s['wheelRadius'],s['wheelPivot'][2]),
                (width/2,s['wheelRadius'],s['wheelPivot'][2]),.017,2)
            box('Front cross bridge' if front else 'Wide rear cross bridge',(0,.034,-.13),
                (width*.7,.028,.092),0)
            box('Identification inset',(0,.050,-.13),(.15,.008,.051),1,.001)
            if level<2: label('A32-F' if front else 'A32-R',(0,.055,-.13),.024)
            if front: box('Thin insertion spine',(0,.031,.13),(.045,.024,.22),6)
            current=(end,'LEVER',level)
            rod('Load rocker',(-.122,0,0),(.122,0,0),.024,2)
            for side in (-1,1):
                x=side*(.061 if front else .08)
                # Lowered blade stays above the front wing and below the nose.
                profile=[(-.012,-.028),(.020,.01),(.010,L-.075),(.008,L+.016),
                         (-.005,L+.016),(-.010,L-.075)]
                plate('Tapered lifting fork',profile,x,.017,2)
                if not front: rod('Rear fork stiffener',(x,.011,.02),(x,.019,L-.06),.012,0)
            rod('Saddle hinge',(-s['padWidth']*.62,0,L),(s['padWidth']*.62,0,L),.012,1)
            grip=s['grip']
            chain=[(0,0,-.035),(0,.21,-.10),(0,.40 if front else .47,-.235),grip]
            for a,b in zip(chain,chain[1:]): rod('Bent alloy operating lever',a,b,.019 if front else .024,0)
            if level<3:
                for side in (-1,1):
                    rod('Handle load gusset',(side*.09,0,-.01),(0,.21,-.10),.011,6)
            half=s['gripSpacing']/2
            rod('T bar',(-half-.065,grip[1],grip[2]),(half+.065,grip[1],grip[2]),.016,2)
            for side in (-1,1):
                rod('Moulded grip',(side*half-.063,grip[1],grip[2]),
                    (side*half+.063,grip[1],grip[2]),.026,7)
                rod('Safety end cap',(side*(half+.066),grip[1],grip[2]),
                    (side*(half+.073),grip[1],grip[2]),.027,4)
                if level==0:
                    for j in range(7):
                        xx=side*half+(j-3)*.015
                        rod('Grip moulding ribs',(xx-.0015,grip[1],grip[2]),
                            (xx+.0015,grip[1],grip[2]),.0275,3,16)
            if level<2:
                box('Quick release paddle',(.049,grip[1]-.074,grip[2]+.015),(.068,.014,.033),4)
                rod('Release linkage',(.034,.05,-.025),(.043,grip[1]-.08,grip[2]),.004,1,8)
            current=(end,'PAD',level)
            box('Replaceable saddle carrier',(0,-.005,0),(s['padWidth']+.03,.024,.070),2)
            box('Dense contact pad',(0,s['padTop']/2,0),(s['padWidth'],s['padTop'],.05),3,.004)
            for side in (-1,1):
                box('Saddle retainer',(side*(s['padWidth']/2+.008),.002,0),(.010,.023,.048),6)
                if level<2:
                    rod('Retainer pin',(side*(s['padWidth']/2+.014),-.004,-.017),
                        (side*(s['padWidth']/2+.014),-.004,.017),.006,1,8)
            current=(end,'WHEELS',level)
            r=s['wheelRadius']; w=.047 if front else .063
            for side in (-1,1):
                x=side*width/2; wheel(x,r,w)
                rod('Recessed alloy wheel hub',(x-w*.44,0,0),(x+w*.44,0,0),r*.51,2)
                rod('Axle safety cap',(x+side*w*.47,0,0),(x+side*w*.59,0,0),.020,4)
                if level<2:
                    for i in range(6):
                        yy,zz=math.cos(i*math.tau/6)*r*.33,math.sin(i*math.tau/6)*r*.33
                        rod('Hub fixing',(x+side*w*.46,yy,zz),(x+side*w*.5,yy,zz),.004,1,6)

    def empty(name,parent,p=(0,0,0),**props):
        o=bpy.data.objects.new(name,None); runtime.objects.link(o); o.parent=parent; o.location=xyz(p)
        for k,v in props.items(): o[k]=v
        return o
    family=empty('A32_PIT_JACKS',None,asset_id='A32',revision=REVISION,collision='none')
    deps=bpy.context.evaluated_depsgraph_get()
    for end,s in SPECS.items():
        root=empty('A32_'+end+'_ROOT',family,(-.65 if end=='FRONT' else .65,0,0),jack_role=end.lower())
        pivots={}
        for part in PARTS:
            parent=pivots['LEVER'] if part=='PAD' else root
            pos=s['pivot'] if part=='LEVER' else s['wheelPivot'] if part=='WHEELS' else (0,0,s['length']) if part=='PAD' else (0,0,0)
            pivots[part]=empty(f'A32_{end}_{part}_PIVOT',parent,pos,rigid_part=part)
        for level in range(4):
            for part in PARTS:
                verts=[]; faces=[]; normals=[]; uvs=[]
                for o in [p for p in components if p['jack_role']==end and p['rigid_part']==part and p['lod_level']==level]:
                    ev=o.evaluated_get(deps); me=ev.to_mesh(); me.calc_loop_triangles()
                    transform=o.matrix_world; normalmat=transform.to_3x3().inverted().transposed()
                    region=o['a32_material_region']; col,row=region%4,region//4
                    for tri in me.loop_triangles:
                        start=len(verts)
                        for li in tri.loops:
                            v=transform@me.vertices[me.loops[li].vertex_index].co
                            n=(normalmat@me.corner_normals[li].vector).normalized()
                            g=game(v); ng=game(n); dominant=max(range(3),key=lambda k:abs(ng[k]))
                            axes=[i for i in range(3) if i!=dominant]
                            u=.12+.76*min(.98,max(.02,g[axes[0]]/2.4+.5))
                            vtex=.12+.76*min(.98,max(.02,g[axes[1]]/2.4+.5))
                            verts.append(tuple(v)); normals.append(tuple(n))
                            uvs.append(((col+u)/4,1-(row+vtex)/2))
                        faces.append((start,start+1,start+2))
                    ev.to_mesh_clear()
                name=f'A32_{end}_{part}_LOD{level}'
                # Weld positions without losing per-corner split normals or atlas seams.
                # A triangle-soup export otherwise repeats the same GLB vertices.
                unique=[]; remap=[]; seen={}
                for index,v in enumerate(verts):
                    key=(*v,*normals[index],*uvs[index])
                    if key not in seen:
                        seen[key]=len(unique); unique.append(v)
                    remap.append(seen[key])
                faces=[tuple(remap[i] for i in face) for face in faces]
                me=bpy.data.meshes.new(name); me.from_pydata(unique,[],faces); me.update()
                for poly in me.polygons: poly.use_smooth=True
                me.validate(clean_customdata=False)
                if len(me.loops) != len(normals):
                    raise RuntimeError(f'Degenerate A32 geometry: {name}')
                me.normals_split_custom_set(normals)
                uv=me.uv_layers.new(name='UVMap')
                for i,co in enumerate(uvs): uv.data[i].uv=co
                obj=bpy.data.objects.new(name,me); runtime.objects.link(obj); obj.parent=pivots[part]
                obj.data.materials.append(mat); obj['asset_id']='A32'; obj['lod_level']=level
                obj['rigid_part']=part; obj['jack_role']=end.lower()
        empty(f'SOCKET_A32_{end}_CONTACT',pivots['PAD'],(0,s['padTop'],0),interaction='car_contact')
        for side in (-1,1):
            empty(f'SOCKET_A32_{end}_GRIP_'+('L' if side<0 else 'R'),pivots['LEVER'],
                  (side*s['gripSpacing']/2,s['grip'][1],s['grip'][2]),interaction='operator_hand')
        empty(f'SOCKET_A32_{end}_GROUND',pivots['FRAME'],interaction='ground')
        for side in (-1,1):
            empty(f'SOCKET_A32_{end}_WHEEL_'+('L' if side<0 else 'R')+'_GROUND',pivots['FRAME'],
                  (side*s['width']/2,0,s['wheelPivot'][2]),interaction='wheel_ground')
        empty(f'SOCKET_A32_{end}_STOW',pivots['FRAME'],interaction='staging')
    source.hide_render=True; source.hide_viewport=True

# Export all four levels. Blender source visibility is not the runtime LOD policy.
for obj in runtime.objects:
    obj.hide_set(False); obj.hide_render=False
    if obj.name.endswith('LEVER_PIVOT') or obj.name.endswith('PAD_PIVOT'):
        obj.rotation_euler=(0,0,0)
bpy.ops.object.select_all(action='DESELECT')
for obj in runtime.objects: obj.select_set(True)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,
                          export_yup=True,export_extras=True,export_animations=False,
                          export_cameras=False,export_lights=False,export_tangents=True,
                          export_materials='EXPORT')
raw=GLB.read_bytes(); size=struct.unpack_from('<I',raw,12)[0]; doc=json.loads(raw[20:20+size])
triangles={end.lower():{} for end in SPECS}
bounds={}
for end in SPECS:
    root=bpy.data.objects[f'A32_{end}_ROOT']; inv=root.matrix_world.inverted(); pts=[]
    for level in range(4):
        names={f'A32_{end}_{part}_LOD{level}' for part in PARTS}
        triangles[end.lower()][str(level)]=sum(
            doc['accessors'][p['indices']]['count']//3
            for node in doc['nodes'] if node.get('name') in names
            for p in doc['meshes'][node['mesh']]['primitives'])
        if level==0:
            for name in names:
                ob=bpy.data.objects[name]; t=inv@ob.matrix_world
                pts += [game(t@Vector(co)) for co in ob.bound_box]
    bounds[end.lower()]={'min':[min(p[i] for p in pts) for i in range(3)],
                         'max':[max(p[i] for p in pts) for i in range(3)]}
    counts=list(triangles[end.lower()].values())
    if counts[0]>24000 or any(a<=b for a,b in zip(counts,counts[1:])):
        raise RuntimeError(f'A32 LOD budget or ordering failure: {end} {counts}')
if len(raw)>8_000_000: raise RuntimeError('A32 export exceeded 8 MB budget')
for ob in runtime.objects:
    if ob.type=='MESH': ob.hide_render=ob.get('lod_level',0)>0; ob.hide_set(ob.hide_render)
if not opts.export_only:
    # Studio objects never enter the GLB. The retained source opens on a legible LOD0 pair.
    studio=bpy.data.collections.new('A32_STUDIO_NO_EXPORT'); scene.collection.children.link(studio)
    def studio_own(ob):
        for col in list(ob.users_collection): col.objects.unlink(ob)
        studio.objects.link(ob)
    scene.world=bpy.data.worlds.new('Neutral inspection world'); scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background'); bg.inputs[0].default_value=(.11,.13,.15,1)
    bg.inputs[1].default_value=.35
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001)); floor=bpy.context.object
    floor.name='Studio ground (not exported)'; studio_own(floor)
    fm=bpy.data.materials.new('Studio floor'); fm.diffuse_color=(.105,.122,.133,1); fm.use_nodes=True
    fm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.105,.122,.133,1)
    fm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.68
    floor.data.materials.append(fm)
    bpy.ops.object.camera_add(location=xyz((2.65,2.05,-3.2))); cam=bpy.context.object; studio_own(cam)
    cam.name='A32 inspection camera'; cam.rotation_euler=(Vector(xyz((0,.34,.0)))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO'; cam.data.ortho_scale=2.70; scene.camera=cam
    for name,p,power,area in [('Key',(-2.3,3,-2),850,3),('Fill',(2.2,1.9,.8),520,2.5),('Rim',(0,2.1,2.4),650,2)]:
        data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=area
        ob=bpy.data.objects.new(name,data); studio.objects.link(ob); ob.location=xyz(p)
        ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine='CYCLES'; scene.cycles.samples=40; scene.cycles.use_denoising=True
    scene.render.resolution_x=1500; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND),compress=True)
manifest={'schema':1,'assetId':'A32','revision':REVISION,'author':'scripts/author-a32-pit-jacks.py',
          'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'editable':'scripts/aurel-a32-pit-jacks.blend','url':'models/aurel-a32-pit-jacks.glb',
          'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,
          'bounds':bounds,'kinematics':{k.lower():v for k,v in SPECS.items()},'parts':list(PARTS),
          'lods':4,'materials':len(doc['materials']),'images':len(doc.get('images',[])),
          'nodes':len(doc['nodes']),'meshes':len(doc['meshes']),
          'textureSize':[512,256],'textureRGBABytes':512*256*4*3,'socketCount':14,
          'collision':'none','variation':'fixed original atlas; no random runtime changes',
          'finalArtApproved':False}
MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n')
print('A32_RECEIPT '+json.dumps(manifest))
if opts.render_dir:
    opts.render_dir.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(opts.render_dir/'a32-jack-pair.png'); bpy.ops.render.render(write_still=True)
    for end in SPECS:
        bpy.data.objects[f'A32_{end}_LEVER_PIVOT'].rotation_euler.x=-.36
        bpy.data.objects[f'A32_{end}_PAD_PIVOT'].rotation_euler.x=.36
    scene.render.filepath=str(opts.render_dir/'a32-jack-pair-raised.png'); bpy.ops.render.render(write_still=True)
