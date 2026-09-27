"""Build the user's RB19 + R06 sources into one animated Three.js player asset.
Run: blender -b --python scripts/build-supplied-player.py -- --car CAR.blend
     --cockpit COCKPIT.blend --output OUTPUT [--preview]
Never overwrites inputs. Excludes photos, studios, archives and font files.
Sources are reconstructions, not measured RB19 engineering/CAD certification.
"""
import argparse, collections, gzip, hashlib, json, math, struct, sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
p = argparse.ArgumentParser()
p.add_argument('--car', required=True); p.add_argument('--cockpit', required=True)
p.add_argument('--output', required=True); p.add_argument('--preview', action='store_true')
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
out = Path(a.output).resolve(); out.mkdir(parents=True, exist_ok=True)
source_hashes = {k:hashlib.sha256(Path(v).read_bytes()).hexdigest() for k,v in [('car',a.car),('cockpit',a.cockpit)]}
S = 3.44/3.57
# Blender common space: Z up, -Y forward. Export becomes game Y up, +Z forward.
M = Matrix.Translation((0,-(1.82-1.65*S),.05-.358*S)) @ Matrix.Rotation(math.pi/2,4,'Z') @ Matrix.Scale(S,4)
CP = M @ Matrix.Translation((-.221075,0,-.0415)) @ Matrix.Rotation(math.pi/2,4,'Z') @ Matrix.Scale(.9,4)
report = {'sourceSHA256':source_hashes,'excluded':[],'batches':[], 'fit':{'bodyScale':S,'cockpitScale':.9,'cockpitOffsetInCarSource':[-.221075,0,-.0415],'wheelbase':3.44,'track':1.66},'materialAdaptations':[]}
def activate(obj):
    bpy.ops.object.select_all(action='DESELECT'); obj.hide_set(False); obj.select_set(True); bpy.context.view_layer.objects.active=obj

def empty(name,matrix=None,parent=None):
    obj=bpy.data.objects.new(name,None); bpy.context.scene.collection.objects.link(obj)
    if parent: obj.parent=parent
    if matrix is not None: obj.matrix_world=matrix
    return obj

def join_batch(objects,name,parent=None):
    if not objects: return None
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.hide_set(False); obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1: bpy.ops.object.join()
    obj=bpy.context.view_layer.objects.active; world=obj.matrix_world.copy(); obj.name=name
    if parent: obj.parent=parent; obj.parent_type='OBJECT'; obj.matrix_parent_inverse=Matrix.Identity(4)
    obj.matrix_world=world; obj.data.validate(clean_customdata=False); obj.data.calc_loop_triangles()
    report['batches'].append({'name':name,'triangles':len(obj.data.loop_triangles),'materials':len(obj.data.materials)})
    return obj

def prep_mesh(obj,cockpit=False):
    activate(obj)
    if obj.type=='CURVE': obj.data.resolution_u=min(obj.data.resolution_u,4); obj.data.bevel_resolution=min(obj.data.bevel_resolution,2)
    if obj.type in {'CURVE','FONT'}: bpy.ops.object.convert(target='MESH')
    obj.data=obj.data.copy()
    for mod in list(obj.modifiers):
        if mod.type=='ARMATURE': continue
        if mod.type=='SUBSURF':
            mod.levels=mod.render_levels=(1 if 'Helmet_Shell' in obj.name else 0)
            if mod.levels==0: obj.modifiers.remove(mod); continue
        if not mod.show_render:
            obj.modifiers.remove(mod); continue
        mod.show_viewport=True
        if mod.type=='BEVEL': mod.segments=min(mod.segments,2)
        while list(obj.modifiers).index(mod)>0: bpy.ops.object.modifier_move_up(modifier=mod.name)
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as error:
            if 'Modifier is disabled' not in str(error): raise
            report['excluded'].append(obj.name+' / disabled '+mod.name)
            obj.modifiers.remove(mod)
    if len(obj.data.vertices)>2500:
        dec=obj.modifiers.new('Runtime surface budget','DECIMATE'); dec.ratio=.42 if cockpit else .45
        while list(obj.modifiers).index(dec)>0: bpy.ops.object.modifier_move_up(modifier=dec.name)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    if not obj.data.uv_layers:
        uv=obj.data.uv_layers.new(name='UVMap')
        for loop in obj.data.loops:
            v=obj.data.vertices[loop.vertex_index].co; uv.data[loop.index].uv=(v.x,v.z)
    if any(m.type=='ARMATURE' for m in obj.modifiers):
        for v in obj.data.vertices:
            groups=sorted(((g.group,g.weight) for g in v.groups if g.weight>1e-8),key=lambda g:-g[1])
            for g in list(v.groups):
                if g.group not in [i for i,_ in groups[:4]]: obj.vertex_groups[g.group].remove([v.index])
            total=sum(w for _,w in groups[:4])
            if total:
                for i,w in groups[:4]: obj.vertex_groups[i].add([v.index],w/total,'REPLACE')
    obj.data.validate(clean_customdata=False)

