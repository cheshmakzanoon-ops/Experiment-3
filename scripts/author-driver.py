"""Author the original APX seated suit in Blender, including a nine-joint skin.

blender --background --python-exit-code 1 --python scripts/author-driver.py

Three.js vehicle coordinates are metres, +Y up and +Z forward. Blender uses
(x,-z,y). The exporter converts these back to glTF Y-up. No downloaded meshes,
textures, motion capture, or proprietary art are inputs. Hands/helmet/harness
remain independently driven vehicle components; this asset owns the suit only.
"""
from pathlib import Path
import bpy, gzip, hashlib, json, math
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/rendering'
BONES = ['SeatRoot'] + [f'{part}_{side}' for side in ['R','L'] for part in ['Upper','Elbow','Forearm','Cuff']]
WHEEL_TILT = .12
UPPER, LOWER = .37, .36

def xyz(v): return (v[0], -v[2], v[1])
def smooth(t):
    t=max(0,min(1,t)); return t*t*(3-2*t)
def mix(a,b,t): return a*(1-t)+b*t

def wheel(v):
    x,y,z=v
    return Vector((x, .115+y*math.cos(WHEEL_TILT)-z*math.sin(WHEEL_TILT),
                   .22+y*math.sin(WHEEL_TILT)+z*math.cos(WHEEL_TILT)))

def joints(side):
    s=Vector((side*.16,.015,-.48)); w=wheel((side*.178,-.052,-.048))
    d=(w-s).length; axis=(w-s)/d; pole=Vector((side*.24,-.32,-.23))-s
    bend=(pole-axis*pole.dot(axis)).normalized()
    along=(UPPER**2-LOWER**2+d*d)/(2*d)
    e=s+axis*along+bend*math.sqrt(UPPER**2-along**2)
    return s,e,w

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials): bpy.data.materials.remove(block)
mat=bpy.data.materials.new('APX / woven suit'); mat.use_nodes=True
pbr=mat.node_tree.nodes.get('Principled BSDF')
pbr.inputs['Base Color'].default_value=(1,1,1,1);pbr.inputs['Roughness'].default_value=.89
attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='Tailored panels'
mat.node_tree.links.new(attr.outputs['Color'],pbr.inputs['Base Color'])
rig_data=bpy.data.armatures.new('APX seated suit hardpoints')
rig=bpy.data.objects.new('APX_SeatedSuit',rig_data);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root=rig_data.edit_bones.new('SeatRoot');root.head=xyz((0,0,0));root.tail=xyz((0,.05,0))
rest={}
for side,label in [(-1,'R'),(1,'L')]:
    s,e,w=joints(side); rest[label]={'shoulder':list(s),'elbow':list(e),'wrist':list(w)}
    bisector=((e-s).normalized()+(w-e).normalized()).normalized()
    cuff_axis=Vector((0,-math.cos(WHEEL_TILT)*.7-math.sin(WHEEL_TILT)*.7,
                      -math.sin(WHEEL_TILT)*.7+math.cos(WHEEL_TILT)*.7)).normalized()
    for name,a,b in [('Upper',s,e),('Elbow',e,e+bisector*.045),('Forearm',e,w),('Cuff',w,w+cuff_axis*.045)]:
        bone=rig_data.edit_bones.new(f'{name}_{label}');bone.head=xyz(a);bone.tail=xyz(b)
        # Siblings permit exact independent hardpoint transforms. Mesh weights,
        # not an accidental parent scale, connect the continuous suit surface.
        bone.parent=root;bone.use_connect=False
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(False)

