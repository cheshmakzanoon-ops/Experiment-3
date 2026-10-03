"""Original A01 modular race barriers. Blender 5.2.2 LTS (original construction retained from 4.3.2); metres, game Y-up +Z span.
Rebuild in a separate background process, never the interactive Blender file:
  blender -b --factory-startup --python scripts/author-concrete-barriers.py
Editable component objects and a material-batched, three-LOD export are retained.
"""
import bpy, math, json, hashlib, struct, tempfile, sys
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-concrete-barriers.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A01_EDITABLE_COMPONENTS'].objects)==9
 images=[i for i in bpy.data.images if i.name.startswith('A01_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(256,256) for i in images)
 assert all(i.pixels[0:16] for i in images)
 print('A01_EDITABLE_SOURCE_ROUNDTRIP_OK')
 sys.exit(0)
REV='aurel-a01-concrete-r01-b522'
def xyz(p): return (p[0],-p[2],p[1])
def game(p): return (p[0],p[2],-p[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A01_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A01_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A01_CONCRETE_BARRIER_KIT',None);runtime.objects.link(root)
root['assetId']='A01';root['revision']=REV;root['finalArtApproved']=False

def collection_move(o,c):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o)

def material():
 m=bpy.data.materials.new('A01_original_weathered_concrete');m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.9;p.inputs['Metallic'].default_value=0
 n=256; yy,xx=np.mgrid[:n,:n];rng=np.random.default_rng(101)
 fine=rng.random((n,n));grain=(fine-.5)*.065
 patches=(np.sin(xx*.033+np.cos(yy*.067)*1.9)+np.sin(yy*.049+xx*.009))*.016
 pits=(fine>.985).astype(float)*.18
 color=np.stack([.66+grain+patches-pits,.65+grain+patches-pits,.60+grain+patches-pits],axis=-1)
 normal=np.dstack([.5+np.gradient(fine,axis=1)*.12,.5+np.gradient(fine,axis=0)*.12,np.ones((n,n))])
 rough=np.dstack([np.ones((n,n)),np.clip(.88+(fine-.5)*.1,0,1),np.zeros((n,n))])
 for role,pix in [('base',color),('normal',normal),('orm',rough)]:
  # Save/reload before packing so editable source reopens with real PNG pixels.
  image=bpy.data.images.new('A01_original_'+role,width=n,height=n,alpha=True)
  data=np.dstack([np.clip(pix,0,1),np.ones((n,n))]).astype(np.float32)
  image.pixels.foreach_set(data.ravel());image.file_format='PNG'
  with tempfile.TemporaryDirectory(prefix='a01-pixels-') as tmp:
   path=Path(tmp)/('A01_'+role+'.png');image.filepath_raw=str(path);image.save()
   bpy.data.images.remove(image);image=bpy.data.images.load(str(path),check_existing=False);image.name='A01_original_'+role;image.pack();image.filepath='//A01_'+role+'.png'
  image.colorspace_settings.name='sRGB' if role=='base' else 'Non-Color'
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
  if role=='base':
   color=m.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='A01_cast_variation'
   mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
   m.node_tree.links.new(tex.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(color.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
  elif role=='normal':
   node=m.node_tree.nodes.new('ShaderNodeNormalMap');node.inputs['Strength'].default_value=.45;m.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);m.node_tree.links.new(node.outputs[0],p.inputs['Normal'])
  else:
   node=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(tex.outputs['Color'],node.inputs[0]);m.node_tree.links.new(node.outputs['Green'],p.inputs['Roughness'])
 return m
concrete=material()
profile=[(-.275,-.055),(.275,-.055),(.275,.16),(.17,.55),(.17,.89),(.12,.94),(-.12,.94),(-.17,.89),(-.17,.55),(-.275,.16)]

def body(name,variant,level):
 verts=[xyz((x,y,z)) for z in [0,3.8] for x,y in profile]
 n=len(profile);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o);me.materials.append(concrete)
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 # Mould chamfers only remove material from the retained physical envelope.
 if level<2:
  bevel=o.modifiers.new('Cast edge chamfers','BEVEL');bevel.width=.006;bevel.segments=2 if level==0 else 1
  bpy.ops.object.modifier_apply(modifier=bevel.name)
 if level==0:
  cuts=[]
  for x in [-.17,.17]:
   for z in [.62,3.18]:cuts.append(((x,.72,z),(.075,.086,.24),'Side lifting recess'))
  for z in [.02,3.78]:cuts.append(((0,.48,z),(.13,.20,.055),'Recessed connection joint'))
  for pos,size,label in cuts:
   bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));c=bpy.context.object;c.name=label;c.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
   b=c.modifiers.new('Rounded recess corners','BEVEL');b.width=.012;b.segments=2;bpy.context.view_layer.objects.active=c;bpy.ops.object.modifier_apply(modifier=b.name)
   bpy.context.view_layer.objects.active=o;mod=o.modifiers.new(label,'BOOLEAN');mod.operation='DIFFERENCE';mod.object=c;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)
 if variant=='chipped' and level<2:
  for z,x in [(1.11,.27),(2.82,-.27)]:
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.08,location=xyz((x,.145,z)));c=bpy.context.object;c.scale=(1,.7,.7)
   bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Controlled edge spall','BOOLEAN');mod.operation='DIFFERENCE';mod.object=c;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.cube_project(cube_size=1);bpy.ops.object.mode_set(mode='OBJECT')
 # Broad variation belongs to authored vertex colour, not extra overlapping decals.
 col=o.data.color_attributes.new(name='A01_cast_variation',type='FLOAT_COLOR',domain='CORNER')
 for i,loop in enumerate(o.data.loops):
  v=game(o.data.vertices[loop.vertex_index].co);film=max(0,1-(v[1]+.05)/.28)*.13
  rub=(.28*(.7+.3*math.sin(v[2]*5.5))*math.exp(-((v[1]-.42)/.22)**2) if variant=='rubbed' else 0)
  c=max(.55,1-film-rub);col.data[i].color=(c,c,c,1)
 o['variant']=variant;o['lod']=level;o['collision']='visual-only; retained track boundary authoritative'
 return o

