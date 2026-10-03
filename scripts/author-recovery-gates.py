"""A05 original closed recovery/access gate family.
Blender 5.2.2 LTS (original construction retained from 4.3.2), metre scale, Y-up/+Z-span GLB; physical barriers are unchanged.
"""
import bpy,bmesh,math,json,hashlib,struct,tempfile,sys,zlib
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
if '--check-source' in sys.argv:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts/aurel-recovery-gates.blend'))
 assert bpy.context.scene.unit_settings.scale_length==1
 assert len(bpy.data.collections['A05_EDITABLE_COMPONENTS'].objects)>60
 images=[i for i in bpy.data.images if i.name.startswith('A05_original_')]
 assert len(images)==3 and all(i.packed_file and tuple(i.size)==(512,512) for i in images)
 print('A05_EDITABLE_SOURCE_ROUNDTRIP_OK');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
source=bpy.data.collections.new('A05_EDITABLE_COMPONENTS');scene.collection.children.link(source)
runtime=bpy.data.collections.new('A05_RUNTIME');scene.collection.children.link(runtime)
root=bpy.data.objects.new('A05_RECOVERY_GATE_KIT',None);runtime.objects.link(root);root['assetId']='A05';root['finalArtApproved']=False
REV='aurel-a05-gates-r02-b522'
def xyz(v):return(v[0],-v[2],v[1])
def game(v):return(v[0],v[2],-v[1])
def png(pixels):
 h,w,_=pixels.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 scan=b''.join(b'\0'+row.tobytes()for row in pixels)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b'')
