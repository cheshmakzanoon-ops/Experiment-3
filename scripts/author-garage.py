"""A22: original, metre-scale Aurel working garage. Run in pinned Blender 5.2.2.
No external art assets. Source objects remain editable; runtime objects are
material-batched with three authored detail levels, not one mesh per screw.
"""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aurel-garage-r01'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
source = bpy.data.collections.new('EDITABLE_GARAGE_COMPONENTS')
scene.collection.children.link(source)
runtime = bpy.data.collections.new('GAME_EXPORT')
scene.collection.children.link(runtime)
parts = []
materials = {}

def xyz(p):
    """Game X/depth, Y/up, Z/width -> Blender Z-up; glTF restores game axes."""
    return (p[0], -p[2], p[1])

def material(name, color, metal=0.0, rough=0.55, emission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    materials[name] = m
    return m

ivory = material('GARAGE_CeramicCladding', (0.64, 0.68, 0.66), 0.18, 0.43)
concrete = material('GARAGE_Concrete', (0.31, 0.33, 0.32), 0, 0.88)
steel = material('GARAGE_AnodizedSteel', (0.055, 0.078, 0.085), 0.72, 0.33)
aluminium = material('GARAGE_BrushedAlloy', (0.37, 0.43, 0.45), 0.83, 0.29)
rubber = material('GARAGE_Gaskets', (0.012, 0.018, 0.023), 0, 0.78)
teal = material('GARAGE_TeamEnamel', (0.025, 0.27, 0.25), 0.28, 0.34)
amber = material('GARAGE_SafetyAmber', (0.8, 0.39, 0.055), 0.1, 0.49)
floor = material('GARAGE_EpoxyFloor', (0.19, 0.24, 0.255), 0.08, 0.59)
glass = material('GARAGE_UpperGlazing', (0.038, 0.091, 0.12), 0.28, 0.16)
diffuser = material('GARAGE_LightDiffusers', (0.69, 0.86, 0.91), 0.0, 0.48, 0.75)
screenmat = material('GARAGE_ScreenSurface', (0.015, 0.037, 0.047), 0, 0.43, 0.25)
white = material('GARAGE_Lettering', (0.85, 0.89, 0.83), 0.02, 0.56)

# Packed original micro-surface maps, repeatable in world-scale UVs. Their mild
# amplitude preserves legibility; there is no baked light or external photograph.
import numpy as np
rng = np.random.default_rng(2201)
n = 256
noise = rng.uniform(-1, 1, (n, n)).astype(np.float32)
grain = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1)) / 3
normal = np.ones((n, n, 4), dtype=np.float32)
normal[:, :, 0] = 0.5 + (np.roll(grain, 1, 1) - grain) * 0.09
normal[:, :, 1] = 0.5 + (np.roll(grain, 1, 0) - grain) * 0.09
normal[:, :, 2] = 0.998
roughmap = np.ones((n, n, 4), dtype=np.float32)
roughmap[:, :, :3] = (0.91 + grain * 0.08)[:, :, None]
for name, pixels in [('GARAGE_original_normal', normal), ('GARAGE_original_roughness', roughmap)]:
    image = bpy.data.images.new(name, width=n, height=n, alpha=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    for m in [ivory, concrete, steel, aluminium, teal, floor]:
        nodes, links = m.node_tree.nodes, m.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'REPEAT'
        p = nodes.get('Principled BSDF')
        if 'normal' in name:
            normalnode = nodes.new('ShaderNodeNormalMap')
            normalnode.inputs['Strength'].default_value = 0.25
            links.new(tex.outputs['Color'], normalnode.inputs['Color'])
            links.new(normalnode.outputs['Normal'], p.inputs['Normal'])
        else:
            gain = nodes.new('ShaderNodeMath')
            gain.operation = 'MULTIPLY'
            gain.inputs[1].default_value = p.inputs['Roughness'].default_value
            links.new(tex.outputs['Color'], gain.inputs[0])
            links.new(gain.outputs[0], p.inputs['Roughness'])

def own(o, name, m, tier=0):
    o.name = name
    for c in list(o.users_collection):
        c.objects.unlink(o)
    source.objects.link(o)
    o.data.materials.clear()
    o.data.materials.append(m)
    o['detail_tier'] = tier
    parts.append(o)
    return o

def box(name, p, size, m, bevel=0.015, tier=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width = min(bevel, min(size) * 0.22)
        mod.segments = 2
        o.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    return own(o, name, m, tier)

def tube(name, points, radius, m, tier=1):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for v, p in zip(spline.points, points):
        v.co = (*xyz(p), 1)
    o = bpy.data.objects.new(name, curve)
    source.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    o.select_set(False)
    return own(o, name, m, tier)

def text(name, string, p, size, m=white, tier=1):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = string
    curve.size = size
    curve.align_x = 'CENTER'
    curve.extrude = 0.0007
    curve.resolution_u = 3
    o = bpy.data.objects.new(name, curve)
    source.objects.link(o)
    o.location = xyz(p)
    # Font plane normal towards the pit lane (-X); text right follows +game Z.
    o.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return own(bpy.context.object, name, m, tier)

# Structural envelope matches the existing 13 x 8.6 m bay at the fourth gap.
box('Load-bearing slab', (0, -0.75, 0), (13, 1.5, 8.6), concrete, 0.025)
box('Epoxy working floor', (0, 0.025, 0), (12.9, 0.05, 8.3), floor, 0.006)
box('Rear structural wall', (6.3, 1.84, 0), (0.4, 3.68, 8.6), concrete)
box('Acoustic ceiling', (0, 3.64, 0), (13.5, 0.25, 8.7), steel)
box('Upper occupied volume', (0, 4.97, 0), (12.9, 2.5, 8.5), concrete)
box('Roof cap with rolled lip', (0, 6.36, 0), (14, 0.18, 8.94), aluminium, 0.035)
for z in [-4.13, 4.13]:
    box('Party wall', (0, 1.85, z), (13, 3.7, 0.34), concrete)
    box('Structural portal column', (-6.48, 1.76, z), (0.25, 3.52, 0.28), steel, 0.025)
    box('Portal alloy reveal', (-6.64, 1.6, z), (0.045, 3.15, 0.19), aluminium, 0.008)
    box('Rubber skirting', (0, 0.14, z * 0.956), (12.7, 0.2, 0.045), rubber, 0.006)
    for x in [-4.8, -2.4, 0, 2.4, 4.8]:
        box('Acoustic wall cassette', (x, 2.0, z * 0.951), (2.32, 2.95, 0.055), ivory, 0.014, 1)
        box('Lower wall protection', (x, 0.48, z * 0.94), (2.31, 0.55, 0.07), teal, 0.015, 1)
    for x in [-5.8, 0.0, 5.7]:
        box('Roof steel rib', (x, 3.42, 0), (0.14, 0.22, 8.1), steel, 0.008, 1)
# Upper deck: recessed glazing retains the adjacent row silhouette.
for z in [-3.43, -2.45, -1.47, -0.49, 0.49, 1.47, 2.45, 3.43]:
    box('Recessed upper window', (-6.49, 4.84, z), (0.055, 1.55, 0.94), glass, 0.008)
    box('Mullion extrusion', (-6.56, 4.84, z + 0.49), (0.12, 1.65, 0.045), aluminium, 0.004)
box('Glazing sun visor', (-6.8, 5.73, 0), (1.02, 0.14, 8.75), ivory, 0.03)
box('Front fascia', (-6.65, 3.68, 0), (0.22, 0.9, 8.35), teal, 0.045)
box('Fascia lower reveal', (-6.78, 3.24, 0), (0.075, 0.055, 8.3), aluminium, 0.01)
text('Garage identity', 'A U R E L   /   R A C E   O P S', (-6.78, 3.58, 0), 0.23)
text('Bay number', '05', (-6.79, 3.43, 3.53), 0.47)
# Real shutter cassette and recessed guide channels, above the open passage.
box('Shutter cassette', (-6.12, 3.21, 0), (0.62, 0.52, 7.78), steel, 0.07, 1)
for y in [2.98, 3.055, 3.13, 3.205, 3.28, 3.355]:
    box('Roller shutter slat', (-6.46, y, 0), (0.055, 0.065, 7.7), aluminium, 0.008, 1)
for z in [-3.84, 3.84]:
    box('Door guide channel', (-6.25, 1.5, z), (0.15, 2.95, 0.1), steel, 0.007, 1)
    box('Guide channel shadow gap', (-6.35, 1.5, z), (0.015, 2.92, 0.038), rubber, 0, 1)
# Rear wall panel system, central service door and recessed telemetry desk.
for z in [-3.0, -1.0, 1.0, 3.0]:
    box('Rear wall cassette', (6.075, 1.95, z), (0.06, 3.15, 1.94), ivory, 0.012, 1)
box('Service door seal', (6.015, 1.18, 0), (0.045, 2.27, 1.19), rubber, 0.012, 1)
box('Service door leaf', (5.982, 1.18, 0), (0.04, 2.18, 1.1), steel, 0.012, 1)
box('Door vision panel', (5.953, 1.75, 0), (0.012, 0.42, 0.64), glass, 0.018, 1)
box('Door panic rail', (5.895, 1.08, 0), (0.07, 0.055, 0.8), aluminium, 0.015, 1)
# Long fitted workstations on either side. Recessed kick plates and split drawer fronts.
for sign in [-1, 1]:
    z = sign * 3.3
    box('Fitted cabinet carcass', (2.0, 0.59, z), (5.1, 1.08, 1.03), steel, 0.035, 1)
    box('Recessed cabinet plinth', (2.0, 0.12, z), (4.98, 0.19, 0.84), rubber, 0.012, 1)
    box('Rolled worktop', (2.0, 1.155, z), (5.22, 0.07, 1.13), aluminium, 0.025, 1)
    for x in [-0.05, 0.99, 2.03, 3.07, 4.11]:
        for y, h in [(0.3, 0.24), (0.58, 0.23), (0.845, 0.23)]:
            box('Drawer with corner radii', (x, y, z - sign * 0.533), (0.995, h, 0.028), teal, 0.009, 1)
            box('Recessed pull shadow', (x, y + h * 0.33, z - sign * 0.554), (0.64, 0.035, 0.014), rubber, 0.005, 2)
            box('Finger pull extrusion', (x, y + h * 0.38, z - sign * 0.578), (0.7, 0.018, 0.046), aluminium, 0.004, 2)
    for x in [0, 2.1, 4.2]:
        box('Overhead storage frame', (x, 2.57, sign * 3.65), (1.98, 0.87, 0.54), steel, 0.035, 1)
        box('Overhead storage face', (x, 2.57, sign * 3.36), (1.91, 0.78, 0.04), ivory, 0.024, 1)
        box('Cabinet release', (x, 2.3, sign * 3.315), (0.34, 0.025, 0.05), aluminium, 0.006, 2)
    # Cable trunking follows the wall, never cuts through the work area.
    tube('Wall utility conduit', [(-5.7, 0.6, sign * 3.95), (-5.7, 2.98, sign * 3.95),
                                (5.5, 2.98, sign * 3.95)], 0.028, aluminium)
    for x in [-2.8, -0.4, 2.0, 4.4]:
        box('Ceiling suspension bracket', (x, 3.29, sign * 2.75), (0.06, 0.35, 0.1), aluminium, 0.006, 1)
        box('Linear luminaire housing', (x, 3.04, sign * 2.75), (2.25, 0.115, 0.19), steel, 0.018, 1)
        box('Luminaire diffuser', (x, 2.978, sign * 2.75), (2.14, 0.025, 0.13), diffuser, 0.012, 1)
    for zoff in [-0.17, 0.17]:
        box('Cable tray side', (-0.4, 3.26, sign * 1.75 + zoff), (10.5, 0.11, 0.035), aluminium, 0.008, 1)
    for x in [i * 0.55 - 5.2 for i in range(19)]:
        box('Cable tray rung', (x, 3.22, sign * 1.75), (0.055, 0.03, 0.32), steel, 0.004, 2)
    tube('Contained cable loom', [(-5.3, 3.28, sign * 1.75), (4.9, 3.28, sign * 1.75),
                                (5.45, 2.99, sign * 2.0)], 0.045, rubber, 2)
# Service power panel and curved hoses on front-side utilities island.
box('Electrical enclosure', (-4.8, 1.47, 3.67), (0.86, 1.02, 0.36), steel, 0.03, 1)
box('Electrical inspection door', (-4.8, 1.47, 3.475), (0.78, 0.92, 0.025), ivory, 0.016, 1)
box('Emergency isolator plate', (-4.8, 1.55, 3.444), (0.24, 0.24, 0.035), amber, 0.025, 2)
box('Emergency isolator switch', (-4.8, 1.55, 3.402), (0.055, 0.13, 0.055), rubber, 0.013, 2)
for x in [-3.8, -3.2]:
    box('Reel mounting bracket', (x, 2.45, 3.77), (0.2, 0.4, 0.17), aluminium, 0.016, 1)
    pts = [(x + math.cos(i * math.pi / 12) * 0.22, 2.4 + math.sin(i * math.pi / 12) * 0.22, 3.59)
           for i in range(25)]
    tube('Utility hose reel', pts, 0.073, steel, 1)
    pts = [(x + math.sin(i * math.pi / 12) * 0.13, 2.25 - i * 0.045, 3.43) for i in range(27)]
    tube('Stowed service hose', pts, 0.022, rubber, 2)
# Monitor wall: separate screen slot can be rebound to a live texture by the game.
for z in [-2.62, 2.62]:
    box('Telemetry support rail', (5.79, 2.16, z), (0.16, 1.42, 1.78), steel, 0.025, 1)
    box('Monitor rounded housing', (5.64, 2.16, z), (0.18, 0.86, 1.58), rubber, 0.045, 1)
    box('Monitor active surface', (5.538, 2.16, z), (0.012, 0.76, 1.47), screenmat, 0.014, 1)
    # Status graphics are geometry on an explicitly idle display, not fabricated live telemetry.
    text('Idle telemetry status', 'AUREL  /  STANDBY', (5.523, 2.18, z), 0.084, diffuser, 2)
    for j in range(3):
        box('Idle display grid', (5.52, 1.99 + j * 0.054, z), (0.007, 0.005, 1.15), teal, 0, 2)
# Floor service lane and transverse slot drain. Middle remains unobstructed.
for z in [-2.25, 2.25]:
    box('Service lane painted edge', (-0.7, 0.052, z), (9.8, 0.003, 0.055), amber, 0, 1)
box('Threshold drain recess', (-6.08, 0.054, 0), (0.19, 0.006, 7.3), rubber, 0, 1)
for z in [i * 0.16 - 3.52 for i in range(45)]:
    box('Slot drain transverse grate', (-6.08, 0.059, z), (0.17, 0.009, 0.046), aluminium, 0.003, 2)
# Rooftop equipment follows the original building height envelope.
box('Ventilation unit', (3.0, 6.89, 0), (2.3, 0.88, 2.25), steel, 0.07)
for z in [i * 0.18 - 0.9 for i in range(11)]:
    box('Air intake louvre', (1.81, 6.89, z), (0.035, 0.65, 0.06), aluminium, 0.008, 1)
box('Vent curb', (3, 6.47, 0), (2.48, 0.18, 2.42), rubber, 0.025)
for z in [-4.1, 4.1]:
    tube('Roof downpipe', [(-6.79, 5.7, z), (-6.75, 5.45, z), (-6.75, 0.15, z)], 0.04, aluminium, 1)

# Three LODs share material slots. Editable pieces are never replaced by the
# exports; the artist can change any source component and run the script again.
root = bpy.data.objects.new('AUREL_GARAGE', None)
runtime.objects.link(root)
root['revision'] = REVISION
root['units'] = 'metres'
root['entrance_axis'] = '-X'
root['asset_id'] = 'A22'
root['finalArtApproved'] = False
root['opening_min'] = [-6.6, 0.08, -2.2]
root['opening_max'] = [5.4, 2.9, 2.2]
for level, max_tier in [(0, 2), (1, 1), (2, 0)]:
    lod = bpy.data.objects.new('GARAGE_LOD' + str(level), None)
    runtime.objects.link(lod)
    lod.parent = root
    bins = {}
    for original in parts:
        if original['detail_tier'] > max_tier:
            continue
        o = original.copy()
        o.data = original.data.copy()
        runtime.objects.link(o)
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        # UV coordinates are metre-scaled and independent of asset batching.
        uv = o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
        for polygon in o.data.polygons:
            axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
            axes = [i for i in range(3) if i != axis]
            for loop in polygon.loop_indices:
                co = o.matrix_world @ o.data.vertices[o.data.loops[loop].vertex_index].co
                uv.data[loop].uv = (co[axes[0]] / 0.7, co[axes[1]] / 0.7)
        bins.setdefault(o.data.materials[0].name, []).append(o)
    for name, objects in bins.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        batch = bpy.context.object
        batch.name = 'LOD' + str(level) + '_' + name
        batch.parent = lod
        if level > 0:
            mod = batch.modifiers.new('Coplanar face consolidation', 'DECIMATE')
            mod.decimate_type = 'DISSOLVE'
            mod.angle_limit = 0.035
            bpy.ops.object.modifier_apply(modifier=mod.name)
        # Triangulate so runtime count and export receipt refer to the same geometry.
        mod = batch.modifiers.new('Export triangles', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)

sockets = {
    'SOCKET_CAR': [-0.4, 0.05, 0],
    'SOCKET_FRONT_JACK': [-3.6, 0.06, 0],
    'SOCKET_TYRE_FL': [-2, 0.06, -1.7],
    'SOCKET_TYRE_FR': [-2, 0.06, 1.7],
    'SOCKET_TYRE_RL': [1.5, 0.06, -1.7],
    'SOCKET_TYRE_RR': [1.5, 0.06, 1.7],
    'SOCKET_ENGINEER_01': [4.2, 0.06, -2.1],
    'SOCKET_ENGINEER_02': [4.2, 0.06, 2.1],
    'SOCKET_CREW': [-4.3, 0.06, 2.3],
}
for name, position in sockets.items():
    socket = bpy.data.objects.new(name, None)
    socket.empty_display_type = 'ARROWS'
    socket.empty_display_size = 0.25
    socket.parent = root
    socket.location = xyz(position)
    socket['purpose'] = 'placement-only; does not teleport a racing vehicle'
    runtime.objects.link(socket)
# Save the source with only editable pieces visible; export selected runtime hierarchy.
source.hide_render = True
source.hide_viewport = True
bpy.ops.object.select_all(action='DESELECT')
for o in runtime.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
out = ROOT / 'public/models/aurel-hero-garage-bay.glb'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True,
                          export_yup=True, export_extras=True, export_cameras=False,
                          export_lights=False, export_animations=False, export_materials='EXPORT')
# Only LOD0 visible by default in Blender; JS controls visibility by screen size.
for o in runtime.objects:
    if o.name.startswith(('LOD1_', 'LOD2_')):
        o.hide_set(True)
        o.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'scripts/aurel-hero-garage-bay.blend'), compress=True)
