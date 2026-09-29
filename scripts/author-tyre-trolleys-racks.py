"""A35: original metre-scale tyre trolley / garage rack, Blender 5.2.2.

Run from the repository root:
  blender -b --factory-startup --python scripts/author-tyre-trolleys-racks.py
Optional: append -- --render /absolute/path/a35.png for a source preview.
The preview is not an in-game acceptance image. Only A35 outputs are written.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-a35-r01'
RADIUS = 0.335  # Existing tire-profile.ts: preserve silhouette, not live simulation state.
HALF_WIDTHS = {'FRONT': 0.15, 'REAR': 0.20}
RAIL_X, RAIL_RADIUS = 0.25, 0.022
RAIL_HEIGHTS = (0.285, 1.025)
CENTRE_LIFT = math.sqrt((RADIUS + RAIL_RADIUS) ** 2 - RAIL_X ** 2)
SLOT_Z = (-0.60, -0.265, 0.12, 0.555)
SLOT_TYPES = ('front', 'front', 'rear', 'rear')
OUT = ROOT / 'public/models/aurel-tyre-trolleys-racks.glb'
SOURCE = ROOT / 'scripts/aurel-tyre-trolleys-racks.blend'
MANIFEST = ROOT / 'src/rendering/tyre-trolleys-racks.manifest.json'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
source = bpy.data.collections.new('EDITABLE_A35_COMPONENTS')
export = bpy.data.collections.new('A35_GAME_EXPORT')
preview = bpy.data.collections.new('A35_PREVIEW_NOT_EXPORTED')
for collection in (source, export, preview):
    scene.collection.children.link(collection)


def xyz(p):
    """Game right-handed +X/right,+Y/up,+Z/long axis -> Blender Z-up."""
    return (p[0], -p[2], p[1])


def material(name, color, metal=0.0, rough=0.5):
    m = bpy.data.materials.new('A35_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m


paint = material('PowderCoat', (0.015, 0.20, 0.175), 0.12, 0.43)
alloy = material('SatinAlloy', (0.36, 0.41, 0.44), 0.92, 0.33)
dark = material('GraphiteMetal', (0.027, 0.037, 0.045), 0.75, 0.40)
rubber = material('Rubber', (0.016, 0.021, 0.024), 0.0, 0.77)
mark = material('IvoryMarkings', (0.80, 0.85, 0.79), 0.0, 0.56)
amber = material('SafetyAmber', (0.91, 0.39, 0.025), 0.0, 0.58)
materials = [paint, alloy, dark, rubber, mark, amber]

# Original, deterministic, packed micro-surface maps. No downloaded textures.
n = 256
rng = np.random.default_rng(3501)
grain = rng.random((n, n)).astype(np.float32)
normal = np.ones((n, n, 4), dtype=np.float32)
dx = (np.roll(grain, 1, 1) - grain) * .055
dy = (np.roll(grain, 1, 0) - grain) * .055
normal[:, :, 0] = .5 + dx * .5
normal[:, :, 1] = .5 + dy * .5
normal[:, :, 2] = .5 + np.sqrt(1 - dx * dx - dy * dy) * .5
roughness = np.ones((n, n, 4), dtype=np.float32)
roughness[:, :, :3] = (.90 + .10 * grain[:, :, None])
for name, pixels, kind in [('MicroNormal', normal, 'normal'), ('ContactRoughness', roughness, 'rough')]:
    image = bpy.data.images.new('A35_Original_' + name, width=n, height=n, alpha=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    for m in [paint, alloy, dark, rubber]:
        nodes, links = m.node_tree.nodes, m.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        if kind == 'normal':
            norm = nodes.new('ShaderNodeNormalMap')
            norm.inputs['Strength'].default_value = .23 if m == rubber else .12
            links.new(tex.outputs['Color'], norm.inputs['Color'])
            links.new(norm.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
        else:
            # Bake roughness values per material via a multiplier the glTF exporter supports.
            mul = nodes.new('ShaderNodeMath')
            mul.operation = 'MULTIPLY'
            mul.inputs[1].default_value = nodes.get('Principled BSDF').inputs['Roughness'].default_value
            links.new(tex.outputs['Color'], mul.inputs[0])
            links.new(mul.outputs[0], nodes.get('Principled BSDF').inputs['Roughness'])

parts = []
current = ''


def own(o, name, m, tier=0, role='frame'):
    o.name = f'A35_{current}_{name}'
    for c in list(o.users_collection):
        c.objects.unlink(o)
    source.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(m)
    o['assetId'], o['asset_role'], o['detail_tier'] = 'A35', role, tier
    o['variant'] = current
    parts.append(o)
    return o


def bevel(o, width=.004, segments=2):
    mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
    mod.width, mod.segments = width, segments
    o.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    return o


def box(name, p, size, m=paint, radius=.004, tier=0, role='frame'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel(o, min(radius, min(size) * .3))
    return own(o, name, m, tier, role)


def rod(name, a, b, radius, m=alloy, tier=0, segments=16, role='frame'):
    av, bv = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius, depth=(bv - av).length,
                                      location=(av + bv) / 2)
    o = bpy.context.object
    o.rotation_euler = (bv - av).to_track_quat('Z', 'Y').to_euler()
    for polygon in o.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    o['cylinder_radius'], o['cylinder_depth'], o['radial_segments'] = radius, (bv - av).length, segments
    return own(o, name, m, tier, role)


def path(name, points, radius, m=alloy, tier=1, role='retainer'):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth, curve.bevel_resolution = radius, 1
    sp = curve.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for v, p in zip(sp.points, points):
        v.co = (*xyz(p), 1)
    o = bpy.data.objects.new(name, curve)
    source.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, m, tier, role)


def ring(name, p, radius, thickness, m=alloy, tier=1, axis='Y', role='hardware'):
    points = []
    for i in range(25):
        t = i * math.tau / 24
        if axis == 'Y':
            delta = (radius * math.cos(t), 0, radius * math.sin(t))
        elif axis == 'Z':
            delta = (radius * math.cos(t), radius * math.sin(t), 0)
        else:
            delta = (0, radius * math.sin(t), radius * math.cos(t))
        points.append(tuple(p[j] + delta[j] for j in range(3)))
    return path(name, points, thickness, m, tier, role)


def text(name, body, p, size, facing='X', m=mark, tier=2):
    c = bpy.data.curves.new(name, 'FONT')
    c.body, c.size, c.align_x, c.align_y = body, size, 'CENTER', 'CENTER'
    c.extrude, c.resolution_u = .00025, 2
    o = bpy.data.objects.new(name, c)
    source.objects.link(o)
    o.location = xyz(p)
    # Local text normal +Z -> selected game surface normal.
    o.rotation_euler = (math.pi / 2, 0, math.pi / 2 if facing == 'X' else 0)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, m, tier, 'marking')


def bolt(name, p, axis='Y', tier=2):
    d = {'X': (.007, 0, 0), 'Y': (0, .007, 0), 'Z': (0, 0, .007)}[axis]
    rod(name, p, tuple(p[j] + d[j] for j in range(3)), .009, alloy, tier, 6, 'hardware')


def castor(index, x, z, swivel):
    start = len(parts)
    box(f'Castor{index}_Mount', (x, .194, z), (.112, .015, .094), alloy, .007, 0, 'caster')
    rod(f'Castor{index}_Bearing', (x, .166, z), (x, .19, z), .039, dark, 0, 20, 'caster')
    ring(f'Castor{index}_Race', (x, .179, z), .040, .004, alloy, 1)
    wheel_z = z - .024 if swivel else z
    for side in [-1, 1]:
        box(f'Castor{index}_Fork', (x + side * .030, .112, wheel_z + .012),
            (.013, .095, .052), alloy, .011, 0, 'caster')
    rod(f'Castor{index}_Tyre', (x - .025, .068, wheel_z), (x + .025, .068, wheel_z),
        .068, rubber, 0, 28, 'caster')
    rod(f'Castor{index}_Hub', (x - .030, .068, wheel_z), (x + .030, .068, wheel_z),
        .027, dark, 1, 16, 'caster')
    rod(f'Castor{index}_Axle', (x - .043, .068, wheel_z), (x + .043, .068, wheel_z),
        .009, alloy, 1, 8, 'caster')
    if swivel:
        lever = box(f'Castor{index}_BrakePedal', (x, .13, wheel_z - .069),
                    (.066, .014, .080), amber, .004, 1, 'brake')
        lever.rotation_euler.x = .23
        box(f'Castor{index}_BrakeLink', (x, .119, wheel_z - .036),
            (.032, .037, .023), dark, .002, 1, 'brake')
        for dz in [-.02, 0, .02]:
            box(f'Castor{index}_GripRib', (x, .14, wheel_z - .070 + dz),
                (.052, .003, .006), rubber, .001, 2, 'brake')
    for dx in [-.038, .038]:
        for dz in [-.031, .031]:
            bolt(f'Castor{index}_PlateBolt', (x + dx, .203, z + dz))
    # Stable parked angles; no non-deterministic physics or invisible animation.
    angle = (.15 if x > 0 else -.20) if swivel else 0
    if angle:
        from mathutils import Matrix
        p = Vector(xyz((x, 0, z)))
        transform = Matrix.Translation(p) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation(-p)
        # Mount stays fixed, the yoke/wheel/brake rotates below the bearing.
        for o in parts[start + 3:]:
            if 'PlateBolt' not in o.name:
                o.matrix_world = transform @ o.matrix_world


def structure(variant):
    global current
    current = variant
    # Open frame and U-shaped end assemblies: no opaque boxes hiding missing mechanics.
    for x in [-.34, .34]:
        box('LowerSill', (x, .225, 0), (.055, .050, 1.81), paint)
        for z in [-.87, .87]:
            box('Upright', (x, .94, z), (.044, 1.40, .044), paint)
            box('TubeEndCap', (x, 1.647, z), (.045, .016, .045), rubber, .005, 1, 'hardware')
            for y in [.255, 1.03]:
                # Folded receiver plates and gussets are separate readable parts.
                box('ReceiverPlate', (x, y, z), (.012, .13, .115), alloy, .003, 1)
                bolt('ReceiverBolt', (x + .008, y + .035, z), 'X')
            for y in [.72, .81, .90, 1.12, 1.21]:
                # Recessed black hole bottoms, not costly high-sided boolean cuts.
                rod('AdjustmentRecess', (x - .023, y, z), (x + .023, y, z),
                    .005, rubber, 2, 8, 'hardware')
    for z in [-.87, .87]:
        box('BaseCrossmember', (0, .225, z), (.73, .05, .055), paint)
        rod('TopEndRail', (-.34, 1.62, z), (.34, 1.62, z), .022, paint, 0, 20)
        # A compact brace on the end face leaves both long loading faces open.
        rod('EndDiagonal', (-.31, .28, z), (.31, .91, z), .013, dark, 1, 12)
        for y in RAIL_HEIGHTS:
            rod('CrossTie', (-.34, y, z), (.34, y, z), .02, paint)
            for x in [-RAIL_X, RAIL_X]:
                ring('RailCollar', (x, y, z), .028, .006, dark, 1, 'Z')
        # Pins close each end; tyres can leave via the long sides without lifting over a top rail.
        for y in [.61, 1.35]:
            rod('RemovableRetainer', (-.36, y, z), (.36, y, z), .011, alloy, 0, 12, 'retainer')
            ring('PinPullRing', (.382, y, z), .025, .003, alloy, 1, 'X', 'retainer')
            box('RetainerLatch', (-.36, y, z), (.022, .057, .045), dark, .003, 1, 'retainer')
        if variant == 'TROLLEY':
            # Curved push handle stands clear of the wheel sidewall and retaining bar.
            pts = [(-.30, 1.02, z), (-.30, 1.10, z * 1.17), (-.25, 1.16, z * 1.19),
                   (.25, 1.16, z * 1.19), (.30, 1.10, z * 1.17), (.30, 1.02, z)]
            path('PushHandle', pts, .019, alloy, 0, 'handle')
            rod('HandleGrip', (-.20, 1.16, z * 1.19), (.20, 1.16, z * 1.19),
                .023, rubber, 1, 20, 'handle')
    for y in RAIL_HEIGHTS:
        for x in [-RAIL_X, RAIL_X]:
            rod('TyreSupportRail', (x, y, -.87), (x, y, .87), RAIL_RADIUS, alloy, 0, 24)
            # Restrained contact wear: narrow satin sleeves, no random grunge.
            for z in [-.61, -.25, .14, .56]:
                rod('ContactSleeve', (x, y, z - .075), (x, y, z + .075), .0224, dark, 2, 16, 'hardware')
    for i, (x, z) in enumerate([(-.34, -.78), (.34, -.78), (-.34, .78), (.34, .78)]):
        if variant == 'TROLLEY':
            castor(i + 1, x, z, z < 0)
        else:
            rod('LevellingStem', (x, .040, z), (x, .205, z), .016, alloy, 0, 16, 'foot')
            rod('LevellingFoot', (x, .000, z), (x, .040, z), .059, rubber, 0, 24, 'foot')
            rod('AdjustmentNut', (x, .154, z), (x, .170, z), .026, alloy, 1, 6, 'hardware')
            box('FootBracket', (x, .194, z), (.09, .019, .09), dark, .004, 1)
    for x in [-.372, .372]:
        box('IdentityPanel', (x, .79, 0), (.017, .125, .46), dark, .006, 1, 'marking')
        if x > 0:
            text('Identity', 'AUREL / TYRE OPS', (x + .010, .808, 0), .034)
            text('SetLabel', 'RACK 35   |   2 SETS', (x + .010, .764, 0), .018)
        for z in [-.185, .185]:
            bolt('LabelRivet', (x + .010, .79, z), 'X')
    # Stored webbing on one end, with buckle and thin layered folds.
    for offset in range(3):
        box('StowedWebbing', (.30, 1.46 - offset * .035, .90 + offset * .004),
            (.05, .10, .008), rubber, .002, 1, 'retainer')
    box('StrapBuckle', (.30, 1.50, .91), (.059, .033, .014), alloy, .003, 1, 'retainer')
    for z in [-.82, .82]:
        box('SafetyEdge', (.374, .235, z), (.004, .022, .08), amber, .001, 1, 'marking')


def lathe(name, profile, segments, m, tier=0):
    """Game Z-axis lathe with proper circumferential UV seam and tyre/rim openings."""
    verts, faces, uvcoords = [], [], []
    for i in range(segments + 1):
        theta = math.tau * i / segments
        for j, (r, z) in enumerate(profile):
            verts.append(xyz((r * math.cos(theta), r * math.sin(theta), z)))
            uvcoords.append((i / segments, j / (len(profile) - 1)))
    width = len(profile)
    for i in range(segments):
        for j in range(width - 1):
            a = i * width + j
            faces.append((a, a + width, a + width + 1, a + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for polygon in me.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            uv.data[loop].uv = uvcoords[me.loops[loop].vertex_index]
    o = bpy.data.objects.new(name, me)
    source.objects.link(o)
    return own(o, name, m, tier, 'wheel')


def wheel(kind, level):
    global current
    current = f'{kind}_LOD{level}'
    h = HALF_WIDTHS[kind]
    seg = [40, 16, 8][level]
    profile = [(.245, -h), (.306, -h), (.331, -h + .025), (.335, -h + .065),
               (.335, h - .065), (.331, h - .025), (.306, h), (.245, h), (.245, -h)]
    if level == 2:
        profile = [(.245, -h), (.306, -h), (.335, -h + .06), (.335, h - .06), (.306, h), (.245, h), (.245, -h)]
    lathe('TyreCarcass', profile, seg, rubber)
    rim_profile = [(.236, -h + .009), (.245, -h + .009), (.247, -h + .025),
                   (.231, -h + .045), (.227, h - .038), (.245, h - .02),
                   (.245, h - .006), (.236, h - .006), (.213, h - .04),
                   (.213, -h + .04), (.236, -h + .009)]
    if level == 2:
        rim_profile = [(.218, -h + .035), (.245, -h + .01), (.245, h - .01), (.218, h - .035), (.218, -h + .035)]
    lathe('RimBarrel', rim_profile, seg, dark)
    # Centre-lock opening is a real annulus, not a solid cylinder.
    lathe('CentreLock', [(.040, -h + .035), (.074, -h + .035), (.076, -h + .065),
                         (.04, -h + .065), (.04, -h + .035)], [24, 16, 6][level], alloy)
    for i in range(10 if level < 2 else 5):
        a = math.tau * i / (10 if level < 2 else 5)
        p0 = (.068 * math.cos(a), .068 * math.sin(a), -h + .063)
        p1 = (.224 * math.cos(a + .08), .224 * math.sin(a + .08), -h + .040)
        rod('WheelSpoke', p0, p1, .015 if level < 2 else .023, dark, 0, 6, 'wheel')
    if level == 0:
        rod('Valve', (.202, 0, -h + .015), (.202, 0, -h - .004), .006, alloy, 1, 8, 'wheel')
    # Readable original compound bars, intentionally not a real tyre brand.
    if level < 2:
        for a in [-.65, .60]:
            points = [xyz((r * math.cos(t), r * math.sin(t), -h - .001))
                      for t in np.linspace(a, a + .43, 11) for r in [.271, .283]]
            me = bpy.data.meshes.new('CompoundBar')
            me.from_pydata(points, [], [(i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1) for i in range(10)])
            me.update()
            obj = bpy.data.objects.new('CompoundBar', me)
            source.objects.link(obj)
            own(obj, 'CompoundBar', amber, 0, 'wheel')


structure('TROLLEY')
structure('RACK')
for k in HALF_WIDTHS:
    for level in range(3):
        wheel(k, level)

root = bpy.data.objects.new('A35_ASSET', None)
export.objects.link(root)
root['assetId'], root['revision'], root['units'] = 'A35', REVISION, 'metres'
root['finalArtApproved'] = False
root['visualOnly'] = True
stats, template_nodes = {}, {}


def batch(name, originals, level, cutoff):
    parent = bpy.data.objects.new(name, None)
    export.objects.link(parent)
    parent.parent = root
    parent['assetId'], parent['lod'] = 'A35', level
    bins = {}
    for original in originals:
        if original['detail_tier'] > cutoff:
            continue
        obj = original.copy()
        obj.data = original.data.copy()
        export.objects.link(obj)
        if level > 0 and 'cylinder_radius' in original:
            count = min(int(original['radial_segments']), 12 if level == 1 else 8)
            r, depth = original['cylinder_radius'], original['cylinder_depth']
            verts = [(r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count), z)
                     for z in [-depth / 2, depth / 2] for i in range(count)]
            faces = [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
            faces += [tuple(reversed(range(count))), tuple(range(count, count * 2))]
            me = bpy.data.meshes.new(obj.name + '_ReducedCylinder')
            me.from_pydata(verts, [], faces)
            me.materials.append(original.data.materials[0])
            me.update()
            for face in me.polygons:
                face.use_smooth = len(face.vertices) == 4
            obj.data = me
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == 'BEVEL':
                if level == 2:
                    obj.modifiers.remove(mod)
                    continue
                mod.segments = 1 if level == 1 else 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if not obj.data.uv_layers:
            uv = obj.data.uv_layers.new(name='UVMap')
            for face in obj.data.polygons:
                axis = max(range(3), key=lambda i: abs(face.normal[i]))
                axes = [i for i in range(3) if i != axis]
                for loop in face.loop_indices:
                    p = obj.matrix_world @ obj.data.vertices[obj.data.loops[loop].vertex_index].co
                    uv.data[loop].uv = (p[axes[0]] / .16, p[axes[1]] / .16)
        # Preserve smooth normals for tubes while flat faces keep manufacturing edges.
        bins.setdefault(obj.data.materials[0].name, []).append(obj)
    for matname, objects in sorted(bins.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name + '_' + matname
        # All templates use an identity origin. Positions are baked, never scaled to fit.
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        mod = obj.modifiers.new('Stable export triangles', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.parent = parent
        obj['assetId'], obj['lod'] = 'A35', level
    return parent


for variant in ('TROLLEY', 'RACK'):
    originals = [p for p in parts if p['variant'] == variant]
    for level, cutoff in [(0, 2), (1, 1), (2, 0)]:
        name = f'A35_{variant}_LOD{level}'
        template_nodes[name] = batch(name, originals, level, cutoff)
for kind in HALF_WIDTHS:
    for level in range(3):
        name = f'A35_{kind}_LOD{level}'
        originals = [p for p in parts if p['variant'] == f'{kind}_LOD{level}']
        template_nodes[name] = batch(name, originals, level, 2)

sockets = {}
for tier, rail in enumerate(RAIL_HEIGHTS):
    for j, z in enumerate(SLOT_Z):
        name = f'A35_SOCKET_{"LOWER" if tier == 0 else "UPPER"}_{j + 1:02d}'
        p = [0, rail + CENTRE_LIFT, z]
        o = bpy.data.objects.new(name, None)
        export.objects.link(o)
        o.parent, o.location = root, xyz(p)
        o['asset_role'], o['wheelType'], o['slotIndex'] = 'socket', SLOT_TYPES[j], tier * 4 + j
        sockets[name] = {'position': p, 'wheelType': SLOT_TYPES[j], 'slotIndex': tier * 4 + j}
for i, (x, z) in enumerate([(-.34, -.78), (.34, -.78), (-.34, .78), (.34, .78)]):
    o = bpy.data.objects.new(f'A35_CASTER_PIVOT_{i + 1:02d}', None)
    export.objects.link(o)
    o.parent, o.location = root, xyz((x, .18, z))
    o['asset_role'], o['braked'] = 'caster_pivot', i < 2
for side in [-1, 1]:
    o = bpy.data.objects.new(f'A35_PUSH_HAND_{"L" if side < 0 else "R"}', None)
    export.objects.link(o)
    o.parent, o.location = root, xyz((side * .18, 1.16, -1.0353))
    o['asset_role'] = 'hand_socket'

source.hide_render = True
source.hide_viewport = True
bpy.ops.object.select_all(action='DESELECT')
for o in export.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', use_selection=True,
                         export_yup=True, export_extras=True, export_cameras=False,
                         export_lights=False, export_animations=False, export_materials='EXPORT')
raw = OUT.read_bytes()
size = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + size])
byname = {n.get('name'): n for n in doc['nodes']}
for name in template_nodes:
    nodes = [n for n in doc['nodes'] if n.get('name', '').startswith(name + '_')]
    stats[name] = {'triangles': sum(doc['accessors'][p['indices']]['count'] // 3
                    for n in nodes for p in doc['meshes'][n['mesh']]['primitives']),
                   'primitives': sum(len(doc['meshes'][n['mesh']]['primitives']) for n in nodes)}
receipt = {'assetId': 'A35', 'revision': REVISION, 'author': str(Path(__file__).relative_to(ROOT)),
           'sourceSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
           'editable': str(SOURCE.relative_to(ROOT)), 'url': 'models/' + OUT.name,
           'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
           'materials': len(doc.get('materials', [])), 'images': len(doc.get('images', [])),
           'meshes': len(doc['meshes']), 'nodes': len(doc['nodes']), 'templates': stats,
           'sockets': sockets, 'tyreRadius': RADIUS, 'halfWidths': HALF_WIDTHS,
           'railRadius': RAIL_RADIUS, 'railX': RAIL_X, 'railHeights': list(RAIL_HEIGHTS),
           'maxBounds': {'min': [-.45, -.005, -1.08], 'max': [.45, 1.67, 1.08]},
           'casterCount': 4, 'brakedCasterCount': 2, 'capacity': 8,
           'sourceComponents': len(parts), 'visualOnly': True, 'finalArtApproved': False,
           'collision': {'enabled': False, 'type': 'placement-envelope-only'},
           'provenance': 'Original mesh, converted Blender built-in lettering and seeded micro maps. No third-party art. Tyre dimensions follow repository tire-profile.ts.'}
MANIFEST.parent.mkdir(parents=True, exist_ok=True)
MANIFEST.write_text(json.dumps(receipt, indent=2) + '\n')
assert len(raw) < 6 * 1024 * 1024, len(raw)
for variant in ('TROLLEY', 'RACK'):
    for level, ceiling in enumerate((38000, 16000, 3500)):
        full = stats[f'A35_{variant}_LOD{level}']['triangles']
        full += 4 * stats[f'A35_FRONT_LOD{level}']['triangles'] + 4 * stats[f'A35_REAR_LOD{level}']['triangles']
        assert full <= ceiling, (variant, level, full, ceiling)

# A clean editable presentation scene: shared templates, not duplicate export geometry.
export.hide_render = True
export.hide_viewport = True
for index, (variant, occupied) in enumerate([('TROLLEY', [0, 1, 2, 3]), ('RACK', list(range(8)))]):
    shift = Vector((index * 1.55 - .775, 0, 0))
    for template, location in [(template_nodes[f'A35_{variant}_LOD0'], Vector((0, 0, 0)))] + [
        (template_nodes[f'A35_{s["wheelType"].upper()}_LOD0'], Vector(xyz(s['position'])))
        for s in sockets.values() if s['slotIndex'] in occupied
    ]:
        for original in template.children:
            obj = original.copy()
            preview.objects.link(obj)
            obj.parent = None
            obj.location += shift + location
            obj.name = 'PREVIEW_' + obj.name
            obj.hide_set(False)
            obj.hide_render = False
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.world = bpy.data.worlds.new('A35_PreviewWorld')
scene.world.color = (.18, .18, .18)
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1600, 1100, 100
scene.view_settings.view_transform = 'AgX'
# Ground / lighting exist only in the non-exported preview collection.
bpy.ops.mesh.primitive_plane_add(size=200)
ground = bpy.context.object
for c in list(ground.users_collection):
    c.objects.unlink(ground)
preview.objects.link(ground)
ground.name = 'PREVIEW_Ground'
ground.data.materials.append(material('PreviewGround', (.13, .15, .16), 0, .8))
for name, location, energy, size in [('Key', (1, -4, 6), 1500, 5), ('Fill', (-4, -1, 4), 950, 4),
                                      ('Rim', (2, 4, 5), 1900, 3)]:
    data = bpy.data.lights.new('PREVIEW_' + name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', size
    obj = bpy.data.objects.new('PREVIEW_' + name, data)
    preview.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, .9)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
data = bpy.data.cameras.new('PREVIEW_Camera')
camera = bpy.data.objects.new('PREVIEW_Camera', data)
preview.objects.link(camera)
camera.location = (4.1, -5.4, 3.1)
camera.rotation_euler = (Vector((0, 0, .8)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
data.lens = 52
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
receipt['blendSHA256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
receipt['blendBytes'] = SOURCE.stat().st_size
MANIFEST.write_text(json.dumps(receipt, indent=2) + '\n')
print('A35_RECEIPT ' + json.dumps(receipt))
args = argparse.ArgumentParser()
args.add_argument('--render')
opt = args.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if opt.render:
    scene.cycles.samples = 12
    scene.render.resolution_percentage = 50
    scene.render.filepath = opt.render
    bpy.ops.render.render(write_still=True)
