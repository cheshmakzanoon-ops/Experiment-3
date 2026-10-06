import type * as T from 'three';

/**
 * House shader-hook chaining for studio departments.
 *
 * Every material may already carry hooks from other systems (weather dampness,
 * local fog, point-light work, paint finish, …). A studio hook must:
 *  - call the previous `onBeforeCompile` exactly once, before its own edit,
 *  - extend `customProgramCacheKey` with `|<id>-vN` so three.js never reuses a
 *    program compiled without (or with an older version of) the edit,
 *  - be idempotent: chaining the same key twice is a no-op.
 *
 * The idempotency marker lives on the hook function itself (`studioHookKeys`),
 * not in `material.userData`: `Material.copy()` clones userData but not the
 * hook, so a userData marker would claim a clone is patched when it is not,
 * while a hook copied by reference carries its keys with it.
 */

/** The shader object three.js passes to `onBeforeCompile`. */
export type StudioShader = T.WebGLProgramParametersWithUniforms;
export type ShaderStage = 'vertex' | 'fragment';
export type StudioHookBody = (
  shader: StudioShader,
  renderer: T.WebGLRenderer,
  material: T.Material,
) => void;

type ChainedHook = T.Material['onBeforeCompile'] & { studioHookKeys?: ReadonlySet<string> };

/** `<department-or-feature>-v<N>`: lower-case words joined by hyphens, versioned. */
const HOOK_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v\d+$/;

/** Studio hook keys already chained on `material`, oldest first. */
export function studioHookKeys(material: T.Material): readonly string[] {
  return [...((material.onBeforeCompile as ChainedHook).studioHookKeys ?? [])];
}

/**
 * Chain `fn` after the material's current `onBeforeCompile`.
 * Returns false (and changes nothing) when `key` is already in the chain.
 */
export function chainShaderHook(material: T.Material, key: string, fn: StudioHookBody): boolean {
  if (!HOOK_KEY.test(key))
    throw new Error(`Studio shader hook key "${key}" must look like "<feature>-v<N>"`);
  if (typeof fn !== 'function') throw new Error(`Studio shader hook "${key}" needs a function`);
  const previous = material.onBeforeCompile as ChainedHook;
  const keys = previous.studioHookKeys;
  if (keys?.has(key)) return false;
  // A custom key installed by another system may depend on its own state, so it
  // is evaluated lazily. The prototype default returns the *current* hook's
  // source text, which after chaining would be this wrapper for every material;
  // capture the previous hook's text now so distinct chains never share a program.
  const ownKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')
    ? material.customProgramCacheKey
    : null;
  const baseKey = ownKey ? '' : previous.toString();
  const hook: ChainedHook = function (
    this: T.Material,
    shader: StudioShader,
    renderer: T.WebGLRenderer,
  ) {
    previous.call(this, shader, renderer);
    fn(shader, renderer, this);
  };
  hook.studioHookKeys = new Set([...(keys ?? []), key]);
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = function (this: T.Material) {
    return `${ownKey ? ownKey.call(this) : baseKey}|${key}`;
  };
  material.needsUpdate = true;
  return true;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A bare chunk name means its `#include <chunk>` line; anything else is literal GLSL text. */
function anchorText(chunk: string) {
  return IDENTIFIER.test(chunk) ? `#include <${chunk}>` : chunk;
}
function occurrences(source: string, text: string) {
  let count = 0;
  for (let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + text.length)) count++;
  return count;
}
function stageSource(shader: StudioShader, stage: ShaderStage) {
  return stage === 'vertex' ? shader.vertexShader : shader.fragmentShader;
}
function setStageSource(shader: StudioShader, stage: ShaderStage, source: string) {
  if (stage === 'vertex') shader.vertexShader = source;
  else shader.fragmentShader = source;
}
function resolveStage(shader: StudioShader, anchor: string, stage?: ShaderStage): ShaderStage {
  if (stage) {
    if (!stageSource(shader, stage).includes(anchor))
      throw new Error(`Shader anchor "${anchor}" is missing from the ${stage} shader`);
    return stage;
  }
  const vertex = shader.vertexShader.includes(anchor),
    fragment = shader.fragmentShader.includes(anchor);
  if (vertex && fragment)
    throw new Error(`Shader anchor "${anchor}" is in both stages; name the stage to patch`);
  if (!vertex && !fragment) throw new Error(`Shader anchor "${anchor}" is missing`);
  return vertex ? 'vertex' : 'fragment';
}
function inject(
  shader: StudioShader,
  chunk: string,
  glsl: string,
  stage: ShaderStage | undefined,
  after: boolean,
) {
  const anchor = anchorText(chunk);
  const target = resolveStage(shader, anchor, stage);
  const source = stageSource(shader, target);
  if (occurrences(source, anchor) !== 1)
    throw new Error(`Shader anchor "${anchor}" is ambiguous in the ${target} shader`);
  const patched = after ? `${anchor}\n${glsl}` : `${glsl}\n${anchor}`;
  // Idempotent: the same text at the same anchor is never inserted twice.
  if (source.includes(patched)) return target;
  setStageSource(
    shader,
    target,
    source.replace(anchor, () => patched),
  );
  return target;
}

/**
 * Insert `glsl` on the line after `chunk` (a ShaderChunk name such as
 * `lights_fragment_maps`, or literal anchor text). Throws when the anchor is
 * missing or ambiguous; omit `stage` only for anchors unique to one stage.
 * Returns the patched stage.
 */
export function injectAfter(
  shader: StudioShader,
  chunk: string,
  glsl: string,
  stage?: ShaderStage,
): ShaderStage {
  return inject(shader, chunk, glsl, stage, true);
}

/** As `injectAfter`, but on the line before the anchor. */
export function injectBefore(
  shader: StudioShader,
  chunk: string,
  glsl: string,
  stage?: ShaderStage,
): ShaderStage {
  return inject(shader, chunk, glsl, stage, false);
}
