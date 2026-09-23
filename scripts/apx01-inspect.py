"""CPU geometry inspection; NOT screenshots of the running game.

First: CHROMIUM_PATH=/path/to/chromium node scripts/apx01-inspect.mjs test-results/apx01/runtime-car.json
Then: blender --python-exit-code 1 --background --python scripts/apx01-inspect.py -- test-results/apx01/runtime-car.json test-results/apx01/inspection

Actual FormulaCar hierarchy, transforms, mesh normals and canvas textures are
extracted by the JS companion. This neutral Blender stage does NOT reproduce the
Three.js custom shaders, postprocessing, weather or target GPU performance.
"""
from pathlib import Path
import bpy, json, math, base64, hashlib, sys
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
source=Path(args[0]);out=Path(args[1]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.19,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
mats={}
def xyz(p):return(p[0],-p[2],p[1])
for number,part in enumerate(json.loads(source.read_text())):
    p=part['position'];v=[xyz(p[i:i+3]) for i in range(0,len(p),3)];idx=part['index'];faces=[idx[i:i+3] for i in range(0,len(idx),3)]
    mesh=bpy.data.meshes.new(part['name'] or f'Car part {number}');mesh.from_pydata(v,[],faces);mesh.update()
    obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj)
    uv=part.get('uv')
    if uv:
        layer=mesh.uv_layers.new(name='Live asset UV')
        for loop in mesh.loops:layer.data[loop.index].uv=uv[loop.vertex_index*2:loop.vertex_index*2+2]
    colours=part.get('vertexColors')
    if colours:
        size=part['colorSize']; layer=mesh.color_attributes.new(name='Live vertex colour',type='FLOAT_COLOR',domain='POINT')
        for i,vertex in enumerate(mesh.vertices):layer.data[i].color=(*colours[i*size:i*size+3],1)
    n=part['normal'];mesh.normals_split_custom_set_from_vertices([xyz(n[i:i+3]) for i in range(0,len(n),3)])
    for poly in mesh.polygons:poly.use_smooth=True
    data=part['material'];key=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
    if key not in mats:
        mat=bpy.data.materials.new('Live '+key[:8]);mat.use_nodes=True;nodes=mat.node_tree.nodes;pbr=nodes.get('Principled BSDF')
        pbr.inputs['Base Color'].default_value=(*data['color'],1);pbr.inputs['Metallic'].default_value=data['metalness'];pbr.inputs['Roughness'].default_value=data['roughness']
        if data.get('emissive'):pbr.inputs['Emission Color'].default_value=(*data['emissive'],1);pbr.inputs['Emission Strength'].default_value=data.get('intensity',0)
        if colours:
            attribute=nodes.new('ShaderNodeVertexColor');attribute.layer_name='Live vertex colour';mat.node_tree.links.new(attribute.outputs['Color'],pbr.inputs['Base Color'])
        if data.get('texture'):
            path=out/(key+'.png');path.write_bytes(base64.b64decode(data['texture'].split(',')[1]));image=bpy.data.images.load(str(path));tex=nodes.new('ShaderNodeTexImage');tex.image=image;mat.node_tree.links.new(tex.outputs['Color'],pbr.inputs['Base Color'])
        if data['metalness']<.25 and data['roughness']<.4:pbr.inputs['Coat Weight'].default_value=.8
        mats[key]=mat
    obj.data.materials.append(mats[key])
# A neutral, fixed studio, not substituted game lighting.
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.01));floor=bpy.context.object
mat=bpy.data.materials.new('Inspection ground');mat.use_nodes=True;pbr=mat.node_tree.nodes['Principled BSDF'];pbr.inputs['Base Color'].default_value=(.085,.10,.12,1);pbr.inputs['Roughness'].default_value=.4;floor.data.materials.append(mat)
def area(name,p,power,size,target=(0,0,.45)):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=p;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
area('Long key',(3,-2.5,5.8),1500,5);area('Fill',(-4,-1,3.7),1000,4);area('Rim',(1,4,4),1800,3)
cam=bpy.data.cameras.new('Inspection');obj=bpy.data.objects.new('Inspection',cam);scene.collection.objects.link(obj);scene.camera=obj;cam.lens=48;cam.sensor_width=36
views = [('three-quarter',38,14,8.6,(0,0,.55)),('side',90,5,9.4,(0,0,.55)),('front',0,8,8.2,(0,0,.53)),('rear',180,10,7.3,(0,0,.55)),('front-mechanical',70,20,2.7,(.7,-1.6,.35)),('rear-mechanical',155,15,3.3,(0,1.8,.5))]
if len(args)>2 and args[2]=='driver':
    scene.cycles.samples=24
    views=[('driver-quarter',135,44,1.55,(0,.17,.69)),('driver-side',95,25,1.5,(0,.17,.72)),('driver-front',20,35,1.6,(0,.17,.70))]
for name,az,elev,distance,focus in views:
    a=math.radians(az);e=math.radians(elev);obj.location=Vector(focus)+Vector((math.sin(a)*math.cos(e)*distance,-math.cos(a)*math.cos(e)*distance,math.sin(e)*distance));obj.rotation_euler=(Vector(focus)-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
print('CPU_RUNTIME_ASSEMBLY_INSPECTION_DONE')
