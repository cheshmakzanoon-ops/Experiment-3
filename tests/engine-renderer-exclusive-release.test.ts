import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Kind = 'festival' | 'circuit';
type Owner = Record<string, unknown> & {
  disposed: boolean;
  outputPass: OutputPass;
  dispose(): void;
};

/** Execute the production output-pass initializer and complete disposal method.
 * Unrelated scene owners are inert boundaries; Three owns the actual sky,
 * shadow targets, pass materials and composer buffers under observation. */
function ownerCode(path: string, className: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === className,
  );
  const output = declaration?.members.find(
    (node): node is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(node) && node.name.getText(source) === 'outputPass',
  );
  const dispose = declaration?.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === 'dispose',
  );
  if (!output?.initializer || !dispose) throw new Error(`Missing ${className} resource owner`);
  return ts.transpileModule(
    `class Owner { ${output.getText(source)} ${dispose.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
}

const code: Record<Kind, string> = {
  festival: ownerCode('../src/rendering/open-world/festival-renderer.ts', 'FestivalRenderer'),
  circuit: ownerCode('../src/rendering/renderer.ts', 'RacingRenderer'),
};

const stages: Record<Kind, readonly string[]> = {
  festival: [
    'atmosphere',
    'terrain',
    'roads',
    'streetLights',
    'practicalLights',
    'buildings',
    'dressing',
    'crops',
    'details',
    'streetDetails',
    'contacts',
    'vegetation',
    'photoVegetation',
    'water',
    'markers',
    'reflection',
    'cars',
    'trails',
    'guidance',
    'orbit',
    'environment',
    'wet',
    'shadows',
    'bloom',
    'grade',
    'fxaa',
    'imagePipeline',
    'ultra',
    'photoSky',
  ],
  circuit: [
    'textures',
    'gridPreparation',
    'pitCrew',
    'gridPerformance',
    'reflection',
    'shadowProxies',
    'farShadow',
    'gpuTimer',
    'gpuFrames',
    'motionBlur',
    'exposure',
    'weatherPresentation',
    'bloom',
    'fxaa',
    'scenePass',
    'grade',
    'ultra',
    'environment',
    'photoSky',
  ],
};

function backend() {
  return {
    getPixelRatio: () => 1,
    getSize: (size: T.Vector2) => size.set(4, 4),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
}

function fixture(kind: Kind, renderer = backend()) {
  const detach = vi.fn();
  const disposeTextureLoaders = vi.fn(async () => {});
  const dependencies = {
    T,
    OutputPass,
    scannedGround: { detach },
    disposeTextureLoaders,
    disposeSceneTexture: (texture: T.Texture) => texture.dispose(),
  };
  const Constructor = new Function(...Object.keys(dependencies), `${code[kind]}; return Owner;`)(
    ...Object.values(dependencies),
  ) as new () => Owner;
  const owner = new Constructor();
  const releases = stages[kind].map((name) => [name, vi.fn()] as const);
  const sky = new Sky(),
    sun = new T.DirectionalLight();
  sun.shadow.map = new T.WebGLRenderTarget(4, 4);
  sun.shadow.mapPass = new T.WebGLRenderTarget(2, 2);
  const scene = new T.Scene().add(sky, sun);
  const composer = new EffectComposer(renderer as unknown as T.WebGLRenderer);
  composer.addPass(owner.outputPass);
  Object.assign(owner, Object.fromEntries(releases.map(([name, dispose]) => [name, { dispose }])), {
    disposed: false,
    renderer,
    scene,
    sky,
    sun,
    composer,
  });
  if (kind === 'festival') {
    Object.assign(owner, {
      vehiclePaint: [{}],
      vehicleRoots: [{}],
      effectPlayback: { reset: vi.fn() },
      effects: { group: new T.Group() },
    });
  } else {
    const inert = () => ({ dispose: vi.fn() });
    Object.assign(owner, {
      cars: [],
      bikeShells: { disposeAll: vi.fn() },
      releaseCarTemplates: inert,
      circuit: {
        disposePlanting: vi.fn(),
        secondaryStands: inert(),
        wetReflection: inert(),
        stateTexture: new T.Texture(),
        disposalMaterials: () => new Set<T.Material>(),
      },
    });
  }
  const resources = {
    skyGeometry: sky.geometry,
    skyMaterial: sky.material,
    shadowMap: sun.shadow.map,
    shadowPass: sun.shadow.mapPass,
    outputMaterial: owner.outputPass.material,
    composerRead: composer.renderTarget1,
    composerWrite: composer.renderTarget2,
    composerCopyMaterial: composer.copyPass.material,
  };
  const events = Object.fromEntries(
    Object.entries(resources).map(([name, resource]) => {
      const disposed = vi.fn();
      resource.addEventListener('dispose', disposed);
      return [name, disposed];
    }),
  );
  const outputDispose = vi.spyOn(owner.outputPass, 'dispose');
  return {
    owner,
    renderer,
    scene,
    composer,
    resources,
    events,
    outputDispose,
    releases,
    detach,
    disposeTextureLoaders,
  };
}

function expectReleased(f: ReturnType<typeof fixture>, kind: Kind) {
  expect(f.owner.disposed).toBe(true);
  for (const [name, disposed] of Object.entries(f.events))
    expect(disposed, name).toHaveBeenCalledOnce();
  for (const [name, disposed] of f.releases) expect(disposed, name).toHaveBeenCalledOnce();
  expect(f.outputDispose).toHaveBeenCalledOnce();
  expect(f.detach).toHaveBeenCalledExactlyOnceWith(f.renderer);
  expect(f.renderer.forceContextLoss).not.toHaveBeenCalled();
  if (kind === 'festival') {
    expect(f.scene.children).toEqual([]);
    expect(f.renderer.dispose).not.toHaveBeenCalled();
    expect(f.disposeTextureLoaders).not.toHaveBeenCalled();
  } else {
    expect(f.renderer.dispose).toHaveBeenCalledOnce();
    expect(f.disposeTextureLoaders).toHaveBeenCalledExactlyOnceWith(f.renderer);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('exclusive renderer resource release', () => {
  it('demonstrates that composer disposal alone leaves the registered output material live', () => {
    const renderer = backend();
    const composer = new EffectComposer(renderer as unknown as T.WebGLRenderer);
    const output = new OutputPass(),
      disposed = vi.fn();
    output.material.addEventListener('dispose', disposed);
    composer.addPass(output);
    composer.dispose();
    expect(disposed).not.toHaveBeenCalled();
    output.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it.each<Kind>(['festival', 'circuit'])('%s releases its resources only once', (kind) => {
    const f = fixture(kind);
    f.owner.dispose();
    f.owner.dispose();
    expectReleased(f, kind);
  });

  it('releases three consecutive festival regions while retaining the shared backend', () => {
    const renderer = backend();
    for (let cycle = 0; cycle < 3; cycle++) {
      const f = fixture('festival', renderer);
      f.owner.dispose();
      expectReleased(f, 'festival');
    }
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(renderer.forceContextLoss).not.toHaveBeenCalled();
  });

  it.each<Kind>(['festival', 'circuit'])(
    '%s ignores reentrant disposal from native events',
    (kind) => {
      const f = fixture(kind);
      for (const resource of Object.values(f.resources))
        resource.addEventListener('dispose', () => f.owner.dispose());
      f.owner.dispose();
      f.owner.dispose();
      expectReleased(f, kind);
    },
  );

  it.each(['skyGeometry', 'skyMaterial', 'shadowPass', 'outputMaterial'] as const)(
    'continues independent festival releases when %s throws',
    (name) => {
      const f = fixture('festival');
      const failure = new Error(`${name} listener failed`);
      f.resources[name].addEventListener('dispose', () => {
        f.owner.dispose();
        throw failure;
      });
      expect(() => f.owner.dispose()).toThrow(failure);
      expect(() => f.owner.dispose()).not.toThrow();
      expectReleased(f, 'festival');
    },
  );

  it('preserves the first thrown value while completing later independent cleanup', () => {
    const f = fixture('festival');
    f.resources.skyGeometry.addEventListener('dispose', () => {
      throw undefined;
    });
    f.resources.outputMaterial.addEventListener('dispose', () => {
      throw new Error('later failure');
    });
    let caught = false;
    try {
      f.owner.dispose();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(() => f.owner.dispose()).not.toThrow();
    expectReleased(f, 'festival');
  });

  it('still closes the circuit backend when the output material listener throws', () => {
    const f = fixture('circuit');
    const failure = new Error('output listener failed');
    f.resources.outputMaterial.addEventListener('dispose', () => {
      throw failure;
    });
    expect(() => f.owner.dispose()).toThrow(failure);
    expect(() => f.owner.dispose()).not.toThrow();
    expectReleased(f, 'circuit');
  });
});
