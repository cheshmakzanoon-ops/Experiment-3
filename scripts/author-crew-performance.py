"""A41/A42: original mechanic revision and editable task actions.

Blender 5.2.2: blender -b --python-exit-code 1 --python scripts/author-crew-performance.py
Retains the Aurel 15-bone rest skeleton and measured cuff/grip/sole sockets.
No supplied player, previous people asset, racing physics or service clock is modified.
The deliberately keyed actions are original animation, not motion capture.
"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import struct
import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/rendering'
SOURCE = ROOT / 'scripts/author-people.py'
SHA = lambda b: hashlib.sha256(b).hexdigest()
base_hash = json.loads((OUT / 'aurel-people.manifest.json').read_text())['sourceSHA256']
assert SHA(SOURCE.read_bytes()) == base_hash, 'Retained Aurel pattern changed'
ns = {'__file__': str(SOURCE)}
exec(compile(SOURCE.read_text().split("bpy.ops.object.select_all(action='SELECT');", 1)[0], str(SOURCE), 'exec'), ns)
Shape, REST, NAMES = ns['Shape'], ns['BONES'], ns['NAMES']
C = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
CI = C.inverted()
PARENTS = [None,0,1,1,3,4,1,6,7,0,9,10,0,12,13]
FABRIC = (.62,.68,.70)
PANEL = (.11,.16,.18)
RUBBER = (.032,.038,.043)
TRIM = (.47,.43,.34)
clamp = lambda x: max(0., min(1., x))
smooth = lambda x: clamp(x)**2 * (3-2*clamp(x))


def weights(g, index, mapping):
    pairs = sorted([(k,v) for k,v in mapping.items() if v > 1e-8], key=lambda x: -x[1])[:4]
    total = sum(v for _,v in pairs)
    g.j[index] = [k for k,_ in pairs] + [0]*(4-len(pairs))
    g.w[index] = [v/total for _,v in pairs] + [0]*(4-len(pairs))


def garment(sides):
    """Re-patterned torso, shaped sleeves, four-influence shoulders/hips.

    Keep soles, wrists and skeletal lengths. The cloth can change silhouette
    without moving its attachment contracts. Reinforcement follows cloth skin,
    not a rigid shin box that punches through the knee when crouching.
    """
    g = Shape()
    # More volume around the shoulder blades/chest, a shorter crotch and less
    # cylindrical waist. Distinct front/back depth is applied below.
    rows = [(.805,.134,.097),(.88,.166,.117),(.98,.153,.112),(1.08,.162,.118),
            (1.19,.182,.137),(1.31,.216,.143),(1.395,.242,.124),
            (1.445,.220,.098),(1.470,.183,.083),(1.495,.095,.067),(1.513,.064,.061)]
    start=len(g.v)
    g.loft([((0,y,0),x,z,smooth((y-.86)/.20)) for y,x,z in rows], sides,
           FABRIC, 0, 1, tailoring='torso')
    torso_end=len(g.v)
    for i in range(start,torso_end):
        x,y,z=g.v[i]
        # Sternum and scapula profiles avoid a uniformly elliptical barrel.
        if z>0:
            z += .009*math.exp(-((y-1.25)/.15)**2)*(1-(abs(x)/.26)**2)
        else:
            z -= .008*math.exp(-((abs(x)-.125)/.09)**2)*math.exp(-((y-1.35)/.13)**2)
        g.v[i]=(x,y,z)
        if y<.90:
            leg=9 if x<0 else 12
            amount=.35*(1-smooth((y-.805)/.10))*smooth(abs(x)/.075)
            fraction=smooth((x+.09)/.18)
            weights(g,i,{0:1-amount,9:amount*(1-fraction),12:amount*fraction})
    g.loft([((0,1.489,0),.071,.064,0),((0,1.53,0),.068,.060,0)], sides,PANEL,1,cloth=0)
    # Front zipper welt, chest pockets and low-profile belt: no waist slab.
    g.box((0,1.276,.147),(.011,.27,.006),PANEL,1)
    g.box((-.097,1.318,.137),(.063,.081,.013),PANEL,1)
    g.box((.090,1.32,.138),(.075,.039,.003),TRIM,1)
    for side in [-1,1]:
        arm=3 if side<0 else 6
        leg=9 if side<0 else 12
        begin=len(g.v)
        # Deltoid -> triceps -> elbow -> forearm taper, with a softer armhole.
        rows=[(.741,.040,.036),(.83,.046,.042),(.94,.055,.049),(1.035,.061,.055),
              (1.07,.065,.058),(1.13,.068,.063),(1.23,.073,.070),
              (1.345,.078,.075),(1.418,.077,.075),(1.465,.059,.057),(1.490,.019,.028)]
        g.loft([((side*(.245-.040*smooth((y-1.445)/.045)),y,0),x,z,smooth((1.135-y)/.14)) for y,x,z in rows],
               sides,FABRIC,arm,arm+1,tailoring='sleeve')
        for i in range(begin,len(g.v)):
            x,y,z=g.v[i]
            fore=smooth((1.135-y)/.14)
            shoulder=smooth((y-1.345)/.12)
            inside=clamp((.285-abs(x))/.10)
            chest=shoulder*(.24+.30*inside)
            weights(g,i,{1:chest,arm:(1-chest)*(1-fore),arm+1:(1-chest)*fore})
        g.loft([((side*.245,.731,0),.041,.038,0),((side*.245,.777,0),.045,.040,0)],sides,PANEL,arm+1,cloth=0)
        begin=len(g.v)
        rows=[(.12,.047,.051),(.21,.058,.057),(.32,.066,.066),(.42,.066,.070),
              (.46,.068,.074),(.52,.078,.075),(.64,.090,.084),(.77,.098,.090),(.89,.093,.096)]
        g.loft([((side*.092,y,.012*(1-smooth((y-.15)/.25))),x,z,smooth((.515-y)/.135)) for y,x,z in rows],
               sides,FABRIC,leg,leg+1,tailoring='leg')
        for i in range(begin,len(g.v)):
            x,y,z=g.v[i]
            shin=smooth((.515-y)/.135)
            pelvic=.25*smooth((y-.77)/.12)
            weights(g,i,{0:pelvic,leg:(1-pelvic)*(1-shin),leg+1:(1-pelvic)*shin})
            # Reinforcement is the curved garment surface itself, so it deforms.
            knee=math.exp(-((y-.46)/.064)**4)*smooth((z-.018)/.045)
            g.c[i]=tuple(FABRIC[k]*(1-.68*knee) for k in range(3))
        # Heel cup, rounded toe, flatter sole and ankle. Exact floor is retained.
        g.loft([((side*.092,y,z),x,d,0) for y,z,x,d in [(.005,.078,.062,.139),(.023,.078,.066,.143),
                    (.063,.07,.064,.138),(.108,.04,.049,.09),(.16,.02,.045,.05)]],sides,RUBBER,leg+2,cloth=0)
        g.loft([((side*.092,.006,.078),.064,.14,0),((side*.092,.023,.078),.066,.143,0)],sides,(.075,.08,.085),leg+2,cloth=0)
        if sides>=20:
            for n in range(5):
                g.box((side*.092,.103,.061+n*.019),(.065,.004,.004),TRIM,leg+2)
    # Panel boundaries and narrow fold fans; not broad plastic stripes.
    for i,(x,y,z) in enumerate(g.v):
        if not g.mask[i]:continue
        radial=math.exp(-((y-1.07)/.07)**2) if abs(x)>.20 else math.exp(-((y-.93)/.075)**2)
        # Low-amplitude asymmetric gathers; the bind garment remains smooth.
        dz=.0024*radial*math.sin(y*116+abs(x)*18)*smooth((-z+.02)/.075)
        g.v[i]=(x,y,z+dz)
        flank=smooth((abs(x)-.13)/.10) if y>1.0 and abs(x)<.235 else 0
        g.c[i]=tuple(c*(1-.18*flank) for c in g.c[i])
    return g


def tailoring_matrices():
    # Separate limbs in a temporary A-pose while joining shoulder/hip seams.
    # Unioning a straight-arm bind pose welds sleeve to flank down to the elbow.
    transforms=[Matrix.Identity(4) for _ in REST]
    for first,angle in [(3,-.48),(6,.48),(9,-.10),(12,.10)]:
        pivot=Vector(REST[first])
        value=Matrix.Translation(pivot) @ Matrix.Rotation(angle,4,'Z') @ Matrix.Translation(-pivot)
        for bone in range(first,first+3):transforms[bone]=value
    return transforms


def skin_matrix(joints, weights, matrices):
    value=Matrix(((0.,)*4,)*4)
    for bone,weight in zip(joints,weights):
        if weight:value+=matrices[bone]*weight
    return value


def unify_garment(original, target):
    """Join the overlapping cloth volumes into a continuous deforming surface.

    Only garment faces are remeshed. Hardware, cuffs and sole boundaries keep
    their authored vertices. Smoothly transfer the original skin field onto the
    continuous surface, then derive both tiers from the same voxel envelope.
    """
    transforms=tailoring_matrices()
    posed=[skin_matrix(j,w,transforms) @ Vector((*p,1)) for p,j,w in zip(original.v,original.j,original.w)]
    faces=[face for face in original.f if all(original.mask[i] for i in face)]
    ids=sorted({i for face in faces for i in face});indices={old:new for new,old in enumerate(ids)}
    mesh=bpy.data.meshes.new('continuous garment work surface')
    mesh.from_pydata([tuple(posed[i][:3]) for i in ids],[],[tuple(indices[i] for i in face) for face in faces]);mesh.update()
    obj=bpy.data.objects.new('garment voxel union',mesh);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    obj.data.remesh_voxel_size=.014
    bpy.ops.object.voxel_remesh()
    polish=obj.modifiers.new('Relax garment junctions','SMOOTH');polish.factor=.8;polish.iterations=4
    bpy.ops.object.modifier_apply(modifier=polish.name)
    triangles=sum(len(p.vertices)-2 for p in obj.data.polygons)
    decimate=obj.modifiers.new('Bounded deformation topology','DECIMATE');decimate.ratio=min(1.,target/triangles)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    tri=obj.modifiers.new('Runtime triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    kd=KDTree(len(ids))
    for local,old in enumerate(ids):kd.insert(Vector(posed[old][:3]),old)
    kd.balance()
    g=Shape()
    for vertex in obj.data.vertices:
        point=vertex.co.copy();neighbors=kd.find_n(point,6)
        factors=[1/(distance*distance+1e-6) for _,_,distance in neighbors];total=sum(factors)
        colour=[0.,0.,0.];skin={}
        for (_,old,_),factor in zip(neighbors,factors):
            weight=factor/total
            for channel in range(3):colour[channel]+=weight*original.c[old][channel]
            for bone,value in zip(original.j[old],original.w[old]):skin[bone]=skin.get(bone,0)+weight*value
        index=g.vertex(tuple(point),tuple(colour));weights(g,index,skin)
        inverse=skin_matrix(g.j[index],g.w[index],transforms).inverted()
        g.v[index]=tuple((inverse @ Vector((*point,1)))[:3])
    g.f=[tuple(p.vertices) for p in obj.data.polygons]
    bpy.data.objects.remove(obj,do_unlink=True)
    # Carry the manufactured parts through unmodified, with no surface union.
    faces=[face for face in original.f if not all(original.mask[i] for i in face)]
    mapping={}
    for old in sorted({i for face in faces for i in face}):
        new=g.vertex(original.v[old],original.c[old],cloth=original.mask[old]);mapping[old]=new
        g.j[new]=original.j[old][:];g.w[new]=original.w[old][:]
    g.f.extend(tuple(mapping[i] for i in face) for face in faces)
    return g


def refined_helmet():
    g=ns['helmet']()
    # Retain the tested headset/visor envelope, but flatten the rear quarter,
    # form a brow ridge and a chin taper instead of adding a larger sphere.
    for i,(x,y,z) in enumerate(g.v):
        if z<-.035:
            z*=1-.065*smooth((-z-.035)/.07)
        if y>.06:
            x*=1-.025*smooth((y-.06)/.07)
        g.v[i]=(x,y,z)
    # Shell-edge gasket below the ear and a vent rim across the brow.
    g.tube([(-.092,-.10,.046),(-.073,-.119,.089),(0,-.122,.123),(.073,-.119,.089),(.092,-.10,.046)],
           .003,8,RUBBER)
    for s in [-1,1]:
        g.tube([(s*.048,.073,.112),(s*.067,.091,.085),(s*.087,.087,.054)],.0025,8,RUBBER)
        for n in range(3):
            g.box((s*(.048+n*.013),-.08,.149),(.007,.004,.002),RUBBER)
    return g


def refined_glove():
    g=Shape()
    g.loft([((0,y,z),x,d,0) for y,z,x,d in [(-.076,-.011,.036,.022),(-.054,-.009,.039,.022),
                  (-.023,-.003,.041,.023),(.010,.005,.041,.024),(.037,.015,.037,.022)]],20,RUBBER,cloth=0)
    # Curled digits have individual knuckles, a defined thumb opposition and
    # a clear palm opening around the retained local grip (0,.034,.041).
    for digit in range(4):
        x=(digit-1.5)*.019
        rise=[.011,.018,.016,.005][digit]
        g.tube([(x,.024,.014),(x,.050+rise,.025),(x,.052+rise*.4,.052),
                (x,.035,.067),(x,.019,.059)], [.0095,.010,.009,.0077,.0068],12,(.13,.16,.17))
        g.ellipsoid((x,.049+rise,.023),(.0104,.010,.006),(.19,.21,.21),segments=12,rings=6)
    g.tube([(-.033,-.032,.003),(-.055,-.009,.015),(-.050,.016,.038),(-.031,.018,.057)],
           [.014,.014,.012,.010],12,(.14,.16,.17))
    g.box((0,-.051,-.033),(.059,.022,.004),TRIM)
    g.tube([(-.03,-.060,-.030),(0,-.061,-.034),(.03,-.060,-.030)],.0015,6,(.36,.38,.35))
    return g


def build_mesh(name,g):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([tuple((C @ Vector((*v,1)))[:3]) for v in g.v],[],g.f)
    mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(mesh);bm.free();mesh.update()
    for p in mesh.polygons:p.use_smooth=True
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    mat=bpy.data.materials.new(name+' finish');mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.87 if 'suit' in name else .55
    col=mat.node_tree.nodes.new('ShaderNodeVertexColor');col.layer_name='Color'
    mat.node_tree.links.new(col.outputs['Color'],bsdf.inputs['Base Color'])
    mesh.materials.append(mat)
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for i,c in enumerate(g.c):attr.data[i].color=(*c,1)
    uv=mesh.uv_layers.new(name='Garment unwrap')
    for polygon in mesh.polygons:
        for li in polygon.loop_indices:
            vi=mesh.loops[li].vertex_index;x,y,z=g.v[vi]
            bone=g.j[vi][0]
            cx=REST[bone][0] if bone in [3,4,5,6,7,8,9,10,11,12,13,14] else 0
            uv.data[li].uv=(math.atan2(z,x-cx)/(2*math.pi)+.5,y/1.8)
    if 'suit' in name:
        for n in NAMES:obj.vertex_groups.new(name=n)
        for i in range(len(g.v)):
            for bone,w in zip(g.j[i],g.w[i]):
                if w:obj.vertex_groups[bone].add([i],w,'REPLACE')
    data={'position':g.v,'normal':[tuple((CI.to_3x3() @ v.normal)) for v in mesh.vertices],
          'index':[v for p in mesh.polygons for v in p.vertices],'color':g.c,
          'joints':g.j,'weights':g.w,'cloth':g.mask,
          'uv':[(math.atan2(z,x-REST[g.j[i][0]][0])/(2*math.pi)+.5,y/1.8) for i,(x,y,z) in enumerate(g.v)]}
    data={k:[round(float(a),6) for row in v for a in row] if k not in ['index','cloth'] else v for k,v in data.items()}
    # Integer joint storage and indices are deliberately retained as integers.
    data['joints']=[int(j) for j in data['joints']]
    return obj,data


def rig_create():
    arm=bpy.data.armatures.new('Aurel retained 15-bone rig')
    obj=bpy.data.objects.new('CrewPerformance',arm);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for i,n in enumerate(NAMES):
        b=arm.edit_bones.new(n);b.head=(C @ Vector((*REST[i],1)))[:3]
        end=REST[i+1] if i in [3,4,6,7,9,10,12,13] else (REST[i][0],REST[i][1]+.15,REST[i][2])
        b.tail=(C @ Vector((*end,1)))[:3]
        if PARENTS[i] is not None:b.parent=arm.edit_bones[NAMES[PARENTS[i]]]
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in obj.pose.bones:p.rotation_mode='QUATERNION'
    return obj


def bend(a,b,upper,lower,pole):
    delta=b-a;d=max(abs(upper-lower)+1e-5,min(upper+lower-1e-5,delta.length))
    delta.normalize();perp=Vector(pole)-delta*Vector(pole).dot(delta);perp.normalize()
    along=(upper*upper+d*d-lower*lower)/(2*d)
    return a+delta*along+perp*math.sqrt(max(0,upper*upper-along*along))


def key_pose(hip=.855,lean=.035,twist=0.,sway=0.,head=(0.,0.,0.),hands=None,feet=None,elbow=0.):
    """Designed key poses: global runtime-space joints and rigid skin rotations."""
    joint=[Vector(p) for p in REST];q=[Quaternion() for _ in REST]
    joint[0]=Vector((sway,hip,0));joint[1]=joint[0].copy()
    q[1]=Quaternion((0,1,0),twist) @ Quaternion((1,0,0),lean)
    for i in [2,3,6]:joint[i]=joint[0]+q[1]@(Vector(REST[i])-Vector(REST[0]))
    q[2]=Quaternion((0,1,0),head[1]) @ Quaternion((1,0,0),head[0]) @ Quaternion((0,0,1),head[2])
    hands=hands or [(-.21,.79,.07),(.21,.79,.07)]
    feet=feet or [(-.14,.055,.035),(.14,.055,.035)]
    down=Vector((0,-1,0))
    for side in [0,1]:
        sign=-1 if side==0 else 1;a=3 if side==0 else 6;l=9 if side==0 else 12
        joint[a+2]=Vector(hands[side]);joint[a+1]=bend(joint[a],joint[a+2],.36,.34,(sign*(.8+elbow),-.25,-.30))
        q[a]=down.rotation_difference((joint[a+1]-joint[a]).normalized())
        q[a+1]=down.rotation_difference((joint[a+2]-joint[a+1]).normalized());q[a+2]=q[a+1].copy()
        joint[l]=joint[0]+Vector((sign*.092,0,0));joint[l+2]=Vector(feet[side])
        joint[l+1]=bend(joint[l],joint[l+2],.42,math.hypot(.405,.035),(0,0,1))
        q[l]=down.rotation_difference((joint[l+1]-joint[l]).normalized())
        restshin=(Vector(REST[l+2])-Vector(REST[l+1])).normalized()
        q[l+1]=restshin.rotation_difference((joint[l+2]-joint[l+1]).normalized())
    return joint,q


# Each list is deliberately keyed, not a recording of the old runtime solver.
# Hip and torso poses include anticipation, weight transfer and settling.
# The route/contact solver may retarget endpoints without inventing service state.
IDLE=[(0,dict()),(.8,dict(sway=-.006,head=(.02,-.08,0))),
      (2,dict(sway=.006,head=(0,.10,-.02))),(3.2,dict(sway=-.003,head=(.025,.04,0))),(4,dict())]
WALK=[]
for t,sway,hip,lz,rz,ly,ry in [(0,0,.845,0,0,0,0),(.15,-.009,.836,.10,-.05,.06,0),
                            (.30,-.006,.845,.20,-.10,0,0),(.45,.002,.852,.10,-.02,0,.05),
                            (.60,.009,.836,0,.18,0,.07),(.90,.006,.845,-.10,.20,0,0),(1.2,0,.845,0,0,0,0)]:
    WALK.append((t,dict(hip=hip,lean=.055,sway=sway,twist=-sway*3,head=(.025,-sway*2,0),
                 hands=[(-.22,.78,.05-rz*.45),(.22,.78,.05-lz*.45)],
                 feet=[(-.14,.055+ly,.035+lz),(.14,.055+ry,.035+rz)])))
KNEEL=[(0,dict()),(.30,dict(hip=.84,lean=.09,head=(.08,0,0))),
       (.85,dict(hip=.65,lean=.15,sway=-.004,head=(.13,0,0),hands=[(-.21,.67,.20),(.21,.67,.20)])),
       (1.45,dict(hip=.49,lean=.20,head=(.17,0,0),hands=[(-.21,.59,.36),(.21,.59,.36)])),
       (2,dict(hip=.46,lean=.185,head=(.17,0,0),hands=[(-.21,.59,.40),(.21,.59,.40)]))]
INSPECT=[(0,KNEEL[-1][1]),(1,dict(hip=.456,lean=.19,twist=-.016,head=(.22,-.10,0),elbow=-.10)),
         (2,dict(hip=.46,lean=.18,twist=.012,head=(.20,.07,0),elbow=.05)),(3,KNEEL[-1][1])]
LIFT=[(0,KNEEL[-1][1]),(.5,dict(hip=.45,lean=.205,head=(.23,0,0),elbow=-.08)),
      (1.3,dict(hip=.455,lean=.17,head=(.19,-.02,0),hands=[(-.22,.67,.39),(.22,.67,.39)])),
      (2.3,dict(hip=.46,lean=.16,head=(.13,.02,0),hands=[(-.22,.72,.39),(.22,.72,.39)])),
      (3,dict(hip=.46,lean=.185,head=(.12,0,0),hands=[(-.22,.72,.39),(.22,.72,.39)]))]
STAND=[(0,LIFT[-1][1]),(.35,dict(hip=.50,lean=.16,head=(.11,0,0))),
       (.9,dict(hip=.68,lean=.095,head=(.07,0,0))),
       (1.5,dict(hip=.85,lean=.035,head=(.035,0,0))),
       (2,dict(hip=.855,lean=.035,head=(.025,0,0),hands=[(-.22,.90,.41),(.22,.90,.41)]))]
TURN=[(0,dict()),(.25,dict(sway=-.006,twist=-.04,head=(.02,-.18,0))),
      (.65,dict(sway=.004,twist=.025,head=(.02,.08,0))),(1.2,dict())]
CARRY=[(t,{**p,'hands':[(-.22,.90,.41),(.22,.90,.41)],'lean':.055,'head':(.045,0,0)}) for t,p in WALK]
# Service clock duration is the existing 5.2 seconds. Gun location, actuation and
# wheel release remain physics-owned; these keys author posture and followthrough.
GUN=[(0,dict(hip=.30,lean=.85,head=(.30,0,0),
            hands=[(-.12,.27,.48),(.12,.28,.44)],
            feet=[(-.14,.055,.185),(.14,.055,.185)])),
     (.60,dict(hip=.295,lean=.86,head=(.31,-.035,0),elbow=-.12)),
     (1.0,dict(hip=.30,lean=.85,head=(.32,0,0),elbow=-.16)),
     (1.35,dict(hip=.306,lean=.82,head=(.24,.03,0),elbow=.06)),
     (2.2,dict(hip=.30,lean=.83,head=(.27,-.05,0),elbow=.05)),
     (3.05,dict(hip=.295,lean=.86,head=(.31,0,0),elbow=-.12)),
     (3.4,dict(hip=.30,lean=.85,head=(.30,0,0),elbow=-.08)),
     (3.9,dict(hip=.307,lean=.82,head=(.24,.06,0),elbow=.10)),
     (5.2,dict(hip=.30,lean=.85,head=(.30,0,0)))]
ACTIONS={'idle':IDLE,'walk':WALK,'turn':TURN,'kneel':KNEEL,'inspect':INSPECT,'lift':LIFT,'stand':STAND,'carry':CARRY,'gun_service':GUN}


# Five complementary service actions. The 5.2-second reference is the existing
# service schedule, not a new simulation duration. Runtime adds the small keyed
# hip/lean offsets to each measured working posture and retargets both hands.
# Separate removal/installation keys encode different weight transfer and gaze.
REMOVE = [
    (0, dict(hip=.43, lean=.35, head=(.14,-.08,0), hands=[(-.20,.58,.38),(.20,.58,.38)])),
    (.20, dict(hip=.425, lean=.375, sway=-.008, head=(.22,-.04,0))),
    (.80, dict(hip=.418, lean=.38, twist=-.025, head=(.30,0,0), elbow=-.10)),
    (1.35, dict(hip=.415, lean=.395, sway=-.012, head=(.31,0,0), elbow=-.12)),
    (1.70, dict(hip=.424, lean=.33, twist=.035, sway=.008, head=(.26,-.06,0), elbow=.08)),
    (2.10, dict(hip=.438, lean=.315, twist=.025, sway=.012, head=(.18,-.12,0), elbow=.12)),
    (2.20, dict(hip=.44, lean=.32, head=(.18,-.14,0))),
    (2.90, dict(hip=.435, lean=.33, twist=-.015, sway=-.005, head=(.10,-.18,0), elbow=.02)),
    (3.50, dict(hip=.43, lean=.35, twist=0, sway=0, head=(.13,.08,0))),
    (4.50, dict(hip=.434, lean=.34, head=(.10,-.08,0))),
    (5.20, dict(hip=.43, lean=.35, head=(.12,0,0))),
]
INSTALL = [
    (0, dict(hip=.43, lean=.35, head=(.12,.14,0), hands=[(-.20,.58,.38),(.20,.58,.38)])),
    (.80, dict(hip=.428, lean=.36, sway=.004, head=(.17,.10,0))),
    (1.35, dict(hip=.422, lean=.375, twist=.025, sway=.010, head=(.25,.04,0), elbow=.08)),
    (1.80, dict(hip=.416, lean=.39, twist=.015, head=(.31,0,0), elbow=-.04)),
    (2.20, dict(hip=.422, lean=.38, twist=0, sway=0, head=(.32,0,0), elbow=-.08)),
    (2.65, dict(hip=.42, lean=.39, sway=-.005, head=(.30,-.04,0), elbow=-.14)),
    (3.05, dict(hip=.425, lean=.365, sway=0, head=(.27,0,0))),
    (3.50, dict(hip=.43, lean=.335, head=(.20,.10,0), elbow=.06)),
    (4.15, dict(hip=.44, lean=.32, twist=-.025, sway=-.008, head=(.12,.18,0))),
    (4.60, dict(hip=.433, lean=.34, twist=0, sway=0, head=(.12,.08,0))),
    (5.20, dict(hip=.43, lean=.35, head=(.12,0,0))),
]
FRONT_JACK = [
    (0, dict(hip=.60, lean=.52, head=(.18,0,0), hands=[(-.14,.83,.35),(.14,.83,.35)])),
    (.50, dict(hip=.588, lean=.555, sway=-.009, head=(.28,0,0), elbow=-.06)),
    (.80, dict(hip=.58, lean=.57, sway=0, head=(.30,0,0))),
    (1.25, dict(hip=.587, lean=.54, head=(.26,0,0), elbow=.08)),
    (1.95, dict(hip=.60, lean=.51, head=(.18,-.12,0))),
    (2.20, dict(hip=.60, lean=.52, head=(.19,-.07,0))),
    (3.05, dict(hip=.595, lean=.53, head=(.19,.12,0))),
    (3.50, dict(hip=.60, lean=.52, head=(.16,0,0))),
    (3.85, dict(hip=.59, lean=.55, sway=-.008, head=(.26,0,0))),
    (4.35, dict(hip=.585, lean=.565, sway=0, head=(.27,0,0))),
    (4.70, dict(hip=.597, lean=.535, head=(.15,-.18,0))),
    (4.95, dict(hip=.61, lean=.49, twist=-.04, sway=-.010, head=(.08,-.24,0))),
    (5.20, dict(hip=.60, lean=.52, twist=0, sway=0, head=(.12,-.12,0))),
]
REAR_JACK = [
    (0, dict(hip=.60, lean=.52, head=(.22,.08,0), hands=[(-.18,.81,.34),(.18,.81,.34)])),
    (.50, dict(hip=.59, lean=.545, twist=.025, sway=.009, head=(.30,0,0), elbow=.10)),
    (.80, dict(hip=.582, lean=.56, twist=.01, head=(.32,0,0))),
    (1.30, dict(hip=.59, lean=.535, sway=-.004, head=(.24,-.06,0))),
    (1.95, dict(hip=.60, lean=.52, twist=0, sway=0, head=(.17,.15,0))),
    (2.20, dict(hip=.60, lean=.52, head=(.22,.06,0))),
    (3.05, dict(hip=.594, lean=.54, head=(.21,-.12,0), elbow=.03)),
    (3.50, dict(hip=.60, lean=.52, head=(.17,0,0))),
    (3.85, dict(hip=.588, lean=.55, sway=.008, head=(.25,0,0))),
    (4.35, dict(hip=.585, lean=.56, twist=.015, head=(.26,0,0))),
    (4.70, dict(hip=.598, lean=.53, sway=0, head=(.16,.18,0))),
    (4.95, dict(hip=.61, lean=.495, twist=.04, sway=.010, head=(.09,.24,0))),
    (5.20, dict(hip=.60, lean=.52, twist=0, sway=0, head=(.16,.12,0))),
]
RELEASE = [
    (0, dict(hip=.84, lean=.08, head=(.05,-.20,0), hands=[(-.08,1.04,.40),(.08,1.16,.40)])),
    (.80, dict(hip=.836, lean=.09, sway=-.008, head=(.08,.20,0))),
    (1.70, dict(hip=.84, lean=.08, twist=-.025, sway=.004, head=(.10,-.22,0))),
    (2.20, dict(hip=.839, lean=.085, twist=.02, head=(.08,.17,0))),
    (3.05, dict(hip=.837, lean=.09, sway=-.004, head=(.12,-.10,0))),
    (3.50, dict(hip=.84, lean=.08, twist=0, sway=0, head=(.10,.20,0))),
    (4.40, dict(hip=.836, lean=.09, head=(.08,-.20,0))),
    # Still a HOLD pose: reaching clock 5.2 does not prove traffic clearance.
    (5.20, dict(hip=.84, lean=.08, head=(.08,0,0))),
]
ACTIONS.update({'tyre_remove': REMOVE, 'tyre_install': INSTALL,
                'front_jack': FRONT_JACK, 'rear_jack': REAR_JACK,
                'release_service': RELEASE})


def make_actions(rig):
    clips={}
    rig.animation_data_create()
    for name,keys in ACTIONS.items():
        action=bpy.data.actions.new(name);action.use_fake_user=True
        rig.animation_data.action=action
        parameters = {}
        for t,params in keys:
            parameters.update(params)
            joint,rotation=key_pose(**parameters)
            desired=[]
            for i,n in enumerate(NAMES):
                skin=Matrix.Translation(joint[i]) @ rotation[i].to_matrix().to_4x4() @ Matrix.Translation(-Vector(REST[i]))
                desired.append(C @ skin @ CI @ rig.data.bones[n].matrix_local)
            for i,n in enumerate(NAMES):
                p=rig.pose.bones[n]
                parent=PARENTS[i]
                # Compute local basis from intended parent, not a partially
                # updated evaluated hierarchy from a different keyframe.
                if parent is None:
                    p.matrix_basis=p.bone.matrix_local.inverted() @ desired[i]
                else:
                    p.matrix_basis=p.bone.matrix_local.inverted() @ rig.data.bones[NAMES[parent]].matrix_local @ desired[parent].inverted() @ desired[i]
                p.keyframe_insert(data_path='location',frame=round(t*30),group=n)
                p.keyframe_insert(data_path='rotation_quaternion',frame=round(t*30),group=n)
        # Explicit clamped cubic/Bezier interpolation with auto handles.
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fcurve in bag.fcurves:
                        for k in fcurve.keyframe_points:
                            k.interpolation='BEZIER';k.handle_left_type=k.handle_right_type='AUTO_CLAMPED'
        parameters={}
        for t,params in keys:
            parameters.update(params)
            expected,_=key_pose(**parameters)
            bpy.context.scene.frame_set(round(t*30))
            bpy.context.view_layer.update()
            for i,n in enumerate(NAMES):
                p=rig.pose.bones[n]
                skin=CI @ (p.matrix @ p.bone.matrix_local.inverted()) @ C
                measured=Vector((skin @ Vector((*REST[i],1)))[:3])
                assert (measured-expected[i]).length < .00002, f'{name}/{t}/{n} keyframe hierarchy mismatch'
        duration=keys[-1][0]
        samples=[]
        # Runtime tracks are evaluated from the actual action, not a second formula.
        for frame in range(round(duration*30)+1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            values=[]
            for i,n in enumerate(NAMES):
                p=rig.pose.bones[n]
                skin=CI @ (p.matrix @ p.bone.matrix_local.inverted()) @ C
                position=skin @ Vector((*REST[i],1));q=skin.to_quaternion().normalized()
                values.extend([*position[:3],q.x,q.y,q.z,q.w])
            samples.append([round(v,6) for v in values])
        clips[name]={'duration':duration,'fps':30,'frames':samples}
        # Stash each distinct action; glTF uses these action bindings.
        track=rig.animation_data.nla_tracks.new();track.name=name
        strip=track.strips.new(name,0,action);track.mute=True
        rig.animation_data.action=None
    bpy.context.scene.frame_set(0)
    for p in rig.pose.bones:p.matrix_basis.identity()
    return clips


def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    bpy.context.scene.render.fps=30
    bpy.context.scene.frame_start=0
    rig=rig_create();meshes={};objects=[]
    for name,shape in [('suit_near',unify_garment(garment(24),7200)),('suit_mid',unify_garment(garment(24),2000)),('helmet',refined_helmet()),('glove',refined_glove())]:
        obj,data=build_mesh(name,shape);objects.append(obj);meshes[name]=data
        if name.startswith('suit'):
            mod=obj.modifiers.new('Four-influence deformation','ARMATURE');mod.object=rig
            obj.parent=rig
        else:
            # Rigid kit remains in its original local socket coordinates.
            obj.hide_render=True
    clips=make_actions(rig)
    bpy.context.scene['finalArtApproved']=False
    bpy.context.scene['sourcePattern']=base_hash
    bpy.context.scene['motionType']='Original keyed actions; runtime contact retargeting, not motion capture'
    path=OUT/'crew-performance.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,
                             export_animations=True,export_animation_mode='ACTIONS',
                             export_force_sampling=True,export_frame_range=False,export_extras=True)
    raw=path.read_bytes();packed=gzip.compress(raw,compresslevel=9,mtime=0)
    (OUT/'crew-performance.glb.gz').write_bytes(packed);path.unlink()
    data={'version':1,'rest':REST,'bones':NAMES,'meshes':meshes,'clips':clips}
    text=json.dumps(data,separators=(',',':'))+'\n'
    (OUT/'crew-performance.geometry.json').write_text(text)
    header=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    names=sorted(a['name'] for a in header.get('animations',[]))
    assert names==sorted(ACTIONS),f'Missing exported actions: {names}'
    manifest={'version':1,'source':'scripts/author-crew-performance.py','sourceSHA256':SHA(Path(__file__).read_bytes()),
              'basePatternSHA256':base_hash,'generator':bpy.app.version_string,'runtimeSHA256':SHA(text.encode()),
              'exchangeSHA256':SHA(raw),'compressedSHA256':SHA(packed),'compressedBytes':len(packed),
              'triangles':{k:len(v['index'])//3 for k,v in meshes.items()},'actions':names,'finalArtApproved':False}
    assert all(n<18000 for n in manifest['triangles'].values())
    (OUT/'crew-performance.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Native inspection assembly: rigid kit follows its retained bone sockets.
    # These helper clones are added after exchange export, never to runtime data.
    preview=bpy.data.collections.new('Dressed character preview');bpy.context.scene.collection.children.link(preview)
    cuff=Vector((0,-.067,-.008))
    for label,role,bone,local in [
        ('Preview helmet','helmet',2,Matrix.Translation(Vector(REST[2]))),
        ('Preview left glove','glove',4,Matrix.Translation(Vector(REST[5])) @ Matrix.Rotation(math.pi,4,'X') @ Matrix.Rotation(-math.pi/2,4,'Y') @ Matrix.Translation(-cuff)),
        ('Preview right glove','glove',7,Matrix.Translation(Vector(REST[8])) @ Matrix.Rotation(math.pi,4,'X') @ Matrix.Rotation(math.pi/2,4,'Y') @ Matrix.Translation(-cuff)),
    ]:
        obj=bpy.data.objects[role].copy();obj.name=label;preview.objects.link(obj)
        obj.hide_render=False;obj.hide_set(False)
        if 'left' in label:
            obj.data=obj.data.copy()
            for vertex in obj.data.vertices:vertex.co.x *= -1
            obj.data.flip_normals()
        obj.matrix_world=C @ local @ CI
        constraint=obj.constraints.new('CHILD_OF');constraint.target=rig;constraint.subtarget=NAMES[bone]
        constraint.inverse_matrix=rig.data.bones[NAMES[bone]].matrix_local.inverted()
    bpy.data.objects['suit_mid'].hide_set(True);bpy.data.objects['suit_mid'].hide_render=True
    for role in ['helmet','glove']:bpy.data.objects[role].hide_set(True)
    rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(0)
    bpy.context.scene.frame_end=120
    text_block=bpy.data.texts.new('CREW_README')
    text_block.write('Original A41/A42 kit. Choose an action on CrewPerformance to inspect keyed poses. Dressed preview clones follow rigid sockets; runtime foot/tool contacts use retargeting. suit_mid is hidden for inspection, not missing. Source: scripts/author-crew-performance.py. Final art approval remains open.')
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/crew-performance.blend'),compress=True)
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
