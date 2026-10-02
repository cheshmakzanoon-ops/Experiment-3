"""Original close-grid mechanic derived from the retained Aurel garment pattern.

Run with pinned Blender 5.2.2. The original people/player assets are read-only.
This asset refines the garment, not the skeleton or the solver's contact points.
Animation remains the explicit runtime preparation performance, not motion capture.
"""
from pathlib import Path
import hashlib, json, gzip, math
import bpy, bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'rendering'
base = ROOT / 'scripts' / 'author-people.py'
expected = json.loads((OUT/'aurel-people.manifest.json').read_text())['sourceSHA256']
assert hashlib.sha256(base.read_bytes()).hexdigest() == expected
# Reuse only the original modelling definitions; never run their export section.
pattern = base.read_text().split("bpy.ops.object.select_all(action='SELECT');", 1)[0]
ns = {'__file__': str(base)}
exec(compile(pattern, str(base), 'exec'), ns)
xyz, yxz, names, bones = (ns[k] for k in ['xyz','yxz','NAMES','BONES'])
g = ns['body'](24)
# Authored double seams follow shoulder/chest panels. Their cloth weights follow
# the underlying chest, with no rigid floating ornaments over flexing joints.
for side in [-1,1]:
    for shift in [-.004,.004]:
        g.tube([(side*.071,1.48,.071+shift),(side*.14,1.431,.109+shift),
                (side*.211,1.389,.13+shift)],.0015,6,(.17,.22,.25),bone=1,cloth=1)
    # Stitched knee-pad border and boot tread; rigid to the correct lower leg/boot.
    shin = 10 if side<0 else 13
    boot = shin+1
    g.tube([(side*.092-.047,.414,.080),(side*.092-.051,.475,.084),
            (side*.092-.043,.532,.083),(side*.092+.043,.532,.083),
            (side*.092+.051,.475,.084),(side*.092+.047,.414,.080)],
           .002,6,(.25,.30,.32),bone=shin,cloth=0)
    for row in range(6):
        g.box((side*.092,.007,-.012+row*.032),(.108,.004,.009),(.025,.028,.031),bone=boot)
# Cloth compression detail is anatomical and bounded to a few millimetres.
# Contact regions (wrist cuffs, boot soles, neck) keep their established shape.
for i,(x,y,z) in enumerate(g.v):
    if not g.mask[i]: continue
    if abs(x)>.18 and .83<y<1.25:
        inner=max(0.,-z/.09)
        amplitude=.0018*math.exp(-((y-1.065)/.095)**2)*inner
        g.v[i]=(x,y,z+amplitude*math.sin(y*145+x*9))

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
material=bpy.data.materials.new('Grid mechanic / tailored fabric'); material.use_nodes=True
bsdf=material.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value=.88
vc=material.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color'
material.node_tree.links.new(vc.outputs['Color'],bsdf.inputs['Base Color'])
mesh=bpy.data.meshes.new('grid_mechanic_hero')
mesh.from_pydata([xyz(p) for p in g.v],[],g.f); mesh.update()
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();mesh.update()
for poly in mesh.polygons:poly.use_smooth=True
obj=bpy.data.objects.new('grid_mechanic_hero',mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(material)
col=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
for i,c in enumerate(g.c): col.data[i].color=(*c,1)
mesh.uv_layers.new(name='Garment pattern UV')
for p in mesh.polygons:
    for li in p.loop_indices:
        x,y,z=g.v[mesh.loops[li].vertex_index]; mesh.uv_layers.active.data[li].uv=(x*2+.5,y)
for name in names: obj.vertex_groups.new(name=name)
for vi in range(len(g.v)):
    for bone,weight in zip(g.j[vi],g.w[vi]):
        if weight: obj.vertex_groups[bone].add([vi],weight,'ADD')
rig=bpy.data.armatures.new('grid mechanic rig');rigobj=bpy.data.objects.new('grid mechanic rig',rig);bpy.context.collection.objects.link(rigobj)
bpy.context.view_layer.objects.active=rigobj;rigobj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
parents=[None,0,1,1,3,4,1,6,7,0,9,10,0,12,13]
for bi,name in enumerate(names):
    b=rig.edit_bones.new(name);b.head=xyz(bones[bi]);end=(bones[bi][0],bones[bi][1]+.15,bones[bi][2])
    if bi in [3,4,6,7,9,10,12,13]: end=bones[bi+1]
    b.tail=xyz(end)
    if parents[bi] is not None:b.parent=rig.edit_bones[names[parents[bi]]]
bpy.ops.object.mode_set(mode='OBJECT');rigobj.select_set(False)
mod=obj.modifiers.new('Compatible two-influence skin','ARMATURE');mod.object=rigobj
obj.parent=rigobj
for name,p in [('wrist_L',bones[5]),('wrist_R',bones[8]),('head_socket',bones[2]),('sole_L',(-.092,0,.078)),('sole_R',(.092,0,.078))]:
    socket=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(socket);socket.location=xyz(p);socket.empty_display_size=.04
obj['source_pattern']='aurel-people';obj['final_art_approved']=False
bpy.context.scene['coordinate_contract']='runtime (x,y,z), Blender (x,-z,y)'
bpy.context.scene['final_art_approved']=False
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts'/'grid-mechanic.blend'),compress=True)
path=OUT/'grid-mechanic.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_animations=False,export_extras=True)
raw=path.read_bytes(); exchange=gzip.compress(raw,compresslevel=9,mtime=0);(OUT/'grid-mechanic.glb.gz').write_bytes(exchange);path.unlink()
def flat(vs): return [round(float(x),6) for v in vs for x in v]
data={'version':1,'position':flat(g.v),'normal':flat([yxz(v.normal) for v in mesh.vertices]),
      'index':[v for p in mesh.polygons for v in p.vertices],'color':flat(g.c),'joints':[x for v in g.j for x in v],
      'weights':flat(g.w),'cloth':g.mask,'uv':[round(c,6) for x,y,z in g.v for c in (x*2+.5,y)]}
text=json.dumps(data,separators=(',',':'))+'\n';(OUT/'grid-mechanic.geometry.json').write_text(text)
manifest={'version':1,'source':'scripts/author-grid-mechanic.py','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'basePatternSHA256':expected,'editable':'scripts/grid-mechanic.blend','generator':'Blender '+bpy.app.version_string,
          'runtimeSHA256':hashlib.sha256(text.encode()).hexdigest(),'runtimeBytes':len(text.encode()),
          'exchangeSHA256':hashlib.sha256(raw).hexdigest(),'exchangeCompressedBytes':len(exchange),
          'vertices':len(g.v),'triangles':len(data['index'])//3,'bones':15,'finalArtApproved':False}
assert len(g.v)<20000 and len(data['index'])%3==0
assert all(math.isfinite(x) for key,value in data.items() if isinstance(value,list) for x in value)
(OUT/'grid-mechanic.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
