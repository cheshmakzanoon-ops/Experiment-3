"""A61 original rival refinement, on the retained APX mechanical hardpoints.

blender -b --python-exit-code 1 --python scripts/author-a61-rival.py
The original assembly and supplied player assets are read-only. Three standard
quantized GLBs share named roles/pivots. Native editable high-detail art is kept.
"""
from pathlib import Path
import bpy, bmesh, hashlib, json, math, runpy, sys, tempfile
from math import sin, cos, pi, exp, sqrt
from mathutils import Vector
ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT/'scripts/apx01-assembly.blend'
SOURCE_HASH = '0f1728899b8420cd6712e15415861f1e68ba24a80e952780924a037e49929096'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_HASH, 'Retained source changed; reconcile A61 first'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
contract = json.loads((ROOT/'src/rendering/apx01-assembly.json').read_text())
# Preserve the original assembled-inspection transforms, but link them to the
# revised prototypes. Preview copies have no export role and never enter GLB.
prototype_data = {o.data.as_pointer(): o['apex_role'] for o in bpy.data.objects
                  if o.type == 'MESH' and o.get('apex_role') in contract['parts']}
preview_layout = [(o.name, prototype_data[o.data.as_pointer()], o.matrix_world.copy())
                  for o in bpy.data.objects if o.type == 'MESH' and o.get('apx_preview')
                  and o.data.as_pointer() in prototype_data]

for ob in list(bpy.data.objects):
    if ob.type != 'MESH' or ob.get('apex_role') not in contract['parts']:
        bpy.data.objects.remove(ob, do_unlink=True)
parts = {o['apex_role']: o for o in bpy.data.objects if o.type == 'MESH'}
for ob in parts.values(): ob.hide_set(False); ob.hide_render=False

def xyz(p): return (p[0], -p[2], p[1])
def runtime(p): return (p[0], p[2], -p[1])
def activate(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob

def add(role, vertices, faces, smooth=True):
    """Add a material-compatible part without adding a runtime draw submission."""
    m=bpy.data.meshes.new('A61 / '+role);m.from_pydata([xyz(p) for p in vertices],[],faces);m.update()
    bm=bmesh.new();bm.from_mesh(m);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(m);bm.free()
    for p in m.polygons:p.use_smooth=smooth
    uv=m.uv_layers.new(name='APX normalized UV')
    bounds=[(min(p.co[i] for p in m.vertices),max(p.co[i] for p in m.vertices)) for i in range(3)]
    for poly in m.polygons:
        axis=max(range(3),key=lambda k:abs(poly.normal[k])); axes=[k for k in range(3) if k!=axis]
        for li in poly.loop_indices:
            p=m.vertices[m.loops[li].vertex_index].co
            uv.data[li].uv=tuple((p[k]-bounds[k][0])/max(1e-9,bounds[k][1]-bounds[k][0]) for k in axes)
    o=bpy.data.objects.new('A61 / '+role,m);bpy.context.collection.objects.link(o)
    o.data.materials.append(parts[role].data.materials[0])
    activate(parts[role]);o.select_set(True);bpy.ops.object.join()

def ribbon(role, points, width, depth):
    v=[]; f=[]
    for i,(x,y,z) in enumerate(points):
        d=(Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])).normalized()
        axis=Vector((0,1,0)) if abs(d.y)<.9 else Vector((0,0,1))
        right=d.cross(axis).normalized(); up=right.cross(d).normalized()
        v.extend(tuple(Vector((x,y,z))+right*a*width/2+up*b*depth/2) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)])
        if i:
            a=(i-1)*4
            for j in range(4): f.append((a+j,a+(j+1)%4,a+4+(j+1)%4,a+4+j))
    f.extend([(3,2,1,0),tuple((len(points)-1)*4+j for j in range(4))]);add(role,v,f)

def tube(role, points, radius, radial=12):
    v=[];f=[]
    for i,p in enumerate(points):
        d=(Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])).normalized()
        axis=Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))
        u=d.cross(axis).normalized();w=d.cross(u).normalized()
        for j in range(radial):v.append(tuple(Vector(p)+radius*(cos(j*2*pi/radial)*u+sin(j*2*pi/radial)*w)))
        if i:
            for j in range(radial):a=(i-1)*radial+j;b=(i-1)*radial+(j+1)%radial;f.append((a,b,b+radial,a+radial))
    f.extend([tuple(reversed(range(radial))),tuple((len(points)-1)*radial+j for j in range(radial))]);add(role,v,f)