ROLES=[('Teal moulded polymer',(.025,.18,.145),.52,0),('Off-white moulded polymer',(.62,.61,.54),.58,0),('Hinge grease and seals',(.014,.018,.017),.91,0),('Safety amber paint',(.44,.245,.055),.62,0),('Galvanized connector',(.18,.21,.22),.48,.88),('Orange identification panel',(.62,.11,.022),.44,0),('Worn galvanized edge',(.40,.405,.36),.74,.5),('Teal contact film',(.018,.12,.096),.72,0)]
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
mat=bpy.data.materials.new('A05_original_PBR_surface_atlas');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=1;p.inputs['Roughness'].default_value=1
for name,pixels in [('base',base),('orm',orm),('normal',normal)]:
 with tempfile.TemporaryDirectory(prefix='a05-atlas-')as tmp:
  path=Path(tmp)/('A05_'+name+'.png');path.write_bytes(png(pixels));im=bpy.data.images.load(str(path),check_existing=False);im.name='A05_original_'+name;im.colorspace_settings.name='sRGB'if name=='base'else'Non-Color';im.pack();im.filepath='//A05_'+name+'.png'
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
counts={};draws={};sockets={};hinges={}
for variant in ['recovery','maintenance','access']:
 vr=bpy.data.objects.new('A05_'+variant.upper(),None);runtime.objects.link(vr);vr.parent=root;counts[variant]=[];draws[variant]=[]
 height=1.55 if variant=='access' else 3.40;split=1.9 if variant!='maintenance' else 2.60
 for level in range(3):
  lr=bpy.data.objects.new(f'A05_{variant.upper()}_LOD{level}',None);runtime.objects.link(lr);lr.parent=vr;current=[]
  for z in[.09,3.71]:
   cube('A05_SOURCE_galvanized_gate_post',(.23,height/2,z),(.12,height+.06,.14),4,.01 if level==0 else 0)
   cube('A05_SOURCE_terrain_foot',(.16,-.025,z),(.34,.05,.18),4,.007 if level==0 else 0)
   cube('A05_SOURCE_sealed_post_cap',(.23,height+.045,z),(.135,.032,.155),4,.005 if level==0 else 0)
   if height>2:beam('A05_SOURCE_swept_crown',(.23,3.4,z),(-.17,3.80,z),.070,4,level)
   if level==0:
    for dz in[-.045,.045]:cylinder('A05_SOURCE_anchor_nut',(.07,.014,z+dz),.018,.025,4,level)
  if height>2:beam('A05_SOURCE_top_tension_support',(-.17,3.80,.09),(-.17,3.80,3.71),.026,4,level)
  else:beam('A05_SOURCE_access_sill',(.23,-.012,.09),(.23,-.012,3.71),.045,4,level)
  tri=join_runtime(current,lr.name+'_FRAME',lr)
  for leaf,lo,hi,pivotz,angle in [('LEFT',.19,split-.022,.19,-100),('RIGHT',split+.022,3.61,3.61,100)]:
   current=[];center=(lo+hi)/2;width=hi-lo;pivot=(.23,0,pivotz)
   hinge=bpy.data.objects.new(lr.name+'_HINGE_'+leaf,None);runtime.objects.link(hinge);hinge.parent=lr;hinge.location=xyz(pivot);hinge.empty_display_type='SINGLE_ARROW';hinge.empty_display_size=.24;hinge['axis']='local +Y in GLB';hinge['closedDegrees']=0;hinge['serviceOpenDegrees']=angle;hinge['runtimeLockedClosed']=True;hinges[hinge.name]={'pivot':list(pivot),'openDegrees':angle}
   for y in[.06,height-.05]:cube('A05_SOURCE_leaf_edge',(.23,y,center),(.07,.075,width),4,.004 if level==0 else 0)
   for z in[lo,hi]:cube('A05_SOURCE_leaf_upright',(.23,height/2,z),(.07,height-.04,.075),4,.004 if level==0 else 0)
   if height>2:
    cube('A05_SOURCE_closed_lower_panel',(0,.47,center),(.40,.90,width-.07),0 if variant=='recovery' else 1,.025 if level==0 else 0,2 if level==0 else 1)
    cube('A05_SOURCE_panel_lower_reinforcement',(.22,.11,center),(.06,.08,width-.08),4)
    cube('A05_SOURCE_panel_upper_reinforcement',(.22,.89,center),(.06,.075,width-.08),4)
    beam('A05_SOURCE_leaf_diagonal',(.23,1.0,lo+.05),(.23,height-.13,hi-.05),.035,4,level)
   else:
    cube('A05_SOURCE_access_safety_rail',(.23,.76,center),(.07,.10,width-.04),3,.008 if level==0 else 0)
    beam('A05_SOURCE_access_brace',(.23,.16,lo+.08),(.23,height-.16,hi-.08),.039,4,level)
   if level<2:
    cube('A05_SOURCE_infill_bottom_rail',(.24,1.0 if height>2 else .13,center),(.035,.035,width),4)
    cube('A05_SOURCE_sign_mounting_rail',(.24,1.28,center),(.028,.028,width),4)
    gap=.23 if level==0 else .46;z=lo+gap
    while z<hi-.08:
     beam('A05_SOURCE_security_vertical',(.24,1.0 if height>2 else .13,z),(.24,height-.05,z),.012 if level==0 else .016,4,level);z+=gap
    for y in([.3,.78,2.8]if height>2 else[.3,1.25]):
     cylinder('A05_SOURCE_hinge_barrel',(.23,y,pivotz),.051,.16,4,level)
     cylinder('A05_SOURCE_hinge_pin_cap',(.23,y+.085,pivotz),.029,.02,2,level)
     cube('A05_SOURCE_hinge_mount',(.20,y,pivotz),(.16,.10,.14),4,.005 if level==0 else 0)
    if leaf=='RIGHT':
     z=lo+.12;cube('A05_SOURCE_latch_receiver',(.285,.88,z),(.095,.15,.16),4,.009 if level==0 else 0)
     beam('A05_SOURCE_drop_bolt',(.30,.02,z),(.30,.61,z),.029,4,level)
     cube('A05_SOURCE_drop_bolt_handle',(.30,.60,z+.055),(.029,.028,.13),3,.005 if level==0 else 0)
    else:
     z=hi-.12;cube('A05_SOURCE_latch_keeper',(.286,.88,z),(.09,.13,.14),4,.008 if level==0 else 0)
     beam('A05_SOURCE_cross_latch',(.34,.9,hi-.15),(.34,.9,hi+.16),.03,4,level)
     cube('A05_SOURCE_operator_grip',(.365,1.09,z),(.035,.19,.035),2,.01 if level==0 else 0)
     for y in[1.015,1.165]:cube('A05_SOURCE_grip_mount',(.30,y,z),(.11,.025,.025),4,.005 if level==0 else 0)
    cube('A05_SOURCE_original_access_sign',(.185,1.28,center),(.022,.20,min(.40,width*.5)),5,.012 if level==0 else 0)
    for dz in[-.10,.10]:cube('A05_SOURCE_sign_standoff',(.224,1.28,center+dz),(.075,.024,.024),4)
    if level==0:
     d=bpy.data.curves.new('Original Aurel access lettering','FONT');d.body='AUREL / SERVICE';d.size=.027;d.align_x='CENTER';d.align_y='CENTER';d.extrude=0;d.resolution_u=2;o=bpy.data.objects.new('A05_SOURCE_access_lettering',d);source.objects.link(o);o.location=xyz((.171,1.28,center));o.rotation_euler=Matrix(((0,0,-1),(-1,0,0),(0,1,0))).to_euler();bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');finish(bpy.context.object,o.name,1)
    if level==0 and height>2:
     for z in[lo+.12,hi-.12]:
      for y in[.16,.80]:
       bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.019,depth=.018,location=xyz((-.210,y,z)));o=bpy.context.object;o.rotation_euler[1]=math.pi/2;finish(o,'A05_SOURCE_panel_fastener',4)
   tri+=join_runtime(current,lr.name+'_'+leaf+'_LEAF',hinge,pivot)
  counts[variant].append(tri);draws[variant].append(3)
 for name,pos in [('START',(0,.47,0)),('END',(0,.47,3.8)),('LEFT_HINGE',(.23,0,.19)),('RIGHT_HINGE',(.23,0,3.61)),('LATCH',(.34,.90,split)),('ROUTE_CENTER',(.36,0,1.9))]:
  key='A05_'+variant.upper()+'_SOCKET_'+name;e=bpy.data.objects.new(key,None);runtime.objects.link(e);e.parent=vr;e.location=xyz(pos);e.empty_display_size=.08;sockets[key]=list(pos)