def make_mesh(name, verts, faces, uvs, colours, weights=None):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([xyz(p) for p in verts],[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    obj['apex_character_role']=name
    mesh.materials.append(mat)
    uv=mesh.uv_layers.new(name='Tailoring UV')
    for loop in mesh.loops: uv.data[loop.index].uv=uvs[loop.vertex_index]
    color=mesh.color_attributes.new(name='Tailored panels',type='FLOAT_COLOR',domain='POINT')
    for i,c in enumerate(colours): color.data[i].color=(*c,1)
    for poly in mesh.polygons:poly.use_smooth=True
    if weights:
        groups={name:obj.vertex_groups.new(name=name) for name in BONES}
        for i,blend in enumerate(weights):
            for key,value in blend.items():
                if value>0:groups[key].add([i],value,'REPLACE')
        modifier=obj.modifiers.new('Hardpoint-driven continuous tailoring','ARMATURE');modifier.object=rig
        obj.parent=rig
    return obj

# A fitted seated torso: pelvis, waist, rib cage, clavicles, trapezius and collar.
# Fore/aft centres track a reclined seat rather than an upright mannequin.
profile=[(-.285,-.486,.106,.065),(-.235,-.475,.144,.087),(-.155,-.470,.159,.105),
         (-.075,-.468,.176,.109),(-.005,-.468,.192,.098),(.035,-.461,.183,.088),
         (.067,-.449,.145,.078),(.092,-.437,.080,.061)]
verts=[];faces=[];uv=[];col=[];rows=52;sides=48
for row in range(rows+1):
    y=mix(profile[0][0],profile[-1][0],row/rows)
    k=0
    while k<len(profile)-2 and y>profile[k+1][0]:k+=1
    a,b=profile[k],profile[k+1];t=smooth((y-a[0])/(b[0]-a[0]))
    z,rx,rz=[mix(a[i],b[i],t) for i in range(1,4)]
    for j in range(sides+1):
        angle=(j%sides)/sides*math.tau;ca=math.cos(angle);sa=math.sin(angle)
        # Gentle pectoral/abdominal compression folds, not an inflated cylinder.
        front=max(0,sa);waist=math.exp(-((y+.155)/.10)**2)
        fold=.0028*waist*front*math.sin(y*104+ca*3)
        seam=.0006*math.exp(-(ca/.027)**2)*front
        verts.append((ca*rx,y,z+sa*rz+fold+seam));uv.append((j/sides,row/rows))
        panel=smooth((abs(ca)-.62)/.19)
        shoulder=smooth((y-.008)/.045)*(1-panel)
        base=Vector((.22,.35,.36));dark=Vector((.018,.039,.052));cream=Vector((.68,.70,.62))
        colour=base.lerp(dark,panel).lerp(cream,shoulder*.85)
        col.append(tuple(colour))
        if row<rows and j<sides:
            q=row*(sides+1)+j;r=q+sides+1;faces.extend([(q,q+1,r),(q+1,r+1,r)])
for row in [0,rows]:
    centre=len(verts);ring=verts[row*(sides+1):row*(sides+1)+sides]
    verts.append(tuple(sum((Vector(p) for p in ring),Vector())/sides));uv.append((.5,.5));col.append((.22,.35,.36))
    for j in range(sides):
        a=row*(sides+1)+j;b=a+1;faces.append((centre,b,a) if row==0 else (centre,a,b))
make_mesh('suit_torso',verts,faces,uv,col)

# Each arm is ONE closed manifold surface. A volume-preserving elbow joint and
# cuff joint distribute bending and wrist twist over the knitted stretch panels.
for side,label in [(-1,'R'),(1,'L')]:
    s,e,w=joints(side); upper=(e-s).normalized(); lower=(w-e).normalized()
    across=upper.cross(lower).normalized()
    if across.x<0:across.negate()
    # Compression belongs to the inside of the seated elbow, not a stack of
    # concentric corrugations around the whole sleeve. Hardpoints stay unchanged.
    inside=(s+w-e*2).normalized()
    verts=[];faces=[];uv=[];col=[];weights=[];rows=72;sides=32
    for row in range(rows+1):
        distance=(UPPER+LOWER)*row/rows
        f=distance/UPPER if distance<=UPPER else (distance-UPPER)/LOWER
        centre=s.lerp(e,f) if distance<=UPPER else e.lerp(w,f)
        turn=smooth((distance-(UPPER-.075))/.15)
        tangent=upper.lerp(lower,turn).normalized();depth=across.cross(tangent).normalized()
        if distance<=UPPER:
            rx=mix(.055,.041,smooth(f));rz=mix(.048,.038,smooth(f))
            rx+=.014*math.sin(math.pi*f)**2
            rz+=.003*math.sin(math.pi*f)**2
        else:
            rx=mix(.041,.027,smooth(f));rz=mix(.038,.026,smooth(f))
            rx+=.011*math.sin(math.pi*f)**2
            rz+=.002*math.sin(math.pi*f)**2
        # Root weighting stays inside the broad deltoid; elbow receives its own
        # rotation instead of collapsing under opposing linear skin weights.
        root_mix=1-smooth(distance/.072)
        elbow_mix=max(0,1-abs(distance-UPPER)/.093);elbow_mix=smooth(elbow_mix)
        cuff_mix=smooth((distance-(UPPER+LOWER-.095))/.095)
        bone='Upper' if distance<=UPPER else 'Forearm'
        blend={f'{bone}_{label}':1.0}
        for name,amount in [(f'Elbow_{label}',elbow_mix),(f'Cuff_{label}',cuff_mix),('SeatRoot',root_mix)]:
            blend={key:value*(1-amount) for key,value in blend.items()};blend[name]=blend.get(name,0)+amount
        for j in range(sides+1):
            angle=(j%sides)/sides*math.tau;ca=math.cos(angle);sa=math.sin(angle)
            joint=math.exp(-((distance-UPPER)/.105)**2)
            compression=max(0.,(across*ca+depth*sa).dot(inside))**2
            # Compression fans cross the inside elbow; tension ridges run along
            # the outer forearm. Both die away at shoulder/cuff hardpoints.
            envelope=math.sin(math.pi*row/rows)**2
            fan=(.0031*math.sin(distance*118+ca*1.7)+.0009*math.sin(distance*191-sa*2))*joint*(.15+.85*compression)
            fan+=.0011*math.sin(angle*5+distance*11)*envelope*(1-joint)*smooth((distance-.38)/.16)
            # Short knitted cuff ribs, with an unchanged terminal ring.
            fan+=.0012*math.sin(distance*360)*math.exp(-((distance-.689)/.025)**2)*envelope
            seam=.00065*math.exp(-(math.sin(angle-.65)/.09)**2)*math.sin(math.pi*row/rows)**2
            p=centre+across*(ca*(rx+fan+seam))+depth*(sa*(rz+fan))
            verts.append(tuple(p));uv.append((j/sides,row/rows*2));weights.append(blend.copy())
            panel=smooth((math.cos(angle-side*.5)-.3)/.4)*smooth((distance-.12)/.15)
            cream=smooth((.13-distance)/.09)
            colour=Vector((.11,.195,.215)).lerp(Vector((.027,.051,.065)),panel*.82)
            colour=colour.lerp(Vector((.68,.70,.62)),cream*.85)
            # A stitched forearm panel has an actual bounded cloth colour, not
            # an emissive highlight; it follows the same skinned vertices.
            panel_edge=math.exp(-((distance-.57)/.011)**2)*(1-panel)*.36
            colour=colour.lerp(Vector((.61,.66,.61)),panel_edge)
            stitch=math.exp(-(math.sin(angle-.65)/.028)**2)*.5
            colour=colour.lerp(Vector((.58,.62,.56)),stitch)
            col.append(tuple(colour))
            if row<rows and j<sides:
                q=row*(sides+1)+j;r=q+sides+1;faces.extend([(q,r,q+1),(q+1,r,r+1)])
    for row,centre in [(0,s),(rows,w)]:
        idx=len(verts);verts.append(tuple(centre));uv.append((.5,.5));col.append((.22,.35,.36));weights.append(weights[row*(sides+1)].copy())
        for j in range(sides):
            a=row*(sides+1)+j;b=a+1;faces.append((idx,a,b) if row==0 else (idx,b,a))
    make_mesh(f'{label.lower()}_sleeve',verts,faces,uv,col,weights)

# Recalculate outward topology; authored UV seam normals are welded explicitly.
for obj in list(bpy.data.objects):
    if obj.type!='MESH':continue
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    # Same geometric coordinates at the U seam must have identical normals.
    normals=[v.normal.copy() for v in obj.data.vertices];buckets={}
    for v in obj.data.vertices:buckets.setdefault(tuple(round(c,7) for c in v.co),[]).append(v.index)
    for ids in buckets.values():
        n=sum((normals[i] for i in ids),Vector()).normalized()
        for i in ids:normals[i]=n
    obj.data.normals_split_custom_set_from_vertices(normals);obj.select_set(False)
rig['apex_character_revision']='27H-cockpit-tailoring-seated-suit-3'
rig['apex_driver_bones']=','.join(BONES)
def canonical_driver_glb(blob):
    """Remove host-SIMD joint decomposition noise without rounding mesh data.

    Only joint rotations/scales are canonicalized (1e-6 before quaternion
    normalization). Matching inverse bind matrices are recomputed in Python's
    double precision, then written as glTF float32. Positions, normals, colours,
    UVs, indices, weights, joint indices and literal translations are untouched.
    """
    import json, math, struct
    if len(blob)<28 or struct.unpack_from('<III',blob)!=(0x46546c67,2,len(blob)):
        raise ValueError('Expected a complete GLB 2 container')
    size,kind=struct.unpack_from('<II',blob,12)
    if kind!=0x4e4f534a: raise ValueError('Expected JSON first')
    document=json.loads(blob[20:20+size])
    start=20+size
    n,kind=struct.unpack_from('<II',blob,start)
    if kind!=0x004e4942 or start+8+n!=len(blob): raise ValueError('Expected one BIN chunk')
    data=bytearray(blob[start+8:])
    nodes=document['nodes'];parents={}
    for i,node in enumerate(nodes):
        for child in node.get('children',[]):
            if child in parents: raise ValueError('Joint graph has multiple parents')
            parents[child]=i
    identity=[[float(r==c) for c in range(4)] for r in range(4)]
    def multiply(a,b):
        return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
    def local(node):
        if 'matrix' in node: raise ValueError('Driver rig requires explicit TRS')
        x,y,z,w=node.get('rotation',[0.,0.,0.,1.]);sx,sy,sz=node.get('scale',[1.,1.,1.])
        tx,ty,tz=node.get('translation',[0.,0.,0.])
        return [[(1-2*(y*y+z*z))*sx,2*(x*y-z*w)*sy,2*(x*z+y*w)*sz,tx],
                [2*(x*y+z*w)*sx,(1-2*(x*x+z*z))*sy,2*(y*z-x*w)*sz,ty],
                [2*(x*z-y*w)*sx,2*(y*z+x*w)*sy,(1-2*(x*x+y*y))*sz,tz],
                [0.,0.,0.,1.]]
    joints={i for skin in document['skins'] for i in skin['joints']}
    for i in joints:
        node=nodes[i]
        if 'rotation' in node:
            q=[round(float(v),6) for v in node['rotation']]
            length=math.sqrt(sum(v*v for v in q))
            if not math.isfinite(length) or length<.99: raise ValueError('Invalid joint quaternion')
            node['rotation']=[v/length for v in q]
        if 'scale' in node:
            node['scale']=[round(float(v),6) for v in node['scale']]
            if any(not math.isfinite(v) or v<=0 for v in node['scale']): raise ValueError('Invalid joint scale')
    cache={};visiting=set()
    def world(i):
        if i in cache:return cache[i]
        if i in visiting:raise ValueError('Cyclic joint graph')
        visiting.add(i)
        matrix=multiply(world(parents[i]) if i in parents else identity,local(nodes[i]))
        visiting.remove(i);cache[i]=matrix
        return matrix
    def inverse(matrix):
        a=[row[:]+identity[r][:] for r,row in enumerate(matrix)]
        for c in range(4):
            pivot=max(range(c,4),key=lambda r:abs(a[r][c]))
            if abs(a[pivot][c])<1e-12:raise ValueError('Singular bind matrix')
            a[c],a[pivot]=a[pivot],a[c]
            divisor=a[c][c];a[c]=[v/divisor for v in a[c]]
            for r in range(4):
                if r!=c:
                    factor=a[r][c];a[r]=[v-factor*w for v,w in zip(a[r],a[c])]
        return [row[4:] for row in a]
    for skin in document['skins']:
        accessor=document['accessors'][skin['inverseBindMatrices']]
        view=document['bufferViews'][accessor['bufferView']]
        if accessor['componentType']!=5126 or accessor['type']!='MAT4' or accessor['count']!=len(skin['joints']) or 'sparse' in accessor or view.get('byteStride',64)!=64 or view.get('buffer',0)!=0:
            raise ValueError('Unexpected inverse-bind storage')
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
        if offset+64*accessor['count']>len(data):raise ValueError('Bind storage exceeds BIN')
        for index,joint in enumerate(skin['joints']):
            matrix=inverse(world(joint));values=[matrix[r][c] for c in range(4) for r in range(4)]
            original=struct.unpack_from('<16f',data,offset+index*64)
            if max(abs(a-b) for a,b in zip(original,values))>2e-6:
                raise ValueError('Canonicalization exceeds the driver bind precision budget')
            struct.pack_into('<16f',data,offset+index*64,*values)
    encoded=json.dumps(document,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    encoded+=b' '*((-len(encoded))%4)
    return (struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+
            struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
            struct.pack('<II',len(data),0x004e4942)+data)

# Retain the editable source, with named vertex groups and no baked pose.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/apx01-driver.blend'),compress=True)
raw=OUT/'apx01-driver.glb'
bpy.ops.export_scene.gltf(filepath=str(raw),export_format='GLB',export_animations=False,export_skins=True,
                         export_yup=True,export_extras=True,export_materials='EXPORT',export_texcoords=True,
                         export_normals=True,export_all_influences=False)
blob=canonical_driver_glb(raw.read_bytes());packed=bytearray(gzip.compress(blob,compresslevel=9,mtime=0));packed[9]=255
(OUT/'apx01-driver.glb.gz').write_bytes(packed);raw.unlink()
manifest={'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'revision':'27H-cockpit-tailoring-seated-suit-3','bytes':len(blob),'sha256':hashlib.sha256(blob).hexdigest(),
          'compressedBytes':len(packed),'compressedSHA256':hashlib.sha256(packed).hexdigest(),
          'bones':BONES,'roles':['suit_torso','r_sleeve','l_sleeve'],'rest':rest,'torsoProfile':profile,
          'maxVertices':18000,'maxTriangles':20000,'maxRawBytes':1500000,'blenderVersion':bpy.app.version_string}
(OUT/'apx01-driver.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('APX_DRIVER_ASSET',json.dumps(manifest))