# Sculpt the shoulder/undercut region without moving inlet, outlet, deck cooling
# holes, livery UVs, floor datums or suspension sockets. Continuous, not noise.
pod=parts['sidepod']
for v in pod.data.vertices:
    x,y,z=runtime(v.co)
    length=sin(pi*max(0,min(1,(z+1.8)/2.19)))**2
    flank=min(1,max(0,(abs(x)-.11)/.15))
    under=max(0,min(1,(-y-.025)/.18))
    x*=1-.19*length*under
    y+=.029*length*flank*(1-under)
    v.co=xyz((x,y,z))
pod.data.normals_split_custom_set_from_vertices([(0,0,0)]*len(pod.data.vertices));pod.data.update()
# The nose keeps every suspension attachment (z=1.52,2.12) and its collar.
# Small paired crown ridges replace the featureless cylindrical highlight.
nose=parts['nose']
for v in nose.data.vertices:
    x,y,z=runtime(v.co)
    if .72<z<1.40 and y>0:
        y+=.011*sin(pi*(z-.72)/.68)**2*exp(-((abs(x)-.12)/.06)**2)
    v.co=xyz((x,y,z))
nose.data.normals_split_custom_set_from_vertices([(0,0,0)]*len(nose.data.vertices));nose.data.update()

# Rolled inlet lip: follows the actual aperture on the retained airbox. The
# throat stays hollow. Repeated rings are surface geometry, not black decals.
for scale,z in [(1.,-.534),(.985,-.540)]:
    points=[]
    for j in range(65):
        a=j*2*pi/64
        points.append((.066*scale*cos(a),.574+.077*scale*sin(a),z))
    tube('airbox_carbon',points,.0032,8)
# Centre splitter inside that opening, connected from top to bottom.
ribbon('airbox_carbon',[(0,.497,-.540),(0,.574,-.576),(0,.649,-.543)],.0035,.004)

# Rear diffuser channels: continuous rolled lips following the retained floor
# surface at the outlet, returning into the existing full-length fences.
for side in [-1,1]:
    for fraction in [.25,.50,.76]:
        points=[]
        for j in range(17):
            t=j/16;z=-2.178+.31*t;w=.60+.26*t
            rise=.142-.052*t
            tunnel=sin(pi*max(0,min(1,(fraction-.12)/.88)))**2
            points.append((side*fraction*w,-.385-.022*t+rise*tunnel+.027,z))
        ribbon('floor_edges',points,.008,.032)
    # Rolled outer floor shoulder rail, inside the unchanged maximum width.
    ribbon('floor_edges',[(side*.58,-.353,-2.16),(side*.79,-.374,-1.96),
                         (side*.865,-.378,-1.58),(side*.900,-.381,-1.07)],.012,.020)
# Real flanged rain-lamp enclosure. The emissive lamp remains runtime-owned.
for side in [-1,1]:
    ribbon('tail_carbon',[(side*.056,-.274,-2.285),(side*.056,-.190,-2.285)],.012,.014)
ribbon('tail_carbon',[(-.056,-.274,-2.286),(.056,-.274,-2.286)],.01,.01)
ribbon('tail_carbon',[(-.056,-.190,-2.286),(.056,-.190,-2.286)],.01,.01)
# Rear light brackets and exhaust heat-shield saddle, in the existing alloy draw.
for side in [-1,1]:
    tube('tail_alloy',[(side*.046,-.190,-2.275),(side*.065,-.163,-2.15)],.004,8)
points=[(.055*cos(j*pi/32),-.076+.055*sin(j*pi/32),-2.10) for j in range(33)]
tube('tail_alloy',points,.004,10)

# Wheel fairing radial ribs. Each is rim/carrier-owned, not part of the tyre;
# paired crown features catch light at oblique overtaking/replay angles.
for end,half in [('front',.155),('rear',.19)]:
    for j in range(12):
        a=j*2*pi/12;pts=[]
        for k in range(7):
            t=k/6;r=.065+.15*t;aa=a+.09*sin(pi*t)
            pts.append((half+.023-.007*t,.001+r*cos(aa),r*sin(aa)))
        tube(end+'_cover',pts,.0017,6)
    # Proper rim-balance pockets/valve stem belong to the removable wheel.
    tube(end+'_hub',[(half+.012,.218,0),(half+.024,.218,0)],.003,8)

# Endplate shoulders with a connected, tapered swage. No wider collision box.
for side in [-1,1]:
    ribbon('rear_carbon',[(side*.846,.266,-2.255),(side*.846,.32,-2.19),
                         (side*.845,.37,-2.07),(side*.843,.40,-1.92)],.008,.009)
    # Front endplate leading-edge radius seated on the existing plate.
    tube('front_carbon',[(side*.978,-.277,2.575),(side*.978,-.234,2.580),
                         (side*.978,-.193,2.541)],.0032,8)

