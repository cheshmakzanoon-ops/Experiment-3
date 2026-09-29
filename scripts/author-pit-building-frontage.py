"""A21 original Aurel Race Operations frontage. Blender 5.2.2 LTS / Node 22.
Four architectural chunks inherit the game's Track.at datums. Editable pieces
and three material-batched LODs. No downloaded art or baked-in movable props.
"""
import bpy
import bmesh
import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path
from mathutils import Matrix, Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-pit-building-r01'
result = subprocess.run(['node', '--experimental-transform-types', '--input-type=module', '-e',
    "import {Track} from './src/simulation/track.ts';"
    "import {pitBuildingLayout} from './src/rendering/pit-building-layout.ts';"
    "console.log(JSON.stringify(pitBuildingLayout(new Track())));"],
    cwd=ROOT, capture_output=True, text=True, check=True)
layout = json.loads(result.stdout)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
source = bpy.data.collections.new('EDITABLE_A21_COMPONENTS')
scene.collection.children.link(source)
runtime = bpy.data.collections.new('A21_GAME_EXPORT')
scene.collection.children.link(runtime)
parts, mats, sockets, occluders = [], {}, {}, {}
chunk_id, bay_pose = 'A', (0, 0, 0, 0)

def xyz(p):
    return (p[0], -p[2], p[1])

def mat(name, color, metallic=0, rough=0.5, emission=0):
    m = bpy.data.materials.new('A21_' + name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    mats[name] = m
    return m

concrete = mat('ArchitecturalConcrete', (0.36, 0.40, 0.39), rough=0.84)
ceramic = mat('CeramicCladding', (0.70, 0.75, 0.71), 0.12, 0.40)
steel = mat('AnodizedSteel', (0.023, 0.048, 0.056), 0.68, 0.34)
alloy = mat('BrushedAlloy', (0.41, 0.49, 0.50), 0.78, 0.31)
glass = mat('SmokedGlazing', (0.038, 0.088, 0.10), 0.28, 0.19)
interior = mat('DarkInterior', (0.025, 0.042, 0.039), rough=0.88)
teal = mat('TeamEnamel', (0.022, 0.25, 0.225), 0.26, 0.38)
roof = mat('RoofMembrane', (0.11, 0.15, 0.145), rough=0.90)
light = mat('LightDiffuser', (0.62, 0.79, 0.77), rough=0.50, emission=0.55)

# Original aggregate and broad casting mottles. No baked light or photographs.
n = 256
rng = np.random.default_rng(2101)
yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
noise = rng.uniform(-1, 1, (n, n)).astype(np.float32)
fine = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1)) / 3
mottle = (np.sin(xx*math.tau*3 + np.cos(yy*math.tau*2))*.024
          + np.cos(yy*math.tau*5 + xx*math.tau)*.014 + fine*.018)
normal = np.ones((n,n,4),dtype=np.float32)
normal[:,:,0] = .5 + (np.roll(fine,1,1)-fine)*.045
normal[:,:,1] = .5 + (np.roll(fine,1,0)-fine)*.045
normal[:,:,2] = .999
roughmap = np.ones((n,n,4),dtype=np.float32)
roughmap[:,:,:3] = (.79 + mottle*.8)[:,:,None]
color = np.ones((n,n,4),dtype=np.float32)
color[:,:,:3] = np.clip(.74 + mottle,0,1)[:,:,None]
images = {}
for name, pixels in [('MicroNormal',normal),('CastingRoughness',roughmap),('CastingAlbedo',color)]:
    image=bpy.data.images.new('A21_original_'+name,width=n,height=n,alpha=True)
    image.colorspace_settings.name = 'Non-Color' if name!='CastingAlbedo' else 'sRGB'
    image.pixels.foreach_set(pixels.ravel()); image.pack(); images[name]=image
for m in [concrete,ceramic,steel,alloy,teal]:
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tex=nodes.new('ShaderNodeTexImage'); tex.image=images['MicroNormal']; tex.extension='REPEAT'
    norm=nodes.new('ShaderNodeNormalMap'); norm.inputs['Strength'].default_value=.28
    p=nodes.get('Principled BSDF')
    links.new(tex.outputs['Color'],norm.inputs['Color']); links.new(norm.outputs['Normal'],p.inputs['Normal'])
