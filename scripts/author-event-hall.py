"""A71 original Aurel event-hall refinement; explicit Blender -> GLB -> runtime.

Usage: blender -b -t 2 --factory-startup --python-exit-code 1 --python
scripts/author-event-hall.py -- --output-root /tmp/a71 [--source /path/to/hall.blend]
The source checkout is never an output directory. Reopening uses saved meshes,
not regeneration, and must reproduce identical GLB/runtime bytes.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import math
import shutil
import struct
import sys
import bpy
import bmesh

ROOT = Path(__file__).resolve().parent.parent
sha = lambda b: hashlib.sha256(b).hexdigest()
xyz = lambda p: (p[0], -p[2], p[1])
TAU = math.tau
NAMES = ['foundation', 'plinth', 'facade', 'bearing', 'canopy', 'column', 'bollard',
         'shell_near', 'shell_mid', 'shell_far']
COLORS = {'stone': (.32, .33, .29), 'paving': (.22, .28, .27),
          'metal': (.055, .11, .13), 'glass': (.022, .052, .067), 'screen': (1, 1, 1)}

class Shape:
    def __init__(self):
        self.v, self.faces, self.uv = [], [], []

    def vertex(self, p, uv=None):
        self.v.append(p)
        self.uv.append(uv if uv is not None else (p[0] + p[2] * .17, p[1] + p[2] * .11))
        return len(self.v) - 1

    def quad(self, a, b, c, d):
        self.faces.extend([(a, b, c), (a, c, d)])

    def box(self, center, size, yaw=0):
        start = len(self.v)
        c, s = math.cos(yaw), math.sin(yaw)
        for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                        (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            x, y, z = x * size[0] / 2, y * size[1] / 2, z * size[2] / 2
            self.vertex((center[0] + c*x + s*z, center[1] + y, center[2] - s*x + c*z))
        for q in [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]:
            self.quad(*(start + i for i in q))

    def lathe(self, profile, segments=24, cap=False):
        """Profile pairs are (radius, height); a closed profile makes a ring."""
        start = len(self.v)
        for r, y in profile:
            for j in range(segments):
                a = TAU * j / segments
                self.vertex((math.sin(a)*r, y, math.cos(a)*r), (a*r, y))
        for i in range(len(profile)-1):
            for j in range(segments):
                a = start+i*segments+j; b = start+i*segments+(j+1)%segments
                self.quad(a, b, b+segments, a+segments)
        if cap:
            for row in [0, len(profile)-1]:
                begin = start+row*segments
                for j in range(1, segments-1):
                    self.faces.append((begin, begin+j, begin+j+1))

    def ramp(self, yaw):
        # Four 3.6 m clear entries, 0.18 m rise over 4.8 m; closed wedge.
        c, s = math.cos(yaw), math.sin(yaw); start = len(self.v)
        for x,y,z in [(-1.8,0,17.7),(1.8,0,17.7),(-1.8,.18,17.7),(1.8,.18,17.7),
                      (-1.8,0,22.5),(1.8,0,22.5)]:
            self.vertex((c*x+s*z,y,-s*x+c*z))
        for q in [(0,1,3,2),(2,3,5,4),(0,4,5,1)]: self.quad(*(start+i for i in q))
        self.faces.extend([(start,start+2,start+4),(start+1,start+5,start+3)])


def author():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    materials = {}
    for name, color in COLORS.items():
        m = bpy.data.materials.new('A71 / '+name); m.use_nodes = True
        bs = m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Roughness'].default_value = {'stone':.93,'paving':.83,'metal':.39,'glass':.19,'screen':.5}[name]
        bs.inputs['Metallic'].default_value = .65 if name=='metal' else .28 if name=='glass' else .22 if name=='screen' else 0
        m['runtime_finish'] = name
        materials[name] = m
    prototypes = bpy.data.collections.new('A71 / editable export prototypes')
    bpy.context.scene.collection.children.link(prototypes)
    objects = {}
    def mesh(name, shape, material, smooth=False):
        data = bpy.data.meshes.new('A71_'+name)
        data.from_pydata([xyz(p) for p in shape.v], [], shape.faces); data.update()
        bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(data); bm.free()
        for p in data.polygons: p.use_smooth = smooth
        uv = data.uv_layers.new(name='Original metric / panel UV')
        for loop in data.loops: uv.data[loop.index].uv = shape.uv[loop.vertex_index]
        o=bpy.data.objects.new('A71_'+name, data); prototypes.objects.link(o)
        data.materials.append(materials[material])
        o['role']=name; o['units']='metres'; o['final_art_approved']=False
        objects[name]=o
    g=Shape(); g.lathe([(27.5,-1),(27.5,0)],64,True); mesh('foundation',g,'stone')
    g=Shape(); g.lathe([(18.2,0),(18.1,.18)],24,True)
    for k in range(4): g.ramp(k*math.pi/2)
    mesh('plinth',g,'paving')
    g=Shape()
    for k in range(24):
        a,b=(k-.5)*TAU/24,(k+.5)*TAU/24
        r=16.35 if k%6==0 else 16.8
        ids=[g.vertex((math.sin(t)*r,y,math.cos(t)*r),(t*16.8,y)) for y,t in [(0.18,a),(0.18,b),(4.4,b),(4.4,a)]]
        g.quad(*ids)
        if k%6==0:
            # Recess returns join the exact exterior drum at each door jamb.
            for t in [a,b]:
                ids=[g.vertex((math.sin(t)*rr,y,math.cos(t)*rr)) for rr,y in [(r,.18),(16.8,.18),(16.8,4.4),(r,4.4)]]
                g.quad(*ids)
    mesh('facade',g,'glass')
    g=Shape(); g.lathe([(16.8,4.22),(17.05,4.22),(17.05,4.48),(16.8,4.48),(16.8,4.22)],24)
    mesh('bearing',g,'metal')
    g=Shape()
    # A four-lobed entrance canopy, continuous closed skin rather than a disk
    # through the interior. The four shallow lobes announce the door approaches.
    for j in range(48):
        a=TAU*j/48; r=19.4+max(0,math.cos(4*a))**6
        for rr,y in [(16.85,3.12),(r,3.12),(r,3.28),(16.85,3.28)]:
            g.vertex((math.sin(a)*rr,y,math.cos(a)*rr))
    for j in range(48):
        a=j*4; b=((j+1)%48)*4
        for q in [(a,b,b+1,a+1),(a+1,b+1,b+2,a+2),(a+2,b+2,b+3,a+3),(a+3,b+3,b,a)]: g.quad(*q)
    for k in range(24):
        a=(k+.5)*TAU/24
        g.box((math.sin(a)*16.82,2.26,math.cos(a)*16.82),(.07,4.12,.10),a)
    # A shallow transom ring and four door headers/paired handles all share metal.
    g.lathe([(16.77,1.04),(16.86,1.04),(16.86,1.10),(16.77,1.10),(16.77,1.04)],24)
    for k in range(4):
        a=k*math.pi/2
        g.box((math.sin(a)*16.45,2.98,math.cos(a)*16.45),(3.6,.23,.14),a)
        for x in [-.16,.16]:
            g.box((math.cos(a)*x+math.sin(a)*16.5,1.35,-math.sin(a)*x+math.cos(a)*16.5),(.035,.52,.075),a)
    mesh('canopy',g,'metal')
    # Chamfered square support, same 4.32 m socket height and 24 anchors.
    g=Shape(); profile=[(-.10,-.24),(.10,-.24),(.14,-.20),(.14,.20),(.10,.24),(-.10,.24),(-.14,.20),(-.14,-.20)]
    for y in [-2.16,2.16]:
        for x,z in profile:g.vertex((x,y,z))
    for j in range(8):g.quad(j,(j+1)%8,(j+1)%8+8,j+8)
    for start in [0,8]:
        for j in range(1,7):g.faces.append((start,start+j,start+j+1))
    mesh('column',g,'metal')
    g=Shape(); g.lathe([(.15,-.45),(.13,.45)],8,True); mesh('bollard',g,'metal')
    for tier,n,rows in [('near',64,24),('mid',32,12),('far',16,8)]:
        g=Shape()
        for i in range(rows+1):
            theta=math.acos(-.6)*i/rows
            for j in range(n+1):
                phi=TAU*j/n
                g.vertex((-21*math.cos(phi)*math.sin(theta),21*math.cos(theta),21*math.sin(phi)*math.sin(theta)),(j/n,1-i/rows))
        for i in range(rows):
            for j in range(n):
                a=i*(n+1)+j; b=a+n+1
                if i:g.faces.append((a,a+1,b+1))
                g.faces.append((a,b+1,b))
        mesh('shell_'+tier,g,'screen',True)
    assembly=bpy.data.collections.new('A71 / assembled near hall')
    bpy.context.scene.collection.children.link(assembly)
    def place(role,pos=(0,0,0),yaw=0,scale=(1,1,1)):
        o=objects[role].copy();o.data=objects[role].data;assembly.objects.link(o)
        o.name='Assembly / '+role;o.location=xyz(pos);o.rotation_euler.z=-yaw;o.scale=(scale[0],scale[2],scale[1])
    for role in ['plinth','facade','bearing','canopy']:place(role)
    place('foundation',scale=(1,.6,1));place('shell_near',(0,17,0))
    for k in range(24):
        a=k*TAU/24;place('column',(math.sin(a)*16.91,2.2,math.cos(a)*16.91),a)
    for k in range(20):
        a=(k+.5)*TAU/20;place('bollard',(math.sin(a)*25.9,.45,math.cos(a)*25.9))
    # Door/ground sockets are explicitly authored, but do not imply an interior
    # walking system or access road through the circuit's safety perimeter.
    for k in range(4):
        a=k*math.pi/2;o=bpy.data.objects.new('A71_ENTRY_'+str(k),None);assembly.objects.link(o)
        o.location=xyz((math.sin(a)*22.5,0,math.cos(a)*22.5));o.rotation_euler.z=-a
        o['clear_width']=3.6;o['threshold_height']=.18
    prototypes.hide_render=True;prototypes.hide_viewport=True
    bpy.context.scene['asset_id']='A71';bpy.context.scene['revision']='aurel-event-hall-r01'
    bpy.context.scene['scope']='Same Aurel site and 42m spherical screen; original external architecture only.'
    bpy.context.scene['final_art_approved']=False


def export(root, source):
    prototypes=bpy.data.collections.get('A71 / editable export prototypes')
    if not prototypes:raise ValueError('Missing original A71 prototypes')
    for o in bpy.context.scene.objects:o.select_set(False)
    prototypes.hide_viewport=False;prototypes.hide_render=False
    for name in NAMES:
        obj=bpy.data.objects.get('A71_'+name)
        if obj is None or obj.type!='MESH' or len(obj.data.materials)!=1:raise ValueError(name)
        if any(abs(v)>1e-8 for v in obj.location) or any(abs(v-1)>1e-8 for v in obj.scale):raise ValueError('Unexpected transform')
        obj.select_set(True)
    output=root/'public/models/aurel-event-hall.glb';output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,
        export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',
        export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
    raw=output.read_bytes(); size,kind=struct.unpack_from('<II',raw,12)
    if kind!=0x4e4f534a:raise ValueError('GLB JSON chunk')
    doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
    def attribute(index):
        a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
        component={5126:('f',4),5125:('I',4),5123:('H',2)}[a['componentType']]
        dim={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        stride=view.get('byteStride',component[1]*dim)
        start=view.get('byteOffset',0)+a.get('byteOffset',0)
        data=b''.join(binary[start+i*stride:start+i*stride+component[1]*dim] for i in range(a['count']))
        return {'data':base64.b64encode(data).decode(),'count':a['count'],'itemSize':dim,'componentType':a['componentType']}
    meshes={}
    for name in NAMES:
        node=next(n for n in doc['nodes'] if n['name']=='A71_'+name)
        p=doc['meshes'][node['mesh']]['primitives']
        if len(p)!=1:raise ValueError('One material per mesh required')
        p=p[0]; meshes[name]={k:attribute(p['attributes'][v]) for k,v in [('position','POSITION'),('normal','NORMAL'),('uv','TEXCOORD_0')]}
        meshes[name]['index']=attribute(p['indices'])
    package={'version':1,'assetId':'A71','units':'metres-Y-up','meshes':meshes}
    text=json.dumps(package,separators=(',',':'))+'\n'
    runtime=root/'src/rendering/event-hall.geometry.json';runtime.parent.mkdir(parents=True,exist_ok=True);runtime.write_text(text)
    triangles={k:v['index']['count']//3 for k,v in meshes.items()}
    total=sum(v*(24 if k=='column' else 20 if k=='bollard' else 1) for k,v in triangles.items())
    if total>=7000:raise ValueError('Retained eight-draw, 7000 triangle allocation budget exceeded: '+str(total))
    manifest={'version':1,'assetId':'A71','revision':'aurel-event-hall-r01','generator':'Blender '+bpy.app.version_string,
        'source':'scripts/author-event-hall.py','sourceSHA256':sha(Path(__file__).read_bytes()),
        'editable':'scripts/aurel-event-hall.blend','editableSHA256':sha(source.read_bytes()),
        'exchange':'public/models/aurel-event-hall.glb','exchangeSHA256':sha(raw),'exchangeBytes':len(raw),
        'runtimeSHA256':sha(text.encode()),'runtimeBytes':len(text.encode()),'triangles':triangles,
        'allocatedTrianglesWithInstances':total,'draws':8,'shellLevels':['near','mid','far'],
        'materials':len(doc['materials']),'externalTextures':0,'finalArtApproved':False}
    (runtime.parent/'event-hall.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))

args=argparse.ArgumentParser();args.add_argument('--output-root',required=True);args.add_argument('--source')
options=args.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(options.output_root).resolve()
if out==ROOT or ROOT in out.parents:raise ValueError('Author outside the checkout')
out.mkdir(parents=True,exist_ok=True); native=out/'scripts/aurel-event-hall.blend';native.parent.mkdir(exist_ok=True)
if options.source:
    src=Path(options.source).resolve();bpy.ops.wm.open_mainfile(filepath=str(src));shutil.copyfile(src,native)
else:
    author();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
export(out,native)