source.hide_viewport=True;source.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:o.select_set(True)
out=ROOT/'public/models/aurel-recovery-gates.glb'
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_texcoords=True,export_normals=True,export_vertex_color='NONE',export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False)
raw=out.read_bytes();d=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
assert all(0<c[2]<c[1]<c[0]<15000 for c in counts.values()),counts
assert len(raw)<4*1024*1024
manifest={'assetId':'A05','revision':REV,'author':'scripts/author-recovery-gates.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'editable':'scripts/aurel-recovery-gates.blend','authoredIn':bpy.app.version_string,'url':'models/aurel-recovery-gates.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':counts,'draws':draws,'materials':len(d['materials']),'images':len(d.get('images',[])),'meshes':len(d['meshes']),'nodes':len(d['nodes']),'span':3.8,'units':'metres-Y-up-Z-span','sockets':sockets,'hinges':hinges,'bounds':{'min':[-.225,-.05,0],'max':[.4,3.85,3.8]},'atlasSize':[512,512],'collision':'visual-only closed and locked; original collision barriers retained','provenance':'Original hinged recovery/access leaves, structural posts, brackets, latches, drop bolts, grips and deterministic PBR atlas; no downloaded art.','finalArtApproved':False}
(ROOT/'src/rendering/recovery-gates.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for i,v in enumerate(['RECOVERY','MAINTENANCE','ACCESS']):bpy.data.objects['A05_'+v].location.x=(i-1)*1.6
for o in runtime.objects:
 if '_LOD1' in o.name or '_LOD2' in o.name:o.hide_render=True;o.hide_set(True)
scene['handoff']='Closed canonical export. Runtime hinge pivots retain rotation metadata; gameplay operation is intentionally locked. Source inspection layout separates variants after export.'
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/aurel-recovery-gates.blend'),compress=True)
print('A05_RECEIPT',json.dumps(manifest))
