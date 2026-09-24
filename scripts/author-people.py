"""Author original Aurel people in Blender; no third-party art is an input.

Blender 4.5.1: blender -b --python-exit-code 1 --python scripts/author-people.py
The editable .blend and GLB exchange file contain exactly the same local meshes
as the compact, rounded geometry table used by the synchronous Three.js factory.
This avoids making component tests use a different model from application startup.
Coordinates below are metres, +Y up, +Z forward; Blender receives (x,-z,y).
"""
from pathlib import Path
import math, json, gzip, hashlib
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'rendering'
BONES = [(0,.88,0),(0,.88,0),(0,1.61,0),
         (-.245,1.43,0),(-.245,1.07,0),(-.245,.73,0),
         (.245,1.43,0),(.245,1.07,0),(.245,.73,0),
         (-.092,.88,0),(-.092,.46,0),(-.092,.055,.035),
         (.092,.88,0),(.092,.46,0),(.092,.055,.035)]
NAMES = ['pelvis','chest','head','upper_L','fore_L','hand_L','upper_R','fore_R','hand_R',
         'thigh_L','shin_L','boot_L','thigh_R','shin_R','boot_R']
WHITE=(.72,.78,.80); DARK=(.021,.027,.033); TRIM=(.62,.55,.35)
def xyz(p): return (p[0],-p[2],p[1])
def yxz(p): return (p[0],p[2],-p[1])
def mix(a,b,t): return tuple(x*(1-t)+y*t for x,y in zip(a,b))
def clamp(x): return max(0.,min(1.,x))
def smooth(x): x=clamp(x);return x*x*(3.-2.*x)

