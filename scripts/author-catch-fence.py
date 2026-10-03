"""A03 original catch-fence support kit. Blender 5.2.2 LTS (original construction retained from 4.3.2), metres / Y-up / +Z span.
Run only in a separate background Blender process. No downloaded art.
"""
import bpy, bmesh, math, json, hashlib, struct, tempfile, sys
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-catch-fence.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A03_EDITABLE_COMPONENTS'].objects)>100
 images=[i for i in bpy.data.images if i.name.startswith('A03_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(256,256) for i in images)
 print('A03_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A03_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A03_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A03_CATCH_FENCE_KIT',None);runtime.objects.link(root);root['assetId']='A03';root['finalArtApproved']=False
REV='aurel-a03-fence-r01-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def move_collection(o,c):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o)

def steel_material():
 m=bpy.data.materials.new('A03_galvanized_steel');m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=.67;p.inputs['Roughness'].default_value=.44
 n=256;yy,xx=np.mgrid[:n,:n];rng=np.random.default_rng(202);fine=rng.random((n,n))
 # Low contrast deterministic zinc-like facets and micrograined roughness.
 facets=(np.sin(xx*.17+np.sin(yy*.07))+np.sin(yy*.23-xx*.055))*.014
 base=np.stack([.30+facets+(fine-.5)*.035,.33+facets+(fine-.5)*.035,.34+facets+(fine-.5)*.035],axis=-1)
 rough=np.dstack([np.ones((n,n)),np.clip(.43+(fine-.5)*.14+facets,0,1),np.full((n,n),.67)])
 normal=np.dstack([.5+np.gradient(fine,axis=1)*.075,.5+np.gradient(fine,axis=0)*.075,np.ones((n,n))])
 for role,pix in [('base',base),('orm',rough),('normal',normal)]:
  image=bpy.data.images.new('A03_original_'+role,width=n,height=n,alpha=True);image.pixels.foreach_set(np.dstack([pix,np.ones((n,n))]).astype(np.float32).ravel());image.file_format='PNG'
  with tempfile.TemporaryDirectory(prefix='a03-pixels-') as tmp:
   path=Path(tmp)/('A03_'+role+'.png');image.filepath_raw=str(path);image.save();bpy.data.images.remove(image);image=bpy.data.images.load(str(path),check_existing=False);image.name='A03_original_'+role;image.pack();image.filepath='//A03_'+role+'.png'
  image.colorspace_settings.name='sRGB' if role=='base' else 'Non-Color';tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
  if role=='base':m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
  elif role=='orm':
   sep=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(tex.outputs[0],sep.inputs[0]);m.node_tree.links.new(sep.outputs['Green'],p.inputs['Roughness']);m.node_tree.links.new(sep.outputs['Blue'],p.inputs['Metallic'])
  else:
   norm=m.node_tree.nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.3;m.node_tree.links.new(tex.outputs[0],norm.inputs['Color']);m.node_tree.links.new(norm.outputs[0],p.inputs['Normal'])
 return m
steel=steel_material()
current=[]
def finish(o,name,bevel=0,segments=1):
 o.name=name;move_collection(o,source);o.data.materials.append(steel);bpy.context.view_layer.objects.active=o
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 if bevel:
  mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=bevel;mod.segments=segments;bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.cube_project(cube_size=1);bpy.ops.object.mode_set(mode='OBJECT')
 current.append(o);return o

def cube(name,pos,size,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,bevel)

def rod(name,start,end,radius,sides=8):
 a,b=Vector(xyz(start)),Vector(xyz(end));bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=radius,depth=(b-a).length,location=(a+b)*.5);o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return finish(o,name)

def tube(name,points,radius,sides):
 points=[Vector(xyz(p))for p in points];verts=[];faces=[]
 for i,p in enumerate(points):
  tangent=(points[min(len(points)-1,i+1)]-points[max(0,i-1)]).normalized();u=Vector((0,1,0));v=tangent.cross(u).normalized()
  for j in range(sides):
   theta=2*math.pi*j/sides;verts.append(p+radius*(u*math.cos(theta)+v*math.sin(theta)))
 for i in range(len(points)-1):
  for j in range(sides):n=(j+1)%sides;faces.append((i*sides+j,i*sides+n,(i+1)*sides+n,(i+1)*sides+j))
 faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+j for j in range(sides))])
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o);return finish(o,name)

def bolt(name,pos,axis='x'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.009,depth=.012,location=xyz(pos),rotation=(0,math.pi/2,0) if axis=='x' else (0,0,0));return finish(bpy.context.object,name,bevel=.001)