# Closed triangulated named assemblies; output never contains a camera/light or
# a preview duplicate. UV domain and all original material roles stay intact.
for role,ob in parts.items():
    activate(ob)
    ob['apex_role']=role;ob['apex_material']=contract['parts'][role]
    ob['a61_revision']='A61 / original APX refinement 1'
    tri=ob.modifiers.new('A61 explicit triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    ob.data.materials.clear();ob.data.materials.append(bpy.data.materials['APX / '+contract['parts'][role]])
    for p in ob.data.polygons:p.material_index=0
    for layer in list(ob.data.uv_layers)[1:]:ob.data.uv_layers.remove(layer)
    for loop in ob.data.uv_layers[0].data:
        if any(not math.isfinite(v) for v in loop.uv):raise ValueError('Nonfinite UV')
        loop.uv=(max(0,min(1,loop.uv.x)),max(0,min(1,loop.uv.y)))

native=ROOT/'scripts/a61-rival.blend'
bpy.context.scene['A61_sourceSHA256']=SOURCE_HASH
bpy.context.scene['A61_finalArtApproved']=False
bpy.context.scene['A61_coordinate_contract']='metres, runtime +Y up +Z nose; wheel prototypes +X outboard'
bpy.context.scene.unit_settings.system='METRIC'
bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)

# Export the same native source at three bounded resolutions. Collapse retains
# UV interpolation; tires and open ducts keep more topology than hidden hardware.
# Native high detail is reopened for each derivative to avoid chained errors.
reports=[]
for level,name,ratio in [(0,'near',1.),(1,'mid',.25),(2,'far',.075)]:
    if level:
        bpy.ops.wm.open_mainfile(filepath=str(native))
        for ob in [o for o in bpy.data.objects if o.type=='MESH' and o.get('apex_role')]:
            activate(ob);role=ob['apex_role']
            if len(ob.data.polygons)<100:continue
            dec=ob.modifiers.new('A61 '+name+' derived topology','DECIMATE')
            dec.ratio=max(ratio,.18 if role.startswith('tire_') else ratio)
            dec.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=dec.name)
            for loop in ob.data.uv_layers[0].data:
                loop.uv=(max(0,min(1,loop.uv.x)),max(0,min(1,loop.uv.y)))
    with tempfile.TemporaryDirectory(prefix='a61-export-') as temp:
        target=Path(temp)/'body.glb.gz';old_args=sys.argv[:]
        try:
            sys.argv=[str(ROOT/'scripts/apx01-export.py'),'--',str(target)]
            runpy.run_path(str(ROOT/'scripts/apx01-export.py'),run_name='__main__')
        finally:sys.argv=old_args
        report=json.loads((Path(temp)/'apx01-shell.manifest.json').read_text())
        report['asset']='A61 / APX-01 rival / '+name
        report['sourceSHA256']=SOURCE_HASH
        report['authorSHA256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report['detailLevel']=level
        (ROOT/f'src/rendering/a61-rival-{name}.glb.gz').write_bytes(target.read_bytes())
        (ROOT/f'src/rendering/a61-rival-{name}.manifest.json').write_text(json.dumps(report,indent=2)+'\n')
        reports.append(report)
assert all(sum(reports[i]['triangles'].values())>sum(reports[i+1]['triangles'].values()) for i in [0,1])
print('A61_EXPORTED',[(r['detailLevel'],sum(r['triangles'].values()),r['compressedBytes']) for r in reports])

# Restore a useful editable assembled inspection, not a pile of axle prototypes.
bpy.ops.wm.open_mainfile(filepath=str(native))
prototypes={o['apex_role']:o for o in bpy.data.objects if o.type=='MESH' and o.get('apex_role') in contract['parts']}
collection=bpy.data.collections.new('A61 / assembled inspection')
bpy.context.scene.collection.children.link(collection)
for name,role,matrix in preview_layout:
    ob=prototypes[role].copy();ob.data=prototypes[role].data;ob.name=name.replace('Assembled','A61 assembled')
    for key in list(ob.keys()):del ob[key]
    ob['apx_preview']=True;collection.objects.link(ob);ob.matrix_world=matrix
    ob.hide_set(False);ob.hide_render=False
for ob in prototypes.values():ob.hide_set(True);ob.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.region_3d.view_distance=8
            space.region_3d.view_location=(0,0,0)
            space.region_3d.view_rotation=Vector((5,-7,3)).to_track_quat('Z','Y')
            space.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
print('A61_EDITABLE_PREVIEW',len(preview_layout))