class Shape:
    def __init__(self):
        self.v=[];self.f=[];self.c=[];self.j=[];self.w=[];self.mask=[];self.joint=[];self.skin=[];self.accessory=[];self.stand=[]
    def vertex(self,p,color=WHITE,bones=(0,0),weight=0.,cloth=1.,joint=0.,skin=0.,accessory=0.,standing=None):
        self.v.append(p);self.c.append(color);self.j.append([bones[0],bones[1],0,0]);self.w.append([1-weight,weight,0,0]);self.mask.append(cloth)
        self.joint.append(joint);self.skin.append(skin);self.accessory.append(accessory);self.stand.append(standing or p)
        return len(self.v)-1
    def loft(self,rows,sides=16,color=WHITE,bone=0,nextbone=None,joint=0,skin=0,cloth=1,accessory=0,standing=None,fold=0.):
        # Rows are (centre, width-X, depth-Z, skin blend); explicit garment pattern.
        start=len(self.v)
        for i,(p,rx,rz,w) in enumerate(rows):
            for k in range(sides):
                a=2*math.pi*k/sides; f=1+fold*math.sin(a*7+i*2.3)*math.sin(math.pi*i/(len(rows)-1))**2
                q=(p[0]+rx*math.cos(a)*f,p[1],p[2]+rz*math.sin(a)*f)
                c=color
                if cloth and abs(math.cos(a))>.94: c=tuple(t*.47 for t in color)
                self.vertex(q,c,(bone,bone if nextbone is None else nextbone),w,cloth,joint,skin,accessory,standing(q) if standing else None)
        for i in range(len(rows)-1):
            for k in range(sides):
                a=start+i*sides+k;b=start+i*sides+(k+1)%sides
                self.f.extend([(a,b,a+sides),(b,b+sides,a+sides)])
        for i in [0,len(rows)-1]:
            p=rows[i][0]; c=self.vertex(p,color,(bone,bone if nextbone is None else nextbone),rows[i][3],cloth,joint,skin,accessory,standing(p) if standing else None)
            for k in range(sides):
                a=start+i*sides+k;b=start+i*sides+(k+1)%sides
                self.f.append((c,b,a) if i==0 else (c,a,b))
    def tube(self,points,radii,sides=10,color=DARK,bone=0,joint=0,skin=0,cloth=0,accessory=0,standing=None):
        start=len(self.v)
        for i,p in enumerate(points):
            tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
            tangent.normalize();ref=Vector((0,1,0)) if abs(tangent.y)<.9 else Vector((1,0,0));u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
            r=radii[i] if isinstance(radii,list) else radii
            for k in range(sides):
                angle=2*math.pi*k/sides;q=Vector(p)+r*(u*math.cos(angle)+v*math.sin(angle))
                self.vertex(tuple(q),color,(bone,bone),0,cloth,joint,skin,accessory,standing(tuple(q)) if standing else None)
        for i in range(len(points)-1):
            for k in range(sides):
                a=start+i*sides+k;b=start+i*sides+(k+1)%sides
                self.f.extend([(a,b,a+sides),(b,b+sides,a+sides)])
        for i in [0,len(points)-1]:
            p=points[i];c=self.vertex(p,color,(bone,bone),0,cloth,joint,skin,accessory,standing(p) if standing else None)
            for k in range(sides):
                a=start+i*sides+k;b=start+i*sides+(k+1)%sides;self.f.append((c,a,b) if i==0 else (c,b,a))
    def ellipsoid(self,p,scale,color=WHITE,bone=0,joint=0,skin=0,cloth=0,accessory=0,segments=16,rings=10,standing=None):
        rows=[]
        for r in range(rings+1):
            a=math.pi*r/rings;radius=max(.001,math.sin(a));rows.append(((p[0],p[1]-math.cos(a)*scale[1],p[2]),scale[0]*radius,scale[2]*radius,0))
        self.loft(rows,segments,color,bone,joint=joint,skin=skin,cloth=cloth,accessory=accessory,standing=standing)
    def box(self,p,scale,color=DARK,bone=0,joint=0,cloth=0,accessory=0,standing=None):
        # Bevelled manufactured / shoe forms, not unmodified block primitives.
        rx,ry,rz=[v/2 for v in scale]; rows=[]
        for y,w in [(-ry,.84),(-ry*.78,1),(ry*.78,1),(ry,.84)]:
            rows.append(((p[0],p[1]+y,p[2]),rx*w,rz*w,0))
        self.loft(rows,12,color,bone,joint=joint,cloth=cloth,accessory=accessory,standing=standing)
    def torus(self,p,R,r,color=DARK,axis='x',major=24,minor=8,cloth=0):
        start=len(self.v)
        for i in range(major):
            a=2*math.pi*i/major
            for k in range(minor):
                b=2*math.pi*k/minor;q=(r*math.sin(b),(R+r*math.cos(b))*math.cos(a),(R+r*math.cos(b))*math.sin(a))
                if axis=='z':q=(q[1],q[2],q[0])
                self.vertex(tuple(p[j]+q[j] for j in range(3)),color,cloth=cloth)
        for i in range(major):
            for k in range(minor):
                a=start+i*minor+k;b=start+i*minor+(k+1)%minor;c=start+((i+1)%major)*minor+k;d=start+((i+1)%major)*minor+(k+1)%minor
                self.f.extend([(a,b,c),(b,d,c)])