triangles={};bounds={}
for vi,variant in enumerate(['clean','rubbed','chipped']):
 vr=bpy.data.objects.new('A01_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root
 triangles[variant]=[]
 for level in range(3):
  o=body('A01_SOURCE_'+variant+'_LOD'+str(level),variant,level)
  copy=o.copy();copy.data=o.data.copy();copy.modifiers.clear();runtime.objects.link(copy);copy.parent=vr;copy.name='A01_'+variant.upper()+'_LOD'+str(level)
  tri=copy.modifiers.new('Runtime triangles','TRIANGULATE');bpy.context.view_layer.objects.active=copy;bpy.ops.object.modifier_apply(modifier=tri.name)
  copy.data.calc_loop_triangles();triangles[variant].append(len(copy.data.loop_triangles))
  # Runtime origins are always module start / centreline / track datum.
  copy['spanMetres']=3.8;copy['lod']=level
  o.hide_render=True;o.hide_set(True)
  if level:copy.hide_render=True
 for name,pos in [('START',(0,0,0)),('END',(0,0,3.8)),('LIFT_LEFT',(-.17,.72,.62)),('LIFT_RIGHT',(.17,.72,3.18))]:
  e=bpy.data.objects.new('A01_'+variant.upper()+'_SOCKET_'+name,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.08;e['purpose']='placement metadata, no physical or gameplay collider'
source.hide_render=True;source.hide_viewport=True
# Export all three levels; visibility is selected by the runtime, not baked into GLB.
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
path=ROOT/'public/models/aurel-concrete-barriers.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='ACTIVE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=path.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
manifest={'assetId':'A01','revision':REV,'author':'scripts/author-concrete-barriers.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-concrete-barriers.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-concrete-barriers.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'materials':len(d.get('materials',[])),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up-Z-span','span':3.8,'profile':profile,'textureBudget':'three original embedded 256-square maps; reused across variants and LODs','collision':'visual geometry only; existing simulation track boundary unchanged','instancing':'conform deterministic repeated modules to retained track stations; merge by material into independently culled 80m LOD chunks','provenance':'Original authored profiles, moulded recesses, controlled spalls and deterministic texture pixels. No downloaded art.','finalArtApproved':False}
assert all(0<counts[2]<counts[1]<counts[0]<1600 for counts in triangles.values()),triangles
assert len(raw)<2*1024*1024,len(raw)
(ROOT/'src/rendering/concrete-barriers.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
scene['handoff']='Editable source collection retains independent module variants and LODs. Runtime modules use +Z span and metre scale; no collision changes. Do not overwrite other racing or house assets.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-concrete-barriers.blend'),compress=True)
print('A01_RECEIPT',json.dumps(manifest))