def post(level,z=.08):
 sides=[16,8,5][level];points=[(.23,.94,z),(.23,3.30,z)]
 for i in range(1,[7,4,2][level]):
  t=i/([7,4,2][level]-1);x=(1-t)**2*.23+2*(1-t)*t*.23+t*t*.1593;y=(1-t)**2*3.3+2*(1-t)*t*3.4+t*t*3.4707;points.append((x,y,z))
 points.append((-.17,3.80,z));tube('A03_SOURCE_swept_overhang_post',points,.036,sides)
 cube('A03_SOURCE_cantilever_wall_bracket',(.165,.938,z),(.215,.018,.13),bevel=.003 if level==0 else 0)
 cube('A03_SOURCE_wall_clamp',(.18,.847,z),(.023,.20,.13),bevel=.003 if level==0 else 0)
 if level==0:
  for y in [.79,.885]:bolt('A03_SOURCE_wall_clamp_bolt',(.196,y,z))
  for x in [.095,.235]:bolt('A03_SOURCE_bracket_bolt',(x,.955,z),'y')
  for y in [1.18,2.32,3.4]:
   cube('A03_SOURCE_cable_clamp',(.218,y,z),(.065,.052,.055),bevel=.004)
   bolt('A03_SOURCE_cable_clamp_bolt',(.256,y,z))

