"""A02 original steel guardrail kit. Blender 5.2.2 LTS (original construction retained from 4.3.2), metres / Y-up / +Z span.
Run only in a separate background Blender process. No downloaded art.
"""
import bpy, bmesh, math, json, hashlib, struct, tempfile, sys
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-steel-guardrails.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A02_EDITABLE_COMPONENTS'].objects)>100
 images=[i for i in bpy.data.images if i.name.startswith('A02_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(256,256) for i in images)
 print('A02_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A02_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A02_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A02_STEEL_GUARDRAIL_KIT',None);runtime.objects.link(root);root['assetId']='A02';root['finalArtApproved']=False
REV='aurel-a02-steel-r02-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def move_collection(o,c):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o)

def steel_material():
 m=bpy.data.materials.new('A02_galvanized_steel');m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=.92;p.inputs['Roughness'].default_value=.44
 n=256;yy,xx=np.mgrid[:n,:n];rng=np.random.default_rng(202);fine=rng.random((n,n))
 # Low contrast deterministic zinc-like facets and micrograined roughness.
 facets=(np.sin(xx*.17+np.sin(yy*.07))+np.sin(yy*.23-xx*.055))*.014
 base=np.stack([.56+facets+(fine-.5)*.035,.59+facets+(fine-.5)*.035,.60+facets+(fine-.5)*.035],axis=-1)
 rough=np.dstack([np.ones((n,n)),np.clip(.43+(fine-.5)*.14+facets,0,1),np.full((n,n),.92)])
 normal=np.dstack([.5+np.gradient(fine,axis=1)*.075,.5+np.gradient(fine,axis=0)*.075,np.ones((n,n))])
 for role,pix in [('base',base),('orm',rough),('normal',normal)]:
  image=bpy.data.images.new('A02_original_'+role,width=n,height=n,alpha=True);image.pixels.foreach_set(np.dstack([pix,np.ones((n,n))]).astype(np.float32).ravel());image.file_format='PNG'
  with tempfile.TemporaryDirectory(prefix='a02-pixels-') as tmp:
   path=Path(tmp)/('A02_'+role+'.png');image.filepath_raw=str(path);image.save();bpy.data.images.remove(image);image=bpy.data.images.load(str(path),check_existing=False);image.name='A02_original_'+role;image.pack();image.filepath='//A02_'+role+'.png'
  image.colorspace_settings.name='sRGB' if role=='base' else 'Non-Color';tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
  if role=='base':m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
  elif role=='orm':
   sep=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(tex.outputs[0],sep.inputs[0]);m.node_tree.links.new(sep.outputs['Green'],p.inputs['Roughness']);m.node_tree.links.new(sep.outputs['Blue'],p.inputs['Metallic'])
  else:
   norm=m.node_tree.nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.3;m.node_tree.links.new(tex.outputs[0],norm.inputs['Color']);m.node_tree.links.new(norm.outputs[0],p.inputs['Normal'])
 return m
steel=steel_material()
reflector=bpy.data.materials.new('A02_amber_roadside_reflector');reflector.use_nodes=True;p=reflector.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.78,.24,.018,1);p.inputs['Metallic'].default_value=0;p.inputs['Roughness'].default_value=.34

current=[]
def finish(o,name,material=steel,bevel=0,segments=1):
 o.name=name;move_collection(o,source);o.data.materials.append(material);bpy.context.view_layer.objects.active=o
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 if bevel:
  mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=min(bevel,min(o.dimensions)*.45);mod.segments=segments;bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.cube_project(cube_size=1);bpy.ops.object.mode_set(mode='OBJECT')
 current.append(o);return o

def cube(name,pos,size,material=steel,bevel=0,segments=1):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,material,bevel,segments)

def profile_extrude(name,profile,z0,z1,bevel=0,segments=1):
 n=len(profile);verts=[xyz((x,y,z))for z in[z0,z1]for x,y in profile];faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o);return finish(o,name,bevel=bevel,segments=segments)

def bolt(name,pos,level,axis='x'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=6 if level==0 else 4,radius=.017 if level==0 else .018,depth=.014,location=xyz(pos),rotation=(0,math.pi/2,0) if axis=='x' else (0,0,0));return finish(bpy.context.object,name,bevel=.0015 if level==0 else 0)