bpy.ops.wm.open_mainfile(filepath=str(Path(a.cockpit).resolve()))
scene=bpy.context.scene; scene.render.fps=30; scene.render.fps_base=1
rig=bpy.data.objects['F1CP_ARMATURE']; rig.animation_data.action=bpy.data.actions['F1CP_SRC_Neutral']
if rig.animation_data.action.slots: rig.animation_data.action_slot=rig.animation_data.action.slots[0]
scene.frame_set(1); bpy.context.view_layer.update(); cp_root=bpy.data.objects['F1CP_ROOT']
sockets={k: CP @ bpy.data.objects[n].matrix_world.translation for k,n in [('eye','F1CP_SOCKET_COCKPIT_CAMERA'),('steering','F1CP_SOCKET_STEERING_AXIS')]}
sockets['pod']=M @ Vector((.43,0,1.19))
keep={rig,cp_root}; cp_batches=collections.defaultdict(list)
for i,obj in enumerate(list(scene.objects)):
    col=[c.name for c in obj.users_collection]
    good=obj.type in {'MESH','FONT','CURVE'} and not obj.hide_render and any(c.startswith(('10_COCKPIT','20_HALO','30_WHEEL','40_DRIVER','50_HELMET')) for c in col)
    if not good or 'UpperMonocoque' in obj.name or 'Display_CoverGlass' in obj.name:
        if obj.type in {'MESH','FONT','CURVE'}: report['excluded'].append(obj.name)
        continue
    name=obj.name; prep_mesh(obj,True); skinned=any(m.type=='ARMATURE' for m in obj.modifiers)
    if skinned:
        world=obj.matrix_world.copy(); obj.parent=rig; obj.parent_type='OBJECT'; obj.matrix_parent_inverse=Matrix.Identity(4); obj.matrix_world=world
    if name=='F1CP_Display_EmissiveLCD':
        role='PLAYER_LCD'
        for loop in obj.data.loops:
            v=obj.data.vertices[loop.vertex_index].co; obj.data.uv_layers.active.data[loop.index].uv=((v.x+.068)/.136,(v.z-.74093)/.06278)
    elif any(c.startswith('50_HELMET') for c in col) or any(w in name for w in ['Balaclava','Eye_', 'EyeLid','Eyebrow','Eyelid','Driver_HeadVolume']): role='PLAYER_HEAD'
    elif any(c.startswith('40_DRIVER') for c in col): role='PLAYER_DRIVER'
    elif any(c.startswith('30_WHEEL') for c in col): role='PLAYER_CONTROLS'
    else: role='PLAYER_COCKPIT'
    cp_batches[(role,skinned)].append(obj)
    if i%80==0: print('COCKPIT_PREP',i,flush=True)
for (role,skinned),objects in cp_batches.items(): keep.add(join_batch(objects,role+('' if skinned else '_STATIC'),rig if skinned else cp_root))
cp_root.matrix_world=CP; bpy.context.view_layer.update()
# Monotonic steering sweep evaluates original IK. Runtime samples by input,
# not elapsed time, so pause/replay seek cannot drift hands from the wheel.
rig.animation_data.action=None
for tr in rig.animation_data.nla_tracks: tr.mute=True
for frame,degrees in [(1,-35),(71,35)]: rig['steering_degrees']=degrees; rig.keyframe_insert(data_path='["steering_degrees"]',frame=frame)
rig.animation_data.action.name='PLAYER_STEERING'
for layer in rig.animation_data.action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points: key.interpolation='LINEAR'
scene.frame_start=1; scene.frame_end=71; scene.frame_set(36); bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'cockpit-prepared.blend'),compress=True)
(out/'cockpit-prepared.json').write_text(json.dumps({'report':report,'keep':[o.name for o in keep],'sockets':{k:list(v) for k,v in sockets.items()}}))
with bpy.data.libraries.load(str(Path(a.car).resolve()),link=False) as (src,dst):
    dst.collections=[n for n in src.collections if n[:2].isdigit() or n.startswith('WHEEL_') or n.startswith('GUIDES')]
rb=[]
for col in dst.collections:
    if col:
        scene.collection.children.link(col)
        rb.extend(o for o in col.all_objects if o not in rb)