counts={};sockets={}
for variant in ['run','braced','gate']:
 vr=bpy.data.objects.new('A03_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[];post(level)
  if level<2:
   for y in [1.18,2.32,3.4]:rod('A03_SOURCE_tension_cable',(.23,y,.006),(.23,y,3.794),.0075,6 if level==0 else 4)
   if level==0:
    for y in [1.18,2.32,3.4]:
     rod('A03_SOURCE_tension_adjuster',(.23,y,.18),(.23,y,.34),.018,8)
     rod('A03_SOURCE_locking_nut',(.23,y,.20),(.23,y,.225),.023,6)
  if variant=='braced':
   rod('A03_SOURCE_rear_ground_stay',(.255,2.55,.08),(.86,.028,.44),.026,[12,8,5][level])
   cube('A03_SOURCE_ground_anchor_plate',(.86,-.032,.44),(.24,.024,.24),bevel=.003 if level==0 else 0)
   if level==0:
    cube('A03_SOURCE_stay_clevis',(.86,.021,.44),(.095,.09,.12),bevel=.006)
    for dx,dz in[(-.07,-.075),(.07,.075)]:bolt('A03_SOURCE_ground_anchor_bolt',(.86+dx,-.014,.44+dz),'y')
  if variant=='gate':
   # Closed maintenance panel over the retained wall, not a new traversable route.
   for z in [1.04,2.14]:cube('A03_SOURCE_gate_jamb',(.226,2.18,z),(.064,2.45,.055),bevel=.003 if level==0 else 0)
   for y in [1.01,3.34]:cube('A03_SOURCE_gate_leaf_rail',(.204,y,1.59),(.05,.048,1.045),bevel=.003 if level==0 else 0)
   for z in [1.09,2.09]:cube('A03_SOURCE_gate_leaf_stile',(.204,2.175,z),(.05,2.31,.048),bevel=.003 if level==0 else 0)
   if level<2:
    for y in [1.34,2.98]:
     rod('A03_SOURCE_gate_hinge',(.234,y-.062,1.062),(.234,y+.062,1.062),.021,10 if level==0 else 6)
     cube('A03_SOURCE_gate_hinge_leaf',(.209,y,1.085),(.055,.045,.09),bevel=.002 if level==0 else 0)
    cube('A03_SOURCE_gate_latch_body',(.18,1.96,2.08),(.055,.115,.068),bevel=.006 if level==0 else 0)
    rod('A03_SOURCE_gate_latch_handle',(.143,1.96,2.075),(.143,1.96,1.985),.012,10 if level==0 else 6)
   if level==0:
    for y in [1.34,2.98]:bolt('A03_SOURCE_gate_hinge_pin_cap',(.235,y+.07,1.062),'y')
  lr=bpy.data.objects.new('A03_'+variant.upper()+'_LOD'+str(level),None);runtime.objects.link(lr);lr.parent=vr
  copies=[]
  for o in current:
   o['variant']=variant;o['lod']=level;o.hide_render=True;c=o.copy();c.data=o.data.copy();runtime.objects.link(c);c.hide_render=False;c.hide_set(False);c.data.transform(c.matrix_world);c.matrix_world=Matrix.Identity(4);copies.append(c)
  bpy.ops.object.select_all(action='DESELECT')
  for c in copies:c.select_set(True)
  bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();joined=bpy.context.object;joined.name=lr.name+'_STEEL';joined.parent=lr
  tri=joined.modifiers.new('Runtime triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name);joined.data.calc_loop_triangles();counts[variant].append(len(joined.data.loop_triangles));joined.hide_render=level>0
 for name,pos in [('START',(.23,.96,0)),('END',(.23,.96,3.8)),('OVERHANG',(-.17,3.8,.08)),('WALL_CLAMP',(.18,.847,.08)),('GROUND_STAY',(.86,-.032,.44))]:
  if name=='GROUND_STAY' and variant!='braced':continue
  key='A03_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.07;sockets[key]=list(pos)
 if variant=='gate':
  for name,pos in [('HINGE',(.234,2.16,1.062)),('LATCH',(.143,1.96,2.075))]:
   key='A03_GATE_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-catch-fence.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<5000 for c in counts.values()),counts
assert len(raw)<3*1024*1024,len(raw)
manifest={'assetId':'A03','revision':REV,'author':'scripts/author-catch-fence.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-catch-fence.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-catch-fence.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'span':3.8,'units':'metres-Y-up-Z-span','sockets':sockets,'bounds':{'min':[-.208,-.045,0],'max':[.985,3.838,3.8]},'textureBudget':'three original packed 256-square metal maps','wireIntegration':'Retain original metre-scaled analytic diamond-wire surface, UVs, filtering and no-shadow/depth-write policy. Fine wires are not dense opaque meshes.','provenance':'Original swept posts, cantilever clamps, tension adjusters, braced ground anchors and closed maintenance-gate fittings. Original metal pixels; no downloaded art.','collision':'visual-only; physical barrier and access behavior unchanged','finalArtApproved':False}
(ROOT/'src/rendering/catch-fence.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
scene['handoff']='Editable source components and three batched LODs. Fine wire is supplied by the original analytic runtime shader; no traversable gate or safety certification is implied.'
# Inspection-only wire surfaces reproduce the production diamond spacing.
# They never enter the GLB, which deliberately preserves the existing runtime wire shader.
preview=bpy.data.collections.new('A03_NON_EXPORT_WIRE_PREVIEW');scene.collection.children.link(preview)
wm=bpy.data.materials.new('A03_preview_only_analytic_wire');wm.use_nodes=True
nodes,links=wm.node_tree.nodes,wm.node_tree.links;nodes.clear()
outnode=nodes.new('ShaderNodeOutputMaterial');metal=nodes.new('ShaderNodeBsdfPrincipled');metal.inputs['Base Color'].default_value=(.22,.25,.24,1);metal.inputs['Metallic'].default_value=.55;metal.inputs['Roughness'].default_value=.67
transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader');links.new(transparent.outputs[0],mix.inputs[1]);links.new(metal.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],outnode.inputs[0])
uvnode=nodes.new('ShaderNodeTexCoord');sep=nodes.new('ShaderNodeSeparateXYZ');links.new(uvnode.outputs['UV'],sep.inputs[0]);covers=[]
for operation in ['ADD','SUBTRACT']:
 phase=nodes.new('ShaderNodeMath');phase.operation=operation;links.new(sep.outputs['X'],phase.inputs[0]);links.new(sep.outputs['Y'],phase.inputs[1])
 frac=nodes.new('ShaderNodeMath');frac.operation='FRACT';links.new(phase.outputs[0],frac.inputs[0])
 low=nodes.new('ShaderNodeMath');low.operation='LESS_THAN';low.inputs[1].default_value=.016;links.new(frac.outputs[0],low.inputs[0])
 high=nodes.new('ShaderNodeMath');high.operation='GREATER_THAN';high.inputs[1].default_value=.984;links.new(frac.outputs[0],high.inputs[0])
 combine=nodes.new('ShaderNodeMath');combine.operation='MAXIMUM';links.new(low.outputs[0],combine.inputs[0]);links.new(high.outputs[0],combine.inputs[1]);covers.append(combine)
combine=nodes.new('ShaderNodeMath');combine.operation='MAXIMUM';links.new(covers[0].outputs[0],combine.inputs[0]);links.new(covers[1].outputs[0],combine.inputs[1]);links.new(combine.outputs[0],mix.inputs[0])
wirepoints=[(.23,.96,0),(.23,.96,3.8),(.23,3.4,0),(.23,3.4,3.8),(-.17,3.8,0),(-.17,3.8,3.8)]
for i,variant in enumerate(['RUN','BRACED','GATE']):
 me=bpy.data.meshes.new('A03_preview_wire_'+variant);me.from_pydata([xyz(p)for p in wirepoints],[],[(0,1,3,2),(2,3,5,4)]);me.update();layer=me.uv_layers.new(name='WireMetres')
 for face in me.polygons:
  for li in face.loop_indices:
   p=wirepoints[me.loops[li].vertex_index];layer.data[li].uv=(p[2]/.09,p[1]/.09)
 me.materials.append(wm);o=bpy.data.objects.new('A03_PREVIEW_WIRE_'+variant,me);preview.objects.link(o)
 # The saved Blender inspection layout separates the module families. Export
 # remains origin-local because the GLB was written before these preview offsets.
 offset=(i-1)*1.6;bpy.data.objects['A03_'+variant].location.x=offset;o.location.x=offset
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_set(True)
scene['A03_preview_note']='Runtime GLB is origin-local. This Blender file separates RUN/BRACED/GATE by 1.6m for inspection; preview wire is non-export artwork. Regenerate with author script for canonical GLB.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-catch-fence.blend'),compress=True)
print('A03_RECEIPT',json.dumps(manifest))
