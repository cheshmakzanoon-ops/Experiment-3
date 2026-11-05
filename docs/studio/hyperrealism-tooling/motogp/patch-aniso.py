WT = '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68'


def edit(path, pairs):
    p = f'{WT}/{path}'
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:80], s.count(old))
        s = s.replace(old, new, 1)
    open(p, 'w').write(s)


edit('src/rendering/bike.ts', [
    ("  readonly aluminium: T.MeshStandardMaterial;", "  readonly aluminium: T.MeshPhysicalMaterial;"),
    ("  readonly forkUpper: T.MeshStandardMaterial;\n  readonly forkLower: T.MeshStandardMaterial;",
     "  readonly forkUpper: T.MeshPhysicalMaterial;\n  readonly forkLower: T.MeshPhysicalMaterial;"),
    ("""    this.aluminium = add(
      new T.MeshStandardMaterial({""", """    this.aluminium = add(
      new T.MeshPhysicalMaterial({"""),
    ("""    this.forkUpper = add(
      new T.MeshStandardMaterial({""", """    this.forkUpper = add(
      new T.MeshPhysicalMaterial({"""),
    ("""    this.forkLower = add(
      new T.MeshStandardMaterial({""", """    this.forkLower = add(
      new T.MeshPhysicalMaterial({"""),
    ("""  calibrateGpMaterials,""", """  calibrateGpMaterials,
  setGpMetalAnisotropy,"""),
    ("""        setGpOcclusionStrength(occlusion, quality === 'high');""",
     """        setGpOcclusionStrength(occlusion, quality === 'high');
        setGpMetalAnisotropy(entry.materials, quality === 'high');"""),
])

edit('src/rendering/gp-appearance.ts', [
    ("""  materials.titanium.userData.gpBareTitanium = true;""",
     """  // Brushed and turned metal (High/ULTRA, setGpMetalAnisotropy): the
  // highlight stretches across the tool marks. The brushed frame map's marks
  // run along U, a turned tube's around its circumference (U), so both
  // stretch along V: the spar length and the tube axis.
  for (const metal of [materials.aluminium, materials.forkUpper, materials.forkLower])
    metal.anisotropyRotation = Math.PI / 2;
  materials.aluminium.userData.gpAnisotropy = GP_METAL_ANISOTROPY.brushed;
  materials.forkUpper.userData.gpAnisotropy = GP_METAL_ANISOTROPY.turned;
  materials.forkLower.userData.gpAnisotropy = GP_METAL_ANISOTROPY.polished;
  materials.titanium.userData.gpBareTitanium = true;"""),
    ("""/** Temper oxide is a smooth glassy TiO2 film over burnished metal, so the""",
     """/** Anisotropy strengths of the GP machine's metals (three.js
 * KHR_materials_anisotropy): brushed frame aluminium, the hard-anodised
 * turned outer fork tubes, and the superfinished stanchions. */
export const GP_METAL_ANISOTROPY = Object.freeze({ brushed: 0.62, turned: 0.45, polished: 0.22 });
/** Switch the anisotropic lobes with the graphics tier. Crossing zero
 * recompiles once (three.js keys USE_ANISOTROPY), so this only flips when the
 * preset changes; it is idempotent per frame. */
export function setGpMetalAnisotropy(materials: BikeMaterials, enabled: boolean) {
  for (const metal of [materials.aluminium, materials.forkUpper, materials.forkLower]) {
    const strength = metal.userData.gpAnisotropy;
    if (typeof strength !== 'number') continue;
    const target = enabled ? strength : 0;
    if (metal.anisotropy !== target) metal.anisotropy = target;
  }
}
/** Temper oxide is a smooth glassy TiO2 film over burnished metal, so the"""),
])
print('ok')
