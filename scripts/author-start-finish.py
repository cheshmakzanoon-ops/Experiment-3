"""Original A11/A13/A18/A43/A44/A45 venue kit. Blender 5.2.2, no third-party art.

Runtime tables and exchange GLB come from the same native meshes and evaluated
keyed actions. Original people/crew/player files are read-only inputs.
"""
from pathlib import Path
import bpy, bmesh, json, gzip, hashlib, math
from mathutils import Vector, Matrix, Quaternion
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'src/rendering'
xyz=lambda p:(p[0],-p[2],p[1])
yxz=lambda p:(p[0],p[2],-p[1])
flat=lambda a:[round(float(x),6) for p in a for x in p]
sha=lambda b:hashlib.sha256(b).hexdigest()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
# Retain the original human pattern and its seated/standing correspondence.
base=ROOT/'scripts/author-people.py'
base_hash=json.loads((OUT/'aurel-people.manifest.json').read_text())['sourceSHA256']
assert sha(base.read_bytes())==base_hash
ns={'__file__':str(base)}
exec(compile(base.read_text().split("bpy.ops.object.select_all(action='SELECT');",1)[0],str(base),'exec'),ns)
Shape=ns['Shape']
colors={'stone':(.36,.37,.34),'steel':(.11,.16,.18),'roof':(.58,.62,.61),'trim':(.038,.18,.21),'seat':(.74,.75,.71),'glass':(.075,.15,.17)}
materials={}
for name,c in colors.items():
 m=bpy.data.materials.new('Aurel / '+name);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*c,1)
 bs.inputs['Roughness'].default_value={'stone':.88,'steel':.42,'roof':.52,'trim':.5,'seat':.54,'glass':.24}[name]
 bs.inputs['Metallic'].default_value=.65 if name in ['steel','roof'] else 0
 materials[name]=m
people_material=bpy.data.materials.new('Aurel / original audience');people_material.use_nodes=True
bs=people_material.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.85
vc=people_material.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';people_material.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
objects={};data={}
def obj(name,g,mat):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([xyz(p) for p in g.v],[],g.f);mesh.update()
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();mesh.update()
 for p in mesh.polygons:p.use_smooth=not name.startswith('bay_')
 o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(materials[mat] if mat in materials else people_material)
 ca=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
 for i,c in enumerate(g.c):ca.data[i].color=(*c,1)
 mesh.uv_layers.new(name='Metre scale UV')
 for p in mesh.polygons:
  for li in p.loop_indices:
   x,y,z=g.v[mesh.loops[li].vertex_index];mesh.uv_layers.active.data[li].uv=(z,y+x*.12)
 d={'position':flat(g.v),'normal':flat([yxz(v.normal) for v in mesh.vertices]),'index':[i for p in mesh.polygons for i in p.vertices],
    'uv':[round(c,6) for x,y,z in g.v for c in (z,y+x*.12)],'color':flat(g.c),'material':mat}
 o['authored_role']=name;o['final_art_approved']=False;objects[name]=o;data[name]=d
 return o,d