bpy.context.view_layer.update(); assembly=empty('PLAYER_VEHICLE'); keep.add(assembly)
world=cp_root.matrix_world.copy(); cp_root.parent=assembly; cp_root.matrix_world=world
rb_groups=collections.defaultdict(list); wheel_map={'FR':0,'FL':1,'RR':2,'RL':3}; anchors={}; wheel_sources={}
for label,idx in wheel_map.items():
    source=next(o for o in rb if o.name=='STEER_'+label); wheel_sources[idx]=M @ source.matrix_world.translation
    center=Vector((-.83 if idx%2==0 else .83,-(1.82 if idx<2 else -1.62),.05))
    pivot=empty('PLAYER_WHEEL_'+str(idx),Matrix.Translation(center),assembly); spin=empty('PLAYER_SPIN_'+str(idx),Matrix.Translation(center),pivot)
    anchors['wheel'+str(idx)]=pivot; anchors['spin'+str(idx)]=spin; keep.update([pivot,spin])
for role in ['BODY','FRONT_WING','REAR_WING']: anchors[role]=empty('PLAYER_'+role,parent=assembly); keep.add(anchors[role])
drs_source=next(o for o in rb if o.name.startswith('DRS_PIVOT'))
anchors['DRS']=empty('PLAYER_DRS',Matrix.Translation(M @ drs_source.matrix_world.translation),anchors['REAR_WING']); keep.add(anchors['DRS'])
for idx,obj in enumerate(rb):
    if obj.type not in {'MESH','CURVE','FONT'} or obj.hide_render: continue
    col=[c.name for c in obj.users_collection]
    if any(c.startswith(('07_COCKPIT','11_SERVICE_POWERTRAIN','REFERENCES','STUDIO')) for c in col) or 'Halo ' in obj.name or obj.name.startswith('Halo |'):
        report['excluded'].append(obj.name); continue
    role='BODY'; chain=[]; parent=obj.parent
    while parent: chain.append(parent.name); parent=parent.parent
    for label,wi in wheel_map.items():
        if 'ROTATE_'+label in chain or 'WHEEL_'+label in col: role='spin'+str(wi); break
        if 'STEER_'+label in chain: role='wheel'+str(wi); break
    if role=='BODY':
        if any(n.startswith('DRS_PIVOT') for n in chain): role='DRS'
        elif '02_FRONT_WING' in col: role='FRONT_WING'
        elif '04_REAR_WING_DRS' in col: role='REAR_WING'
    if 'inset optical glass' in obj.name: role='MIRROR_'+('0' if ' R ' in obj.name else '1')
    if obj.name.startswith('Rain light | LED'): role='RAIN'
    prep_mesh(obj); deps=bpy.context.evaluated_depsgraph_get(); ev=obj.evaluated_get(deps)
    data=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=deps)
    baked=bpy.data.objects.new(obj.name+'_RUNTIME',data); scene.collection.objects.link(baked); baked.matrix_world=M @ obj.matrix_world
    if role.startswith(('spin','wheel')):
        wi=int(role[-1]); baked.location.x+=(-.83 if wi%2==0 else .83)-wheel_sources[wi].x
    rb_groups[role].append(baked)
    if idx%100==0: print('CAR_PREP',idx,flush=True)
for role,objects in rb_groups.items(): keep.add(join_batch(objects,'RB19_'+role,anchors.get(role,assembly)))
for name,point in sockets.items(): keep.add(empty('PLAYER_SOCKET_'+name.upper(),Matrix.Translation(point),assembly))
# Delete source geometry after evaluating modifiers, retain IK controller empties.
for obj in list(scene.objects):
    if obj not in keep and obj.type in {'MESH','FONT','CURVE','CAMERA','LIGHT'}: bpy.data.objects.remove(obj,do_unlink=True)
used_materials={m for o in keep if o and o.type=='MESH' for m in o.data.materials if m}
for mat in used_materials:
    if not mat.use_nodes: continue
    ps=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not ps: continue
    for socket in ['Base Color','Metallic','Roughness']:
        for link in list(ps.inputs[socket].links):
            if link.from_node.type not in {'TEX_IMAGE','SEPRGB','SEPXYZ','SEPARATE_COLOR','MATH'}:
                mat.node_tree.links.remove(link); report['materialAdaptations'].append(mat.name+': '+socket+' uses source constant PBR value')
    if mat.name.startswith('Tyre | compound'): ps.inputs['Base Color'].default_value=(.85,.63,.012,1)