def rail(name,y,variant,level):
 # Closed 4 mm sheet preserves the two-lobed corrugated silhouette at every LOD.
 wave=[(-.155,0),(-.172,.035),(-.096,.077),(-.08,.11),(-.136,.148),(-.158,.16),(-.136,.172),(-.08,.21),(-.096,.253),(-.172,.295),(-.155,.32)]
 if level==2:wave=[wave[i]for i in[0,1,3,5,7,9,10]]
 cross=[(x,h+y)for x,h in wave]+[(x+.004,h+y)for x,h in reversed(wave)]
 if variant!='terminal':return profile_extrude(name,cross,.004,3.796,bevel=.0012 if level==0 else 0,segments=1)
 # Rotate each closed sheet section around a real quarter-circle return.
 # Blending every profile x to one tip coordinate collapses the 4 mm sheet;
 # the tangent frame preserves its thickness and cap area at every station.
 n=len(cross);segments=[8,4,2][level];xref=-.126;radius=.35;start=3.366
 stations=[(xref,.004,0),(xref,start,0)]
 for i in range(1,segments+1):
  theta=i/segments*math.pi/2;stations.append((xref+radius*(1-math.cos(theta)),start+radius*math.sin(theta),theta))
 verts=[]
 for cx,cz,theta in stations:
  for x,h in cross:
   q=x-xref;verts.append(xyz((cx+q*math.cos(theta),h,cz-q*math.sin(theta))))
 # Close the thin corrugation with explicit paired strip quads. A single
 # highly concave n-gon can incorrectly fill a return's open corrugation valleys.
 faces=[];end_offset=(len(stations)-1)*n
 for i in range(len(wave)-1):
  strip=(i,i+1,n-2-i,n-1-i);faces.append(tuple(reversed(strip)));faces.append(tuple(end_offset+k for k in strip))
 for j in range(len(stations)-1):
  for i in range(n):k=(i+1)%n;faces.append((j*n+i,j*n+k,(j+1)*n+k,(j+1)*n+i))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o)
 return finish(o,name,bevel=.0012 if level==0 else 0)