def rect(g,pos,size):g.box(pos,size,(1,1,1))
def beam(g,a,b,r=.05,n=6):g.tube([a,b],r,n,(1,1,1))
# Eight-metre structural bay, outward X, along-stand Z. Column foot extensions
# are fitted to actual site terrain by the runtime, not assumed to be flat.
for tier in ['near','mid','far']:
 s={name:Shape() for name in ['stone','steel','roof','trim','glass']}
 for row in range(8):rect(s['stone'],(1.7+row*.98,row*.49+.1,0),(1.02,.2,8))
 rect(s['stone'],(.3,-.12,0),(2.5,.24,8));rect(s['stone'],(9.5,3.53,0),(1.25,.2,8))
 # Distinct folded cantilever roof, deep edge and visible tapered supporting ribs.
 roof=s['roof']; profile=[(-1.88,5.93),(1.0,6.42),(4.8,7.10),(8.65,7.66),(10.82,7.90)]
 for x,y in profile:
  for z,h in [(-4.04,0),(4.04,0),(-4.04,-.09),(4.04,-.09)]:roof.vertex((x,y+h,z),(1,1,1))
 for i in range(len(profile)-1):
  a=i*4;b=a+4
  for q in [(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)]:
   roof.f.extend([(q[0],q[1],q[2]),(q[0],q[2],q[3])])
 for a in [0,(len(profile)-1)*4]:roof.f.extend([(a,a+1,a+2),(a+1,a+3,a+2)])
 for z in [-3.92,3.92]:
  for x,top in [(2.1,6.28),(9.8,7.77)]:rect(s['steel'],(x,top*.5,z),(.19,top,.19))
  beam(s['steel'],(-1.8,5.81,z),(10.7,7.85,z),.07,8)
  beam(s['steel'],(-1.8,5.50,z),(10.7,7.30,z),.06,8)
  beam(s['steel'],(2.1,3.72,z),(9.8,7.72,z),.055,8)
  if tier!='far':
   for k in range(7):
    a=-1.8+k*1.78;b=a+1.78
    beam(s['steel'],(a,5.5+(a+1.8)*.144,z),(b,5.81+(b+1.8)*.163,z),.022)
 rect(s['trim'],(-1.81,5.64,0),(.14,.52,8.06))
 rect(s['trim'],(10.78,7.58,0),(.13,.55,8.06))
 # Deep concourse frontage: opaque jambs and spandrels, recessed glazing/doors.
 rect(s['stone'],(9.73,1.52,0),(.25,3.0,8))
 rect(s['glass'],(9.91,1.64,0),(.06,2.15,6.7))
 for z in [-3.45,-1.1,1.1,3.45]:rect(s['steel'],(9.96,1.64,z),(.075,2.25,.06))
 rect(s['trim'],(9.94,2.9,0),(.08,.25,7.25))
 if tier!='far':
  for z in [-3.7,3.7]:
   beam(s['steel'],(9.9,.3,z),(9.9,3.1,-z),.035)
  # Seat supporting rails, front and rear guard rails, drainage trough.
  for row in range(8):rect(s['steel'],(1.68+row*.98,row*.49+.37,0),(.045,.075,8))
  for x,y in [(-.8,1.05),(10,4.82),(10,4.27)]:rect(s['steel'],(x,y,0),(.04,.04,8))
  for z in [-3.8,0,3.8]:
   rect(s['steel'],(-.8,.54,z),(.045,1.1,.045));rect(s['steel'],(10,4.2,z),(.04,1.3,.04))
  rect(s['steel'],(10.75,7.37,0),(.22,.09,8.05))
 if tier=='near':
  for z in [-3.88,3.88]:
   beam(s['steel'],(10.74,.05,z),(10.74,7.42,z),.035,8)
   for x,y in [(2.1,6.15),(9.8,7.5)]:rect(s['steel'],(x,y,z),(.34,.26,.045))
  for x,y in [(-.7,5.93),(2.2,6.55),(6.2,7.25)]:rect(s['steel'],(x,y-.13,0),(.10,.14,7.9))
 for mat,g in s.items():obj(f'bay_{tier}_{mat}',g,mat)
# Shaped shell with a concave pan and rounded, tapered back, mount below the pan.
for tier,n in [('near',12),('mid',6),('far',3)]:
 g=Shape()
 # Watertight thin loft around pan, then upholstered-looking formed back shell.
 for back in [False,True]:
  rows=[]
  if back:
   for t in [0,.08,.4,.78,1]:rows.append(((.165+.07*t,.015+.41*t,0),.022,.18*(1-.13*t),0))
   # Loft axis uses Y; x radius is small thickness, z is seat width.
   g.loft(rows,n,(1,1,1))
  else:
   g.loft([((-.015,-.035,0),.20,.172,0),((-.02,0,0),.205,.193,0),((-.02,.028,0),.195,.19,0)],n,(1,1,1))
 if tier!='far':
  for z in [-.12,.12]:
   beam(g,(.07,-.01,z),(.12,-.23,z),.022,6)
   rect(g,(.11,-.24,z),(.14,.025,.06))
 obj('seat_'+tier,g,'seat')
# Accessible service stair module. Two half-rise treads per seating riser.
for tier in ['near','mid','far']:
 g=Shape()
 for step in range(16):rect(g,(1.20+step*.49,step*.245-.035,0),(.5,.12,1.15))
 if tier!='far':
  for z in [-.64,.64]:
   beam(g,(.90,.93,z),(9.28,5.10,z),.024,8)
   for k in [0,4,8,12,16]:
    x=.9+k*.52;y=k*.26
    beam(g,(x,y,z),(x,y+.95,z),.024,6)
 obj('stairs_'+tier,g,'stone')
# Eight by four LED installation, grounded columns, rear maintenance catwalk.
for tier in ['near','mid','far']:
 g=Shape()
 rect(g,(0,6.2,0),(8.7,4.8,.55))
 for x in [-2.7,2.7]:
  rect(g,(x,2.1,.15),(.32,4.2,.32));rect(g,(x,.12,.15),(1.4,.24,1.5))
 if tier!='far':
  rect(g,(0,3.85,.8),(8.8,.12,1.25))
  for x in [-4.2,-2,0,2,4.2]:beam(g,(x,3.85,1.35),(x,4.95,1.35),.025)
  beam(g,(-4.2,4.95,1.35),(4.2,4.95,1.35),.025)
  for x in [-3,3]:
   beam(g,(x,.3,.15),(-x,4.1,.15),.045)
  for y in [1,1.6,2.2,2.8,3.4]:beam(g,(3.7,y,.8),(4.2,y,.8),.023)
  for x in [3.7,4.2]:beam(g,(x,.3,.8),(x,4.05,.8),.032)
 obj('screen_'+tier,g,'steel')
