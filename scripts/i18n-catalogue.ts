/**
 * The English catalogue: every string the interface can show in another language, found
 * in the source rather than kept in a second list.
 *
 *  - Literals passed to t(), th(), ta() or marked with N_() anywhere under src/ (read with the
 *    TypeScript parser, so quoting, line breaks and escapes are exact). The text is its own key.
 *  - Id-keyed data: achievement names and descriptions, Wildcard titles and pitches, machine
 *    character lines. Their keys are `achievement.<id>.name`, `wildcard.<id>.title`, `machine.<id>`
 *    (src/i18n/data.ts), read from the data tables themselves.
 *
 * Used by scripts/i18n-check.ts (the dictionary gate) and scripts/i18n-extract.ts (the
 * translator's worklist).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface Entry {
  key: string;
  /** English source text. */
  source: string;
  /** Where it comes from, for the translator's context (a file, or the data table). */
  from: string[];
}

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = [join(ROOT, 'src/i18n/dict')];
const CALLEES = new Set(['t', 'th', 'ta', 'N_']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (SKIP.includes(path)) return [];
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** The value of a string literal, a template literal without substitutions, or a `+` of those. */
function literal(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = literal(node.left),
      b = literal(node.right);
    return a !== null && b !== null ? a + b : null;
  }
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  return null;
}

/** Strings in the code, in file order. */
export function scanSource(): Entry[] {
  const found = new Map<string, Entry>();
  for (const file of walk(join(ROOT, 'src')).sort()) {
    const text = readFileSync(file, 'utf8');
    if (!/\b(?:t|th|ta|N_)\(/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const rel = relative(ROOT, file);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        CALLEES.has(node.expression.text) &&
        node.arguments.length >= 1
      ) {
        const value = literal(node.arguments[0]);
        if (value !== null) {
          const entry = found.get(value) ?? { key: value, source: value, from: [] };
          if (!entry.from.includes(rel)) entry.from.push(rel);
          found.set(value, entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...found.values()];
}

/** Strings that belong to data tables with ids. */
export async function keyedData(): Promise<Entry[]> {
  const { ACHIEVEMENTS } = await import('../src/steam/achievements.ts');
  const { WILDCARD_SERIES } = await import('../src/career/wildcard-series.ts');
  const { MACHINE_CHARACTER } = await import('../src/ui/machine-character.ts');
  const out: Entry[] = [];
  for (const a of ACHIEVEMENTS) {
    out.push({ key: `achievement.${a.id}.name`, source: a.name, from: ['src/steam/achievements.ts'] });
    out.push({
      key: `achievement.${a.id}.description`,
      source: a.description,
      from: ['src/steam/achievements.ts'],
    });
  }
  for (const e of WILDCARD_SERIES) {
    out.push({ key: `wildcard.${e.id}.title`, source: e.title, from: ['src/career/wildcard-series.ts'] });
    out.push({ key: `wildcard.${e.id}.pitch`, source: e.pitch, from: ['src/career/wildcard-series.ts'] });
  }
  for (const [id, line] of Object.entries(MACHINE_CHARACTER))
    out.push({ key: `machine.${id}`, source: line, from: ['src/ui/machine-character.ts'] });
  return out;
}

/** The whole catalogue: code strings first (by file), then the data tables. */
export async function catalogue(): Promise<Entry[]> {
  return [...scanSource(), ...(await keyedData())];
}
