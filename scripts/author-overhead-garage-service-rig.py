"""A26: original overhead workshop services, authored in Blender 5.2.2 LTS.
Run: blender -b --factory-startup --python scripts/author-overhead-garage-service-rig.py
A22 remains byte-for-byte unchanged. Coordinates below are game X/depth,Y/up,Z/width.
Source parts and hose curves are retained separately from material-batched game LODs.
"""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-overhead-service-rig-r01'
if bpy.app.version[:3] != (5, 2, 2):
    raise RuntimeError('A26 export requires pinned Blender 5.2.2')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
source = bpy.data.collections.new('A26_EDITABLE_COMPONENTS')
scene.collection.children.link(source)
runtime = bpy.data.collections.new('A26_GAME_EXPORT')
scene.collection.children.link(runtime)
guides = bpy.data.collections.new('A26_REFERENCE_GUIDES')
scene.collection.children.link(guides)
parts = []
materials = {}
serial = 0

def xyz(p):
    return (p[0], -p[2], p[1])

def material(name, color, metal, rough, emission=0):
    m = bpy.data.materials.new('A26_' + name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    materials[m.name] = m
    return m

frame = material('PowderCoat', (.035, .058, .066), .45, .41)
alloy = material('BrushedAlloy', (.44, .51, .53), .8, .31)
paint = material('CeramicPaint', (.63, .70, .71), .08, .46)
rubber = material('Rubber', (.012, .018, .024), 0, .76)
air = material('AirBlue', (.025, .32, .58), .02, .45)
fluid = material('ServiceTeal', (.025, .34, .26), .02, .5)
amber = material('SafetyAmber', (.84, .43, .07), .04, .5)
lamp = material('LightDiffusers', (.74, .86, .88), 0, .46, .5)

def own(o, name, mat, tier=0):
    global serial
    serial += 1
    o.name = f'A26_{serial:04d}_{name}'
    source.objects.link(o)
    o.data.materials.append(mat)
    o['detail_tier'] = tier
    o['component'] = name
    parts.append(o)
    return o

def box(name, p, size, mat, bevel=.007, tier=0):
    verts = [(x*size[0]/2, y*size[2]/2, z*size[1]/2)
             for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                           (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces = [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = own(bpy.data.objects.new(name, me), name, mat, tier)
    o.location = xyz(p)
    if bevel:
        b = o.modifiers.new('Manufactured edge radius', 'BEVEL')
        b.width = min(bevel, min(size)*.22)
        b.segments = 2
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return o

def tube(name, points, radius, mat, tier=0):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.use_fill_caps = True
    sp = curve.splines.new('POLY')
    sp.points.add(len(points)-1)
    for v,p in zip(sp.points, points):
        v.co = (*xyz(p),1)
    return own(bpy.data.objects.new(name, curve), name, mat, tier)

def cylinder(name, p, radius, depth, mat, axis='Z', tier=0, segments=24):
    points = []
    for h in [-depth/2, depth/2]:
        for i in range(segments):
            a = 2*math.pi*i/segments
            u,v = radius*math.cos(a), radius*math.sin(a)
            q = (u,v,h) if axis == 'Z' else (u,h,v) if axis == 'Y' else (h,u,v)
            points.append(xyz(tuple(p[j]+q[j] for j in range(3))))
    faces = [tuple(range(segments-1,-1,-1)), tuple(range(segments,2*segments))]
    faces += [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
    # The Y-axis parameterization reverses orientation.
    if axis == 'Y':
        faces = [tuple(reversed(f)) for f in faces]
    me = bpy.data.meshes.new(name)
    me.from_pydata(points, [], faces)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = len(poly.vertices)==4
    return own(bpy.data.objects.new(name, me), name, mat, tier)

def ring(name, p, radius, thickness, mat, tier=1):
    return tube(name, [(p[0]+radius*math.cos(i*2*math.pi/40),
                        p[1]+radius*math.sin(i*2*math.pi/40),p[2]) for i in range(41)],
                thickness, mat, tier)

def text(label, p, size, side=1):
    curve = bpy.data.curves.new(label, 'FONT')
    curve.body = label
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.resolution_u = 2
    o = own(bpy.data.objects.new(label,curve), 'Identification_'+label,paint,2)
    o.location = xyz(p)
    # Text right, up, outward normal, expressed in Blender coordinates.
    o.rotation_euler = Matrix(((-side,0,0),(0,0,side),(0,1,0))).to_euler()
    return o

# Anchor rods terminate on the real A22 roof ribs, not in mid-air.
for x in [-5.8,0,5.7]:
    for z in [-2.75,-1.75,1.75,2.75]:
        box('Rib_clamp', (x,3.35,z),(.25,.045,.23),alloy,.006,1)
        cylinder('Suspension_rod',(x,3.27,z),.018,.16,alloy,'Y',0,12)
        box('Rail_saddle',(x,3.19,z),(.16,.04,.19),frame,.005)
        if abs(z)==1.75:
            for dx in [-.075,.075]:
                cylinder('Anchor_bolt',(x+dx,3.378,z),.018,.014,alloy,'Y',2,6)
    box('Cross_bridge',(x,3.15,0),(.07,.10,5.95),frame,.01)

# Eight complete luminaire enclosures, surrounding the legacy A22 light blocks.
for s in [-1,1]:
    for k,x in enumerate([-2.8,-.4,2,4.4]):
        z = s*2.75
        box('Luminaire_shell',(x,3.043,z),(2.31,.142,.25),alloy,.018)
        box('Recessed_diffuser',(x,2.966,z),(2.16,.024,.165),lamp,.009)
        for dx in [-1.135,1.135]:
            box('Lamp_endcap',(x+dx,3.041,z),(.055,.151,.263),frame,.01)
        for dx in [-.78,.78]:
            box('Diffuser_retainer',(x+dx,2.957,z),(.034,.018,.21),paint,.003,1)
            box('Pendant_clamp',(x+dx,3.14,z),(.09,.09,.11),frame,.008,1)
        cylinder('Cable_gland',(x+1.18,3.05,z),.032,.05,rubber,'X',1,12)
        tube('Light_power_lead',[(x+1.2,3.05,z),(x+1.23,3.13,z),(x+1.18,3.29,z),
                                (x+.9,3.32,s*1.84)],.015,rubber,1)
        if k in [0,3]:
            box('Lamp_asset_plate',(x,3.045,z-s*.134),(.31,.068,.012),frame,.003,2)
            text('A26 / LED', (x,3.045,z-s*.142),.038,s)
    # Formed open trays. All edges are outside the retained A22 tray core.
    for dz in [-.197,.197]:
        box('Folded_tray_wall',(-.4,3.275,s*1.75+dz),(10.72,.156,.024),alloy,.004)
        box('Tray_rolled_edge',(-.4,3.35,s*1.75+dz),(10.76,.028,.044),alloy,.007,1)
    for j in range(20):
        x=-5.56+j*.55
        box('Tray_cross_rung',(x,3.205,s*1.75),(.055,.032,.38),alloy,.004,1)
        if j%3==0:
            box('Cable_saddle',(x,3.268,s*1.75),(.044,.115,.32),frame,.004,2)
    for offset,mat in [(-.105,air),(0,rubber),(.105,fluid)]:
        tube('Contained_utility_bundle',[(-5.7,3.3,s*1.75+offset),(4.9,3.3,s*1.75+offset),
              (5.32,3.23,s*2.10+offset),(5.48,3.12,s*3.67)],.027,mat,1)
    for x in [-5.62,4.93]:
        box('Tray_end_cover',(x,3.28,s*1.75),(.07,.16,.45),frame,.012,1)
    # Dedicated visible service header and labelled connection boxes.
    tube('Air_header',[(-5.5,3.25,s*3.77),(5.5,3.25,s*3.77)],.042,air)
    tube('Service_header',[(-5.5,3.12,s*3.77),(5.5,3.12,s*3.77)],.03,fluid,1)
    for x in [-4.5,-1,2.5,5.4]:
        box('Header_clip',(x,3.25,s*3.8),(.065,.15,.16),alloy,.006,1)
    box('Junction_box',(-5.3,2.96,s*3.69),(.56,.31,.20),frame,.025)
    box('Junction_lid',(-5.3,2.96,s*3.57),(.50,.26,.045),paint,.015,1)
    for dx in [-.2,.2]:
        cylinder('Junction_fastener',(-5.3+dx,3.04,s*3.539),.015,.012,alloy,'Z',2,8)
    box('Rig_identification',(-1.0,3.25,s*3.67),(1.01,.19,.028),frame,.013,1)
    text('A26 / OVERHEAD',(-1.0,3.25,s*3.648),.074,s)
    for dx in [-.45,.45]:
        box('Safety_marker',(-1+dx,3.25,s*3.65),(.052,.15,.014),amber,.004,1)

sockets = {}
# Stowed reel service cabinets cover A22's low-detail rings/hoses without surgery.
for idx,(x,s,mat,kind) in enumerate([(-3.8,1,air,'AIR'),(-3.2,1,fluid,'FLUID'),(-3.5,-1,amber,'POWER')]):
    begin=len(parts)
    rise=.65 if s<0 else 0
    z=s*3.55
    for y in [1.5,2.3]:
        box('Reel_wall_standoff',(x,y,s*3.835),(.41,.10,.26),alloy,.006,1)
    box('Reel_back_guard',(x,1.97,z),(.598,1.66,.40),frame,.025)
    box('Reel_guard_face',(x,1.97,s*3.34),(.56,1.57,.045),rubber,.02,1)
    for dx in [-.278,.278]:
        box('Reel_yoke',(x+dx,2.5,s*3.30),(.05,.5,.35),alloy,.007,1)
    cylinder('Reel_drum',(x,2.46,s*3.235),.243,.25,frame,'Z',0,32)
    for zz in [3.105,3.355]:
        cylinder('Reel_side_cheek',(x,2.46,s*zz),.292,.026,mat,'Z',0,40)
    cylinder('Bearing_hub',(x,2.46,s*3.083),.086,.032,alloy,'Z',1,24)
    cylinder('Axle_cap',(x,2.46,s*3.058),.044,.023,frame,'Z',1,16)
    for j in range(4):
        ring('Coiled_reel_line',(x,2.46,s*(3.143+j*.053)),.253,.021,mat,1)
    for a in [0,math.pi/2,math.pi,3*math.pi/2]:
        cylinder('Cheek_fastener',(x+.22*math.cos(a),2.46+.22*math.sin(a),s*3.083),
                 .013,.017,alloy,'Z',2,6)
    box('Hose_guide',(x,2.12,s*3.2),(.23,.075,.15),frame,.015)
    cylinder('Guide_roller',(x,2.12,s*3.18),.034,.17,alloy,'X',1,16)
    pts=[]
    for j in range(21):
        t=j/20
        pts.append((x+.07*math.sin(t*math.pi*2),2.08-.59*t,s*(3.18-.12*math.sin(math.pi*t))))
    tube('Parked_'+kind+'_line',pts,.022 if kind!='POWER' else .017,mat)
    box('Hose_stop',(x,2.045,s*3.18),(.079,.064,.065),rubber,.013,1)
    cylinder('Quick_connect_body',(x,1.45,s*3.18),.039,.13,alloy,'Y',0,16)
    cylinder('Connector_collar',(x,1.48,s*3.18),.049,.05,frame,'Y',1,16)
    box('Connector_retainer',(x,1.38,s*3.29),(.17,.11,.2),alloy,.013,1)
    tube('Reel_supply',[(x,2.64+rise,s*3.43),(x,min(2.91+rise,3.42),s*3.6),
                        (x+.14,3.25,s*3.77)],.023,mat,1)
    text(kind,(x,2.59,s*3.084),.048,s)
    sockets['SOCKET_A26_REEL_'+str(idx+1)] = [x,2.46,s*3.235]
    sockets['SOCKET_A26_'+kind+'_DROP'] = [x,1.39,s*3.18]
    if kind=='POWER':
        box('Electrical_pendant',(x,1.29,s*3.18),(.25,.21,.13),frame,.021)
        for dx in [-.065,.065]:
            cylinder('Covered_outlet',(x+dx,1.29,s*3.105),.044,.02,rubber,'Z',1,16)
    # A35 occupies the left-wall floor slots. Keep the entire power station above
    # its audited 1.72 m parked envelope, while the supply still meets the header.
    if rise:
        for part in parts[begin:]:
            if part['component']!='Reel_supply':
                part.location.z += rise
        sockets['SOCKET_A26_REEL_'+str(idx+1)][1] += rise
        sockets['SOCKET_A26_'+kind+'_DROP'][1] += rise
# Four-port air regulator station located beside (not over) the vehicle corridor.
x,s=-4.62,1
box('Manifold_mount',(x,2.61,3.55),(.73,.36,.17),frame,.02)
cylinder('Regulator_body',(x,2.59,3.39),.09,.13,alloy,'Y',1,20)
cylinder('Regulator_knob',(x,2.70,3.39),.066,.08,rubber,'Y',1,16)
cylinder('Gauge_bezel',(x,2.87,3.41),.109,.075,alloy,'Z',1,32)
cylinder('Gauge_face',(x,2.87,3.365),.091,.015,paint,'Z',1,32)
tube('Gauge_needle',[(x,2.87,3.352),(x-.045,2.913,3.352)],.005,frame,2)
for dx in [-.29,-.145,.145,.29]:
    cylinder('Air_port',(x+dx,2.59,3.405),.039,.15,air,'Z',1,16)
    cylinder('Air_quick_release',(x+dx,2.59,3.318),.033,.03,alloy,'Z',2,16)
sockets['SOCKET_A26_FRONT_SERVICE']=[-4.62,2.59,3.27]
sockets['SOCKET_A26_REAR_SERVICE']=[5.48,3.12,3.67]

# Non-exported exact clearance guide; never a new game collider.
opening={'min':[-6.6,.08,-2.2],'max':[5.4,2.9,2.2]}
guide=box('Protected_A22_passage',(-.6,1.49,0),(12,2.82,4.4),rubber,0)
parts.remove(guide)
source.objects.unlink(guide)
guides.objects.link(guide)
guide.display_type='WIRE'
guide.hide_render=True
guides.hide_render=True

root=bpy.data.objects.new('A26_SERVICE_RIG',None)
runtime.objects.link(root)
root['asset_id']='A26'
root['revision']=REVISION
root['units']='metres'
root['entrance_axis']='-X'
root['finalArtApproved']=False
# Build each LOD from evaluated source, then batch by material in stable name order.
for level,max_tier in [(0,2),(1,1),(2,0)]:
    lod=bpy.data.objects.new('A26_LOD'+str(level),None)
    runtime.objects.link(lod)
    lod.parent=root
    bins={}
    for original in sorted(parts,key=lambda o:o.name):
        if original['detail_tier']>max_tier:
            continue
        if original.type=='CURVE':
            original.data.bevel_resolution=[2,1,0][level]
        for mod in original.modifiers:
            if mod.type=='BEVEL':
                mod.segments=2 if level==0 else 1
                mod.show_viewport=level<2
            if mod.type=='WEIGHTED_NORMAL':
                mod.show_viewport=level<2
        bpy.context.view_layer.update()
        evaluated=original.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me=bpy.data.meshes.new_from_object(evaluated)
        o=bpy.data.objects.new(original.name+'_export',me)
        runtime.objects.link(o)
        o.matrix_world=original.matrix_world.copy()
        uv=me.uv_layers.active or me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            axis=max(range(3),key=lambda i:abs(poly.normal[i]))
            axes=[i for i in range(3) if i!=axis]
            for li in poly.loop_indices:
                co=o.matrix_world@me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv=(co[axes[0]]/.5,co[axes[1]]/.5)
        bins.setdefault(original.data.materials[0].name,[]).append(o)
    for name,objects in sorted(bins.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        o=bpy.context.object
        o.name=f'A26_L{level}_{name}'
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        o.parent=lod
        if level:
            dec=o.modifiers.new('Coplanar consolidation','DECIMATE')
            dec.decimate_type='DISSOLVE'
            dec.angle_limit=.04
            bpy.ops.object.modifier_apply(modifier=dec.name)
        tri=o.modifiers.new('Export triangles','TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=tri.name)
        # Reject triangle intersections with the central passage using SAT.
        inv=root.matrix_world.inverted()
        clearance_min=Vector(xyz((opening['min'][0],opening['min'][1],opening['max'][2])))
        clearance_max=Vector(xyz((opening['max'][0],opening['max'][1],opening['min'][2])))
        centre=(clearance_min+clearance_max)/2
        half=(clearance_max-clearance_min)/2
        for poly in o.data.polygons:
            v=[inv@o.matrix_world@o.data.vertices[i].co-centre for i in poly.vertices]
            edges=[v[1]-v[0],v[2]-v[1],v[0]-v[2]]
            axes=[Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)),edges[0].cross(edges[1])]
            axes += [e.cross(a) for e in edges for a in axes[:3]]
            separated=False
            for a in axes:
                if a.length_squared<1e-16:
                    continue
                r=sum(half[i]*abs(a[i]) for i in range(3))
                projections=[a.dot(p) for p in v]
                if min(projections)>r or max(projections)<-r:
                    separated=True
                    break
            if not separated:
                raise RuntimeError('A26 enters protected A22 passage: '+o.name)

for name,p in sorted(sockets.items()):
    o=bpy.data.objects.new(name,None)
    runtime.objects.link(o)
    o.parent=root
    o.location=xyz(p)
    o.empty_display_type='ARROWS'
    o.empty_display_size=.12
    o['purpose']='parked visual service socket; no physics changes'
# Restore highest detail on the independently editable originals.
for o in parts:
    if o.type=='CURVE':
        o.data.bevel_resolution=2
    for mod in o.modifiers:
        mod.show_viewport=True
        if mod.type=='BEVEL':
            mod.segments=2
# Artist-facing pivots are centred on each component. Runtime batches were copied
# already and keep identity transforms; source curves remain independently editable.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY',center='BOUNDS')
source.hide_render=True
source.hide_viewport=True
guides.hide_viewport=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active=root
out=ROOT/'public/models/aurel-overhead-garage-service-rig.glb'
out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,
                          export_yup=True,export_extras=True,export_cameras=False,
                          export_lights=False,export_animations=False,export_materials='EXPORT')
raw=out.read_bytes()
length=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+length])
counts={str(l):sum(doc['accessors'][p['indices']]['count']//3
         for n in doc['nodes'] if n.get('name','').startswith('A26_L'+str(l)+'_')
         for p in doc['meshes'][n['mesh']]['primitives']) for l in range(3)}
assert 0<counts['2']<counts['1']<counts['0']<60000,counts
assert len(raw)<8*1024*1024
assert len(doc['materials'])==8
bounds={'min':[-6.0,1.05,-4.0],'max':[5.9,3.5,4.0]}
for o in runtime.objects:
    if o.type=='MESH':
        for v in o.data.vertices:
            p=o.matrix_world@v.co
            game=(p.x,p.z,-p.y)
            assert all(bounds['min'][i]-1e-6<=game[i]<=bounds['max'][i]+1e-6 for i in range(3)),game
for o in runtime.objects:
    if o.name.startswith(('A26_L1_','A26_L2_')):
        o.hide_set(True)
        o.hide_render=True
editable='scripts/aurel-overhead-garage-service-rig.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/editable),compress=True)
receipt={'assetId':'A26','revision':REVISION,'author':'scripts/author-overhead-garage-service-rig.py',
 'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,
 'editable':editable,'url':'models/aurel-overhead-garage-service-rig.glb','sha256':hashlib.sha256(raw).hexdigest(),
 'bytes':len(raw),'triangles':counts,'materials':len(doc['materials']),'images':len(doc.get('images',[])),
 'meshes':len(doc['meshes']),'nodes':len(doc['nodes']),'localBounds':bounds,'protectedOpening':opening,
 'sockets':sockets,'lightingHousings':8,'reels':3,'editableComponents':len(parts),
 'maxDrawCallsPerLevel':8,'externalTextures':False,'textureBudgetBytes':0,'centralPassageIntersections':0,
 'finalArtApproved':False}
(ROOT/'src/rendering/overhead-garage-service-rig.manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('A26_RECEIPT '+json.dumps(receipt))
