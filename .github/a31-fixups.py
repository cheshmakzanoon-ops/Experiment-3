"""A31 source round-trip repair; exact edits to the retained candidate only."""
from pathlib import Path
import hashlib,json
p=Path('scripts/author-wheel-gun.py');s=p.read_text()
changes=[
 ('import sys\nimport zlib','import sys\nimport tempfile\nimport zlib'),
 ("ARGS.add_argument('--export-only', action='store_true')", "ARGS.add_argument('--export-only', action='store_true')\nARGS.add_argument('--check-source', action='store_true')"),
 ("ATLAS = atlas_pixels()\n", """ATLAS = atlas_pixels()

if args.check_source:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'scripts/aurel-wheel-gun.blend'))
    assert bpy.context.scene.unit_settings.scale_length == 1
    assert len(bpy.data.collections['EDITABLE_A31_COMPONENTS'].objects) > 20
    for name, pixels in ATLAS.items():
        image = bpy.data.images['A31_original_' + name]
        assert image.source == 'FILE' and image.packed_file
        actual = np.asarray(image.pixels[:], dtype=np.float32)
        expected = pixels[::-1].astype(np.float32).ravel() / 255
        assert actual.shape == expected.shape
        assert np.max(np.abs(actual - expected)) < .00001, name
    print('A31_SOURCE_ROUNDTRIP_OK: editable source and all packed PBR pixels retained')
    sys.exit(0)
"""),
 ("""        image = bpy.data.images.new('A31_original_' + name, width=256, height=256, alpha=True)
        image.colorspace_settings.name = 'sRGB' if name == 'base' else 'Non-Color'
        image.pixels.foreach_set((pix[::-1].astype(np.float32) / 255).ravel())
        image.pack(data=png(pix), data_len=len(png(pix)))""", """        # A GENERATED image with arbitrary packed bytes reloads as a blank canvas.
        # Load actual PNG bytes before packing, so reopening the source retains
        # both the image source type and its pixels. No external file is needed.
        with tempfile.TemporaryDirectory(prefix='a31-surface-') as temporary:
            path = Path(temporary) / ('A31_original_' + name + '.png')
            path.write_bytes(png(pix))
            image = bpy.data.images.load(str(path), check_existing=False)
            image.name = 'A31_original_' + name
            image.colorspace_settings.name = 'sRGB' if name == 'base' else 'Non-Color'
            image.pack()
            image.filepath = '//A31_original_' + name + '.png'"""),
]
for old,new in changes:
 assert s.count(old)==1,old
 s=s.replace(old,new)
p.write_text(s)
m=Path('src/rendering/wheel-gun.manifest.json');d=json.loads(m.read_text())
assert d['sha256']=='55be98828d4d84152a2b82edf797315b2fb1ea2c3a16f09ef6a9fd457b9a1b93'
d['sourceSHA256']=hashlib.sha256(p.read_bytes()).hexdigest();m.write_text(json.dumps(d,indent=2)+'\n')
