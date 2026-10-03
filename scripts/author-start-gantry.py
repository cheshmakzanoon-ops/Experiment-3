"""A07 original start-light gantry and maintenance structure.
Blender 5.2.2 LTS (original construction retained from 4.3.2), metre scale, Y-up/facing-minus-Z GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-start-gantry.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A07_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A07_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A07_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A07_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A07_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A07_START_GANTRY_KIT',None);runtime.objects.link(root);root['assetId']='A07';root['finalArtApproved']=False
REV='aurel-a07-gantry-r02-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal powder coat',(.025,.18,.145),.52,0),('Off-white enamel',(.62,.61,.54),.58,0),('Lamp surround and cable rubber',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Cast concrete footing',(.26,.28,.26),.92,0),('Perforated walkway coating',(.19,.23,.24),.62,.68)]
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
mat=bpy.data.materials.new('A07_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a07-atlas-')as tmp:
  path=Path(tmp)/('A07_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A07_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A07_'+name+'.png'
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
def post(side,level):
 x=side*10.80
 cube('A07_SOURCE_concrete_pad',(x,-.075,0),(.82,.35,.85),6,.045 if level==0 else 0,2 if level==0 else 1)
 cube('A07_SOURCE_steel_baseplate',(x,.135,0),(.58,.065,.59),4,.014 if level==0 else 0)
 cube('A07_SOURCE_main_box_column',(x,2.965,0),(.32,5.60,.40),0,.015 if level==0 else 0,2 if level==0 else 1)
 if level<2:
  for dx in[-.22,.22]:
   for z in[-.22,.22]:cylinder('A07_SOURCE_column_anchor_nut',(x+dx,.186,z),.033,.045,4,level)
  for z in[-.17,.17]:beam('A07_SOURCE_column_knee',(x,4.65,z),(x-side*1.20,5.56,z),.11,4,level)
  for y in[1.5,3.5,5.15]:cube('A07_SOURCE_cable_saddle',(x+.185,y,.19),(.07,.055,.10),4)

def top(level):
 # The retained banner is 14 x 1 m at y=6,z=-.27. Keep its visible face clear.
 cube('A07_SOURCE_banner_fascia',(0,6.0,-.05),(14.48,1.22,.36),0,.035 if level==0 else 0,2 if level==0 else 1)
 for y in[5.48,6.51]:
  for z in[.02,1.13]:cube('A07_SOURCE_box_truss_chord',(0,y,z),(21.90,.16,.16),4,.012 if level==0 else 0)
 for x in[-10.8,10.8]:
  for z in[.02,1.13]:cube('A07_SOURCE_truss_end_vertical',(x,6,z),(.15,1.1,.10),4,.008 if level==0 else 0)
  cube('A07_SOURCE_truss_end_sill',(x,5.375,.58),(.15,.09,1.21),4,.008 if level==0 else 0)
  runs=[(.02,.40),(1.06,1.13)]if x<0 else[(.02,1.13)]
  for a,b in runs:beam('A07_SOURCE_truss_end_upper',(x,6.51,a),(x,6.51,b),.10,4,level)
 if level<2:
  for i in range(12):
   a=-10.65+i*1.775;b=a+1.775
   beam('A07_SOURCE_rear_truss_diagonal',(a,5.50,1.13),(b,6.49,1.13),.065,4,level)
   beam('A07_SOURCE_top_truss_diagonal',(a,6.51,.03),(b,6.51,1.13),.05,4,level)
  for x in[-7.16,0,7.16]:cube('A07_SOURCE_fascia_rear_mount',(x,6,.55),(.09,.08,1.1),4)

def details(level):
 # A single continuous rear catwalk is supported by brackets from the truss.
 cube('A07_SOURCE_non_slip_walkway',(0,5.375,1.77),(21.85,.09,1.13),7,.009 if level==0 else 0)
 cube('A07_SOURCE_ladder_landing',(-11.17,5.375,1.77),(.56,.09,.62),7,.008 if level==0 else 0)
 cube('A07_SOURCE_ladder_foundation',(-11.09,-.075,1.77),(.60,.35,.88),6,.022 if level==0 else 0)
 for z in[1.215,2.335]:cube('A07_SOURCE_walkway_toeboard',(0,5.49,z),(21.85,.20,.025),3)
 for y in[5.94,6.47]:
  for z in[1.23,2.33]:cube('A07_SOURCE_catwalk_handrail',(0,y,z),(21.84,.046,.046),4,.005 if level==0 else 0)
 if level<2:
  for x in[-10.8,-8.1,-5.4,-2.7,0,2.7,5.4,8.1,10.8]:
   beam('A07_SOURCE_rear_rail_post',(x,5.42,2.33),(x,6.5,2.33),.045,4,level)
   beam('A07_SOURCE_walkway_bracket',(x,5.295,.15),(x,5.295,2.30),.07,4,level)
   beam('A07_SOURCE_walkway_bracket_riser',(x,5.295,.15),(x,5.46,.15),.07,4,level)
  for x in[-10.8,10.8]:
   runs=[(1.21,1.44),(2.10,2.33)]if x<0 else[(1.21,2.33)]
   for y in[5.94,6.47]:
    for a,b in runs:beam('A07_SOURCE_catwalk_end_rail',(x,y,a),(x,y,b),.044,4,level)
 # Ladder is outside the retained road aperture; rungs join both stringers.
 for z in[1.48,2.06]:beam('A07_SOURCE_access_ladder_rail',(-11.34,.04,z),(-11.34,6.46,z),.060,4,level)
 step=.27 if level==0 else .54 if level==1 else 1.08
 y=.18
 while y<5.38:
  beam('A07_SOURCE_access_ladder_rung',(-11.34,y,1.48),(-11.34,y,2.06),.036,4,level);y+=step
 if level<2:
  for y in[.55,2.8,5.28]:
   for z in[1.48,2.06]:beam('A07_SOURCE_ladder_standoff',(-10.80,y,.20),(-11.34,y,z),.05,4,level)
  for z in[1.48,2.06]:beam('A07_SOURCE_ladder_top_return',(-11.34,6.46,z),(-10.82,6.46,z),.06,4,level)
  # Rear cable tray, closed junction boxes, feeders and lamp connector entries.
  cube('A07_SOURCE_cable_tray',(0,5.23,.78),(21.50,.06,.16),4)
  for x in[-10.74,10.74]:
   beam('A07_SOURCE_vertical_conduit',(x,.30,.235),(x,5.23,.235),.026,2,level)
   beam('A07_SOURCE_conduit_tray_elbow',(x,5.23,.235),(x,5.23,.78),.026,2,level)
   cube('A07_SOURCE_junction_box',(x,1.14,.30),(.22,.36,.15),1,.017 if level==0 else 0)
   cube('A07_SOURCE_junction_lid',(x,1.14,.381),(.19,.31,.015),0,.012 if level==0 else 0)
  for x in[-.90,-.45,0,.45,.90]:
   beam('A07_SOURCE_lamp_feed',(x,5.23,.75),(x,5.20,.10),.020,2,level)
 # Original five lamp cylinders are retained in-game; no opaque mesh covers them.
 for x in[-.90,-.45,0,.45,.90]:
  cube('A07_SOURCE_lamp_backbox',(x,4.95,-.08),(.40,.42,.22),2,.025 if level==0 else 0,2 if level==0 else 1)
  for dx in[-.188,.188]:cube('A07_SOURCE_lamp_side_bezel',(x+dx,4.95,-.28),(.034,.41,.18),2,.008 if level==0 else 0)
  for y in[4.754,5.146]:cube('A07_SOURCE_lamp_horizontal_bezel',(x,y,-.28),(.343,.025,.18),2,.006 if level==0 else 0)
  cube('A07_SOURCE_lamp_visor',(x,5.185,-.40),(.40,.04,.41),2,.008 if level==0 else 0)
  beam('A07_SOURCE_lamp_bracket',(x,5.41,.10),(x,5.12,.04),.045,4,level)
  if level==0:
   for dx in[-.15,.15]:cube('A07_SOURCE_lamp_mount_fastener',(x+dx,5.155,-.175),(.028,.02,.028),4,.006)
counts=[];draws=[];occluders={}
vr=bpy.data.objects.new('A07_PORTAL',None);runtime.objects.link(vr);vr.parent=root
for level in range(3):
 lr=bpy.data.objects.new(f'A07_PORTAL_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;tris=0
 for part,action in [('COLUMN_LEFT',lambda:post(-1,level)),('COLUMN_RIGHT',lambda:post(1,level)),('TOP',lambda:top(level)),('DETAILS',lambda:details(level))]:
  current=[];action();name=lr.name+'_'+part;tris+=join_runtime(current,name,lr)
  if level==0 and part!='DETAILS':occluders[part]=name
 counts.append(tris);draws.append(4)
sockets={}
for name,pos in [('BANNER',(0,6,-.27)),('LEFT_FOOT',(-10.8,0,0)),('RIGHT_FOOT',(10.8,0,0)),('LADDER_ENTRY',(-11.34,.18,1.77)),('CATWALK',(-10.8,5.42,1.77))]+[(f'LAMP_{i+1}',((i-2)*.45,4.95,-.30))for i in range(5)]:
 key='A07_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.1;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-start-gantry.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert 0<counts[2]<counts[1]<counts[0]<22000,counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A07','revision':REV,'author':'scripts/author-start-gantry.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-start-gantry.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-start-gantry.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':{'portal':counts},'draws':{'portal':draws},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up-facing-minus-Z','sockets':sockets,'bounds':{'min':[-11.46,-.25,-.61],'max':[11.22,6.61,2.36]},'occluders':occluders,'atlasSize':[512,512],'collision':'visual gantry at original station; original start-state and lamps retained','provenance':'Original structural columns, truss, catwalk, ladder, housings, brackets and routed cables; original packed PBR atlas; no downloaded art.','finalArtApproved':False}
(ROOT/'src/rendering/start-gantry.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
scene['handoff']='Canonical origin at original start station. Live lamp cylinders and banner graphic remain runtime-owned; source sockets preserve their exact positions.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-start-gantry.blend'),compress=True);print('A07_RECEIPT',json.dumps(manifest))