def body(sides):
    g=Shape(); fine=sides>=16
    profile=[(.755,.149,.105),(.84,.17,.127),(.94,.151,.119),(1.02,.158,.12),(1.15,.185,.147),(1.29,.228,.145),(1.40,.257,.119),(1.465,.213,.092),(1.51,.071,.064)]
    g.loft([((0,y,0),x,z,smooth((y-.86)/.18)) for y,x,z in profile],sides,WHITE,0,1,fold=.018)
    # Collar, zip, radio pouch and shoulder reinforcements are true geometry.
    g.loft([((0,1.49,0),.078,.07,0),((0,1.536,0),.073,.063,0)],sides,DARK,1,cloth=0)
    g.box((0,1.255,.149),(.008,.33,.005),TRIM,1)
    g.box((-.09,1.30,.142),(.07,.104,.021),DARK,1)
    g.box((.10,1.32,.143),(.083,.039,.006),TRIM,1)
    for side in [-1,1]:
        arm=3 if side<0 else 6;thigh=9 if side<0 else 12
        g.loft([((side*.245,y,z),rx,rz,smooth((1.14-y)/.15)) for y,z,rx,rz in [(1.462,0,.05,.054),(1.43,0,.083,.083),(1.35,0,.087,.081),(1.20,-.004,.073,.067),(1.105,-.005,.066,.062),(1.07,0,.065,.06),(.99,.001,.06,.053),(.84,0,.05,.045),(.745,0,.041,.038)]][::-1],sides,WHITE,arm,arm+1,fold=.028)
        g.loft([((side*.245,.731,0),.043,.04,0),((side*.245,.773,0),.047,.043,0)],sides,DARK,arm+1,cloth=0)
        g.loft([((side*.092,y,z),rx,rz,smooth((.51-y)/.13)) for y,z,rx,rz in [(.055,.035,.045,.048),(.12,.025,.055,.058),(.26,.011,.064,.062),(.405,0,.073,.069),(.46,0,.074,.07),(.52,0,.078,.074),(.70,0,.10,.09),(.88,0,.105,.106)]],sides,WHITE,thigh,thigh+1,fold=.022)
        g.box((side*.092,.47,.067),(.122,.15,.022),DARK,thigh+1)
        # Ankle collar, reinforced heel, round toe and separate rubber outsole.
        g.loft([((side*.092,y,z),rx,rz,0) for y,z,rx,rz in [(.005,.078,.063,.14),(.026,.078,.068,.148),(.075,.063,.062,.137),(.118,.035,.051,.077),(.17,.014,.049,.051)]],sides,DARK,thigh+2,cloth=0)
        g.loft([((side*.092,.008,.078),.065,.142,0),((side*.092,.026,.078),.067,.145,0)],sides,(.055,.057,.06),thigh+2,cloth=0)
        if fine:
            for j in range(3): g.box((side*.092,.103,.115+j*.018),(.075,.004,.004),TRIM,thigh+2)
    return g

def helmet():
    g=Shape();g.ellipsoid((0,0,0),(.117,.143,.132),(.81,.82,.77),segments=24,rings=16)
    # Visor follows the face rather than clipping into a sphere; lower chin guard.
    g.loft([((0,y,z),rx,rz,0) for y,z,rx,rz in [(-.071,.048,.083,.082),(-.047,.066,.106,.079),(.016,.065,.11,.078),(.057,.047,.099,.076)]],24,(.024,.045,.058),cloth=0)
    g.loft([((0,-.116,.058),.072,.062,0),((0,-.088,.071),.09,.076,0),((0,-.065,.083),.088,.058,0)],20,(.71,.75,.75),cloth=0)
    for side in [-1,1]:
        g.ellipsoid((side*.117,-.003,0),(.013,.041,.041),DARK,segments=12,rings=8)
        g.ellipsoid((side*.128,0,.015),(.004,.012,.012),TRIM,segments=8,rings=6)
    g.tube([(-.121,-.023,.03),(-.115,-.055,.09),(-.055,-.075,.135)],.008,color=DARK)
    g.ellipsoid((-.041,-.075,.137),(.021,.011,.013),DARK,segments=10,rings=6)
    return g

def glove():
    g=Shape();g.loft([((0,y,z),rx,rz,0) for y,z,rx,rz in [(-.076,-.011,.036,.022),(-.049,-.004,.041,.024),(0,0,.043,.025),(.04,.013,.041,.025)]],16,DARK,cloth=0)
    for j in range(4):
        x=(j-1.5)*.020; l=.037 if j in [0,3] else .046
        g.tube([(x,.024,.014),(x,.048,.026),(x,.047+l*.25,.055),(x,.023,.065)], [.009,.009,.008,.007],8,(.10,.125,.13))
    g.tube([(-.034,-.032,0),(-.057,-.006,.016),(-.052,.014,.041),(-.033,.014,.057)],[.014,.013,.011,.009],10,DARK)
    g.box((0,-.051,-.033),(.06,.024,.004),TRIM)
    return g

