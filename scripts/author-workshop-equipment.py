"""A36 original workshop equipment. Blender 5.2.2, metres, no external art.

Run: blender -b -t 2 --factory-startup --python-exit-code 1 --python
     scripts/author-workshop-equipment.py -- [--render] [--export-only]
The retained construction objects are editable; runtime meshes are atlas-batched.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
STEM = 'aurel-workshop-equipment'
REVISION = 'aurel-a36-r01'
KINDS = ('TOOL_CHEST', 'MEDIUM_CASE', 'LARGE_CASE', 'WORKBENCH')
GALLERY = {'TOOL_CHEST': (-1.05, 0, .65), 'MEDIUM_CASE': (.45, 0, .65),
           'LARGE_CASE': (1.6, 0, .65), 'WORKBENCH': (0, 0, -1.0)}
PLACEMENTS = [
    {'id': 'a36-tool-chest', 'kind': 'TOOL_CHEST', 'position': [-3.25, .05, 3.34], 'yaw': math.pi},
    {'id': 'a36-medium-case', 'kind': 'MEDIUM_CASE', 'position': [5.27, .05, 1.68], 'yaw': math.pi / 2},
    {'id': 'a36-large-case', 'kind': 'LARGE_CASE', 'position': [5.28, .05, 3.10], 'yaw': math.pi / 2},
    {'id': 'a36-workbench', 'kind': 'WORKBENCH', 'position': [-1.6, .05, 2.95], 'yaw': math.pi},
]
# Conservative forbidden volumes, not new simulation collision geometry.
RESERVED = [
    {'name': 'car aisle and rear door', 'min': [-6.45, .045, -1.25], 'max': [6.10, 2.5, 1.25]},
    {'name': 'A22 positive-side fitted cabinets', 'min': [-.65, .045, 2.68], 'max': [4.65, 1.3, 3.96]},
    {'name': 'A35 negative-side logistics', 'min': [-6.25, .045, -3.96], 'max': [6.05, 1.8, -1.25]},
    {'name': 'crew access at A22 socket', 'min': [-4.75, .045, 1.85], 'max': [-3.85, 2.1, 2.75]},
    {'name': 'engineer access at A22 socket', 'min': [3.75, .045, 1.65], 'max': [4.65, 2.1, 2.55]},
]
SOCKETS = {
    'TOOL_CHEST': {'PUSH_GRIP': [.68, .932, 0], 'WORK_SURFACE': [0, .967, 0],
                   'DRAWER_TOP': [0, .87, .278], 'GROUND': [0, 0, 0]},
    'MEDIUM_CASE': {'HANDLE': [0, .424, 0], 'LID_HINGE': [0, .300, -.239], 'GROUND': [0, 0, 0]},
    'LARGE_CASE': {'HANDLE_L': [-.579, .4912, 0], 'HANDLE_R': [.579, .4912, 0],
                   'LID_HINGE': [0, .643, -.3115], 'GROUND': [0, 0, 0]},
    'WORKBENCH': {'WORK_SURFACE': [0, .9225, 0], 'SHELF': [0, .253, 0],
                  'VICE_GRIP': [-.48, .990, .405], 'GROUND': [0, 0, 0]},
}
SURFACES = [
    ('TEAM_ENAMEL', (26, 92, 85), .23, .39),
    ('CASE_SHELL', (40, 48, 52), .03, .64),
    ('ALLOY', (166, 178, 181), .86, .31),
    ('RUBBER', (19, 23, 25), .0, .82),
    ('SAFETY_AMBER', (217, 156, 48), .18, .46),
    ('MARKING', (217, 224, 213), .02, .58),
    ('WORKTOP', (119, 126, 123), .35, .53),
    ('FRAME', (57, 72, 75), .58, .44),
]
WIDTH, HEIGHT, TILE = 512, 256, 128
parts: dict[str, list[bpy.types.Object]] = {k: [] for k in KINDS}
roots: dict[str, bpy.types.Object] = {}
source_collection = None
atlas_material = None
serial = 0
pngs: dict[str, bytes] = {}


def game_to_blender(p):
    return (p[0], -p[2], p[1])


def blender_to_game(p):
    return (p[0], p[2], -p[1])


def png_rgba(pixels):
    """Deterministic, dependency-free RGBA PNG encoding."""
    h, w, _ = pixels.shape
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    scan = b''.join(b'\0' + row.tobytes() for row in pixels)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(scan, 9)) + chunk(b'IEND', b'')


def make_atlas():
    global atlas_material
    base = np.full((HEIGHT, WIDTH, 4), 255, dtype=np.uint8)
    orm = base.copy()
    normal = base.copy()
    rng = np.random.default_rng(3605)
    for i, (_, colour, metal, rough) in enumerate(SURFACES):
        x, y = (i % 4) * TILE, (i // 4) * TILE
        n = rng.uniform(-1, 1, (TILE, TILE))
        if i == 2:
            n = .24 * n + .76 * rng.uniform(-1, 1, (TILE, 1))
        # Restrained surface grain, not baked light or arbitrary heavy scratches.
        for c in range(3):
            base[y:y+TILE, x:x+TILE, c] = np.clip(colour[c] + n * (3 if i != 3 else 2), 0, 255)
        orm[y:y+TILE, x:x+TILE, 0] = 255
        orm[y:y+TILE, x:x+TILE, 1] = np.clip(rough * 255 + n * 6, 0, 255)
        orm[y:y+TILE, x:x+TILE, 2] = round(metal * 255)
        dx = (np.roll(n, 1, 1) - n) * .025
        dy = (np.roll(n, 1, 0) - n) * .025
        normal[y:y+TILE, x:x+TILE, 0] = np.clip(127.5 + dx * 127.5, 0, 255)
        normal[y:y+TILE, x:x+TILE, 1] = np.clip(127.5 + dy * 127.5, 0, 255)
        normal[y:y+TILE, x:x+TILE, 2] = 255
    # PNG's top-left origin and glTF's UV convention agree. Blender's image UVs
    # are inverted below, and the GLB writer flips V back on export.
    temp = ROOT / 'test-results/a36-authoring'
    temp.mkdir(parents=True, exist_ok=True)
    images = {}
    for name, pixels in [('base', base), ('orm', orm), ('normal', normal)]:
        pngs[name] = png_rgba(pixels)
        path = temp / f'a36-{name}.png'
        path.write_bytes(pngs[name])
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = f'A36_original_{name}'
        if name != 'base':
            image.colorspace_settings.name = 'Non-Color'
        image.pack()
        images[name] = image
    atlas_material = bpy.data.materials.new('A36_OriginalWorkshopAtlas')
    atlas_material.use_nodes = True
    nodes, links = atlas_material.node_tree.nodes, atlas_material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    tex = {}
    for name, image in images.items():
        t = nodes.new('ShaderNodeTexImage')
        t.image = image
        t.extension = 'EXTEND'
        tex[name] = t
    links.new(tex['base'].outputs['Color'], bsdf.inputs['Base Color'])
    split = nodes.new('ShaderNodeSeparateColor')
    links.new(tex['orm'].outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    n = nodes.new('ShaderNodeNormalMap')
    links.new(tex['normal'].outputs['Color'], n.inputs['Color'])
    links.new(n.outputs['Normal'], bsdf.inputs['Normal'])


def atlas_uv(mesh, surface):
    """Box-project every component with a ten-pixel gutter in its material tile."""
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    coords = np.array([v.co[:] for v in mesh.vertices])
    lo, hi = coords.min(axis=0), coords.max(axis=0)
    span = np.maximum(hi - lo, 1e-8)
    tx, ty = surface % 4, surface // 4
    for face in mesh.polygons:
        axis = max(range(3), key=lambda a: abs(face.normal[a]))
        axes = [a for a in range(3) if a != axis]
        for li in face.loop_indices:
            p = (coords[mesh.loops[li].vertex_index] - lo) / span
            u, v = .08 + .84 * p[axes[0]], .08 + .84 * p[axes[1]]
            uv.data[li].uv = ((tx + u) / 4, 1 - (ty + v) / 2)


def own(kind, obj, name, surface, tier=0):
    global serial
    serial += 1
    obj.name = f'A36_{kind}_{serial:04d}_{name}'
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    source_collection.objects.link(obj)
    obj.parent = roots[kind]
    obj['a36_kind'] = kind
    obj['a36_detail_tier'] = tier
    obj['a36_surface'] = SURFACES[surface][0]
    obj.data.materials.clear()
    obj.data.materials.append(atlas_material)
    if obj.type == 'MESH':
        obj.data.update()
        atlas_uv(obj.data, surface)
    parts[kind].append(obj)
    obj.select_set(False)
    return obj


def box(kind, name, p, size, surface, bevel=.008, tier=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=game_to_blender(p))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = obj.modifiers.new('Manufactured edge radii', 'BEVEL')
        b.width = min(bevel, min(size) * .22)
        b.segments = 2
        n = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        n.keep_sharp = True
    return own(kind, obj, name, surface, tier)


def cylinder(kind, name, a, b, radius, surface, tier=0, vertices=20):
    av, bv = Vector(game_to_blender(a)), Vector(game_to_blender(b))
    direction = bv - av
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length,
                                      end_fill_type='NGON', location=(av + bv) / 2)
    obj = bpy.context.object
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('Z', 'Y')
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return own(kind, obj, name, surface, tier)


def rail(kind, name, points, radius, surface, tier=1):
    # Segmented physical tubes retain a rounded silhouette at bends.
    for a, b in zip(points, points[1:]):
        cylinder(kind, name, a, b, radius, surface, tier, 12)
    for p in points[1:-1]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=game_to_blender(p))
        obj = bpy.context.object
        for face in obj.data.polygons:
            face.use_smooth = True
        own(kind, obj, name + '_bend', surface, tier)


def lettering(kind, label, p, size, surface=5, top=False, tier=2):
    curve = bpy.data.curves.new('Original Aurel marking', 'FONT')
    curve.body = label
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = .00025
    curve.resolution_u = 2
    obj = bpy.data.objects.new('Marking', curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = game_to_blender(p)
    if not top:
        obj.rotation_euler.x = math.pi / 2
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    own(kind, bpy.context.object, 'marking_' + label, surface, tier)


def tyre(kind, p, radius, width, surface=3):
    """Rounded, hollow caster tread rather than a solid cylinder."""
    profile = [(-width/2, radius*.79), (-width/2, radius*.90), (-width*.35, radius),
               (width*.35, radius), (width/2, radius*.90), (width/2, radius*.79)]
    segments = 20
    vertices, faces = [], []
    for x, r in profile:
        for i in range(segments):
            angle = i * 2 * math.pi / segments
            vertices.append(game_to_blender((p[0]+x, p[1]+r*math.cos(angle), p[2]+r*math.sin(angle))))
    for ring in range(len(profile)):
        nxt = (ring + 1) % len(profile)
        for i in range(segments):
            j = (i+1) % segments
            faces.append((ring*segments+i, nxt*segments+i, nxt*segments+j, ring*segments+j))
    mesh = bpy.data.meshes.new('Rounded caster tread')
    mesh.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces])
    mesh.update()
    obj = bpy.data.objects.new('Caster tread', mesh)
    bpy.context.scene.collection.objects.link(obj)
    for face in mesh.polygons:
        face.use_smooth = True
    own(kind, obj, 'rounded_tread', surface)


def caster(kind, x, z, radius=.07, brake=False):
    tyre(kind, (x, radius, z), radius, .047)
    cylinder(kind, 'wheel_hub', (x-.032, radius, z), (x+.032, radius, z), radius*.56, 2)
    cylinder(kind, 'axle', (x-.046, radius, z), (x+.046, radius, z), .011, 7, 1, 12)
    for dx in [-.037, .037]:
        box(kind, 'fork_cheek', (x+dx, radius+.044, z+.007), (.012, .091, .049), 2, .006)
    cylinder(kind, 'swivel_bearing', (x, radius+.086, z+.009), (x, radius+.107, z+.009), .042, 2)
    box(kind, 'caster_mount', (x, radius+.113, z+.009), (.096, .013, .083), 7, .007)
    if brake:
        box(kind, 'foot_brake', (x+.014, radius+.059, z+.047), (.038, .012, .075), 3, .004, 1)
        for dz in [0, .012, .024]:
            box(kind, 'brake_rib', (x+.014, radius+.067, z+.039+dz), (.036, .002, .003), 7, .0, 2)
    for dx in [-.031, .031]:
        cylinder(kind, 'mount_bolt', (x+dx, radius+.12, z+.009), (x+dx, radius+.125, z+.009), .007, 2, 2, 6)


def chest():
    k = 'TOOL_CHEST'
    for x in [-.465, .465]:
        for z in [-.218, .218]:
            caster(k, x, z, .073, brake=z > 0)
    box(k, 'lower_chassis', (0, .221, 0), (1.14, .054, .60), 7, .016)
    box(k, 'rear_shell', (0, .588, -.279), (1.12, .685, .026), 0, .015)
    for x in [-.547, .547]:
        box(k, 'side_shell', (x, .588, 0), (.026, .685, .58), 0, .009)
        box(k, 'corner_protector', (x, .283, .266), (.043, .12, .06), 3, .015, 1)
    box(k, 'drawer_recess', (0, .588, .259), (1.052, .679, .018), 3, .002)
    y = .257
    for i, h in enumerate([.132, .128, .098, .086, .075, .064, .060]):
        centre = y + h/2
        box(k, f'drawer_{i+1:02d}', (0, centre, .278), (1.035, h-.007, .029), 0, .006)
        box(k, f'pull_recess_{i+1:02d}', (0, centre+h*.22, .295), (.91, .022, .005), 3, .002, 1)
        box(k, f'alloy_pull_{i+1:02d}', (0, centre+h*.25+.005, .310), (.94, .013, .033), 2, .004, 1)
        if i in [0, 3, 6]:
            box(k, 'drawer_label_plate', (-.398, centre-.01, .297), (.092, .025, .003), 7, .001, 1)
            lettering(k, ['SOCKETS', 'SERVICE', 'TOOLS'][[0, 3, 6].index(i)], (-.398, centre-.01, .30), .011)
        y += h
    box(k, 'rimmed_top', (0, .943, 0), (1.16, .035, .635), 2, .013)
    box(k, 'replaceable_top_mat', (0, .963, -.002), (1.087, .008, .558), 3, .008)
    for x in [-.569, .569]:
        box(k, 'raised_top_edge', (x, .965, 0), (.018, .021, .623), 2, .006, 1)
    box(k, 'rear_top_edge', (0, .965, -.308), (1.155, .021, .018), 2, .006, 1)
    rail(k, 'push_handle', [(.56,.84,-.215),(.68,.90,-.215),(.68,.932,-.17),(.68,.932,.17),(.68,.90,.215),(.56,.84,.215)], .015, 2)
    cylinder(k, 'push_grip', (.68,.932,-.15), (.68,.932,.15), .020, 3, 1)
    for z in [-.215,.215]:
        box(k, 'push_mount', (.563,.84,z), (.021,.087,.068), 7, .009, 1)
    cylinder(k, 'key_barrel', (.475,.900,.294), (.475,.900,.305), .013, 2, 1, 16)
    box(k, 'key_slot', (.475,.900,.307), (.003,.013,.001), 3, .0, 2)
    box(k, 'chest_identity_plate', (0,.231,.306), (.272,.033,.006), 7, .003, 1)
    lettering(k, 'AUREL  /  05', (0,.231,.310), .021)
    for x in [-.49,.49]:
        box(k, 'safety_corner', (x,.234,.309), (.044,.027,.004), 4, .002, 1)


def flight_case(kind, width, depth, height, wheeled):
    lift = .176 if wheeled else .020
    body_bottom = lift
    body_top = height - .082
    if wheeled:
        for x in [-width*.36, width*.36]:
            for z in [-depth*.32, depth*.32]:
                caster(kind, x, z, .057, brake=z > 0)
    else:
        for x in [-width*.34,width*.34]:
            for z in [-depth*.32,depth*.32]:
                box(kind,'rubber_foot',(x,.012,z),(.065,.024,.055),3,.008)
    box(kind,'laminated_body',(0,(body_bottom+body_top)/2,0),(width,body_top-body_bottom,depth),1,.015)
    box(kind,'lid',(0,height-.036,0),(width+.003,.071,depth+.003),1,.012)
    box(kind,'lid_gasket',(0,body_top+.004,0),(width+.011,.008,depth+.011),3,.004)
    for y in [body_bottom+.014,body_top-.012,body_top+.018,height-.013]:
        for z in [-depth/2,depth/2]:
            box(kind,'aluminium_edge',(0,y,z),(width+.012,.022,.013),2,.004)
        for x in [-width/2,width/2]:
            box(kind,'aluminium_return',(x,y,0),(.013,.022,depth+.012),2,.004)
    for x in [-width/2,width/2]:
        for z in [-depth/2,depth/2]:
            box(kind,'vertical_angle_x',(x, (body_top+body_bottom)/2, z),(.014,body_top-body_bottom,.038),2,.005)
            box(kind,'vertical_angle_z',(x, (body_top+body_bottom)/2, z),(.038,body_top-body_bottom,.014),2,.005)
            for y in [body_bottom+.025,height-.023]:
                bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.029,location=game_to_blender((x,y,z)))
                obj=bpy.context.object
                for face in obj.data.polygons:
                    face.use_smooth=True
                own(kind,obj,'ball_corner',2,1)
    for x in [-width*.31,width*.31]:
        z=depth/2+.014
        yc=body_top-.035
        box(kind,'recessed_latch_dish',(x,yc,z),(.086,.106,.012),7,.011,1)
        box(kind,'latch_dish_floor',(x,yc,z+.008),(.063,.084,.007),2,.008,1)
        box(kind,'latch_bridge',(x,yc+.010,z+.018),(.028,.061,.014),2,.004,1)
        toggle=box(kind,'butterfly_toggle',(x,yc-.012,z+.028),(.050,.015,.008),2,.005,1)
        toggle.rotation_euler.y=.40
        for dx in [-.031,.031]:
            cylinder(kind,'latch_rivet',(x+dx,yc-.033,z+.008),(x+dx,yc-.033,z+.014),.0038,2,2,8)
        # The hinge axis is horizontal, with alternating short knuckles.
        box(kind,'hinge_leaf',(x,body_top,-depth/2-.012),(.10,.062,.014),2,.005,1)
        for j in [-1,0,1]:
            cylinder(kind,'hinge_knuckle',(x+j*.029-.012,body_top+.005,-depth/2-.024),(x+j*.029+.012,body_top+.005,-depth/2-.024),.009,2,1,12)
    if wheeled:
        for sign in [-1,1]:
            x=sign*(width/2+.011)
            yc=lift+(height-lift)*.55
            box(kind,'side_handle_dish',(x,yc,0),(.014,.123,.205),7,.012,1)
            rail(kind,'folded_side_handle',[(x+sign*.021,yc-.026,-.072),(x+sign*.043,yc+.016,-.072),(x+sign*.043,yc+.016,.072),(x+sign*.021,yc-.026,.072)],.011,2)
            cylinder(kind,'side_handle_grip',(x+sign*.043,yc+.016,-.055),(x+sign*.043,yc+.016,.055),.014,3,1)
    else:
        box(kind,'top_handle_recess',(0,height+.006,0),(.22,.010,.083),7,.009,1)
        rail(kind,'top_carry_handle',[(-.085,height+.008,0),(-.071,height+.047,0),(.071,height+.047,0),(.085,height+.008,0)],.012,2)
        cylinder(kind,'carry_grip',(-.052,height+.047,0),(.052,height+.047,0),.016,3,1)
    box(kind,'case_label_plate',(0,lift+(height-lift)*.49,depth/2+.011),(width*.38,.091,.006),0,.006,1)
    lettering(kind,'AUREL  /  OPS',(0,lift+(height-lift)*.49+.013,depth/2+.016),.025 if wheeled else .018)
    lettering(kind,'05  -  SERVICE',(0,lift+(height-lift)*.49-.019,depth/2+.016),.017 if wheeled else .013)
    for x in [-width*.42,width*.42]:
        box(kind,'identification_strip',(x,height+.001,0),(.025,.004,depth*.65),4,.001,1)


def bench():
    k='WORKBENCH'
    for x in [-.695,.695]:
        for z in [-.268,.268]:
            cylinder(k,'levelling_pad',(x,0,z),(x,.015,z),.039,3)
            cylinder(k,'threaded_foot',(x,.015,z),(x,.065,z),.012,2,0,12)
            box(k,'square_tube_leg',(x,.449,z),(.047,.78,.047),7,.004)
            box(k,'welded_corner_gusset',(x,.833,z),(.089,.079,.071),2,.004,1)
    for z in [-.268,.268]:
        box(k,'upper_longitudinal_rail',(0,.852,z),(1.445,.066,.044),7,.005)
        box(k,'shelf_longitudinal_rail',(0,.219,z),(1.445,.046,.038),7,.005)
    for x in [-.695,.695]:
        box(k,'upper_cross_rail',(x,.852,0),(.044,.066,.58),7,.005)
        box(k,'shelf_cross_rail',(x,.219,0),(.038,.046,.58),7,.005)
    box(k,'composite_worktop',(0,.902,0),(1.61,.041,.722),6,.013)
    box(k,'front_worktop_nosing',(0,.899,.362),(1.60,.035,.009),2,.004,1)
    box(k,'lower_tray',(0,.244,0),(1.353,.018,.509),2,.005)
    box(k,'lower_tray_rear_lip',(0,.267,-.253),(1.35,.042,.014),7,.003,1)
    for x in [-.675,.675]:
        box(k,'tray_side_lip',(x,.260,0),(.012,.026,.50),7,.002,1)
    # An open braced rear, never a solid cabinet disguised as a bench.
    cylinder(k,'rear_diagonal_brace',(-.66,.295,-.274),(.66,.79,-.274),.014,7,1,12)
    cylinder(k,'rear_diagonal_brace',(.66,.295,-.280),(-.66,.79,-.280),.014,7,1,12)
    box(k,'small_vice_mount',(-.48,.936,.23),(.18,.028,.165),2,.008,1)
    box(k,'vice_fixed_body',(-.48,.989,.227),(.152,.08,.144),0,.014,1)
    for z in [.204,.294]:
        box(k,'vice_jaw',(-.48,1.051,z),(.177,.052,.030),7,.004,1)
        box(k,'replaceable_jaw_face',(-.48,1.059,z+(.016 if z<.25 else -.016)),(.17,.025,.003),2,.001,2)
    cylinder(k,'vice_screw',(-.48,.990,.23),(-.48,.990,.399),.012,2,1,16)
    cylinder(k,'vice_sliding_handle',(-.533,.990,.405),(-.427,.990,.405),.007,2,1,12)
    for x in [-.535,-.425]:
        cylinder(k,'handle_stop',(x-.006,.990,.405),(x+.006,.990,.405),.011,2,1,12)
    box(k,'bench_identity',(0,.850,.294),(.269,.035,.005),0,.003,1)
    lettering(k,'AUREL  /  WORKSHOP',(0,.850,.298),.018)


def canonical_geometry(obj, local_matrix):
    """Evaluate editable Blender data and preserve split normals / UV seams."""
    deps=bpy.context.evaluated_depsgraph_get()
    evaluated=obj.evaluated_get(deps)
    mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=deps)
    try:
        mesh.calc_loop_triangles()
        uv=mesh.uv_layers.active
        if not uv:
            raise RuntimeError(f'Missing source UVs: {obj.name}')
        normal_matrix=local_matrix.to_3x3().inverted().transposed()
        corners=mesh.corner_normals
        triangles=[]
        for tri in mesh.loop_triangles:
            vertices=[]
            for li in tri.loops:
                point=local_matrix @ mesh.vertices[mesh.loops[li].vertex_index].co
                norm=(normal_matrix @ corners[li].vector).normalized()
                u,v=uv.data[li].uv
                # Quantization makes the serialized representation deterministic
                # without collapsing seams or reversing triangle winding.
                values=(*blender_to_game(point),*blender_to_game(norm),u,1-v)
                vertex=tuple(round(float(n),6) for n in values)
                if not all(math.isfinite(n) for n in vertex):
                    raise RuntimeError('Non-finite workshop geometry')
                vertices.append(vertex)
            if Vector(vertices[1][:3]).__sub__(Vector(vertices[0][:3])).cross(Vector(vertices[2][:3])-Vector(vertices[0][:3])).length < 1e-12:
                continue
            first=min(range(3),key=lambda i:vertices[i])
            triangles.append(tuple(vertices[first:]+vertices[:first]))
        return triangles
    finally:
        evaluated.to_mesh_clear()


def indexed(triangles):
    vertices=[]
    indices=[]
    lookup={}
    for tri in sorted(triangles):
        for vertex in tri:
            if vertex not in lookup:
                lookup[vertex]=len(vertices)
                vertices.append(vertex)
            indices.append(lookup[vertex])
    return np.array(vertices,dtype='<f4'),np.array(indices,dtype='<u4')


def create_export_mesh(kind, level, vertices, indices, collection, parent):
    mesh=bpy.data.meshes.new(f'A36_{kind}_LOD{level}_geometry')
    mesh.from_pydata([game_to_blender(p) for p in vertices[:,:3]],[],indices.reshape(-1,3).tolist())
    mesh.update()
    uv=mesh.uv_layers.new(name='UVMap')
    for li,loop in enumerate(mesh.loops):
        u,v=vertices[loop.vertex_index,6:8]
        uv.data[li].uv=(float(u),1-float(v))
    for face in mesh.polygons:
        face.use_smooth=True
    mesh.normals_split_custom_set_from_vertices([game_to_blender(n) for n in vertices[:,3:6]])
    obj=bpy.data.objects.new(f'A36_{kind}_LOD{level}',mesh)
    collection.objects.link(obj)
    obj.parent=parent
    obj.data.materials.append(atlas_material)
    obj['a36_kind']=kind
    obj['a36_lod']=level
    obj.hide_set(level!=0)
    obj.hide_render=level!=0
    return obj


def build():
    global source_collection
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'
    scene.unit_settings.scale_length=1
    make_atlas()
    source_collection=bpy.data.collections.new('EDITABLE_A36_COMPONENTS')
    scene.collection.children.link(source_collection)
    export=bpy.data.collections.new('A36_GAME_EXPORT')
    scene.collection.children.link(export)
    for kind in KINDS:
        root=bpy.data.objects.new('EDITABLE_'+kind,None)
        source_collection.objects.link(root)
        root.location=game_to_blender(GALLERY[kind])
        roots[kind]=root
    chest()
    flight_case('MEDIUM_CASE',.66,.43,.377,False)
    flight_case('LARGE_CASE',1.05,.575,.72,True)
    bench()
    bpy.context.view_layer.update()
    for kind in KINDS:
        root=bpy.data.objects.new('A36_'+kind,None)
        export.objects.link(root)
        root.location=game_to_blender(GALLERY[kind])
        root['assetId']='A36'
        root['a36_kind']=kind
        for level in range(3):
            triangles=[]
            for obj in parts[kind]:
                if int(obj['a36_detail_tier'])>2-level:
                    continue
                for modifier in obj.modifiers:
                    if modifier.type=='BEVEL':
                        modifier.show_viewport=level<2
                        modifier.segments=2 if level==0 else 1
                bpy.context.view_layer.update()
                local=roots[kind].matrix_world.inverted() @ obj.matrix_world
                triangles.extend(canonical_geometry(obj,local))
            vertices,indices=indexed(triangles)
            create_export_mesh(kind,level,vertices,indices,export,root)
        for name,p in SOCKETS[kind].items():
            socket=bpy.data.objects.new(f'SOCKET_A36_{kind}_{name}',None)
            export.objects.link(socket)
            socket.parent=root
            socket.location=game_to_blender(p)
            socket.empty_display_type='ARROWS'
            socket.empty_display_size=.05
    for objects in parts.values():
        for obj in objects:
            for modifier in obj.modifiers:
                if modifier.type=='BEVEL':
                    modifier.show_viewport=True
                    modifier.segments=2
    source_collection.hide_viewport=True
    source_collection.hide_render=True
    scene['A36_scope']='Four original workshop props, static presentation only. No service rules, crew, player assets or collision mutation.'
    scene['A36_axes']='Runtime +Y up, +Z front; authoring Blender +Z up. Variant origins lie on the floor.'
    scene['A36_atlas']='Original 512x256 PBR atlas, eight padded surface regions, packed base/ORM/normal images.'
    scene['A36_sourceComponents']=sum(len(v) for v in parts.values())
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=5
            area.spaces.active.region_3d.view_location=Vector((0,0,.5))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts'/f'{STEM}.blend'),compress=True)


class GLB:
    def __init__(self):
        self.binary=bytearray()
        self.doc={'asset':{'version':'2.0','generator':'Original A36 evaluated-Blender canonical exporter r01'},
                  'scene':0,'scenes':[{'nodes':[0]}],
                  'nodes':[{'name':'A36_WORKSHOP_EQUIPMENT','children':[]}],
                  'meshes':[],'accessors':[],'bufferViews':[],
                  'materials':[{'name':'A36_OriginalWorkshopAtlas','pbrMetallicRoughness':{
                      'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':1},
                      'metallicFactor':1,'roughnessFactor':1},'normalTexture':{'index':2},'doubleSided':False}],
                  'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],
                  'textures':[{'sampler':0,'source':i} for i in range(3)],'images':[]}
    def view(self,data,target=None):
        while len(self.binary)%4:
            self.binary.append(0)
        view={'buffer':0,'byteOffset':len(self.binary),'byteLength':len(data)}
        if target is not None:
            view['target']=target
        index=len(self.doc['bufferViews'])
        self.doc['bufferViews'].append(view)
        self.binary.extend(data)
        return index
    def accessor(self,array,type_,component=5126,bounds=False):
        array=np.ascontiguousarray(array,dtype='<f4' if component==5126 else '<u4')
        item={'bufferView':self.view(array.tobytes(),34963 if component!=5126 else 34962),
              'componentType':component,'count':len(array),'type':type_}
        if bounds:
            item['min']=array.min(axis=0).tolist()
            item['max']=array.max(axis=0).tolist()
        index=len(self.doc['accessors'])
        self.doc['accessors'].append(item)
        return index
    def write(self,path):
        for key in ['base','orm','normal']:
            image=bpy.data.images.get('A36_original_'+key)
            if not image or not image.packed_file:
                raise RuntimeError('Missing packed original atlas')
            self.doc['images'].append({'name':'A36_'+key,'mimeType':'image/png','bufferView':self.view(bytes(image.packed_file.data))})
        self.doc['buffers']=[{'byteLength':len(self.binary)}]
        while len(self.binary)%4:
            self.binary.append(0)
        raw=json.dumps(self.doc,separators=(',',':'),ensure_ascii=True).encode()
        raw+=b' '*((-len(raw))%4)
        data=struct.pack('<III',0x46546c67,2,28+len(raw)+len(self.binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(self.binary),0x004e4942)+self.binary
        path.write_bytes(data)
        return bytes(data)


def export_retained():
    bpy.context.view_layer.update()
    glb=GLB()
    variants={}
    totals=[0,0,0]
    for kind in KINDS:
        root=bpy.data.objects.get('A36_'+kind)
        if root is None:
            raise RuntimeError('Missing retained asset '+kind)
        role_id=len(glb.doc['nodes'])
        glb.doc['nodes'][0]['children'].append(role_id)
        glb.doc['nodes'].append({'name':'A36_'+kind,'translation':list(GALLERY[kind]),'children':[]})
        info={'triangles':[],'sockets':{}}
        for level in range(3):
            obj=bpy.data.objects.get(f'A36_{kind}_LOD{level}')
            if obj is None:
                raise RuntimeError('Missing retained LOD')
            # Mesh edits in the source .blend are included by --export-only.
            matrix=root.matrix_world.inverted() @ obj.matrix_world
            vertices,indices=indexed(canonical_geometry(obj,matrix))
            primitive={'attributes':{'POSITION':glb.accessor(vertices[:,:3],'VEC3',bounds=True),
                                     'NORMAL':glb.accessor(vertices[:,3:6],'VEC3'),
                                     'TEXCOORD_0':glb.accessor(vertices[:,6:8],'VEC2')},
                       'indices':glb.accessor(indices,'SCALAR',5125),'material':0,'mode':4}
            mesh_id=len(glb.doc['meshes'])
            glb.doc['meshes'].append({'name':obj.name,'primitives':[primitive]})
            node_id=len(glb.doc['nodes'])
            glb.doc['nodes'][role_id]['children'].append(node_id)
            glb.doc['nodes'].append({'name':obj.name,'mesh':mesh_id,'extras':{'assetId':'A36','kind':kind,'lod':level}})
            count=len(indices)//3
            info['triangles'].append(count)
            totals[level]+=count
            if level==0:
                lo=vertices[:,:3].min(axis=0)
                hi=vertices[:,:3].max(axis=0)
                info['bounds']={'min':(np.floor(lo*10000)/10000-.0001).round(4).tolist(),
                                'max':(np.ceil(hi*10000)/10000+.0001).round(4).tolist()}
        if not info['triangles'][0]>info['triangles'][1]>info['triangles'][2]>0:
            raise RuntimeError(f'LOD reduction failed for {kind}')
        for name in SOCKETS[kind]:
            socket=bpy.data.objects.get(f'SOCKET_A36_{kind}_{name}')
            point=[round(float(v),6) for v in blender_to_game((root.matrix_world.inverted() @ socket.matrix_world).translation)]
            info['sockets'][name]=point
            node_id=len(glb.doc['nodes'])
            glb.doc['nodes'][role_id]['children'].append(node_id)
            glb.doc['nodes'].append({'name':socket.name,'translation':point,'extras':{'futureInteractionOnly':True}})
        variants[kind]=info
    path=ROOT/'public/models'/f'{STEM}.glb'
    path.parent.mkdir(parents=True,exist_ok=True)
    data=glb.write(path)
    if len(data)>4_500_000 or totals[0]>40_000 or totals[1]>20_000 or totals[2]>6_000:
        raise RuntimeError(f'A36 exceeds budget: {len(data)} bytes, {totals} triangles')
    source=ROOT/'scripts'/f'{STEM}.blend'
    manifest={'assetId':'A36','revision':REVISION,'author':'scripts/author-workshop-equipment.py',
              'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'editable':f'scripts/{STEM}.blend','blendSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),
              'blendBytes':source.stat().st_size,'url':f'models/{STEM}.glb','sha256':hashlib.sha256(data).hexdigest(),
              'bytes':len(data),'nodes':len(glb.doc['nodes']),'meshes':len(glb.doc['meshes']),
              'materials':1,'images':3,'atlas':{'width':WIDTH,'height':HEIGHT,'regions':8,'gutterPixels':10},
              'variants':variants,'placements':PLACEMENTS,'reservedZones':RESERVED,
              'garageEnvelope':{'min':[-6.1,.045,1.25],'max':[5.92,1.5,3.94]},
              'triangles':totals,'maxDrawCallsPerLevel':1,'sourceComponents':int(bpy.context.scene.get('A36_sourceComponents',0)),
              'visualOnly':True,'finalArtApproved':False,
              'collision':{'enabled':False,'type':'placement-validation-only'},
              'provenance':'Original parameterized Blender meshes and seeded PBR atlas. Built-in authoring lettering is converted to mesh; no font file or third-party artwork is exported.'}
    dest=ROOT/'src/rendering/workshop-equipment.manifest.json'
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(manifest,indent=2)+'\n')
    print('A36_MANIFEST',json.dumps({k:manifest[k] for k in ['revision','bytes','sha256','triangles','sourceComponents','nodes','meshes']}),flush=True)
    return manifest


def render_gallery():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1200
    scene.render.resolution_y=800
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    if scene.world is None:
        scene.world=bpy.data.worlds.new('A36_STUDIO_WORLD')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.20,.23,.25,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003))
    plane=bpy.context.object
    plane.name='STUDIO_ONLY_floor'
    material=bpy.data.materials.new('STUDIO_ONLY_floor')
    material.diffuse_color=(.055,.065,.07,1)
    plane.data.materials.append(material)
    for name,p,power,size in [('Key',(-3,-4,6),1600,5),('Fill',(4,-1,4),900,4),('Rim',(0,4,5),1400,3)]:
        data=bpy.data.lights.new('STUDIO_ONLY_'+name,'AREA')
        data.energy=power
        data.shape='DISK'
        data.size=size
        obj=bpy.data.objects.new(data.name,data)
        scene.collection.objects.link(obj)
        obj.location=p
        obj.rotation_euler=(Vector((0,0,.4))-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('STUDIO_ONLY_camera')
    camera=bpy.data.objects.new('STUDIO_ONLY_camera',data)
    scene.collection.objects.link(camera)
    camera.location=(4.3,-6.7,4.5)
    camera.rotation_euler=(Vector((0,0,.38))-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO'
    data.ortho_scale=4.9
    scene.camera=camera
    scene.render.filepath=str(ROOT/'test-results/a36-authoring/gallery.png')
    bpy.ops.render.render(write_still=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--export-only',action='store_true')
    parser.add_argument('--render',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    (ROOT/'scripts').mkdir(parents=True,exist_ok=True)
    if args.export_only:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/'scripts'/f'{STEM}.blend'))
    else:
        build()
    export_retained()
    if args.render:
        render_gallery()


if __name__=='__main__':
    main()