used_images={n.image for m in used_materials if m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
for image in used_images:
    w,h=image.size
    if max(w,h)>1024:
        ratio=1024/max(w,h); image.scale(max(1,round(w*ratio)),max(1,round(h*ratio)))
    image.pack()
for image in list(bpy.data.images):
    if image not in used_images: bpy.data.images.remove(image)
for curve in list(bpy.data.curves):
    if curve.users==0: bpy.data.curves.remove(curve)
for font in list(bpy.data.fonts):
    if font.name!='Bfont': bpy.data.fonts.remove(font)
for obj in list(scene.objects):
    if obj not in keep: obj.hide_render=True
scene.frame_set(36); bpy.context.view_layer.update()
report['triangles']=sum(v['triangles'] for v in report['batches']); report['images']=len(used_images)
report['sockets']={k:[round(float(v),8) for v in (point.x,point.z,-point.y)] for k,point in sockets.items()}
report['classification']='Fitted runtime assembly of user supplied reconstructions; not measured RB19 CAD or final-art certification.'
scene['PLAYER_INTEGRATION']=report['classification']
bpy.ops.wm.save_as_mainfile(filepath=str(out/'RB19_R06_Player_Combined.blend'),compress=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in keep: obj.hide_set(False); obj.select_set(True)
bpy.context.view_layer.objects.active=rig; path=out/'supplied-player.glb'
print('EXPORT_START',report['triangles'],flush=True)
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
 export_texcoords=True,export_normals=True,export_tangents=False,export_materials='EXPORT',export_image_format='AUTO',
 export_cameras=False,export_lights=False,export_extras=False,export_yup=True,export_apply=False,
 export_skins=True,export_influence_nb=4,export_all_influences=False,export_animations=True,
 export_animation_mode='ACTIVE_ACTIONS',export_nla_strips_merged_animation_name='PLAYER_STEERING',
 export_force_sampling=True,export_bake_animation=True,export_frame_range=True,export_frame_step=1,
 export_anim_slide_to_zero=True,export_rest_position_armature=True,export_optimize_animation_size=True,export_morph=False,export_leaf_bone=False)
raw=path.read_bytes(); length=struct.unpack_from('<I',raw,12)[0]; doc=json.loads(raw[20:20+length])
for gm in doc.get('materials',[]):
    ext=gm.get('extensions',{}).get('KHR_materials_sheen'); mat=bpy.data.materials.get(gm.get('name',''))
    if ext and mat:
        ps=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if ps and not ps.inputs['Sheen Weight'].is_linked: ext['sheenColorFactor']=[x*float(ps.inputs['Sheen Weight'].default_value) for x in ext.get('sheenColorFactor',[0,0,0])]
    for ext in ['KHR_materials_volume','KHR_materials_transmission']: gm.get('extensions',{}).pop(ext,None)
for key in ['extensionsUsed','extensionsRequired']:
    if key in doc: doc[key]=[e for e in doc[key] if e not in ['KHR_materials_volume','KHR_materials_transmission']]
encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode(); encoded+=b' '*((-len(encoded))%4); binary=raw[20+length:]
raw=struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+binary; path.write_bytes(raw)
compressed=gzip.compress(raw,compresslevel=9,mtime=0); (out/'supplied-player.glb.gz').write_bytes(compressed)
manifest={'revision':'RB19-R06-player-1','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'compressedBytes':len(compressed),'compressedSHA256':hashlib.sha256(compressed).hexdigest(),
 'sourceSHA256':source_hashes,'triangles':sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives']),
 'nodes':len(doc['nodes']),'meshes':len(doc['meshes']),'materials':len(doc['materials']),'images':len(doc.get('images',[])),'joints':len(doc['skins'][0]['joints']),
 'sockets':report['sockets'],'steeringDegrees':35,'steeringClip':'PLAYER_STEERING','maxRawBytes':max(len(raw)+4096,64*1024*1024),'fit':report['fit']}
(out/'supplied-player.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n'); (out/'supplied-player-build.json').write_text(json.dumps(report,indent=2)+'\n')
print('EXPORT_DONE',json.dumps(manifest),flush=True)
if a.preview:
    scene.render.engine='CYCLES'; scene.cycles.samples=20; scene.cycles.use_denoising=True
    scene.render.resolution_x=1200; scene.render.resolution_y=800; scene.render.resolution_percentage=100
    scene.world.use_nodes=True; bg=scene.world.node_tree.nodes.get('Background'); bg.inputs[0].default_value=(.3,.35,.45,1); bg.inputs[1].default_value=.4
    for loc,power,size in [((3,-4,5),1500,5),((-4,0,4),1000,4),((1,4,4),1700,3)]:
        data=bpy.data.lights.new('Player review softbox','AREA'); data.energy=power; data.shape='DISK'; data.size=size
        obj=bpy.data.objects.new(data.name,data); scene.collection.objects.link(obj); obj.location=loc; obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    cd=bpy.data.cameras.new('Player review camera'); camera=bpy.data.objects.new(cd.name,cd); scene.collection.objects.link(camera); scene.camera=camera
    for name,pos,target,lens in [('exterior',(4,-6,3),(0,0,.2),45),('cockpit',tuple(sockets['eye']),tuple(sockets['eye']+Vector((0,-1,-.06))),26)]:
        if name=='cockpit':
            for o in keep:
                if o.name.startswith('PLAYER_HEAD'): o.hide_render=True
        camera.location=pos; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler(); cd.lens=lens; cd.clip_start=.02
        scene.render.filepath=str(out/(name+'.png')); bpy.ops.render.render(write_still=True)
