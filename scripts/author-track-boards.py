"""A09 original braking-distance and sector-board family.
Blender 5.2.2 LTS, metre scale, Y-up GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-track-boards.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A09_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A09_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A09_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A09_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A09_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A09_TRACK_BOARD_KIT',None);runtime.objects.link(root);root['assetId']='A09';root['finalArtApproved']=False
REV='aurel-a09-boards-r02'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal powder coat',(.025,.18,.145),.52,0),('Off-white composite panel',(.62,.61,.54),.58,0),('Weighted recycled-rubber feet',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Cast concrete footing',(.26,.28,.26),.92,0),('Weathered panel finish',(.38,.40,.34),.83,0)]
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
mat=bpy.data.materials.new('A09_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a09-atlas-')as tmp:
  path=Path(tmp)/('A09_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A09_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A09_'+name+'.png'
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
 source.objects.link(o);o.data.materials.append(mat);o['materialRole']=ROLES[role][0];o['atlasRole']=role
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();bpy.context.view_layer.objects.active=o
 if bevel:
  b=o.modifiers.new('Moulded edge radii','BEVEL');b.width=bevel;b.segments=segments;bpy.ops.object.modifier_apply(modifier=b.name)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.cube_project(cube_size=1);bpy.ops.object.mode_set(mode='OBJECT')
 layer=o.data.uv_layers.active;coords=[tuple(v.uv)for v in layer.data];lo=[min(v[i]for v in coords)for i in[0,1]];hi=[max(v[i]for v in coords)for i in[0,1]]
 for i,uv in enumerate(layer.data):
  u=(coords[i][0]-lo[0])/max(1e-6,hi[0]-lo[0]);v=(coords[i][1]-lo[1])/max(1e-6,hi[1]-lo[1]);uv.uv=((role%4+(8+u*112)/128)/4,1-(role//4+(8+v*240)/256)/2)
 if smooth:
  for poly in o.data.polygons:poly.use_smooth=True
 current.append(o);return o

def cube(name,pos,size,role,bevel=0,segments=1):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,role,bevel,segments)

def cylinder(name,pos,r,depth,role,level):
 bpy.ops.mesh.primitive_cylinder_add(vertices=16 if level==0 else 8,radius=r,depth=depth,location=xyz(pos));return finish(bpy.context.object,name,role,.002 if level==0 else 0,smooth=True)
def beam(name,a,b,width,role,level):
 av=Vector(xyz(a));bv=Vector(xyz(b));bpy.ops.mesh.primitive_cube_add(size=1,location=(av+bv)/2);o=bpy.context.object;o.dimensions=(width,width,(bv-av).length);o.rotation_euler=(bv-av).to_track_quat('Z','Y').to_euler();bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,role,.003 if level==0 else 0)
def join_runtime(objects,name,parent,pivot=(0,0,0)):
 copies=[]
 for o in objects:
  o.hide_render=True;c=o.copy();c.data=o.data.copy();runtime.objects.link(c);c.hide_render=False;c.hide_set(False);c.data.transform(c.matrix_world);c.matrix_world=Matrix.Identity(4);copies.append(c)
 bpy.ops.object.select_all(action='DESELECT')
 for c in copies:c.select_set(True)
 bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;o.data.transform(Matrix.Translation(-Vector(xyz(pivot))));o.parent=parent;o.location=(0,0,0);mod=o.modifiers.new('Export triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name);o.data.calc_loop_triangles();return len(o.data.loop_triangles)
def foot(x,level):
 cube('A09_SOURCE_weighted_foot',(x,.012,-.055),(.23,.15,.45),2,.025 if level==0 else 0,2 if level==0 else 1)
 cube('A09_SOURCE_post_receiver',(x,.14,-.055),(.105,.13,.11),4,.008 if level==0 else 0)
 if level==0:
  for z in[-.17,.065]:cylinder('A09_SOURCE_foot_retainer',(x,.098,z),.019,.03,4,level)

def board(variant,level):
 sector=variant=='sector';width=1.20 if sector else 1.0;height=.60 if sector else .90;y=2.0 if sector else 2.2;postx=width*.35;role=0 if sector else 7 if variant=='worn' else 1
 cube('A09_SOURCE_thin_composite_panel',(0,y,-.024),(width,height,.04),role,.008 if level==0 else 0,2 if level==0 else 1)
 for x in[-width/2-.007,width/2+.007]:cube('A09_SOURCE_folded_vertical_edge',(x,y,-.006),(.026,height+.052,.043),role,.008 if level==0 else 0)
 for sy in[-1,1]:
  yy=y+sy*(height/2+.009)
  if variant=='worn' and sy==1 and level<2:
   cube('A09_SOURCE_worn_upper_edge_a',(-.085,yy,-.006),(.84,.026,.043),7,.005 if level==0 else 0)
   cube('A09_SOURCE_worn_upper_edge_b',(.43,yy,-.006),(.13,.026,.043),7,.005 if level==0 else 0)
  else:cube('A09_SOURCE_folded_horizontal_edge',(0,yy,-.006),(width,.026,.043),role,.008 if level==0 else 0)
 for x in[-postx,postx]:
  foot(x,level)
  cube('A09_SOURCE_galvanized_post',(x,(y+height*.4+.14)/2,-.065),(.065,y+height*.4-.14,.065),4,.007 if level==0 else 0)
  if level<2:
   for yy in[y-height*.31,y+height*.31]:
    cube('A09_SOURCE_panel_clamp',(x,yy,-.10),(.12,.08,.075),4,.008 if level==0 else 0)
   beam('A09_SOURCE_rear_knee',(x,y-.50,-.065),(x,y-.18,-.125),.035,4,level)
  if level==0:
   for yy in[y-height*.31,y+height*.31]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.015,depth=.018,location=xyz((x,yy,-.144)));o=bpy.context.object;o.rotation_euler[0]=math.pi/2;finish(o,'A09_SOURCE_captive_fastener',4)
 if level<2:
  for yy in[y-height*.31,y+height*.31]:cube('A09_SOURCE_rear_attachment_rail',(0,yy,-.073),(width-.08,.048,.045),4,.005 if level==0 else 0)
  cube('A09_SOURCE_rear_manufacture_tab',(0,y-height*.25,-.047),(.16,.055,.008),5,.003 if level==0 else 0)
counts={};sockets={};faces={}
for variant in['clean','worn','sector']:
 vr=bpy.data.objects.new('A09_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[];board(variant,level);lr=bpy.data.objects.new(f'A09_{variant.upper()}_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;counts[variant].append(join_runtime(current,lr.name+'_SURFACES',lr))
 y=2.0 if variant=='sector' else 2.2;w=1.16 if variant=='sector' else .96;h=.56 if variant=='sector'else .86;faces[variant]={'position':[0,y,0],'width':w,'height':h,'normal':[0,0,1],'textureSize':[512,256]if variant=='sector'else[256,256]}
 for name,pos in [('FACE',(0,y,0)),('LEFT_FOOT',(-(.42 if variant=='sector'else .35),0,-.055)),('RIGHT_FOOT',((.42 if variant=='sector'else .35),0,-.055))]:
  key='A09_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.08;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-track-boards.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<7000 for c in counts.values()),counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A09','revision':REV,'author':'scripts/author-track-boards.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-track-boards.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-track-boards.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up-facing-plus-Z','sockets':sockets,'faces':faces,'bounds':{'min':[-.64,-.063,-.281],'max':[.64,2.68,.171]},'atlasSize':[512,512],'collision':'visual boards; original braking stations and sector definitions retained','provenance':'Original thin panels, folded edges, rear attachments, captive fasteners and weighted feet; original packed PBR atlas. Runtime graphics use the existing original label style.','finalArtApproved':False}
(ROOT/'src/rendering/track-boards.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['CLEAN','WORN','SECTOR']):bpy.data.objects['A09_'+v].location.x=(i-1)*1.7
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
# Readable editing previews are deliberately not exported. The game shares
# five Canvas label textures with the existing font/theme and correct aspect.
preview=bpy.data.collections.new('A09_NONEXPORT_LABEL_PREVIEW');scene.collection.children.link(preview)
ink=bpy.data.materials.new('A09 preview ivory ink');ink.diffuse_color=(.90,.85,.73,1)
dark=bpy.data.materials.new('A09 preview dark sign face');dark.diffuse_color=(.008,.013,.018,1)
for i,(variant,text)in enumerate([('clean','150'),('worn','100'),('sector','S1')]):
 f=faces[variant];dx=(i-1)*1.7
 bpy.ops.mesh.primitive_plane_add(size=1,location=xyz((dx,f['position'][1],.001)));o=bpy.context.object;o.rotation_euler[0]=math.pi/2;o.scale=(f['width'],f['height'],1);o.data.materials.append(dark)
 for c in list(o.users_collection):c.objects.unlink(o)
 preview.objects.link(o)
 bpy.ops.object.text_add(location=xyz((dx,f['position'][1],.003)));o=bpy.context.object;o.data.body=text;o.data.align_x='CENTER';o.data.align_y='CENTER';o.data.size=f['height']*.58;o.rotation_euler[0]=math.pi/2;o.data.materials.append(ink)
 for c in list(o.users_collection):c.objects.unlink(o)
 preview.objects.link(o)
scene['handoff']='Canonical export precedes inspection offsets. Printed faces are runtime-owned; source preview uses built-in Blender text only and is excluded from GLB. Foot sockets and face extents retain metre-space placement.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-track-boards.blend'),compress=True);print('A09_RECEIPT',json.dumps(manifest))