nodes,links=concrete.node_tree.nodes,concrete.node_tree.links
p=nodes.get('Principled BSDF')
for name,socket in [('CastingAlbedo','Base Color'),('CastingRoughness','Roughness')]:
    tex=nodes.new('ShaderNodeTexImage');tex.image=images[name];tex.extension='REPEAT'
    links.new(tex.outputs['Color'],p.inputs[socket])

def transformed(p):
    x,y,z,a=bay_pose; c,s=math.cos(a),math.sin(a)
    return (x+c*p[0]+s*p[2], y+p[1], z-s*p[0]+c*p[2])

def own(o,name,material,tier=0):
    o.name='A21_'+chunk_id+'_'+name
    for c in list(o.users_collection):c.objects.unlink(o)
    source.objects.link(o);o.data.materials.clear();o.data.materials.append(material)
    o['A21_chunk']=chunk_id;o['detail_tier']=tier;o['source_component']=name
    x,y,z,a=bay_pose
    o.matrix_world=Matrix.Translation(xyz((x,y,z))) @ Matrix.Rotation(a,4,'Z') @ o.matrix_world
    parts.append(o);return o

def box(name,p,size,m,bevel=.015,tier=0):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=min(bevel,min(size)*.22);mod.segments=2
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return own(o,name,m,tier)

def tube(name,ps,r,m,tier=1):
    bpy.ops.object.select_all(action='DESELECT')
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1
    c.bevel_depth=r;c.bevel_resolution=0
    spline=c.splines.new('POLY');spline.points.add(len(ps)-1)
    for v,p in zip(spline.points,ps):v.co=(*xyz(p),1)
    o=bpy.data.objects.new(name,c);source.objects.link(o);o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');return own(bpy.context.object,name,m,tier)

