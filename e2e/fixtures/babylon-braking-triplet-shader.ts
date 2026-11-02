/** Contract for actual submitted GLSL, after Babylon has selected/preprocessed
 * its ordinary branch. Raw #else/#endif anchors belong to the production CPU
 * contract, not this later stage. This does not replace actual draw/readback tests. */
export function a09SubmittedClipShader(source: string) {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  const groupedAssignments = (
    code.match(
      /\bgl_Position\s*=\s*a09OriginalProjection\s*\*\s*\(\s*a09OriginalView\s*\*\s*worldPos\s*\)\s*;/g,
    ) ?? []
  ).length;
  const positionWrites =
    (code.match(/\bgl_Position(?:\s*(?:\.\s*\w+|\[[^\]]*\]))?\s*(?:[+\-*/]?=(?!=)|\+\+|--)/g) ?? [])
      .length + (code.match(/(?:\+\+|--)\s*gl_Position\b/g) ?? []).length;
  const legacyCombinedAssignments = (
    code.match(/\bgl_Position\s*=\s*viewProjection\s*\*\s*worldPos\s*;/g) ?? []
  ).length;
  const declarations = ['a09OriginalView', 'a09OriginalProjection'].every(
    (name) =>
      (
        code.match(
          new RegExp(`\\buniform\\s+(?:(?:highp|mediump|lowp)\\s+)?mat4\\s+${name}\\s*;`, 'g'),
        ) ?? []
      ).length === 1,
  );
  const marker =
    (code.match(/^\s*#define[ \t]+ORIGINAL_A09_CLIP_ORDER[ \t]*$/gm) ?? []).length === 1 &&
    !/^\s*#(?:define[ \t]+MULTIVIEW\b|undef[ \t]+ORIGINAL_A09_CLIP_ORDER\b)/m.test(code);
  return {
    marker,
    declarations,
    groupedAssignments,
    positionWrites,
    legacyCombinedAssignments,
    ordinarySite:
      groupedAssignments === 1 && positionWrites === 1 && legacyCombinedAssignments === 0,
  };
}