def gun():
    g=Shape()
    g.tube([(0,0,-.285),(0,0,-.24),(0,0,-.095),(0,0,-.055)],[.032,.047,.047,.029],16,(.16,.23,.26))
    g.tube([(0,0,-.062),(0,0,-.004)],[.023,.021],16,(.58,.63,.65))
    g.torus((0,0,-.008),.018,.003,(.12,.13,.13),'z',16,6)
    g.box((0,-.086,-.205),(.038,.156,.055),DARK)
    g.box((.026,-.028,-.14),(.009,.027,.048),TRIM)
    for z in [-.253,-.22,-.18,-.142]:g.torus((0,0,z),.047,.003,(.043,.057,.062),'z',16,4)
    g.tube([(0,-.167,-.219),(0,-.18,-.245),(0,-.168,-.29)],[.011,.011,.009],8,DARK)
    return g

def tire():
    g=Shape()
    # Axle is local X. The annulus retains the hole; a shaded ring is not a disk.
    g.torus((0,0,0),.254,.081,DARK,'x',32,10)
    for x in [-.135,.135]:
        g.torus((x,0,0),.263,.062,(.035,.038,.04),'x',32,8)
        g.torus((x*1.36,0,0),.254,.005,TRIM,'x',32,4)
    g.torus((0,0,0),.173,.019,(.26,.29,.31),'x',24,6)
    for i in range(10):
        a=i*math.pi/5;g.tube([(0,.052*math.cos(a),.052*math.sin(a)),(0,.17*math.cos(a+.06),.17*math.sin(a+.06))],.012,6,(.22,.24,.25))
    g.torus((0,0,0),.047,.013,(.4,.41,.40),'x',16,6)
    return g

def jack():
    g=Shape();g.box((0,.073,0),(.30,.091,.24),(.25,.3,.31))
    for side in [-1,1]:
        g.tube([(side*.085,.073,.035),(side*.10,.067,-.26)],.024,10,(.23,.27,.28))
        g.ellipsoid((side*.145,.046,-.07),(.029,.045,.045),DARK,segments=12,rings=8)
    g.tube([(0,.095,.015),(0,.23,.015)],[.037,.031],12,(.48,.51,.51))
    g.box((0,.23,.015),(.18,.023,.12),DARK)
    return g