raw = out.read_bytes()
json_length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_length])
accessors = doc.get('accessors', [])
counts = {}
for level in range(3):
    counts[str(level)] = sum(accessors[p['indices']]['count'] // 3
                            for node in doc['nodes'] if node.get('name', '').startswith('LOD' + str(level) + '_')
                            for p in doc['meshes'][node['mesh']]['primitives'])
receipt = {
    'revision': REVISION, 'assetId': 'A22', 'author': 'scripts/author-garage.py',
    'sourceSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'editable': 'scripts/aurel-hero-garage-bay.blend',
    'url': 'models/aurel-hero-garage-bay.glb', 'bytes': len(raw),
    'sha256': hashlib.sha256(raw).hexdigest(), 'triangles': counts,
    'materials': len(doc.get('materials', [])), 'images': len(doc.get('images', [])),
    'meshes': len(doc.get('meshes', [])), 'nodes': len(doc.get('nodes', [])),
    'bayIndex': 4, 'trackS': 106, 'lateral': 35, 'sockets': sockets,
    'maxBounds': {'min': [-7.4, -1.51, -4.48], 'max': [7.1, 7.5, 4.48]},
    'finalArtApproved': False,
}
assert counts['0'] < 100000 and counts['2'] < counts['1'] < counts['0']
assert len(raw) < 12 * 1024 * 1024
(ROOT / 'src/rendering/hero-garage.manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('GARAGE_RECEIPT ' + json.dumps(receipt))
