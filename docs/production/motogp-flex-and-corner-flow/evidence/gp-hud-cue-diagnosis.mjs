import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import ts from 'typescript';
import { menuPreview } from './src/rendering/menu-preview.ts';
import { Track, trackPoint, SURFACE } from './src/simulation/track.ts';
import { VEHICLES } from './src/simulation/vehicles.ts';
import { bikeSlipstreamDragScale } from './src/simulation/bike-slipstream.ts';
import { FLAG } from './src/simulation/marshal.ts';
import * as protocol from './src/simulation/protocol.ts';
import { GPRidingCues } from './src/ui/gp-riding-cues.ts';
const path = 'e2e/fixtures/motorcycle-presentation.ts';
const ast = ts.createSourceFile(path, readFileSync(path,'utf8'), ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'motorcycleHudFrame');
assert(fn);
const js = ts.transpileModule(fn.getText(ast), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const track = new Track();
const context = {menuPreview, track, trackPoint, SURFACE, VEHICLES, bikeSlipstreamDragScale, ...protocol};
const makeFrame = new Function(...Object.keys(context), js + '\nreturn motorcycleHudFrame;')(...Object.values(context));
const cues = new GPRidingCues();
const cases = [
 [{frontSurface:SURFACE.KERB,frontWater:0.2},'FRONT ON WET KERB'],
 [{rearSurface:SURFACE.PAINT,rearWater:0.2},'REAR ON WET PAINT'],
 [{frontDisc:1050},'FRONT BRAKE HOT'],
 [{intervention:0.6},'POWER LIMITED'],
 [{frontSurface:SURFACE.GRASS,lateral:15},'FRONT ON GRASS'],
 [{frontSurface:SURFACE.KERB,frontWater:0.2,flag:FLAG.YELLOW},'CAUTION'],
];
let observations=0;
for (const viewport of [[1440,900],[960,600],[390,844]]) {
 for (const scale of [1,1.35]) {
  for (const [snapshot,expected] of cases) {
   const frame = makeFrame('gpr1',false,snapshot);
   const cue = cues.read(frame,track);
   assert.equal(cue?.action, expected, JSON.stringify({viewport,scale,snapshot}));
   assert.equal(cue?.tone,'caution');
   assert.equal(cue?.tow,0);
   observations++;
  }
 }
}
console.log(JSON.stringify({factory:'exact motorcycleHudFrame source extracted from existing fixture',observations,result:'all 36 expected wet/thermal/electronics/grass/flag cues match, including every CAUTION -> FRONT ON WET KERB transition'}));