counts={};draws={};sockets={}
for variant in ['run','transition','terminal']:
 vr=bpy.data.objects.new('A02_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[];draws[variant]=[]
 for level in range(3):
  current=[]
  rails=[rail('A02_SOURCE_'+variant+'_lower_W_sheet_L'+str(level),.285,variant,level),rail('A02_SOURCE_'+variant+'_upper_W_sheet_L'+str(level),.615,variant,level)]
  for z in [.12,1.90,3.68]:
   # U-channel posts include an open back and a buried end, rather than boxes.
   if level<2:
    for x in [.057,.187]:cube('A02_SOURCE_post_flange',(x,.455,z),(.012,1.03,.14))
    cube('A02_SOURCE_post_web',(.122,.455,z+.064),(.13,1.03,.012))
   else:cube('A02_SOURCE_far_post',(.122,.455,z),(.14,1.03,.08))
   for row,y in enumerate([.44,.77]):
    if level<2:
     # The curved return changes the real sheet position at the rear post.
     # Sample the authored sheet itself, so spacer and bolt contacts stay
     # attached at every LOD rather than relying on a nominal flat-rail x.
     sheet=rails[row];front_hit=sheet.ray_cast(Vector(xyz((-1,y,z))),Vector((1,0,0)),distance=2);back_hit=sheet.ray_cast(Vector(xyz((1,y,z))),Vector((-1,0,0)),distance=2)
     assert front_hit[0] and back_hit[0],('Missing guardrail contact',variant,level,y,z)
     front=game(front_hit[1])[0];back=game(back_hit[1])[0];assert front<back<.122,(variant,level,y,z,front,back)
     cube('A02_SOURCE_spacing_block',((back+.122)/2,y,z),(.122-back+.006,.12,.10),bevel=.003 if level==0 else 0)
     head=front-.010;bolt('A02_SOURCE_hex_fastener',(head,y,z),level)
     bpy.ops.mesh.primitive_cylinder_add(vertices=8 if level==0 else 6,radius=.008,depth=.122-head,location=xyz(((head+.122)/2,y,z)),rotation=(0,math.pi/2,0));finish(bpy.context.object,'A02_SOURCE_connected_fastener_shank')
   if level==0:
    cube('A02_SOURCE_foot_plate',(.122,-.008,z),(.30,.015,.22),bevel=.002)
    for dz in[-.065,.065]:bolt('A02_SOURCE_anchor_bolt',(.215,.006,z+dz),level,'y')
  if level<2 and variant!='terminal':
   for y in [.445,.775]:
    # Lap straps, offset without extending beyond the retained module envelope.
    cube('A02_SOURCE_overlap_backstrap',(-.05,y,3.70),(.01,.26,.18),bevel=.002 if level==0 else 0)
    if level==0:
     for dy in[-.08,.08]:bolt('A02_SOURCE_lap_bolt',(-.179,y+dy,3.69),level)
  if level<2:
   cube('A02_SOURCE_reflector_mount',(-.16,.915,1.90),(.025,.047,.105),bevel=.004 if level==0 else 0)
   cube('A02_SOURCE_reflector_insert',(-.177,.915,1.90),(.006,.030,.079),reflector,bevel=.002 if level==0 else 0)
  if variant=='transition':
   cube('A02_SOURCE_concrete_transition_shoe',(.055,.495,.075),(.39,.83,.06),bevel=.008 if level==0 else 0,segments=2 if level==0 else 1)
   if level<2:
    for y in [.19,.43,.67,.86]:bolt('A02_SOURCE_transition_bolt',(-.153,y,.046),level)
  if variant=='terminal':
   cube('A02_SOURCE_return_end_plate',(.235,.61,3.715),(.022,.65,.11),bevel=.015 if level==0 else 0,segments=2 if level==0 else 1)
  lr=bpy.data.objects.new('A02_'+variant.upper()+'_LOD'+str(level),None);runtime.objects.link(lr);lr.parent=vr
  tris=0;batches=0
  for material in [steel,reflector]:
   copies=[]
   for o in current:
    o['variant']=variant;o['lod']=level;o['units']='metres';o.hide_render=True
    if o.data.materials[0]!=material:continue
    c=o.copy();c.data=o.data.copy();runtime.objects.link(c);c.hide_render=False;c.hide_set(False);c.data.transform(c.matrix_world);c.matrix_world=Matrix.Identity(4);copies.append(c)
   if not copies:continue
   bpy.ops.object.select_all(action='DESELECT')
   for c in copies:c.select_set(True)
   bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();joined=bpy.context.object
   joined.name=lr.name+('_STEEL' if material==steel else '_REFLECTOR');joined.parent=lr
   tri=joined.modifiers.new('Runtime triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name);joined.data.calc_loop_triangles();tris+=len(joined.data.loop_triangles);batches+=1
   joined.hide_render=level>0
  counts[variant].append(tris);draws[variant].append(batches)
 for name,pos in [('START',(0,0,0)),('END',(0,0,3.8)),('POST_1',(.122,0,.12)),('POST_2',(.122,0,1.9)),('POST_3',(.122,0,3.68)),('FENCE_INTERFACE',(.23,.93,0))]:
  key='A02_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.07;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-steel-guardrails.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<7000 for c in counts.values()),counts
assert len(raw)<3*1024*1024,len(raw)
manifest={'assetId':'A02','revision':REV,'author':'scripts/author-steel-guardrails.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-steel-guardrails.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-steel-guardrails.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':draws,'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'span':3.8,'units':'metres-Y-up-Z-span','sockets':sockets,'bounds':{'min':[-.20,-.06,0],'max':[.275,.97,3.8]},'textureBudget':'three original packed 256-square steel maps; one untextured dielectric reflector','provenance':'Original closed corrugated sheets, U-channel posts, lap/transition hardware, return terminals, reflector housings and deterministic zinc-like pixels. No downloaded art.','collision':'visual-only; original track boundary unchanged','finalArtApproved':False}
(ROOT/'src/rendering/steel-guardrails.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
scene['handoff']='Editable source meshes are separate from batched runtime LODs; no external files required. Root is module start/centreline/track datum. No safety compliance or impact simulation implied.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-steel-guardrails.blend'),compress=True)
print('A02_RECEIPT',json.dumps(manifest))