# Authored collars and anchor hardware fit around the existing physical fence.
# The original concrete profile and filtered wire are not replaced or duplicated.
g=Shape()
rect(g,(0,.015,0),(.24,.05,.34))
beam(g,(0,.025,0),(0,.20,0),.049,10)
for x in [-.082,.082]:
 for z in [-.128,.128]:beam(g,(x,.043,z),(x,.066,z),.016,6)
for y in [.25,1.39,2.47]:
 rect(g,(0,y,0),(.104,.05,.10))
 for z in [-.075,.075]:rect(g,(0,y,z),(.063,.045,.065))
obj('fence_mount_near',g,'steel')
# Four original audience silhouettes preserve all seat/aisle/standing anchors.
# Heads and hair vary across authored families; per-instance scale/outfit remains.
for variant in range(4):
 for tier in [0,1]:
  g=ns['spectator'](tier)
  for i,(x,y,z) in enumerate(g.v):
   if g.joint[i]==3:
    dx=(x+.012);dy=y-.62
    sx,sy,sz=[(1,.98,1),(.9,1.05,.9),(1.08,.95,1.08),(.96,1.02,.98)][variant]
    q=(-.012+dx*sx,.62+dy*sy,z*sz)
    if g.skin[i]==2:
     q=(q[0]+(.013 if variant==1 else 0),q[1]+(.03 if variant==2 else -.012 if variant==1 else 0),q[2]*(1.18 if variant==3 else 1))
    delta=tuple(a-b for a,b in zip(q,g.v[i]));g.v[i]=q;g.stand[i]=tuple(a+b for a,b in zip(g.stand[i],delta))
  o,d=obj(f'spectator_{variant}_{tier}',g,'people')
  d.update(crowdJoint=g.joint,skinMask=g.skin,accessory=g.accessory,standing=flat(g.stand))
  o.shape_key_add(name='Seated');sk=o.shape_key_add(name='Standing')
  for i,p in enumerate(g.stand):sk.data[i].co=xyz(p)
  sm=o.data.copy()
  for i,p in enumerate(g.stand):sm.vertices[i].co=xyz(p)
  sm.update();d['standingNormal']=flat([yxz(v.normal) for v in sm.vertices]);bpy.data.meshes.remove(sm)
# Independent pivot skeleton corresponds exactly to the original crowd joints.
pivots=[(0,0,0),(0,.43,-.142),(0,.43,.142),(0,.50,0)]
rig=bpy.data.armatures.new('Audience task pivots');r=bpy.data.objects.new('Audience task rig',rig);bpy.context.collection.objects.link(r)
bpy.context.view_layer.objects.active=r;r.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for i,p in enumerate(pivots):
 b=rig.edit_bones.new('joint_'+str(i));b.head=xyz(p);b.tail=Vector(xyz(p))+Vector((0,0,.1))
bpy.ops.object.mode_set(mode='OBJECT');r.select_set(False)
for name,o in objects.items():
 if not name.startswith('spectator_'):continue
 for i in range(4):o.vertex_groups.new(name='joint_'+str(i))
 for vi,j in enumerate(data[name]['crowdJoint']):o.vertex_groups[int(j)].add([vi],1,'REPLACE')
 mod=o.modifiers.new('Authored audience action','ARMATURE');mod.object=r;o.parent=r
# Local bone axes map +Y to runtime +Y. Key all three channels for reliable GLB.
clips={};bpy.context.scene.render.fps=30
for action in ['audience_idle','audience_clap','audience_cheer','audience_phone']:
 a=bpy.data.actions.new(action);r.animation_data_create();r.animation_data.action=a
 for frame in range(0,121,10):
  t=frame/30;phase=t*math.pi*2
  for j,b in enumerate(r.pose.bones):
   b.rotation_mode='XYZ';b.rotation_euler=(0,0,0)
   # Bone local X acts about runtime X; local Z about runtime horizontal Z.
   if j==3:b.rotation_euler=(0,.055*math.sin(t*math.pi*.5),.025*math.sin(t*math.pi))
   if j in [1,2]:
    sign=-1 if j==1 else 1
    if action=='audience_clap':b.rotation_euler=(sign*(.24+.15*math.sin(phase*2)),0,-.30)
    elif action=='audience_cheer':b.rotation_euler=(sign*.08,.05*math.sin(phase),-.88-.10*math.sin(phase))
    elif action=='audience_phone':b.rotation_euler=(sign*.15,0,-.52 if j==2 else -.17)
    else:b.rotation_euler=(0,0,.018*math.sin(t*math.pi))
   b.keyframe_insert('rotation_euler',frame=frame)
 samples=[]
 C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
 for frame in range(121):
  bpy.context.scene.frame_set(frame);bpy.context.view_layer.update();row=[]
  for b in r.pose.bones:
   q=(C@(b.matrix@b.bone.matrix_local.inverted())@C.inverted()).to_quaternion().normalized()
   row.extend([round(q.x,7),round(q.y,7),round(q.z,7),round(q.w,7)])
  samples.append(row)
 clips[action]={'duration':4,'fps':30,'frames':samples}
 track=r.animation_data.nla_tracks.new();track.name=action;strip=track.strips.new(action,0,a);track.mute=True
