"""A08 original flag-panel, utility and timing-sensor hardware family.
Blender 5.2.2 LTS, metre scale, Y-up GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-track-signal-hardware.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A08_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A08_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A08_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A08_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A08_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A08_TRACK_SIGNAL_KIT',None);runtime.objects.link(root);root['assetId']='A08';root['finalArtApproved']=False
REV='aurel-a08-signals-r03'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal powder coat',(.025,.18,.145),.52,0),('Off-white enclosure enamel',(.62,.61,.54),.58,0),('Seals and cable rubber',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Cast concrete footing',(.26,.28,.26),.92,0),('Sensor lens dielectric',(.022,.035,.04),.22,0)]
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
mat=bpy.data.materials.new('A08_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a08-atlas-')as tmp:
  path=Path(tmp)/('A08_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A08_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A08_'+name+'.png'
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
def flag_back(level):
 # Fits strictly behind the retained live LED box, within A06's physical bezel.
 cube('A08_SOURCE_flag_case',(-1.278,1.85,0),(.19,.71,1.13),2,.018 if level==0 else 0,2 if level==0 else 1)
 cube('A08_SOURCE_flag_rear_lid',(-1.172,1.85,0),(.025,.655,1.065),0,.013 if level==0 else 0)
 for z in[-.48,.48]:
  cube('A08_SOURCE_flag_saddle',(-1.14,1.85,z),(.13,.10,.15),4,.005 if level==0 else 0)
  if level<2:
   for y in[1.68,2.02]:cube('A08_SOURCE_flag_lid_clip',(-1.15,y,z),(.043,.07,.026),4,.005 if level==0 else 0)
 if level<2:
  for z in[-.36,0,.36]:
   cube('A08_SOURCE_flag_service_louvre',(-1.154,2.06,z),(.014,.025,.24),2)
  for z in[-.18,.18]:
   cylinder('A08_SOURCE_flag_cable_gland',(-1.25,1.475,z),.029,.055,4,level)
   beam('A08_SOURCE_flag_feed_drop',(-1.25,1.45,z),(-1.20,1.27,z),.016,2,level)
  cube('A08_SOURCE_flag_junction_mount',(-1.205,1.39,0),(.070,.32,.075),4,.006 if level==0 else 0)
  cube('A08_SOURCE_flag_feed_junction',(-1.20,1.24,0),(.065,.075,.45),2,.008 if level==0 else 0)
  cube('A08_SOURCE_flag_floor_connector',(-1.18,.215,-.96),(.075,.065,.06),4,.007 if level==0 else 0)
  beam('A08_SOURCE_flag_feed_elbow',(-1.20,1.27,-.18),(-1.18,1.27,-.96),.018,2,level)
  beam('A08_SOURCE_flag_feed_conduit',(-1.18,1.27,-.96),(-1.18,.23,-.96),.020,2,level)
  for y in[.45,.95]:cube('A08_SOURCE_flag_conduit_clip',(-1.18,y,-.96),(.045,.04,.047),4)
  cube('A08_SOURCE_flag_service_label',(-1.151,1.83,.15),(.008,.10,.24),1,.003)
  if level==0:
   for y in[1.56,2.14]:
    for z in[-.49,.49]:
     bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.013,depth=.012,location=xyz((-1.152,y,z)));o=bpy.context.object;o.rotation_euler[1]=math.pi/2;finish(o,'A08_SOURCE_flag_lid_fastener',4)

def utility(level):
 cube('A08_SOURCE_utility_foundation',(0,.025,0),(.95,.19,.72),6,.022 if level==0 else 0,2 if level==0 else 1)
 cube('A08_SOURCE_utility_enclosure',(0,.685,0),(.72,1.19,.52),1,.028 if level==0 else 0,2 if level==0 else 1)
 cube('A08_SOURCE_overhanging_weather_cap',(0,1.297,-.015),(.79,.06,.61),0,.02 if level==0 else 0)
 for x in[-.174,.174]:cube('A08_SOURCE_sealed_service_door',(x,.685,-.274),(.332,1.09,.022),0,.012 if level==0 else 0)
 if level<2:
  cube('A08_SOURCE_door_centre_seal',(0,.685,-.289),(.012,1.07,.010),2)
  for x in[-.312,.312]:
   for y in[.26,.72,1.12]:cube('A08_SOURCE_concealed_door_hinge',(x,y,-.292),(.041,.072,.035),4,.008 if level==0 else 0)
  for x in[-.074,.074]:
   cube('A08_SOURCE_lock_escutcheon',(x,.73,-.300),(.042,.19,.027),4,.009 if level==0 else 0)
   cube('A08_SOURCE_recessed_pull',(x,.73,-.320),(.022,.12,.018),2,.006 if level==0 else 0)
  for y in[1.00,1.07,1.14]:
   for x in[-.174,.174]:cube('A08_SOURCE_downward_louvre',(x,y,-.302),(.235,.03,.03),4,.003 if level==0 else 0)
  cube('A08_SOURCE_utility_ID',(0,.39,-.291),(.20,.105,.008),5,.005 if level==0 else 0)
  for x in[-.24,.24]:
   cylinder('A08_SOURCE_base_gland',(x,.11,-.15),.031,.055,4,level)
   beam('A08_SOURCE_base_feed',(x,.09,-.15),(x,-.024,-.15),.025,2,level)
  beam('A08_SOURCE_utility_conduit',(.24,.16,-.33),(.24,.60,-.33),.021,2,level)
  beam('A08_SOURCE_utility_conduit_entry',(.24,.60,-.33),(.24,.60,-.27),.021,2,level)
  if level==0:
   for x in[-.40,.40]:
    for z in[-.27,.27]:cylinder('A08_SOURCE_foundation_anchor',(x,.13,z),.019,.025,4,level)

def sensor(level):
 cube('A08_SOURCE_sensor_foot',(0,.035,0),(.44,.18,.44),6,.018 if level==0 else 0)
 cube('A08_SOURCE_sensor_baseplate',(0,.135,0),(.26,.032,.26),4,.009 if level==0 else 0)
 cube('A08_SOURCE_sensor_mast',(0,.59,0),(.095,.90,.095),4,.01 if level==0 else 0)
 cube('A08_SOURCE_sensor_adjustable_saddle',(0,1.065,0),(.18,.07,.18),4,.01 if level==0 else 0)
 cube('A08_SOURCE_sensor_enclosure',(0,1.20,0),(.32,.26,.27),1,.032 if level==0 else 0,2 if level==0 else 1)
 cube('A08_SOURCE_sensor_rear_cover',(.174,1.20,0),(.026,.218,.235),0,.014 if level==0 else 0)
 cube('A08_SOURCE_sensor_front_surround',(-.173,1.20,0),(.025,.21,.22),2,.023 if level==0 else 0)
 bpy.ops.mesh.primitive_cylinder_add(vertices=24 if level==0 else 12 if level==1 else 8,radius=.073,depth=.042,location=xyz((-.188,1.20,0)));o=bpy.context.object;o.rotation_euler[1]=math.pi/2;finish(o,'A08_SOURCE_sensor_optical_face',7,.003 if level==0 else 0,smooth=True)
 cube('A08_SOURCE_sensor_sun_hood',(-.10,1.345,0),(.50,.03,.34),0,.012 if level==0 else 0)
 if level<2:
  for z in[-.155,.155]:cube('A08_SOURCE_sensor_side_hood',(-.20,1.265,z),(.28,.15,.025),0,.008 if level==0 else 0)
  for x in[-.10,.10]:
   for z in[-.10,.10]:cylinder('A08_SOURCE_sensor_anchor',(x,.16,z),.015,.025,4,level)
  for z in[-.09,.09]:cube('A08_SOURCE_sensor_rear_clip',(.192,1.2,z),(.018,.10,.025),4,.004 if level==0 else 0)
  cylinder('A08_SOURCE_sensor_connector',(.095,1.045,.09),.025,.068,4,level)
  for a,b in[((.095,1.01,.09),(.095,.90,.10)),((.095,.90,.10),(.045,.80,.10)),((.045,.80,.10),(.045,.13,.10))]:beam('A08_SOURCE_sensor_routed_feed',a,b,.016,2,level)
  for y in[.30,.73]:cube('A08_SOURCE_sensor_cable_clip',(.045,y,.072),(.04,.026,.07),4)
counts={};sockets={}
for variant,action in [('flag_back',flag_back),('utility',utility),('sensor',sensor)]:
 vr=bpy.data.objects.new('A08_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[];action(level);lr=bpy.data.objects.new(f'A08_{variant.upper()}_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;counts[variant].append(join_runtime(current,lr.name+'_SURFACES',lr))
 points={'flag_back':[('LED_REAR',(-1.375,1.85,0)),('MOUNT',(-1.14,1.85,0)),('FEED',(-1.18,.23,-.96))],'utility':[('BASE',(0,0,0)),('SERVICE_DOOR',(0,.685,-.29)),('FEED',(.24,.16,-.33))],'sensor':[('BASE',(0,0,0)),('OPTICAL_AXIS',(-.21,1.20,0)),('FEED',(.045,.13,.10))]}[variant]
 for name,pos in points:
  key='A08_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.07;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-track-signal-hardware.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<9000 for c in counts.values()),counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A08','revision':REV,'author':'scripts/author-track-signal-hardware.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-track-signal-hardware.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-track-signal-hardware.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up; flag/sensor face minus-X, utility face minus-Z','sockets':sockets,'bounds':{'min':[-1.38,-.07,-.99],'max':[.48,2.21,.58]},'atlasSize':[512,512],'collision':'visual-only enclosures; original race flags, split stations and physical boundaries retained','provenance':'Original enclosures, mounts, clips, service doors, connectors, cable routes and deterministic PBR atlas. No downloaded art or synthetic readings.','finalArtApproved':False}
(ROOT/'src/rendering/track-signal-hardware.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['FLAG_BACK','UTILITY','SENSOR']):bpy.data.objects['A08_'+v].location.x=i*1.25
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
scene['handoff']='Canonical export precedes variant inspection offsets. Retained live LED content and A06 front bezel are not duplicated. Timing enclosures remain passive display hardware.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-track-signal-hardware.blend'),compress=True);print('A08_RECEIPT',json.dumps(manifest))