def spectator(detail):
    g=Shape();n=[12,8,5][detail]
    rise=.53
    def standing(p):return (p[0]-.255,p[1]+rise,p[2])
    # Face local -X, same anchors as the grandstand's existing seating plan.
    def face(p): return (-p[2],p[1],p[0])
    def person_loft(rows,color=WHITE,joint=0,skin=0,cloth=1,accessory=0,stand=None):
        s=Shape();s.loft(rows,n,color,joint=joint,skin=skin,cloth=cloth,accessory=accessory,fold=.02 if detail==0 else 0)
        start=len(g.v)
        for i,p in enumerate(s.v):
            q=face(p);g.vertex(q,s.c[i],joint=joint,skin=skin,cloth=cloth,accessory=accessory,standing=(stand or standing)(q))
        g.f.extend(tuple(start+k for k in f) for f in s.f)
    person_loft([((0,y,0),rx,rz,0) for y,rx,rz in [(.075,.109,.095),(.17,.132,.104),(.27,.138,.11),(.39,.163,.103),(.45,.17,.087),(.495,.074,.054)]])
    person_loft([((0,.486,0),.048,.045,0),((0,.545,0),.044,.043,0)],joint=3,skin=1,cloth=0)
    # Sculpted skull/jaw/nose profile; hair is a separate cap shape, not a black ball.
    person_loft([((0,y,z),rx,rz,0) for y,z,rx,rz in [(.51,.012,.037,.036),(.545,.015,.066,.056),(.575,.009,.079,.073),(.607,.008,.083,.089),(.64,0,.084,.081),(.68,-.009,.077,.073),(.716,-.01,.052,.048),(.727,-.013,.008,.008)]],joint=3,skin=1,cloth=0)
    person_loft([((0,.664,-.018),.083,.071,0),((0,.70,-.02),.068,.063,0),((0,.737,-.019),.026,.024,0)],joint=3,skin=2,cloth=0)
    # Seated/standing leg shapes have correspondence and exactly planted boot soles.
    for side in [-1,1]:
        joint=1 if side<0 else 2
        for a,b,c,d,r in [((0,.10,side*.084),(-.249,.076,side*.09),(-.255,.63,side*.084),(-.276,.205,side*.09),.065),
                          ((-.249,.076,side*.09),(-.272,-.252,side*.09),(-.276,.205,side*.09),(-.272,-.252,side*.09),.045)]:
            s=Shape();s.tube([a,mix(a,b,.25),mix(a,b,.7),b],[r*.9,r,r*.87,r*.71],max(5,n),(.17,.19,.23))
            axis=Vector(b)-Vector(a);axis2=Vector(d)-Vector(c);rot=axis.rotation_difference(axis2)
            start=len(g.v)
            for i,p in enumerate(s.v):
                t=clamp((Vector(p)-Vector(a)).dot(axis)/axis.length_squared());q=rot@(Vector(p)-Vector(mix(a,b,t)))+Vector(mix(c,d,t))
                g.vertex(p,s.c[i],standing=tuple(q),cloth=1)
            g.f.extend(tuple(start+k for k in f) for f in s.f)
        g.box((-.31,-.2745,side*.09),(.17,.051,.084),DARK)
        if detail<2:
            sh=(0,.43,side*.142);el=(-.08,.245,side*.178);hand=(-.241,.19,side*.087)
            g.tube([sh,mix(sh,el,.42),el,mix(el,hand,.45),hand],[.045,.05,.043,.033,.026],n,WHITE,joint=joint,cloth=1,standing=standing)
            g.ellipsoid(hand,(.044,.024,.028),WHITE,joint=joint,skin=1,segments=n,rings=6,standing=standing)
    if detail==0:
        for side in [-1,1]:
            g.ellipsoid((-.085,.63,side*.035),(.003,.006,.013),DARK,joint=3,segments=8,rings=4,standing=standing)
            g.ellipsoid((-.007,.604,side*.084),(.014,.025,.012),WHITE,joint=3,skin=1,segments=8,rings=6,standing=standing)
        g.ellipsoid((-.101,.600,0),(.018,.024,.014),WHITE,joint=3,skin=1,segments=8,rings=6,standing=standing)
    # Optional cap brim and phone use one draw and a stable cohort mask in both shadows and colour.
    g.box((-.060,.699,0),(.19,.012,.182),(.56,.54,.41),joint=3,accessory=1,standing=standing)
    if detail<2:g.box((-.264,.223,.09),(.015,.085,.046),DARK,joint=2,accessory=2,standing=standing)
    return g

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
material=bpy.data.materials.new('Aurel / original human surfaces');material.use_nodes=True
material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8
vc=material.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';material.node_tree.links.new(vc.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
shapes={'crew_high':body(16),'crew_mid':body(8),'helmet':helmet(),'glove':glove(),'wheel_gun':gun(),'spare_tire':tire(),'jack_base':jack(),
        'spectator_0':spectator(0),'spectator_1':spectator(1),'spectator_2':spectator(2)}
