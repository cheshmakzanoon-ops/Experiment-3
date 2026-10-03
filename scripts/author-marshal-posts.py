"""A06 original marshal shelter and protected working-platform family.
Blender 5.2.2 LTS (original construction retained from 4.3.2), metre scale, Y-up/+Z-span GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-marshal-posts.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A06_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A06_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A06_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A06_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A06_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A06_MARSHAL_POST_KIT',None);runtime.objects.link(root);root['assetId']='A06';root['finalArtApproved']=False
REV='aurel-a06-marshal-r01-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal moulded polymer',(.025,.18,.145),.52,0),('Off-white moulded polymer',(.62,.61,.54),.58,0),('Hinge grease and seals',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Cast concrete footing',(.26,.28,.26),.92,0),('Roof standing seam',(.19,.23,.24),.62,.68)]
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
mat=bpy.data.materials.new('A06_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a06-atlas-')as tmp:
  path=Path(tmp)/('A06_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A06_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A06_'+name+'.png'
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
def roof(level):
 cross=[(-1.62,2.52),(1.62,2.42),(1.62,2.48),(-1.62,2.58)]
 me=bpy.data.meshes.new('Folded waterproof roof');me.from_pydata([xyz((x,y,z))for z in[-1.39,1.39]for x,y in cross],[],[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);me.update();o=bpy.data.objects.new('A06_SOURCE_folded_roof',me);source.objects.link(o);finish(o,o.name,1,.005 if level==0 else 0)
 if level<2:
  for z in[-1.36,-.68,0,.68,1.36]:beam('A06_SOURCE_roof_seam',(-1.61,2.59,z),(1.61,2.49,z),.016,7,level)
  for z in[-1.17,0,1.17]:beam('A06_SOURCE_roof_underside_rib',(-1.53,2.49,z),(1.53,2.39,z),.07,4,level)
 for z in[-1.40,1.40]:beam('A06_SOURCE_folded_roof_fascia',(-1.63,2.50,z),(1.63,2.40,z),.10,0,level)

def structure(variant,level):
 cube('A06_SOURCE_terrain_connected_plinth',(0,0,0),(3.10,.36,2.50),6,.025 if level==0 else 0,2 if level==0 else 1)
 cube('A06_SOURCE_non_slip_deck',(0,.184,0),(3.02,.008,2.42),2)
 for x in[-1.38,1.38]:
  for z in[-1.14,1.14]:
   top=2.49-(x+1.53)/3.06*.1
   cube('A06_SOURCE_structural_column',(x,(top+.18)/2,z),(.09,top-.18,.09),4,.008 if level==0 else 0)
   cube('A06_SOURCE_column_base_plate',(x,.20,z),(.20,.04,.19),4,.006 if level==0 else 0)
   if level==0:
    for dx in[-.065,.065]:cylinder('A06_SOURCE_column_anchor',(x+dx,.235,z),.015,.018,4,level)
   if level<2:beam('A06_SOURCE_roof_knee',(x,top-.34,z),(x*.77,top-.07,z),.04,4,level)
 # Back lining is split into three practical sheet widths with retained joints.
 for z in[-.80,0,.80]:cube('A06_SOURCE_rear_weather_panel',(1.415,1.24,z),(.065,2.08,.785),0,.008 if level==0 else 0)
 if level<2:
  for y in[.38,1.23,2.12]:cube('A06_SOURCE_rear_frame_rail',(1.36,y,0),(.055,.05,2.34),4)
  for z in[-1.19,1.19]:beam('A06_SOURCE_rear_wind_brace',(1.37,.30,z),(.95,2.25,z),.036,4,level)
  for z in[-.83,-.42,0,.42,.83]:cube('A06_SOURCE_rear_louvre',(1.45,2.12,z),(.025,.07,.27),2)
 roof(level)
 if level<2:
  cube('A06_SOURCE_rear_gutter',(1.60,2.395,0),(.12,.10,2.80),7,.012 if level==0 else 0)
  for z in[-1.35,1.35]:cube('A06_SOURCE_gutter_endcap',(1.60,2.395,z),(.13,.11,.03),4)
  beam('A06_SOURCE_drain_pipe',(1.62,2.36,-1.23),(1.62,.02,-1.23),.052,4,level)
  for y in[.45,1.70]:cube('A06_SOURCE_pipe_saddle',(1.52,y,-1.23),(.18,.033,.085),4)
 # Two shallow risers preserve the existing 0.18 m staff foot datum.
 cube('A06_SOURCE_first_step',(-.30,.045,1.68),(1.04,.09,.48),6,.016 if level==0 else 0)
 cube('A06_SOURCE_second_step',(-.30,.125,1.33),(1.04,.11,.28),6,.014 if level==0 else 0)
 if level<2:
  for z,y in[(1.89,.091),(1.46,.181)]:cube('A06_SOURCE_step_nosing',(-.30,y,z),(.99,.008,.028),3)
  for x in[-.86,.26]:
   for z,y in[(1.83,.045),(1.10,.18)]:beam('A06_SOURCE_stair_handrail_post',(x,y,z),(x,y+.86,z),.032,4,level)
   beam('A06_SOURCE_stair_handrail', (x,.905,1.83),(x,1.04,1.10),.032,4,level)
  for z in[-1.18,1.18]:
   runs=[(-1.40,1.33)]if z<0 else[(-1.40,-.86),(.26,1.33)]
   for lo,hi in runs:
    beam('A06_SOURCE_protected_side_rail',(lo,.96,z),(hi,.96,z),.032,4,level)
    beam('A06_SOURCE_protected_side_toe',(lo,.29,z),(hi,.29,z),.024,4,level)
   for x in([- .85,.55]if z<0 else[-1.20,.80]):beam('A06_SOURCE_side_rail_stanchion',(x,.20,z),(x,.96,z),.025,4,level)
  for x in[-.86,.26]:beam('A06_SOURCE_access_rail_return',(x,.96,1.18),(x,.96,1.10),.032,4,level)
 if variant=='sheltered':
  cube('A06_SOURCE_short_wind_screen',(.62,1.12,-1.20),(1.48,1.68,.055),1,.012 if level==0 else 0)
 # Keep the original LED content envelope and semantic ownership outside the GLB.
 for y in[1.465,2.235]:cube('A06_SOURCE_LED_bezel_horizontal',(-1.418,y,0),(.105,.055,1.235),2,.007 if level==0 else 0)
 for z in[-.604,.604]:cube('A06_SOURCE_LED_bezel_vertical',(-1.418,1.85,z),(.105,.72,.06),2,.007 if level==0 else 0)
 if level<2:
  for z in[-.60,.60]:beam('A06_SOURCE_LED_standoff',(-1.35,1.85,z),(-1.16,1.85,z),.045,4,level)
  cube('A06_SOURCE_LED_back_rail',(-1.15,1.85,0),(.06,.055,2.30),4)
  for z in[-1.14,1.14]:beam('A06_SOURCE_LED_mount_bracket',(-1.38,1.85,z),(-1.14,1.85,z),.05,4,level)
  cube('A06_SOURCE_equipment_locker',(.98,.75,-.66),(.49,1.12,.62),1,.023 if level==0 else 0,2 if level==0 else 1)
  cube('A06_SOURCE_locker_door',(.721,.76,-.66),(.024,1.04,.55),0,.01 if level==0 else 0)
  cube('A06_SOURCE_locker_handle',(.69,.85,-.48),(.035,.14,.025),2,.007 if level==0 else 0)
  for y in[.47,1.04]:cube('A06_SOURCE_locker_hinge',(.698,y,-.91),(.024,.11,.034),4)
  cube('A06_SOURCE_radio_shelf',(.96,1.34,.35),(.56,.035,.64),4,.01 if level==0 else 0)
  for z in[.10,.60]:beam('A06_SOURCE_shelf_bracket',(1.34,1.04,z),(.80,1.32,z),.025,4,level)
  cube('A06_SOURCE_rear_equipment_mount',(1.365,1.70,.36),(.045,.40,.58),1)
  for z in[.17,.35,.53]:cube('A06_SOURCE_flag_tool_clip',(1.32,1.70,z),(.045,.09,.05),4,.008 if level==0 else 0)
  for z in[-.70,.70]:
   cube('A06_SOURCE_extinguisher_foot',(.63,.095,z),(.25,.015,.25),4)
   cube('A06_SOURCE_extinguisher_behind_mount',(.75,.38,z),(.025,.48,.22),4)
counts={};sockets={}
for variant in['open','sheltered']:
 vr=bpy.data.objects.new('A06_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[];structure(variant,level);lr=bpy.data.objects.new(f'A06_{variant.upper()}_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;tri=join_runtime(current,lr.name+'_SURFACES',lr);counts[variant].append(tri)
 for name,pos in [('LED_PANEL',(-1.42,1.85,0)),('STAFF_A',(-.18,.18,-.525)),('STAFF_B',(-.18,.18,.525)),('EXTINGUISHER_A',(.63,.4,-.7)),('EXTINGUISHER_B',(.63,.4,.7)),('STEP_ENTRY',(-.30,.09,1.80)),('RADIO',(.96,1.37,.35))]:
  key='A06_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.08;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-marshal-posts.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<18000 for c in counts.values()),counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A06','revision':REV,'author':'scripts/author-marshal-posts.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-marshal-posts.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-marshal-posts.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up-front-minus-X','sockets':sockets,'bounds':{'min':[-1.68,-.18,-1.46],'max':[1.68,2.64,1.94]},'atlasSize':[512,512],'staffDatum':.18,'collision':'visual shelter at existing marshal sites; no road or race-state change','provenance':'Original folded roofs, frames, platforms, stairs, handrails, cabinet and equipment mounts, packed original PBR atlas; existing staff and LED content retained.','finalArtApproved':False}
(ROOT/'src/rendering/marshal-posts.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['OPEN','SHELTERED']):bpy.data.objects['A06_'+v].location.x=(i-.5)*4.2
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
scene['handoff']='Export precedes separated inspection layout. Existing live LED panel, staff foot datum and extinguishers remain runtime-owned. Source contains their explicit attachment sockets.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-marshal-posts.blend'),compress=True);print('A06_RECEIPT',json.dumps(manifest))
