from pathlib import Path
import hashlib,shutil
p=Path('scripts/author-overhead-garage-service-rig.py')
s=p.read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='9017a155b7f0d207ab1522473ab33951971f294ba5bdbae0ee6fcdaa65b69f53'
s=s.replace("    z=s*3.55\n    box('Reel_back_guard'", "    begin=len(parts)\n    rise=.65 if s<0 else 0\n    z=s*3.55\n    for y in [1.5,2.3]:\n        box('Reel_wall_standoff',(x,y,s*3.835),(.41,.10,.26),alloy,.006,1)\n    box('Reel_back_guard'")
s=s.replace("tube('Reel_supply',[(x,2.64,s*3.43),(x,2.91,s*3.6),(x+.14,3.25,s*3.77)],.023,mat,1)", "tube('Reel_supply',[(x,2.64+rise,s*3.43),(x,min(2.91+rise,3.42),s*3.6),\n                        (x+.14,3.25,s*3.77)],.023,mat,1)")
s=s.replace('# Four-port air regulator station located beside (not over) the vehicle corridor.', """    # A35 occupies the left-wall floor slots. Keep the entire power station above
    # its audited 1.72 m parked envelope, while the supply still meets the header.
    if rise:
        for part in parts[begin:]:
            if part['component']!='Reel_supply':
                part.location.z += rise
        sockets['SOCKET_A26_REEL_'+str(idx+1)][1] += rise
        sockets['SOCKET_A26_'+kind+'_DROP'][1] += rise
# Four-port air regulator station located beside (not over) the vehicle corridor.""")
s=s.replace('source.hide_render=True\nsource.hide_viewport=True\n', """# Artist-facing pivots are centred on each component. Runtime batches were copied
# already and keep identity transforms; source curves remain independently editable.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY',center='BOUNDS')
source.hide_render=True
source.hide_viewport=True
""")
assert hashlib.sha256(s.encode()).hexdigest()=='abd41d051685869ae2b0e5311a46e83881c2f47b417ad3d11725e6895d7d3b82'
p.write_text(s)
p=Path('tests/overhead-garage-service-rig.test.ts')
s=p.read_text()
case="  it('clears all three concurrently integrated A35 parked-equipment envelopes', async () => {\n    // A35 placement contract inspected at a5f420a88e42fced894dae3f92ffbcad1541333c.\n    // Bounding volumes are conservative: a pass guarantees no trolley/rig mesh collision.\n    const placements = [\n      { p: [-2.2, 0.05, -3.35], yaw: Math.PI / 2 },\n      { p: [-4.7, 0.05, -3.35], yaw: Math.PI / 2 },\n      { p: [5.5, 0.05, -2.45], yaw: 0 },\n    ];\n    const volumes = placements.map(({ p, yaw }) =>\n      new T.Box3(new T.Vector3(-0.45, -0.005, -1.08), new T.Vector3(0.45, 1.67, 1.08)).applyMatrix4(\n        new T.Matrix4().compose(\n          new T.Vector3().fromArray(p),\n          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw),\n          new T.Vector3(1, 1, 1),\n        ),\n      ),\n    );\n    const rig = await decode();\n    try {\n      const triangle = new T.Triangle();\n      for (const level of rig.levels)\n        level.traverse((object) => {\n          if (!(object instanceof T.Mesh)) return;\n          const geometry = object.geometry,\n            positions = geometry.getAttribute('position'),\n            ix = geometry.index!;\n          for (let i = 0; i < ix.count; i += 3) {\n            triangle.a.fromBufferAttribute(positions, ix.getX(i)).applyMatrix4(object.matrixWorld);\n            triangle.b\n              .fromBufferAttribute(positions, ix.getX(i + 1))\n              .applyMatrix4(object.matrixWorld);\n            triangle.c\n              .fromBufferAttribute(positions, ix.getX(i + 2))\n              .applyMatrix4(object.matrixWorld);\n            for (const volume of volumes) expect(volume.intersectsTriangle(triangle)).toBe(false);\n          }\n        });\n    } finally {\n      rig.dispose();\n    }\n  });\n"
s=s.replace("  it('rejects a negative scale or translated rig before attachment'",case+"  it('rejects a negative scale or translated rig before attachment'")
assert hashlib.sha256(s.encode()).hexdigest()=='48b42e6c6e8269a5b21e848fce0f8dda1fe821d68f5b23d98c45df6591a016ac'
p.write_text(s)
shutil.copyfile('.github/a26-reviewed-authoring.yml','.github/workflows/a26-authoring.yml')
