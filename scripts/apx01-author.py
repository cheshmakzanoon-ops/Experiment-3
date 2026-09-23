"""Author the complete static APX-01 mechanical assembly in Blender.

node --experimental-transform-types scripts/apx01-seed.ts test-results/authoring/seed.json
blender --python-exit-code 1 --background scripts/apx01-shell.blend --python scripts/apx01-author.py -- \
    test-results/authoring/seed.json scripts/apx01-assembly.blend

All dimensions below are original visual design, in runtime metres (+Y up, +Z nose).
Shared source surfaces retain live decal/paint UV alignment; the nose collar is rebuilt.
Wheel prototypes are RIGHT-HANDED +X-outboard; runtime reflects positions, normals
AND triangle winding for the other side. Steering/load/damage are never baked.
"""
from pathlib import Path
import json, math, sys
import bpy
from mathutils import Vector, Matrix
from math import sin, cos, pi, sqrt
args = sys.argv[sys.argv.index('--') + 1:]
if len(args) != 2:
    raise SystemExit('Expected seed.json output.blend')
seed = json.loads(Path(args[0]).read_text())
root = Path(__file__).resolve().parent.parent
contract = json.loads((root/'src/rendering/apx01-assembly.json').read_text())
roles = contract['parts']
# Keep only the original, edited body skins as input. No third-party assets.
for o in list(bpy.data.objects):
    if o.get('apex_role') not in ['engine', 'sidepod']:
        bpy.data.objects.remove(o, do_unlink=True)
materials = {}
for name, color, metallic, roughness in [
    ('paint',(.045,.255,.305,1),.12,.29),('livery',(.045,.255,.305,1),.12,.29),
    ('carbon',(.019,.027,.031,1),.1,.42),('dark',(.012,.016,.02,1),.12,.66),
    ('alloy',(.37,.40,.42,1),.87,.27),('ceramic',(.14,.14,.12,1),.05,.62),('rubber',(.019,.019,.02,1),0,.85)]:
    m=bpy.data.materials.new('APX / '+name);m.diffuse_color=color;m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color
    p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=roughness
    if name in ['paint','livery']:p.inputs['Coat Weight'].default_value=.8
    materials[name]=m
parts={}
def xyz(p): return (p[0],-p[2],p[1])
def obj(role, vertices, faces, uv=None, normals=None, smooth=True):
    m=bpy.data.meshes.new(role);m.from_pydata([xyz(p) for p in vertices],[],faces);m.update()
    o=bpy.data.objects.new(role,m);bpy.context.collection.objects.link(o)
    o['apex_role']=role;o['apex_material']=roles[role]
    o.data.materials.append(materials[roles[role]])
    for poly in m.polygons:poly.use_smooth=smooth
    layer=m.uv_layers.new(name='APX normalized UV')
    if uv:
        for poly in m.polygons:
            for li in poly.loop_indices:layer.data[li].uv=uv[m.loops[li].vertex_index]
    else:
        # Normalized box projection for physically tiled live material shaders.
        lo=[min(p[i] for p in vertices) for i in range(3)]
        span=[max(p[i] for p in vertices)-lo[i] for i in range(3)]
        for poly in m.polygons:
            normal=poly.normal;axis=max(range(3),key=lambda i:abs(normal[i]))
            axes=[i for i in range(3) if i!=axis]
            # Blender coordinates -> use its own bounded local box.
            bounds=[(min(v.co[i] for v in m.vertices),max(v.co[i] for v in m.vertices)) for i in axes]
            for li in poly.loop_indices:
                p=m.vertices[m.loops[li].vertex_index].co
                layer.data[li].uv=tuple((p[i]-a)/max(1e-8,b-a) for i,(a,b) in zip(axes,bounds))
    if normals: m.normals_split_custom_set_from_vertices([xyz(n) for n in normals])
    parts.setdefault(role,[]).append(o)
    return o