r.animation_data.action=None
bpy.context.scene.frame_set(0)
# These evaluated poses also drive marshal attention and a pole-led flag gesture.
# Native two-object channels keep pole angle and head attention explicitly keyed.
control=bpy.data.objects.new('Marshal performance controls',None);bpy.context.collection.objects.link(control)
marshal={}
for action in ['marshal_watch','marshal_flag']:
 a=bpy.data.actions.new(action);control.animation_data_create();control.animation_data.action=a
 for frame in range(0,121,10):
  t=frame/30
  control.rotation_euler=(.06*math.sin(t*math.pi),0,(-.25+.30*math.sin(t*math.pi*2)) if action=='marshal_flag' else -.55)
  control.keyframe_insert('rotation_euler',frame=frame)
 samples=[]
 for frame in range(121):
  bpy.context.scene.frame_set(frame);samples.append([round(control.rotation_euler.x,7),round(control.rotation_euler.z,7)])
 marshal[action]={'duration':4,'fps':30,'frames':samples}
 track=control.animation_data.nla_tracks.new();track.name=action;track.strips.new(action,0,a);track.mute=True
control.animation_data.action=None
# Export asset board before assembling the editable full-length reference stand.
for o in bpy.context.selected_objects:o.select_set(False)
for o in objects.values():o.select_set(True)
r.select_set(True);control.select_set(True)
path=OUT/'start-finish.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_extras=True)
raw=path.read_bytes();compressed=gzip.compress(raw,compresslevel=9,mtime=0);(OUT/'start-finish.glb.gz').write_bytes(compressed);path.unlink()
# Native inspection layout: keep prototypes in an archive collection, instance
# ten bays and real seats as a complete 80-metre stand. No opaque external links.
proto=bpy.data.collections.new('PROTOTYPES / editable meshes and actions');bpy.context.scene.collection.children.link(proto)
for o in list(bpy.context.scene.objects):
 for c in list(o.users_collection):c.objects.unlink(o)
 proto.objects.link(o)
proto.hide_viewport=True;proto.hide_render=True
assembly=bpy.data.collections.new('A11 / 80m start-finish grandstand');bpy.context.scene.collection.children.link(assembly)
for bay in range(10):
 for mat in colors:
  key='bay_near_'+mat
  if key not in objects:continue
  o=objects[key].copy();o.data=objects[key].data;assembly.objects.link(o);o.location=xyz((0,0,(bay-4.5)*8))
for row in range(8):
 for col in range(123):
  z=(col-61)*.65
  if abs(abs(z)-20)<.7:continue
  o=objects['seat_near'].copy();o.data=objects['seat_near'].data;assembly.objects.link(o);o.location=xyz((1.55+row*.98,row*.49+.5,z))
for z in [-20,20]:
 o=objects['stairs_near'].copy();o.data=objects['stairs_near'].data;assembly.objects.link(o);o.location=xyz((0,0,z))
bpy.context.scene['final_art_approved']=False;bpy.context.scene['units']='metres; runtime Y up / Blender Z up'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/start-finish.blend'),compress=True)
result={'version':1,'units':'metres-Y-up','meshes':data,'clips':clips,'marshal':marshal,'pivots':pivots}
text=json.dumps(result,separators=(',',':'))+'\n';(OUT/'start-finish.geometry.json').write_text(text)
manifest={'version':1,'source':'scripts/author-start-finish.py','sourceSHA256':sha(Path(__file__).read_bytes()),'peopleSourceSHA256':base_hash,
 'runtimeSHA256':sha(text.encode()),'exchangeSHA256':sha(raw),'compressedSHA256':sha(compressed),'compressedBytes':len(compressed),
 'generator':'Blender '+bpy.app.version_string,'editable':'scripts/start-finish.blend','triangles':{k:len(v['index'])//3 for k,v in data.items()},
 'actions':list(clips)+list(marshal),'finalArtApproved':False}
(OUT/'start-finish.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