result={'version':1,'generator':'Blender '+bpy.app.version_string,'units':'metres-Y-up','boneNames':NAMES,'rest':BONES,'meshes':{}}
for index,(name,g) in enumerate(shapes.items()):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([xyz(p) for p in g.v],[],g.f);mesh.update()
    # Repair winding from the native topology; authored lofts may mix orientation.
    import bmesh
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();mesh.update()
    for poly in mesh.polygons:poly.use_smooth=True
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(material)
    obj.location.x=index*2.0
    colors=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for i,c in enumerate(g.c):colors.data[i].color=(*c,1)
    mesh.uv_layers.new(name='Pattern UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            vi=mesh.loops[li].vertex_index;x,y,z=g.v[vi];mesh.uv_layers.active.data[li].uv=(x*2+.5,y)
    if name.startswith('crew_'):
        for bn in NAMES:obj.vertex_groups.new(name=bn)
        for vi in range(len(g.v)):
            for b,w in zip(g.j[vi],g.w[vi]):
                if w:obj.vertex_groups[b].add([vi],w,'ADD')
    if name.startswith('crew_'):
        rig=bpy.data.armatures.new(name+' rig'); rigobj=bpy.data.objects.new(name+' rig',rig);bpy.context.collection.objects.link(rigobj);rigobj.location=obj.location
        bpy.context.view_layer.objects.active=rigobj;rigobj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
        parents=[None,0,1,1,3,4,1,6,7,0,9,10,0,12,13]
        for bi,bn in enumerate(NAMES):
            b=rig.edit_bones.new(bn);b.head=xyz(BONES[bi]);end=(BONES[bi][0],BONES[bi][1]+.15,BONES[bi][2])
            if bi in [3,4,6,7,9,10,12,13]:end=BONES[bi+1]
            b.tail=xyz(end)
            if parents[bi] is not None:b.parent=rig.edit_bones[NAMES[parents[bi]]]
        bpy.ops.object.mode_set(mode='OBJECT');rigobj.select_set(False);mod=obj.modifiers.new('Original tailored skin','ARMATURE');mod.object=rigobj
    obj['authored_role']=name;obj['final_art_approved']=False
    # Blender computes normals for the runtime table; exchange and runtime share local vertices.
    normals=[tuple(yxz(v.normal)) for v in mesh.vertices]
    standnorm=normals
    if name.startswith('spectator_'):
        basis=obj.shape_key_add(name='Seated');standing=obj.shape_key_add(name='Standing')
        for i,p in enumerate(g.stand):standing.data[i].co=xyz(p)
        sm=mesh.copy()
        for i,p in enumerate(g.stand):sm.vertices[i].co=xyz(p)
        sm.update();standnorm=[tuple(yxz(v.normal)) for v in sm.vertices];bpy.data.meshes.remove(sm)
    def flat(values):return [round(float(x),6) for v in values for x in v]
    data={'position':flat(g.v),'normal':flat(normals),'index':[v for p in mesh.polygons for v in p.vertices],'color':flat(g.c)}
    if name.startswith('crew_'):data.update(joints=[x for v in g.j for x in v],weights=flat(g.w),cloth=g.mask)
    if name.startswith('spectator_'):data.update(crowdJoint=g.joint,skinMask=g.skin,accessory=g.accessory,standing=flat(g.stand),standingNormal=flat(standnorm))
    data['triangles']=len(data['index'])//3
    result['meshes'][name]=data
# Editable authoring board: each mesh has its name, material, groups and standing shape key.
bpy.context.scene['aurel_people_version']=1;bpy.context.scene['coordinate_contract']='runtime (x,y,z), Blender (x,-z,y)'
bpy.context.scene['final_art_approved']=False
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts'/'aurel-people.blend'),compress=True)
path=OUT/'aurel-people.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_animations=False,export_extras=True)
raw=path.read_bytes();compressed=gzip.compress(raw,compresslevel=9,mtime=0);(OUT/'aurel-people.glb.gz').write_bytes(compressed);path.unlink()
text=json.dumps(result,separators=(',',':'))+'\n';(OUT/'aurel-people.geometry.json').write_text(text)
manifest={'version':1,'generator':result['generator'],'source':'scripts/author-people.py','editable':'scripts/aurel-people.blend',
          'exchangeSha256':hashlib.sha256(raw).hexdigest(),'exchangeCompressedBytes':len(compressed),
          'runtimeSha256':hashlib.sha256(text.encode()).hexdigest(),'runtimeBytes':len(text.encode()),
          'triangles':{k:v['triangles'] for k,v in result['meshes'].items()},'finalArtApproved':False}
(OUT/'aurel-people.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