def bevel(o,width=.0015,segments=3):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Manufactured edge radius','BEVEL');mod.width=width;mod.segments=segments
    mod.limit_method='ANGLE';mod.angle_limit=.5
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def plate(role, outline, thickness, x=0, radius=.002):
    n=len(outline);v=[(x+s*thickness/2,y,z) for s in [-1,1] for z,y in outline]
    f=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    f.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    o=obj(role,v,f,smooth=False)
    if radius:bevel(o,radius)
    return o

def box(role,centre,size,radius=.003):
    x,y,z=centre;a,b,c=[k/2 for k in size]
    v=[(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    o=obj(role,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],smooth=False)
    return bevel(o,radius) if radius else o

def tube(role,points,radii,segments=12,cap=True):
    v=[];uv=[]
    for i,pt in enumerate(points):
        p=Vector(pt);direction=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        direction.normalize();axis=Vector((0,1,0))
        if abs(direction.dot(axis))>.95:axis=Vector((1,0,0))
        u=direction.cross(axis).normalized();w=direction.cross(u).normalized()
        r=radii[i] if isinstance(radii,list) else radii
        for j in range(segments):
            a=2*pi*j/segments;v.append(tuple(p+r*(cos(a)*u+sin(a)*w)));uv.append((j/segments,i/max(1,len(points)-1)))
    f=[]
    for i in range(len(points)-1):
        for j in range(segments):a=i*segments+j;b=i*segments+(j+1)%segments;f.append((a,b,b+segments,a+segments))
    if cap:f.extend([tuple(reversed(range(segments))),tuple((len(points)-1)*segments+j for j in range(segments))])
    return obj(role,v,f,uv)

def lathe(role,profile,segments=96):
    # Profile (axial X, radial R), closed around axle X with outward winding.
    v=[];uv=[];n=len(profile)
    for j in range(segments+1):
        a=j/segments*2*pi
        for i,(x,r) in enumerate(profile):v.append((x,r*cos(a),r*sin(a)));uv.append((j/segments,i/(n-1)))
    f=[]
    for j in range(segments):
        for i in range(n-1):a=j*n+i;f.append((a,a+1,a+n+1,a+n))
    return obj(role,v,f,uv)

# Preserve authored seam normals/UVs on the three pre-existing livery pieces.
for o in list(bpy.data.objects):
    if o.type=='MESH':
        role=o['apex_role'];o['apex_material']=roles[role];o.data.materials.clear();o.data.materials.append(materials[roles[role]]);parts[role]=[o]
for role,data in seed['parts'].items():
    if role in ['floor','floor_edges']:continue
    vec=lambda data,n:[data[i:i+n] for i in range(0,len(data),n)]
    vertices=vec(data['position'],3);faces=vec(data['index'],3)
    normals=vec(data['normal'],3)
    uv=vec(data['uv'],2)
    # Non-skin seeds include ShapeGeometry metre UVs; normalize each channel.
    for axis in range(2):
        lo=min(v[axis] for v in uv);hi=max(v[axis] for v in uv)
        if lo<0 or hi>1:
            for v in uv:v[axis]=(v[axis]-lo)/max(hi-lo,1e-8)
    obj(role,vertices,faces,uv,normals)

# Continuous double-skin venturi floor, a real twelve-millimetre edge and open
# diffuser mouths. Hermite interpolation is bounded to neighbouring stations.
stations=seed['floorStations']
def floor_sample(z):
    i=next((i for i in range(len(stations)-1) if z<=stations[i+1][0]),len(stations)-2)
    a,b=stations[i:i+2];prev=stations[max(0,i-1)];nxt=stations[min(len(stations)-1,i+2)]
    dz=b[0]-a[0];t=(z-a[0])/dz;result=[z]
    for k in [1,2,3]:
        m0=(b[k]-prev[k])/(b[0]-prev[0]);m1=(nxt[k]-a[k])/(nxt[0]-a[0])
        value=(2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*dz*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*dz*m1
        result.append(min(max(a[k],b[k]),max(min(a[k],b[k]),value)))
    return result
zs=sorted(set([s[0] for s in stations]+[stations[0][0]+(stations[-1][0]-stations[0][0])*i/48 for i in range(49)]))
v=[];uv=[];faces=[];across=48;stride=across+1;rows=len(zs);skin=rows*stride
for top in [False,True]:
    for z in zs:
        _,w,y,rise=floor_sample(z)
        for j in range(stride):
            t=2*j/across-1;tunnel=sin(pi*max(0,min(1,(abs(t)-.12)/.88)))**2
            v.append((t*w,y+rise*tunnel+(.012 if top else 0),z));uv.append((j/across,(z-zs[0])/(zs[-1]-zs[0])))
for i in range(rows-1):
    for j in range(across):
        a=i*stride+j;b=a+stride
        faces.extend([(a,a+1,b+1,b),(a+skin,b+skin,b+1+skin,a+1+skin)])
for i in range(rows-1):
    a=i*stride;b=(i+1)*stride;faces.extend([(a,b,b+skin,a+skin),(a+across,a+across+skin,b+across+skin,b+across)])
for j in range(across):
    faces.extend([(j+1,j,j+skin,j+1+skin)])
    a=(rows-1)*stride+j;faces.append((a,a+1,a+1+skin,a+skin))
obj('floor',v,faces,uv)

# Fences use the SAME resampled floor function. A straight rail between the
# old stations would float above this improved continuous underbody.
for side in [-1,1]:
    for across,start,end,height in [(side*.97,0,5,.042)]+[(side*a,0,2,.082) for a in [.25,.5,.76]]:
        z0,z1=stations[start][0],stations[end][0]
        samples=sorted(set([z0,z1]+[z for z in zs if z0<=z<=z1]))
        v=[];f=[]
        for row,z in enumerate(samples):
            _,w,y,rise=floor_sample(z);tunnel=sin(pi*max(0,min(1,(abs(across)-.12)/.88)))**2
            y+=rise*tunnel+.012
            progress=(z-z0)/(z1-z0);h=height*min(1,.65+progress*4, .2+(1-progress)*6)
            for dx,dy in [(-.003,0),(.003,0),(.003,h),(-.003,h)]:v.append((across*w+dx,y+dy,z))
            if row:
                a=(row-1)*4
                for j in range(4):k=(j+1)%4;f.append((a+j,a+k,a+4+k,a+4+j))
        f.extend([(0,3,2,1),tuple((len(samples)-1)*4+j for j in range(4))]);obj('floor_edges',v,f)

# Airfoil surfaces with closed, bevelled endplates; real gaps remain between
# slotted elements, and all mounting detail belongs to its damage-owned wing.
def wing(role,d):
    v=[];uv=[];nspan=40;around=48;stride=around+1
    for i in range(nspan+1):
        x=(2*i/nspan-1)*d['span']/2;edge=abs(x)/(d['span']/2);taper=1-.16*edge**4
        for j in range(stride):
            angle=j/around*2*pi;u=(1-cos(angle))/2;side=1 if j<=around/2 else -1
            thickness=d['thickness']*2.1*sqrt(u)*(1-u)*(1-.3*u)
            yy=4*d['camber']*(1-.18*edge**2)*u*(1-u)+side*thickness-d['gull']*edge**2
            zz=d['chord']*taper*(.5-u)-d['sweep']*edge**2
            a=d['incidence'];v.append((x,d['y']+yy*cos(a)-zz*sin(a),d['z']+yy*sin(a)+zz*cos(a)));uv.append((i/nspan,u))
    f=[]
    for i in range(nspan):
        for j in range(around):a=i*stride+j;f.append((a,a+stride,a+stride+1,a+1))
    # Triangulate cambered concave caps in Blender rather than a crossing fan.
    f.extend([tuple(reversed(range(around))),tuple(nspan*stride+j for j in range(around))])
    obj(role,v,f,uv)
for end in ['front','rear']:
    surfaces=seed[end]
    for d in surfaces:wing(end+'_paint' if d['painted'] else end+'_carbon',d)
    for side in [-1,1]:
        ex=side*(.984 if end=='front' else .839)
        plate(end+'_paint',seed[end+'Endplate'],.012 if end=='front' else .018,ex,.003)
        for j in range(4):
            z=(2.28+j*.13) if end=='front' else (-2.21+j*.11)
            y=(-.21 if end=='front' else .545)
            tube(end+'_alloy',[(ex-side*.008,y,z),(ex+side*.013,y,z)],.004,8)
        if end=='front':
            for outline in seed['frontSpacers']:
                plate('front_carbon',outline,.008,side*.73,.001)
            plate('front_carbon',seed['frontPylon'],.017,side*.083,.003)
        else:
            # Sculpted aerofoil-section swan-neck, not a cylindrical prop.
            plate('rear_carbon',[(-1.932,-.28),(-1.895,-.28),(-1.72,.41),(-1.745,.505),(-1.84,.53),(-2.02,.521),(-2.035,.499),(-1.815,.488),(-1.782,.405)],.022,side*.24,.004)
            for j in range(3):
                plate('rear_carbon',[(-2.27,.29+j*.036),(-2.01,.3+j*.036),(-2.01,.306+j*.036),(-2.27,.296+j*.036)],.002,side*.852,.0006)
            # Seat mounting flanges on the mainplane, connected to swan-neck.
            box('rear_alloy',(side*.24,.485,-1.99),(.049,.006,.10),.002)
# Roll the upper rear trailing edge into a thin gurney strip.
d=seed['rear'][-1]
points=[]
for i in range(41):
    x=(2*i/40-1)*d['span']/2;e=abs(x)/(d['span']/2)
    z=-d['chord']*(1-.16*e**4)*.5-d['sweep']*e*e
    y=-d['gull']*e*e;a=d['incidence']
    points.append((x,d['y']+y*cos(a)-z*sin(a)+.0025,d['z']+y*sin(a)+z*cos(a)))
tube('rear_carbon',points,.0025,6)

# Crash structure, exhaust concentric walls and service hard points.
plate('tail_carbon',[(-2.28,-.277),(-1.82,-.29),(-1.82,-.105),(-2.20,-.197),(-2.28,-.20)],.14,0,.01)
# Exhaust follows Z, opening backwards. Wall and inner throat are geometry.
outer=[];faces=[];steps=48
profile=[(-1.91,.055),(-2.01,.049),(-2.16,.042),(-2.17,.039),(-2.15,.036),(-2.01,.043),(-1.91,.049)]
for z,r in profile:
    for j in range(steps):a=2*pi*j/steps;outer.append((r*cos(a),-.076+r*sin(a),z))
for i in range(len(profile)-1):
    for j in range(steps):a=i*steps+j;b=i*steps+(j+1)%steps;faces.append((a,b,b+steps,a+steps))
obj('tail_alloy',outer,faces)
box('tail_dark',(0,-.076,-1.915),(.075,.075,.012),.003)

# A thin carbon bucket around the established occupant envelope. This replaces
# two intersecting solid boxes without moving the driver, controls or camera.
# Backrest follows the torso recline; raised bolsters remain below the elbows.
plate('seat_shell',[(-.645,-.255),(-.625,.155),(-.602,.160),(-.604,-.202),(.26,-.223),(.265,-.240)],.425,0,.005)
for side in [-1,1]:
    plate('seat_shell',[(-.62,-.23),(-.60,-.062),(-.34,-.11),(.23,-.19),(.27,-.24)],.018,side*.217,.006)
box('seat_padding',(0,-.218,-.13),(.385,.025,.64),.011)
box('seat_padding',(0,-.02,-.592),(.374,.322,.022),.009)

# Complete front/rear wheel manufacture. Distinct widths, shared physical bead
# and tread radius; no fake enlargement and no tyre baked onto the rigid rim.
for end,half in [('front',.155),('rear',.19)]:
    lathe(end+'_rim',[(-half-.003,.234),(-half-.003,.243),(-half+.003,.247),(-half+.010,.247),(-half+.018,.237),(half-.018,.237),(half-.010,.247),(half+.004,.247),(half+.009,.241),(half+.009,.234),(-half-.003,.234)])
    # Continuous wheel centre barrel and an independently retained brake bell.
    # The latter remains on the rotor during a pit-service wheel withdrawal.
    lathe(end+'_rim',[(half+.034,.024),(half+.034,.038),(-half+.039,.038),(-half+.039,.024),(half+.034,.024)],48)
    # Rotor-owned hat overlaps the ceramic disc rather than floating beside it.
    lathe(end+'_hat',[(-half+.029,.026),(-half+.029,.049),(-.037,.049),(-.013,.091),(-.006,.091),(-.006,.079),(-.026,.043),(-half+.029,.036),(-half+.029,.026)],64)
    # Curved, forged inboard spokes remain visible through the suspension view.
    for j in range(10):
        a=2*pi*j/10;pts=[]
        for i in range(7):
            t=i/6;r=.049+.183*t;angle=a+.18*t
            pts.append((-half+.014+.022*sin(pi*t),r*cos(angle),r*sin(angle)))
        tube(end+'_rim',pts,[.012-.005*i/6 for i in range(7)],10)
    lathe(end+'_rim',[(-half+.01,.043),(-half+.01,.061),(-half+.035,.061),(-half+.048,.045),(-half+.01,.043)],48)
    lathe(end+'_cover',[(half+.014,.052),(half+.017,.056),(half+.024,.116),(half+.017,.202),(half+.015,.224),(half+.010,.231),(half+.006,.230),(half+.009,.221),(half+.011,.20),(half+.018,.115),(half+.011,.052),(half+.014,.052)])
    # Continuous lock nut with a true axle bore, not a cap painted black.
    lathe(end+'_hub',[(half+.013,.029),(half+.013,.050),(half+.022,.050),(half+.025,.040),(half+.048,.040),(half+.051,.035),(half+.051,.024),(half+.018,.024),(half+.013,.029)],12)
    lathe(end+'_hub',[(half+.019,.049),(half+.024,.054),(half+.029,.051),(half+.024,.046),(half+.019,.049)],48)
    for j in range(10):
        a=2*pi*j/10;tube(end+'_hub',[(half+.017,.192*cos(a),.192*sin(a)),(half+.023,.192*cos(a),.192*sin(a))],.0032,6)
    # Shoulder curvature resolves light continuously around the compound ring.
    profile=[(-half,.245),(-half-.001,.259),(-half-.002,.276),(-half-.001,.296),(-half+.002,.309),(-half+.009,.320),(-half+.020,.328),(-half+.035,.3325),(-half+.052,.3345),(-half+.068,.335),(half-.068,.335),(half-.052,.3345),(half-.035,.3325),(half-.020,.328),(half-.009,.320),(half-.002,.309),(half+.001,.296),(half+.002,.276),(half+.001,.259),(half,.245),(-half,.245)]
    lathe('tire_'+end,profile,96)
    for face in [-1,1]:
        lettering='APX  CONTROL'
        for j,ch in enumerate(lettering):
            if ch==' ':continue
            angle=pi*.5+(j-(len(lettering)-1)*.5)*.078
            font=bpy.data.curves.new('Original moulded tyre mark','FONT');font.body=ch
            font.size=.017;font.align_x='CENTER';font.extrude=.00045;font.bevel_depth=.0001;font.bevel_resolution=1;font.resolution_u=3
            text=bpy.data.objects.new('Moulded '+ch,font);bpy.context.collection.objects.link(text)
            tangent=Vector(xyz((0,face*sin(angle),-face*cos(angle))))
            radial=Vector(xyz((0,cos(angle),sin(angle))))
            normal=Vector(xyz((face,0,0)))
            text.rotation_euler=Matrix((tangent,radial,normal)).transposed().to_euler()
            text.location=xyz((face*(half+.0017),.263*cos(angle),.263*sin(angle)))
            bpy.ops.object.select_all(action='DESELECT');text.select_set(True);bpy.context.view_layer.objects.active=text
            bpy.ops.object.convert(target='MESH');text=bpy.context.object
            text.data.materials.append(materials['rubber']);parts['tire_'+end].append(text)
    # Upright: bearing housing, forged vertical web, wishbone sockets exactly
    # matching the runtime articulation endpoint (local inboard X, Y +/- dy).
    x=-half-.028
    plate(end+'_upright',[(-.025,-.098),(.026,-.098),(.049,-.040),(.049,.024),(.025,.079),(-.022,.079),(-.04,.025),(-.04,-.049)],.033,x,.009)
    for y in [-.075,.055]:
        tube(end+'_upright',[(x-.022,y,0),(x+.022,y,0)],.022,16)
        tube(end+'_upright',[(x-.026,y,0),(x-.021,y,0)],.010,6)
    lathe(end+'_upright',[(x+.013,.026),(x+.013,.055),(x+.049,.055),(x+.055,.041),(x+.055,.026),(x+.013,.026)],48)
    # Brake scoop is a swept, hollow passage with a rolled inlet rim and a
    # widening exit beside the rotor. The barrel/cover do not rotate this part.
    path=[(x-.021,.017,.222,.024,.059),(x-.023,.017,.219,.029,.064),(x-.021,.016,.202,.029,.063),(x-.01,.013,.166,.036,.063),(x+.019,.010,.119,.042,.060),(x+.041,.008,.070,.044,.055)]
    v=[];f=[];seg=40;rows=len(path)
    for inside in [False,True]:
        for cx,cy,z,rx,ry in path:
            for j in range(seg):
                a=2*pi*j/seg;v.append((cx+(rx-(.003 if inside else 0))*cos(a),cy+(ry-(.003 if inside else 0))*sin(a),z))
    skin=rows*seg
    for r in range(rows-1):
        for j in range(seg):
            a=r*seg+j;b=r*seg+(j+1)%seg
            f.extend([(a,a+seg,b+seg,b),(a+skin,b+skin,b+seg+skin,a+seg+skin)])
    for j in range(seg):
        a=j;b=(j+1)%seg;f.append((a,b,b+skin,a+skin))
        a=(rows-1)*seg+j;b=(rows-1)*seg+(j+1)%seg;f.append((a,a+skin,b+skin,b))
    obj(end+'_duct',v,f)
    # Carrier-fixed split caliper around the rotor, not a solid intersection.
    for side in [-1,1]:box(end+'_caliper',(side*.027,.010,-.188),(.030,.145,.047),.010)
    for y in [-.052,.067]:box(end+'_caliper',(0,y,-.208),(.084,.023,.031),.007)
    for y in [-.032,.044]:tube(end+'_upright',[(-.056,y,-.206),(.056,y,-.206)],.007,8)
# Unit-length aerodynamic link. Physics endpoint placement supplies the length.
v=[];f=[];seg=24
for y in [-.5,.5]:
    for j in range(seg):
        a=2*pi*j/seg;u=(1-cos(a))/2;s=1 if j<=seg/2 else -1
        v.append((.044*(u-.42),y,s*.015*sqrt(u)*(1-u)))
for j in range(seg):f.append((j,(j+1)%seg,(j+1)%seg+seg,j+seg))
f.extend([tuple(reversed(range(seg))),tuple(seg+j for j in range(seg))]);obj('suspension_link',v,f)

# One material/one primitive per named contract role. Preserve split skin UVs,
# weld only authored non-skin coincident positions, and correct face orientation.
for role,objects in parts.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1:bpy.ops.object.join()
    o=bpy.context.view_layer.objects.active;o.name=role;o['apex_role']=role;o['apex_material']=roles[role]
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Converted moulded lettering may carry an extra UV layer. The runtime
    # contract intentionally has one material UV set, never unbound TEXCOORD_1.
    for layer in list(o.data.uv_layers)[1:]:o.data.uv_layers.remove(layer)
    # Join may retain duplicate slots of the same preview material.
    o.data.materials.clear();o.data.materials.append(materials[roles[role]])
    for poly in o.data.polygons:poly.material_index=0
    if role not in ['nose','engine','sidepod','monocoque','safety','airbox_paint','airbox_carbon','airbox_dark','mirror_shell','beam','floor_edges']:
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=.0000001)
        bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        # Mark steep manufacturing edges; continuous body/tyre arcs stay smooth.
        o.data.set_sharp_from_angle(angle=math.radians(45))
    tri=o.modifiers.new('Explicit production triangles','TRIANGULATE');tri.quad_method='BEAUTY';tri.ngon_method='BEAUTY'
    bpy.ops.object.modifier_apply(modifier=tri.name)
    if role not in ['nose','engine','sidepod']:
        for layer in o.data.uv_layers:
            for axis in range(2):
                lo=min(loop.uv[axis] for loop in layer.data);hi=max(loop.uv[axis] for loop in layer.data)
                if lo<0 or hi>1:
                    for loop in layer.data:loop.uv[axis]=(loop.uv[axis]-lo)/max(hi-lo,1e-8)
    o['apex_coordinate_frame']='wheel-positive-X' if role.startswith(('front_rim','rear_rim','front_cover','rear_cover','front_hub','rear_hub','front_duct','rear_duct','front_upright','rear_upright','front_caliper','rear_caliper','tire_')) else ('unit-link' if role=='suspension_link' else 'chassis')
actual={o.get('apex_role') for o in bpy.data.objects if o.type=='MESH'}
if actual!=set(roles):raise ValueError(('Role contract mismatch',actual ^ set(roles)))
# Editable prototypes and an assembled inspection view in the same .blend.
# The export contract selects only apex_role objects, never preview instances.
prototypes={o['apex_role']:o for o in bpy.data.objects if o.type=='MESH' and o.get('apex_role') in roles}
preview_collection=bpy.data.collections.new('APX / assembled mechanical inspection')
bpy.context.scene.collection.children.link(preview_collection)
def preview(role,name,position=(0,0,0),side=1):
    source=prototypes[role];o=source.copy();o.data=source.data;o.name=name
    for key in list(o.keys()):del o[key]
    o['apx_preview']=True;preview_collection.objects.link(o)
    o.location=xyz(position);o.scale.x=side
    return o
wheel_suffixes=['rim','cover','hub','duct','upright','caliper','hat']
wheel_roles={end+'_'+suffix for end in ['front','rear'] for suffix in wheel_suffixes}
for role in roles:
    if role in wheel_roles or role in ['tire_front','tire_rear','brake_rotor','suspension_link','sidepod','mirror_shell']:continue
    preview(role,'Assembled / '+role)
for side in [-1,1]:
    o=preview('sidepod','Assembled / sidepod '+str(side),(side*.53,0,0));o.rotation_euler.y=side*.08
    preview('mirror_shell','Assembled / mirror '+str(side),(side*.64,.30,.43))
for end,z in [('front',1.82),('rear',-1.62)]:
    for side in [-1,1]:
        p=(side*.83,-.183,z)
        for suffix in wheel_suffixes:preview(end+'_'+suffix,'Assembled / '+end+' '+suffix+' '+str(side),p,side)
        preview('tire_'+end,'Assembled / '+end+' rubber '+str(side),p)
        preview('brake_rotor','Assembled / '+end+' brake rotor '+str(side),p)
for i,link in enumerate(seed['suspension']):
    a=Vector(xyz(link['anchor']));b=Vector(xyz(link['end']));axis=(b-a).normalized()
    chord=Vector((0,-1,0));chord=(chord-axis*chord.dot(axis)).normalized()
    cross=axis.cross(chord).normalized()
    o=preview('suspension_link','Assembled / suspension '+str(i))
    o.location=(a+b)*.5;o.rotation_euler=Matrix((chord,cross,axis)).transposed().to_euler();o.scale.z=(b-a).length
for o in prototypes.values():o.hide_set(True);o.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
# Set a useful front-three-quarter editor orbit; no lamps/camera leak into GLB.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.region_3d.view_distance=8
            space.region_3d.view_location=(0,0,0)
            space.region_3d.view_rotation=Vector((5,-7,3)).to_track_quat('Z','Y')
            space.shading.type='MATERIAL'
bpy.context.scene['APX_design']='27H.1 original mechanical assembly; animation remains in Three.js'
bpy.context.scene['APX_finalArtApproved']=False
bpy.context.scene.unit_settings.system='METRIC'
bpy.ops.wm.save_as_mainfile(filepath=str(Path(args[1]).resolve()),compress=True)
print('APX_ASSEMBLY_AUTHORED',len(actual),'roles')
