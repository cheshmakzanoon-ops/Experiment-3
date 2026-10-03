"""A04 original modular impact blocks and strapped tyre-wall display kit.
Blender 5.2.2 LTS (original construction retained from 4.3.2), metre scale, Y-up/+Z-span GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-impact-barriers.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A04_EDITABLE_COMPONENTS'].objects)>100
 images=[i for i in bpy.data.images if i.name.startswith('A04_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A04_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A04_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A04_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A04_IMPACT_BARRIER_KIT',None);runtime.objects.link(root);root['assetId']='A04';root['finalArtApproved']=False
REV='aurel-a04-impact-r02-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal moulded polymer',(.025,.18,.145),.52,0),('Off-white moulded polymer',(.62,.61,.54),.58,0),('Reused tyre rubber',(.014,.018,.017),.91,0),('Amber woven restraint',(.44,.245,.055),.82,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('White contact film',(.40,.405,.36),.74,0),('Teal contact film',(.018,.12,.096),.72,0)]
n=512;base=np.zeros((n,n,4),dtype=np.uint8);orm=np.zeros_like(base);normal=np.zeros_like(base)
yy,xx=np.mgrid[:256,:128];noise=((xx*127+yy*73+xx*yy*11)%101)/100-.5
for role,(_,color,rough,metal)in enumerate(ROLES):
 x,y=(role%4)*128,(role//4)*256;sl=np.s_[y:y+256,x:x+128]
 c=np.array(color);srgb=np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)
 stain=(np.sin(xx*.033+yy*.009)+np.sin(yy*.04))* (.008 if role in[0,1,6,7] else .003)
 base[sl][:,:,:3]=np.clip((srgb[None,None,:]+noise[:,:,None]*.012+stain[:,:,None])*255,0,255);base[sl][:,:,3]=255
 orm[sl][:,:,0]=255;orm[sl][:,:,1]=np.clip((rough+noise*.05)*255,0,255);orm[sl][:,:,2]=round(metal*255);orm[sl][:,:,3]=255
 weave=np.sin(xx*math.pi/2)*3 if role==3 else 0
 normal[sl]=[128,128,255,255];normal[sl][:,:,0]=np.clip(128+noise*(6 if role==2 else 2)+weave,0,255);normal[sl][:,:,1]=np.clip(128+np.roll(noise,1,0)*3+(np.sin(yy*math.pi/2)*3 if role==3 else 0),0,255)
mat=bpy.data.materials.new('A04_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a04-atlas-')as tmp:
  path=Path(tmp)/('A04_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A04_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A04_'+name+'.png'
 tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND'
 if name=='base':mat.node_tree.links.new(tex.outputs[0],p.inputs['Base Color'])
 elif name=='orm':
  sep=mat.node_tree.nodes.new('ShaderNodeSeparateColor');mat.node_tree.links.new(tex.outputs[0],sep.inputs[0]);mat.node_tree.links.new(sep.outputs['Green'],p.inputs['Roughness']);mat.node_tree.links.new(sep.outputs['Blue'],p.inputs['Metallic'])
 else:
  norm=mat.node_tree.nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.35;mat.node_tree.links.new(tex.outputs[0],norm.inputs['Color']);mat.node_tree.links.new(norm.outputs[0],p.inputs['Normal'])
current=[]
def finish(o,name,role,bevel=0,segments=1,smooth=False):
 o.name=name
 for c in list(o.users_collection):c.objects.unlink(o)
 source.objects.link(o)
 # Blender 5.2 booleans can retain an empty cutter material slot. All faces
 # belong to the same atlas; normalize slots before joining/exporting.
 o.data.materials.clear();o.data.materials.append(mat)
 for poly in o.data.polygons:poly.material_index=0
 o['materialRole']=ROLES[role][0];o['atlasRole']=role
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();bpy.context.view_layer.objects.active=o
 if bevel:
  b=o.modifiers.new('Moulded edge radii','BEVEL');b.width=min(bevel,min(o.dimensions)*.45);b.segments=segments;bpy.ops.object.modifier_apply(modifier=b.name)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.cube_project(cube_size=1);bpy.ops.object.mode_set(mode='OBJECT')
 layer=o.data.uv_layers.active;coords=[tuple(v.uv)for v in layer.data];lo=[min(v[i]for v in coords)for i in[0,1]];hi=[max(v[i]for v in coords)for i in[0,1]]
 for i,uv in enumerate(layer.data):
  u=(coords[i][0]-lo[0])/max(1e-6,hi[0]-lo[0]);v=(coords[i][1]-lo[1])/max(1e-6,hi[1]-lo[1]);uv.uv=((role%4+(8+u*112)/128)/4,1-(role//4+(8+v*240)/256)/2)
 if smooth:
  for poly in o.data.polygons:poly.use_smooth=True
 current.append(o);return o

def cube(name,pos,size,role,bevel=0,segments=1):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,role,bevel,segments)

def profile_mesh(name,cross,z0,z1,role,bevel=0,segments=1):
 n=len(cross);me=bpy.data.meshes.new(name);me.from_pydata([xyz((x,y,z))for z in[z0,z1]for x,y in cross],[],[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o)
 if bevel:
  bpy.context.view_layer.objects.active=o;b=o.modifiers.new('Original cast radii','BEVEL');b.width=min(bevel,min(o.dimensions)*.45);b.segments=segments;bpy.ops.object.modifier_apply(modifier=b.name)
 return o

def block(name,z,role,level,worn):
 cross=[(-.265,-.05),(.265,-.05),(.265,.16),(.21,.76),(.195,.915),(-.195,.915),(-.21,.76),(-.265,.16)]
 o=profile_mesh(name,cross,z-.59,z+.59,role,.028 if level<2 else 0,2 if level==0 else 1)
 if level==0:
  for dz in[-.28,.28]:
   bpy.ops.mesh.primitive_cube_add(size=1,location=xyz((-.205,.67,z+dz)));cut=bpy.context.object;cut.dimensions=(.105,.23,.083);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);b=cut.modifiers.new('Rounded carrying recess','BEVEL');b.width=.024;b.segments=2;bpy.ops.object.modifier_apply(modifier=b.name)
   bpy.context.view_layer.objects.active=o;b=o.modifiers.new('Recessed handling grip','BOOLEAN');b.operation='DIFFERENCE';b.object=cut;bpy.ops.object.modifier_apply(modifier=b.name);bpy.data.objects.remove(cut,do_unlink=True)
 finish(o,name,role)
 if worn:
  # Contact films live in the PBR atlas, not extra overlapping wear geometry.
  layer=o.data.uv_layers.active;wrole=7 if role==0 else 6
  for face in o.data.polygons:
   center=o.matrix_world@face.center;x,y,_=game(center)
   if x<-.18 and .18<y<.61:
    for li in face.loop_indices:
     uv=layer.data[li].uv;u=uv.x*4-role%4;v=(1-uv.y)*2-role//4;uv.x=(wrole%4+u)/4;uv.y=1-(wrole//4+v)/2
 return o

def strap(name,z,level):
 points=[(-.27,.05),(-.27,.15),(-.214,.76),(-.201,.918),(.201,.918),(.214,.76),(.27,.15),(.27,.05)]
 if level==1:points=[points[i]for i in[0,2,3,4,5,7]]
 verts=[];faces=[]
 for i,(x,y)in enumerate(points):
  a=Vector(points[max(0,i-1)]);b=Vector(points[min(len(points)-1,i+1)]);t=(b-a).normalized();normal=Vector((-t.y,t.x))*.0025
  for sign,dz in[(-1,-.02),(-1,.02),(1,.02),(1,-.02)]:verts.append(xyz((x+normal.x*sign,y+normal.y*sign,z+dz)))
 for i in range(len(points)-1):
  for j in range(4):faces.append((i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j))
 faces.extend([(3,2,1,0),tuple((len(points)-1)*4+i for i in range(4))]);me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o);finish(o,name,3)
 if level==0:cube('A04_SOURCE_restraint_buckle',(-.269,.32,z),(.012,.054,.047),4,.002)

def tyre(name,center,level,ordinal):
 seg=32 if level==0 else 12;r=.268+math.sin(ordinal*1.9)*.004;w=.225
 profile=[(.147,-w*.42),(.174,-w*.5),(r-.035,-w*.5),(r-.003,-w*.31),(r-.003,w*.31),(r-.035,w*.5),(.174,w*.5),(.147,w*.42)]
 if level==1:profile=[profile[i]for i in[0,2,3,4,5,7]]
 verts=[];faces=[]
 for i in range(seg):
  a=2*math.pi*i/seg
  for radius,height in profile:verts.append(xyz((center[0]+radius*math.cos(a),center[1]+height,center[2]+radius*math.sin(a))))
 n=len(profile)
 for i in range(seg):
  for j in range(n):faces.append((i*n+j,((i+1)%seg)*n+j,((i+1)%seg)*n+(j+1)%n,i*n+(j+1)%n))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);source.objects.link(o);return finish(o,name,2,smooth=True)

def wrap(center,level):
 seg=32 if level==0 else 12;verts=[];faces=[]
 for i in range(seg):
  a=2*math.pi*i/seg
  for radius,y in[(.272,.31),(.272,.58),(.269,.58),(.269,.31)]:
   verts.append(xyz((radius*math.cos(a),y,center+radius*math.sin(a))))
 for i in range(seg):
  for j in range(4):faces.append((i*4+j,((i+1)%seg)*4+j,((i+1)%seg)*4+(j+1)%4,i*4+(j+1)%4))
 me=bpy.data.meshes.new('Original containment wrap');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('A04_SOURCE_fitted_containment_wrap',me);source.objects.link(o);finish(o,o.name,0,smooth=True)

def spine(level):
 # Retained-height rear structure supports the fence interface without moving
 # the track's abstract physical boundary or expanding its display envelope.
 for z in[.06,1.9,3.74]:cube('A04_SOURCE_rear_stanchion',(.23,.465,z),(.055,.95,.07),4,.005 if level==0 else 0)
 for y in[.10,.90]:cube('A04_SOURCE_rear_connection_rail',(.226,y,1.90),(.05,.06,3.78),4,.005 if level==0 else 0)
 if level==0:
  for z in[.06,1.9,3.74]:cube('A04_SOURCE_frame_foot',(.19,-.031,z),(.16,.024,.12),4,.003)

counts={};sockets={}
for variant,role in [('teal',0),('white',1),('tyres',2)]:
 vr=bpy.data.objects.new('A04_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[];spine(level)
  if variant!='tyres':
   for i,z in enumerate([.63,1.90,3.17]):
    block('A04_SOURCE_'+variant+'_segmented_block',z,role,level,i==1)
    if level<2:
     for dz in[-.35,.35]:strap('A04_SOURCE_fitted_restraint',z+dz,level)
     cube('A04_SOURCE_identification_plate',(-.244,.44,z),(.008,.082,.16),5,.008 if level==0 else 0)
   if level<2:
    for z in[1.265,2.535]:cube('A04_SOURCE_segment_link',(.237,.47,z),(.052,.12,.17),4,.004 if level==0 else 0)
  else:
   for i in range(6):
    z=(i+.5)*3.8/6
    if level<2:
     for row in range(4):tyre('A04_SOURCE_reused_tyre',(0,.0625+row*.227,z),level,i*4+row)
     wrap(z,level)
     # Retainers pass over and around each tyre stack; rubber remains material-driven.
     cube('A04_SOURCE_tyre_front_tie',(-.273,.407,z),(.006,.90,.04),3)
     cube('A04_SOURCE_tyre_top_tie',(0,.860,z),(.54,.006,.04),3)
     cube('A04_SOURCE_tyre_back_tie',(.268,.407,z),(.006,.90,.04),3)
     if level==0:cube('A04_SOURCE_tyre_tie_buckle',(-.269,.42,z),(.012,.056,.045),4,.003)
    else:
     bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.272,depth=.906,location=xyz((0,.403,z)));finish(bpy.context.object,'A04_SOURCE_far_tyre_stack',2)
  lr=bpy.data.objects.new('A04_'+variant.upper()+'_LOD'+str(level),None);runtime.objects.link(lr);lr.parent=vr;copies=[]
  for o in current:
   o['variant']=variant;o['lod']=level;o.hide_render=True;c=o.copy();c.data=o.data.copy();runtime.objects.link(c);c.hide_render=False;c.hide_set(False);c.data.transform(c.matrix_world);c.matrix_world=Matrix.Identity(4);copies.append(c)
  bpy.ops.object.select_all(action='DESELECT')
  for c in copies:c.select_set(True)
  bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();joined=bpy.context.object;joined.name=lr.name+'_SURFACES';joined.parent=lr;b=joined.modifiers.new('Runtime triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=b.name);joined.data.calc_loop_triangles();counts[variant].append(len(joined.data.loop_triangles));joined.hide_render=level>0
 for name,pos in [('START',(0,.47,0)),('END',(0,.47,3.8)),('FENCE_INTERFACE',(.23,.94,.06)),('LIFT_A',(0,.94,.63)),('LIFT_B',(0,.94,3.17))]:
  key='A04_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.07;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-impact-barriers.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<16000 for c in counts.values()),counts
assert len(raw)<4*1024*1024,len(raw)
assert all(len(m['primitives'])==1 and m['primitives'][0].get('material')==0 for m in d['meshes']), 'A04 must use one atlas draw per mesh'
manifest={'assetId':'A04','revision':REV,'author':'scripts/author-impact-barriers.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-impact-barriers.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-impact-barriers.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'span':3.8,'units':'metres-Y-up-Z-span','sockets':sockets,'bounds':{'min':[-.276,-.055,0],'max':[.276,.942,3.8]},'atlasSize':[512,512],'atlasRoles':[{'name':n,'linearColor':c,'roughness':r,'metalness':m}for n,c,r,m in ROLES],'collision':'visual-only; no energy-absorption simulation or physical-boundary changes','provenance':'Original moulded blocks, carrying recesses, woven restraints, connectors, generic reused tyres, rear supports and deterministic PBR atlas. No downloaded art or race-wheel replacement.','finalArtApproved':False}
(ROOT/'src/rendering/impact-barriers.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['TEAL','WHITE','TYRES']):bpy.data.objects['A04_'+v].location.x=(i-1)*1.3
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_set(True)
scene['handoff']='Canonical GLB exported before separated inspection layout. Editable source objects carry semantic atlas roles. Physical wall, wheel handling and crash behavior remain unchanged.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-impact-barriers.blend'),compress=True)
print('A04_RECEIPT',json.dumps(manifest))
