import type { Locale } from './locales.ts';

/** ICU-lite messages: the English source text with `{name}` placeholders and plurals
 *
 *   `{n, plural, one {# lap} other {# laps}}`  (`=0 {no laps}` exact matches also work)
 *
 * `#` inside a plural branch is the number, formatted for the language. Plural categories
 * come from Intl.PluralRules, so Polish gets `few` and `many` for free. A message without
 * a brace is returned as is. Literal braces do not occur in source text. */
export type Params = Readonly<Record<string, string | number>>;
type Part = string | { param: string } | { plural: string; branches: Map<string, Part[]> };

const compiled = new Map<string, Part[]>();

/** Parse text up to the closing brace of the enclosing branch (or the end). */
function parse(source: string, from: number, nested: boolean): { parts: Part[]; end: number } {
  const parts: Part[] = [];
  let text = '';
  let i = from;
  const flush = () => {
    if (text) parts.push(text);
    text = '';
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '}' && nested) {
      flush();
      return { parts, end: i + 1 };
    }
    if (c !== '{') {
      text += c;
      i++;
      continue;
    }
    // A placeholder: {name} or {name, plural, ...}.
    flush();
    let j = i + 1;
    while (j < source.length && source[j] !== '}' && source[j] !== ',') j++;
    const name = source.slice(i + 1, j).trim();
    if (!/^[A-Za-z_][\w.]*$/.test(name)) throw new Error(`Bad placeholder name in "${source}"`);
    if (source[j] === '}') {
      parts.push({ param: name });
      i = j + 1;
      continue;
    }
    const kind = /^,\s*plural\s*,/.exec(source.slice(j));
    if (!kind) throw new Error(`Unsupported placeholder type in "${source}"`);
    let k = j + kind[0].length;
    const branches = new Map<string, Part[]>();
    for (;;) {
      while (k < source.length && /\s/.test(source[k])) k++;
      if (source[k] === '}') {
        k++;
        break;
      }
      const m = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(source.slice(k));
      if (!m) throw new Error(`Bad plural branch in "${source}"`);
      const body = parse(source, k + m[0].length, true);
      branches.set(m[1], body.parts);
      k = body.end;
    }
    if (!branches.has('other')) throw new Error(`Plural without "other" in "${source}"`);
    parts.push({ plural: name, branches });
    i = k;
  }
  if (nested) throw new Error(`Unbalanced braces in "${source}"`);
  flush();
  return { parts, end: i };
}

export function compile(source: string): Part[] {
  let parts = compiled.get(source);
  if (!parts) {
    parts = parse(source, 0, false).parts;
    compiled.set(source, parts);
  }
  return parts;
}

/** Placeholders and plural variables a message uses (for the dictionary check). */
export function placeholders(source: string): { params: string[]; plurals: string[] } {
  const params = new Set<string>(),
    plurals = new Set<string>();
  const walk = (parts: Part[]) => {
    for (const part of parts) {
      if (typeof part === 'string') continue;
      if ('param' in part) params.add(part.param);
      else {
        plurals.add(part.plural);
        params.add(part.plural);
        for (const branch of part.branches.values()) walk(branch);
      }
    }
  };
  walk(compile(source));
  return { params: [...params].sort(), plurals: [...plurals].sort() };
}

/** Plural branches each plural placeholder of a message provides. */
export function pluralBranches(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const walk = (parts: Part[]) => {
    for (const part of parts)
      if (typeof part !== 'string' && 'plural' in part) {
        const set = result.get(part.plural) ?? new Set<string>();
        for (const [key, branch] of part.branches) {
          set.add(key);
          walk(branch);
        }
        result.set(part.plural, set);
      }
  };
  walk(compile(source));
  return result;
}

const rules = new Map<string, Intl.PluralRules>();
const pluralRules = (locale: Locale) => {
  let r = rules.get(locale);
  if (!r) rules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
};
const numbers = new Map<string, Intl.NumberFormat>();
const numberFormat = (locale: Locale) => {
  let f = numbers.get(locale);
  if (!f) numbers.set(locale, (f = new Intl.NumberFormat(locale)));
  return f;
};

/** Plural categories that counts 0..1000 can reach in a language. A translation must give
 * a branch for each (English and German: one, other; Polish: one, few, many, other). The
 * rare French, Spanish, Italian and Portuguese `many` (a million and up) falls back to
 * `other`, so it is not required here. */
export function requiredCategories(locale: Locale): string[] {
  const rule = pluralRules(locale);
  const set = new Set<string>(['other']);
  for (let n = 0; n <= 1000; n++) set.add(rule.select(n));
  return [...set].sort();
}

export type Escaper = (text: string) => string;

/** Fill a message. `escape` is applied to the literal text of the message, never to the
 * parameters (callers pass already-escaped HTML or numbers), so the HTML variants of
 * t() can be dropped into templates. */
export function format(
  source: string,
  params: Params | undefined,
  locale: Locale,
  escape?: Escaper,
): string {
  const parts = compile(source);
  if (parts.length === 0) return '';
  if (parts.length === 1 && typeof parts[0] === 'string') return escape ? escape(parts[0]) : parts[0];
  return render(parts, params, locale, escape, null);
}

function render(
  parts: Part[],
  params: Params | undefined,
  locale: Locale,
  escape: Escaper | undefined,
  hash: string | null,
): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      // `#` is the plural number only inside a branch.
      if (hash !== null && part.includes('#'))
        out += part
          .split('#')
          .map((p) => (escape ? escape(p) : p))
          .join(hash);
      else out += escape ? escape(part) : part;
    } else if ('param' in part) {
      const value = params?.[part.param];
      out += value === undefined ? `{${part.param}}` : String(value);
    } else {
      const raw = params?.[part.plural];
      const n = typeof raw === 'number' ? raw : Number(raw);
      const branch =
        part.branches.get(`=${n}`) ??
        part.branches.get(pluralRules(locale).select(n)) ??
        part.branches.get('other')!;
      out += render(branch, params, locale, escape, numberFormat(locale).format(n));
    }
  }
  return out;
}