def profile(name,section,zmin,zmax,m,tier=0):
    vs=[xyz((x,y,z)) for z in [zmin,zmax] for x,y in section]
    k=len(section);faces=[tuple(reversed(range(k))),tuple(range(k,2*k))]
    faces += [(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    o=bpy.data.objects.new(name,mesh);source.objects.link(o);return own(o,name,m,tier)

def text(name,words,p,size,m=ceramic,tier=1):
    bpy.ops.object.select_all(action='DESELECT')
    c=bpy.data.curves.new(name,'FONT');c.body=words;c.size=size;c.align_x='CENTER'
    c.extrude=.002;c.resolution_u=2
    o=bpy.data.objects.new(name,c);source.objects.link(o);o.location=xyz(p)
    o.rotation_euler=(math.pi/2,0,-math.pi/2)
    o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');return own(bpy.context.object,name,m,tier)

def socket(name,p):
    sockets[name]={'chunk':chunk_id,'position':list(transformed(p))}

def solid(name,p,size):
    occluders.setdefault(chunk_id,[]).append({'name':name,'position':list(transformed(p)),
                                              'size':list(size),'yaw':bay_pose[3]})

for chunk in layout:
    chunk_id=chunk['id']
    for j,bay in enumerate(chunk['bays']):
        bay_pose=(bay['x'],bay['y'],bay['z'],bay['yaw'])
        index=bay['index'];num=str(index+1).zfill(2)
        # Lower piers remain on party-wall edges. Nothing crosses A22's entrance.
        for z in [-4.39,4.39]:
            box('Portal pier '+num,(-6.97,3.58,z),(.27,7.28,.22),concrete,.025)
            box('Pier base '+num,(-6.97,-.46,z),(.43,1.06,.38),concrete,.02)
            box('Anodized pier reveal',(-7.125,3.52,z),(.025,7.02,.065),steel,.003,1)
            box('Upper support blade',(-5.9,7.12,z),(.23,1.36,.25),steel,.01)
            # Rear columns connect the new gallery to the same permanent plinth;
            # the additional storey must not read as floating above old roof plant.
            box('Rear gallery pier '+num,(6.87,3.37,z),(.27,8.40,.27),concrete,.025)
            box('Rear pier foot '+num,(6.87,-.54,z),(.47,1.18,.47),concrete,.02)
            box('Rear support cap',(6.87,7.52,z),(.46,.20,.41),steel,.02)

        box('Spandrel eyebrow '+num,(-7.02,4.05,0),(.35,.16,8.77),ceramic,.03)
        box('Deep upper sill',(-7.04,4.18,0),(.56,.10,8.76),steel,.018)
        box('Recess shade',(-7.24,5.95,0),(.70,.11,8.86),ceramic,.025)
        for z in [-3.53,-1.76,0,1.76,3.53]:
            box('Existing-storey shading fin',(-7.15,5.08,z),(.42,1.64,.065),alloy,.006,1)
        # Floor is above the retained roof machinery, not intersecting it.
        floor_y=7.72;h={'A':2.45,'B':2.85,'C':2.65,'D':2.45}[chunk_id];top=floor_y+h
        box('Raised gallery slab',(.10,floor_y,0),(14.80,.26,8.94),concrete,.035)
        solid('Gallery slab '+num,(.10,floor_y,0),(14.8,.26,8.94))
        box('Roof deck',(.2,top+.07,0),(14.88,.22,8.94),ceramic,.03)
        box('Roof membrane',(.35,top+.195,0),(14.55,.03,8.68),roof,.008)
        box('Rear gallery wall',(7.44,floor_y+h/2,0),(.21,h,8.91),concrete,.025)
        solid('Rear gallery '+num,(7.44,floor_y+h/2,0),(.21,h,8.91))
        box('Upper rear ribbon window',(7.57,floor_y+1.36,0),(.035,.89,7.6),glass,.007)
        for z in [-3.8,0,3.8]:box('Rear ribbon mullion',(7.60,floor_y+1.36,z),(.09,1.0,.065),alloy,.006,1)
        # Sorting-safe opaque tinted reflectance. Surrounding reveals give real
        # parallax; no claim of transmissive glass or baked fake interiors.
        for z in [-3.69,-2.215,-.74,.74,2.215,3.69]:
            box('Recessed gallery pane',(-6.30,floor_y+h*.51,z),(.065,h-.42,1.40),glass,.006)
            box('Glazing vertical extrusion',(-6.40,floor_y+h*.50,z-.725),(.20,h-.10,.055),alloy,.005,1)
            box('Glazing seal',(-6.42,floor_y+h*.50,z-.76),(.023,h-.15,.018),steel,.002,2)
        for y in [floor_y+.16,top-.11]:box('Glazing continuous transom',(-6.43,y,0),(.20,.085,8.85),alloy,.008,1)
        box('Gallery recess backing',(-5.92,floor_y+.60,0),(.14,1.00,8.85),interior,.01)
        box('Gallery external walkway',(-7.14,floor_y+.17,0),(1.62,.12,8.93),steel,.018)
        box('Balcony fascia',(-7.94,floor_y+.11,0),(.11,.37,8.93),teal,.016)
        if chunk_id in ['B','C']:
            for z in [-4.25,-2.12,0,2.12,4.25]:
                box('Balustrade stanchion',(-7.88,floor_y+.75,z),(.065,1.15,.065),alloy,.007,1)
            for y in [floor_y+.47,floor_y+.78,floor_y+1.21]:
                box('Balustrade rail',(-7.88,y,0),(.055,.045,8.90),alloy,.007,1)
            for z in [-3.16,-1.05,1.05,3.16]:
                box('Balustrade infill panel',(-7.865,floor_y+.76,z),(.03,.63,2.02),glass,.006,1)
        else:box('Solid gallery edge',(-7.90,floor_y+.64,0),(.11,.92,8.90),ceramic,.018)
        profile('Swept gallery canopy',[(-8.42,top+.05),(-8.52,top+.18),(-8.14,top+.43),
            (-5.58,top+.45),(-5.22,top+.26),(-5.22,top+.14),(-7.98,top+.20)],-4.47,4.47,ceramic)
        box('Canopy shadow reveal',(-8.32,top+.075,0),(.13,.065,8.93),steel,.009)
        box('Canopy teal edge',(-8.44,top+.225,0),(.065,.065,8.90),teal,.009,1)
        for z in [-3.9,-1.95,0,1.95,3.9]:
            tube('Canopy tapered bracket',[(-6.39,top-.56,z),(-7.47,top-.07,z),(-8.02,top+.05,z)],.037,steel,1)
        for x in [-7.86,-7.24,-6.69]:box('Canopy soffit seam',(x,top+.06,0),(.025,.025,8.80),steel,0,2)
        box('Recessed soffit luminaire',(-6.92,top+.035,0),(.07,.02,6.3),light,.004,1)
        for x in [-5.2,7.55]:box('Roof coping',(x,top+.31,0),(.18,.22,8.93),alloy,.01)
        for z in [-4.38,4.38]:box('Coping expansion joint',(.4,top+.33,z),(14.25,.075,.045),steel,.004,1)
        box('Downpipe',(-6.75,3.2,4.31),(.10,6.15,.09),alloy,.012,1)
        for y in [.50,2.10,4.10,5.9]:box('Downpipe clip',(-6.75,y,4.34),(.16,.05,.14),steel,.004,2)
        if index in [0,3,6,9]:
            word={'A':'SERVICE / 01','B':'AUREL / RACE OPERATIONS','C':'PADDOCK CLUB','D':'ENGINEERING / 04'}[chunk_id]
            box('Raised section identity',(-6.6,top-.49,0),(.16,.51,8.4),teal,.03,1)
            text('Section identity',word,(-6.70,top-.60,0),.22 if chunk_id=='B' else .30)
        socket('SOCKET_BAY_'+num,(0,0,0));socket('SOCKET_SIGN_'+num,(-6.83,3.68,0))
        socket('SOCKET_SERVICE_RIG_'+num,(0,3.25,0))
    mid=chunk['bays'][1];bay_pose=(mid['x'],mid['y'],mid['z'],mid['yaw'])
    socket('SOCKET_ROOF_SERVICE_'+chunk_id,(2,8.0,0))
    if chunk_id=='B':socket('SOCKET_A22_HERO_INTERFACE',(-6.8,3.0,0))
    if chunk_id in ['A','D']:
        end=chunk['bays'][0 if chunk_id=='A' else 2];bay_pose=(end['x'],end['y'],end['z'],end['yaw'])
        z=-4.5 if chunk_id=='A' else 4.5;direction=-1 if chunk_id=='A' else 1
        box('End service stair enclosure',(4.95,5.15,z+direction*.67),(5.05,10.5,1.40),concrete,.08)
        solid('End core',(4.95,5.15,z+direction*.67),(5.05,10.5,1.40))
        box('End core coping',(4.90,10.52,z+direction*.67),(5.28,.18,1.62),alloy,.035)
        box('Vertical stair light well',(3.2,5.9,z+direction*1.39),(1.04,7.70,.065),glass,.016)
        for y in [2.4,4.7,7.0,9.3]:box('Stair landing edge',(3.2,y,z+direction*1.43),(1.20,.18,.16),alloy,.02,1)
        for y in [1,2,3,4,5,6,7,8,9]:box('Core construction joint',(4.9,y,z+direction*1.38),(4.95,.028,.04),steel,.002,1)
        box('Rear core access door',(7.51,1.15,z+direction*.67),(.06,2.21,1.03),steel,.01,1)
        socket('SOCKET_REAR_LOADING_'+chunk_id,(8.1,0,z+direction*.6))
        box('End core base',(4.95,-.5,z+direction*.67),(5.24,1.15,1.58),concrete,.02)

# Evaluate modifiers once. Building runtime arrays directly avoids thousands of
# context-sensitive object operations and keeps join order stable across hosts.
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
cached = {}
for original in parts:
    evaluated = original.evaluated_get(depsgraph)
    for high in [False, True]:
        data = evaluated.to_mesh() if high else original.data
        data.calc_loop_triangles()
        matrix = original.matrix_world
        normal_matrix = matrix.to_3x3().inverted().transposed()
        vertices = [matrix @ v.co for v in data.vertices]
        triangles = [tuple(t.vertices) for t in data.loop_triangles]
        normals = [tuple((normal_matrix @ data.corner_normals[li].vector).normalized())
                   for t in data.loop_triangles for li in t.loops]
        # Planar metre-scaled UVs follow each triangle's dominant face normal.
        uvs=[]
        for t in data.loop_triangles:
            normal=normal_matrix @ t.normal
            axis=max(range(3),key=lambda i:abs(normal[i]))
            axes=[i for i in range(3) if i!=axis]
            for vi in t.vertices:
                co=vertices[vi];uvs.append((co[axes[0]]/.8,co[axes[1]]/.8))
        cached[(original.name,high)]=(vertices,triangles,normals,uvs)
        if high:evaluated.to_mesh_clear()
root=bpy.data.objects.new('AUREL_PIT_BUILDING_A21',None);runtime.objects.link(root)
for chunk in layout:
    cid=chunk['id'];cr=bpy.data.objects.new('A21_CHUNK_'+cid,None);runtime.objects.link(cr);cr.parent=root
    for level in range(3):
        lr=bpy.data.objects.new(f'A21_{cid}_LOD{level}',None);runtime.objects.link(lr);lr.parent=cr
        bins={}
        for original in parts:
            if original['A21_chunk']!=cid or original['detail_tier']>2-level:continue
            name=original.data.materials[0].name
            vs,fs,ns,uvs=bins.setdefault(name,([],[],[],[]))
            v,f,n,u=cached[(original.name,level==0)]
            offset=len(vs);vs.extend(v);fs.extend(tuple(i+offset for i in tri) for tri in f);ns.extend(n);uvs.extend(u)
        for name,(vs,fs,ns,uvs) in sorted(bins.items()):
            data=bpy.data.meshes.new(f'A21_{cid}_L{level}_{name}')
            data.from_pydata(vs,[],fs);data.update()
            for polygon in data.polygons:polygon.use_smooth=True
            data.normals_split_custom_set(ns)
            uv=data.uv_layers.new(name='UVMap')
            uv.data.foreach_set('uv',np.asarray(uvs,dtype=np.float32).ravel())
            data.materials.append(bpy.data.materials[name])
            batch=bpy.data.objects.new(data.name,data);runtime.objects.link(batch);batch.parent=lr
    for name,info in sockets.items():
        if info['chunk']!=cid:continue
        e=bpy.data.objects.new(name,None);e.location=xyz(info['position']);e.parent=cr
        e.empty_display_type='ARROWS';e.empty_display_size=.35;e['purpose']='placement only';runtime.objects.link(e)
    cr['A21_station']=chunk['station']
source.hide_render=True;source.hide_viewport=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
out=ROOT/'public/models/aurel-hero-pit-building-frontage.glb';out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
    export_yup=True,export_extras=True,export_cameras=False,export_lights=False,
    export_animations=False,export_materials='EXPORT')
raw=out.read_bytes();ln=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+ln]);acc=doc['accessors']
counts={};bounds={}
for chunk in layout:
    cid=chunk['id'];counts[cid]=[]
    for level in range(3):
        nodes=[v for v in doc['nodes'] if v.get('name','').startswith(f'A21_{cid}_L{level}_')]
        counts[cid].append(sum(acc[p['indices']]['count']//3 for v in nodes for p in doc['meshes'][v['mesh']]['primitives']))
    objects=[o for o in runtime.objects if o.name.startswith(f'A21_{cid}_L0_')]
    vertices=[o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
    game=[(p.x,p.z,-p.y) for p in vertices]
    bounds[cid]={'min':[math.floor(min(p[i] for p in game)*100)/100-.01 for i in range(3)],
                 'max':[math.ceil(max(p[i] for p in game)*100)/100+.01 for i in range(3)]}
totals=[sum(v[i] for v in counts.values()) for i in range(3)]
assert all(t<=b for t,b in zip(totals,[140000,55000,10000])),totals
assert len(raw)<=12*1024*1024,len(raw)
assert len(doc['materials'])<=9
receipt={'assetId':'A21','revision':REVISION,'author':'scripts/author-pit-building-frontage.py',
    'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'layoutSourceSHA256':hashlib.sha256((ROOT/'src/rendering/pit-building-layout.ts').read_bytes()).hexdigest(),
    'editable':'scripts/aurel-hero-pit-building-frontage.blend','url':'models/aurel-hero-pit-building-frontage.glb',
    'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':totals,'chunkTriangles':counts,
    'materials':len(doc['materials']),'images':len(doc.get('images',[])),
    'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),'layout':layout,'bounds':bounds,
    'sockets':sockets,'occluders':occluders,'finalArtApproved':False}
(ROOT/'src/rendering/pit-building-frontage.manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
# Useful assembled near-origin Blender preview, assigned AFTER export.
for chunk in layout:
    cr=bpy.data.objects.get('A21_CHUNK_'+chunk['id']);cr.location=xyz((0,chunk['y']-layout[1]['y'],chunk['station']-106))
for o in runtime.objects:
    if '_L1_' in o.name or '_L2_' in o.name:o.hide_set(True);o.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-hero-pit-building-frontage.blend'),compress=True)
print('A21_RECEIPT '+json.dumps({'triangles':totals,'bytes':len(raw),'sha256':receipt['sha256'],'bounds':bounds}))
