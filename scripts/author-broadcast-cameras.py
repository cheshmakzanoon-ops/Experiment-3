"""A10 original broadcast camera, tripod and compact platform family.
Blender 5.2.2 LTS, metre scale, Y-up GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-broadcast-cameras.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A10_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A10_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A10_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A10_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A10_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A10_BROADCAST_CAMERA_KIT',None);runtime.objects.link(root);root['assetId']='A10';root['finalArtApproved']=False
REV='aurel-a10-cameras-r03'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Camera powder coat',(.025,.18,.145),.52,0),('Camera shell enamel',(.62,.61,.54),.58,0),('Rain cover and cable rubber',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Cast concrete footing',(.26,.28,.26),.92,0),('Broadcast optical coating',(.022,.035,.04),.22,0)]
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
# Original radial optical coating stays in the atlas, not transparent layers.
x,y=384,256;sl=np.s_[y:y+256,x:x+128];rx=(xx-63.5)/56;ry=(yy-127.5)/120;rr=np.sqrt(rx*rx+ry*ry)
ring=np.exp(-((rr-.70)/.10)**2);edge=np.exp(-((rr-.90)/.045)**2)
colors=np.array([.002,.008,.012])[None,None,:]+ring[:,:,None]*np.array([.033,.068,.085])[None,None,:]+edge[:,:,None]*.012
srgb=np.where(colors<=.0031308,colors*12.92,1.055*colors**(1/2.4)-.055);base[sl][:,:,:3]=np.clip(srgb*255,0,255)
orm[sl][:,:,1]=np.clip((.09+noise*.012)*255,0,255);orm[sl][:,:,2]=12
normal[sl][:,:,0]=np.clip(128+rx*15,0,255);normal[sl][:,:,1]=np.clip(128+ry*15,0,255)
mat=bpy.data.materials.new('A10_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a10-atlas-')as tmp:
  path=Path(tmp)/('A10_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A10_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A10_'+name+'.png'
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
def axial(name,pos,front,back,length,role,level):
 bpy.ops.mesh.primitive_cone_add(vertices=24 if level==0 else 12 if level==1 else 8,radius1=front,radius2=back,depth=length,location=xyz(pos));o=bpy.context.object;o.rotation_euler[0]=math.pi/2;finish(o,name,role,.003 if level==0 else 0,smooth=True)
 if role==7:
  uv=o.data.uv_layers.active
  for face in o.data.polygons:
   if face.normal.z<-.4:
    for li in face.loop_indices:
     co=o.data.vertices[o.data.loops[li].vertex_index].co;u=max(0,min(1,.5+co.x/(2*front)));v=max(0,min(1,.5+co.y/(2*front)));uv.data[li].uv=((3+(8+112*u)/128)/4,1-(1+(8+240*v)/256)/2)
 return o
def cover(level):
 profile=[(-.265,-.17),(-.285,.10),(-.19,.225),(.19,.225),(.285,.10),(.265,-.17)]
 n=len(profile);me=bpy.data.meshes.new('Original folded waterproof camera cover');me.from_pydata([xyz((x,y,z))for z in[.48,1.16]for x,y in profile],[],[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]);me.update();o=bpy.data.objects.new('A10_SOURCE_fitted_rain_cover',me);source.objects.link(o);finish(o,o.name,2,.009 if level==0 else 0)
 if level<2:
  for x in[-.271,.271]:cube('A10_SOURCE_cover_hem',(x,-.158,.83),(.012,.021,.64),4)
  for z in[.53,1.11]:cube('A10_SOURCE_cover_seam',(0,.226,z),(.31,.013,.014),2)
  cube('A10_SOURCE_cover_retainer',(0,.234,.92),(.38,.012,.035),3)
def camera(variant,level):
 cube('A10_SOURCE_camera_cast_body',(0,0,.79),(.46,.34,.68),1,.055 if level==0 else .02 if level==1 else 0,3 if level==0 else 1)
 cube('A10_SOURCE_camera_rear_cover',(0,0,1.141),(.39,.28,.03),0,.025 if level==0 else 0)
 for x in[-.24,.24]:cube('A10_SOURCE_camera_side_plate',(x,0,.81),(.02,.27,.46),0,.02 if level==0 else 0)
 axial('A10_SOURCE_lens_barrel',(0,0,.325),.103,.118,.24,4,level)
 axial('A10_SOURCE_focus_ring',(0,0,.458),.126,.126,.086,2,level)
 axial('A10_SOURCE_optical_front',(0,0,.199),.094,.094,.012,7,level)
 for x in[-.158,.158]:cube('A10_SOURCE_lens_hood_side',(x,0,.30),(.025,.272,.24),2,.008 if level==0 else 0)
 for y in[-.137,.137]:cube('A10_SOURCE_lens_hood_lip',(0,y,.30),(.34,.026,.24),2,.008 if level==0 else 0)
 if level<2:
  for z in[.65,.98]:cube('A10_SOURCE_carry_handle_leg',(0,.225,z),(.055,.14,.045),4,.008 if level==0 else 0)
  cube('A10_SOURCE_carry_grip',(0,.305,.815),(.055,.045,.36),2,.012 if level==0 else 0)
  for x in[-.252,.252]:
   for z in[.64,.75,.86,.97]:cube('A10_SOURCE_body_vent',(x,-.03,z),(.010,.10,.024),2)
  cube('A10_SOURCE_rear_control_panel',(0,.012,1.163),(.25,.14,.013),2,.01 if level==0 else 0)
  for x in[-.09,-.03,.03,.09]:cube('A10_SOURCE_control_button',(x,-.09,1.17),(.025,.019,.008),4,.005 if level==0 else 0)
  if level==0:
   for i in range(16):
    a=i*math.pi/8;cube('A10_SOURCE_focus_grip_rib',(.13*math.cos(a),.13*math.sin(a),.458),(.016,.016,.070),2,.003)
   for x in[-.255,.255]:
    for z in[.60,1.01]:
     bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.014,depth=.014,location=xyz((x,.095,z)));o=bpy.context.object;o.rotation_euler[1]=math.pi/2;finish(o,'A10_SOURCE_camera_fastener',4)
 if variant=='rain':cover(level)
 # The optical origin stays at zero. All body and support parts are behind it.
 cube('A10_SOURCE_tilt_cradle',(0,-.205,.75),(.18,.14,.23),4,.015 if level==0 else 0)
 cylinder('A10_SOURCE_pan_bowl',(0,-.325,.75),.12,.11,4,level)
 for x,z in[(-.26,.49),(.26,.49),(0,1.06)]:
  beam('A10_SOURCE_tripod_leg',(x*.22,-.375,.75+(z-.75)*.22),(x,-1.390,z),.042,4,level)
  cube('A10_SOURCE_tripod_foot',(x,-1.400,z),(.11,.025,.10),2,.012 if level==0 else 0)
  if level<2:beam('A10_SOURCE_tripod_spreader',(0,-1.03,.75),(x*.75,-1.03,.75+(z-.75)*.75),.021,4,level)
 if level<2:
  beam('A10_SOURCE_pan_handle',(.10,-.265,.82),(.29,-.18,1.10),.026,4,level)
  beam('A10_SOURCE_pan_grip',(.29,-.18,1.10),(.29,-.18,1.22),.037,2,level)
  for a,b in[((.17,-.08,1.16),(.17,-.40,1.16)),((.17,-.40,1.16),(0,-1.0,1.08)),((0,-1.0,1.08),(0,-1.39,1.06))]:beam('A10_SOURCE_camera_feeder',a,b,.015,2,level)

def tower(height,level):
 deck=height-1.40
 cube('A10_SOURCE_ground_plinth',(.70,.01,.10),(1.04,.28,1.30),6,.028 if level==0 else 0)
 cube('A10_SOURCE_ladder_footing',(1.245,.025,.65),(.10,.18,.75),6,.014 if level==0 else 0)
 for x in[.45,.95]:
  for z in[-.28,.28]:
   cube('A10_SOURCE_mast_baseplate',(x,.1725,z),(.18,.045,.18),4,.007 if level==0 else 0)
   cube('A10_SOURCE_lattice_upright',(x,(deck-.08+.19)/2,z),(.065,deck-.08-.19,.065),4,.007 if level==0 else 0)
   if level==0:
    for dx in[-.052,.052]:cylinder('A10_SOURCE_anchor_nut',(x+dx,.209,z),.014,.030,4,level)
 if level<2:
  bays=max(3,round((deck-.4)/.75))
  for i in range(bays):
   a=.30+(deck-.5)*i/bays;b=.30+(deck-.5)*(i+1)/bays
   for z in[-.28,.28]:beam('A10_SOURCE_mast_diagonal',(.45,a,z),(.95,b,z),.030,4,level)
   for x in[.45,.95]:beam('A10_SOURCE_mast_side_tie',(x,a,-.28),(x,b,.28),.029,4,level)
 cube('A10_SOURCE_non_slip_platform',(.685,deck-.045,.25),(1.13,.09,1.60),4,.007 if level==0 else 0)
 for z in[-.51,1.01]:cube('A10_SOURCE_platform_edge_rail',(.685,deck-.105,z),(1.13,.12,.075),4)
 for x in[.14,1.23]:cube('A10_SOURCE_platform_edge_longitudinal',(x,deck-.10,.25),(.075,.11,1.60),4)
 for z in[-.53,1.03]:
  cube('A10_SOURCE_platform_toe',(.685,deck+.08,z),(1.13,.16,.025),3)
  for y in[deck+.53,deck+1.01]:beam('A10_SOURCE_platform_side_rail',(.65,y,z),(1.235,y,z),.036,4,level)
 for y in[deck+.53,deck+1.01]:beam('A10_SOURCE_platform_back_rail',(1.235,y,-.53),(1.235,y,.30),.036,4,level)
 if level<2:
  for x,z in[(.65,-.53),(1.235,-.53),(1.235,.30),(1.235,1.03),(.65,1.03)]:beam('A10_SOURCE_rail_upright',(x,deck,z),(x,deck+1.03,z),.034,4,level)
  for x in[.45,.95]:
   for z in[-.51,1.01]:beam('A10_SOURCE_deck_bracket',(x,deck-.38,.28 if z>0 else-.28),(x,deck-.10,z),.04,4,level)
 # Tangential offset leaves a working patch beside the tripod and an open entry.
 for z in[.35,.95]:beam('A10_SOURCE_ladder_rail',(1.27,.105,z),(1.27,deck+1.02,z),.037,4,level)
 step=.25 if level==0 else .50 if level==1 else 1.0;y=.28
 while y<deck-.02:
  beam('A10_SOURCE_ladder_rung',(1.27,y,.35),(1.27,y,.95),.027,4,level);y+=step
 cube('A10_SOURCE_landing_support',(1.23,deck-.10,.65),(.13,.09,.60),4)
 cube('A10_SOURCE_ladder_landing',(1.2725,deck-.045,.65),(.045,.09,.66),4,.007 if level==0 else 0)
 if level<2:
  for y in[.45,deck*.5,deck-.12]:
   for z in[.35,.95]:beam('A10_SOURCE_ladder_standoff',(.95,y,.28),(1.27,y,z),.031,4,level)
  beam('A10_SOURCE_base_conduit',(1.06,.19,0),(1.06,deck+.02,0),.022,2,level)
  cube('A10_SOURCE_deck_feed_gland',(1.06,deck+.022,0),(.055,.044,.055),4,.007 if level==0 else 0)
  cube('A10_SOURCE_lower_service_box',(1.02,.48,.18),(.12,.28,.25),1,.017 if level==0 else 0)
counts={};sockets={};heights={'tower_low':4.8,'tower_high':6.8}
for variant in['dry','rain','tower_low','tower_high']:
 vr=bpy.data.objects.new('A10_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[]
 for level in range(3):
  current=[]
  if variant in heights:tower(heights[variant],level)
  else:camera(variant,level)
  lr=bpy.data.objects.new(f'A10_{variant.upper()}_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;counts[variant].append(join_runtime(current,lr.name+'_SURFACES',lr))
 points=[('OPTICAL',(0,0,0)),('PAN_PIVOT',(0,-.325,.75)),('TILT_PIVOT',(0,-.205,.75)),('OPERATOR_GRIP',(.29,-.18,1.16)),('TRIPOD_BASE',(0,-1.40,.75)),('FEED',(0,-1.39,1.06))]if variant not in heights else[('OPTICAL',(0,heights[variant],0)),('DECK',(.70,heights[variant]-1.40,0)),('LADDER',(1.27,.28,.65)),('BASE',(.70,0,.10)),('WORKING',(.94,heights[variant]-1.40,.70))]
 for name,pos in points:
  key='A10_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.08;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-broadcast-cameras.glb';bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<15000 for c in counts.values()),counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A10','revision':REV,'author':'scripts/author-broadcast-cameras.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-broadcast-cameras.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-broadcast-cameras.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':{v:[1,1,1]for v in counts},'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'units':'metres-Y-up; camera looks-minus-Z, tower-plus-X-outward','sockets':sockets,'towerHeights':heights,'deckBelowOptical':1.40,'heightFixedBelow':.20,'heightTranslateFromDeckBelow':.05,'bounds':{'min':[-.34,-1.43,-.57],'max':[1.31,6.46,1.25]},'atlasSize':[512,512],'collision':'visual hardware at existing replay-camera sites; optical origin, director and road retained','provenance':'Original camera bodies, lens barrels/hoods, fitted rain cover, tripod, lattice supports, compact platforms, ladders and routed cables. Original packed PBR atlas; no downloaded art.','finalArtApproved':False}
(ROOT/'src/rendering/broadcast-cameras.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['DRY','RAIN']):bpy.data.objects['A10_'+v].location=xyz((-3.2+i*1.5,1.40,0))
for i,v in enumerate(['TOWER_LOW','TOWER_HIGH']):bpy.data.objects['A10_'+v].location.x=1+i*2.6
preview=bpy.data.collections.new('A10_NONEXPORT_ASSEMBLY_PREVIEW');scene.collection.children.link(preview)
for i,(v,head)in enumerate([('tower_low','DRY'),('tower_high','RAIN')]):
 original=bpy.data.objects['A10_'+head+'_LOD0_SURFACES'];o=original.copy();o.data=original.data;preview.objects.link(o);o.parent=None;o.location=xyz((1+i*2.6,heights[v],0));o.rotation_euler.z=math.pi/2;o.hide_render=False;o.hide_set(False)
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
scene['handoff']='Canonical optical-origin and tower templates export before inspection offsets. Non-export assembled previews show tripod/deck contact. Runtime conforms only tower height/ground and preserves camera optical positions.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-broadcast-cameras.blend'),compress=True);print('A10_RECEIPT',json.dumps(manifest))
