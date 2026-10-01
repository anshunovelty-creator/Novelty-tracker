// src/lib/search.ts
// Builds PostgREST ilike filters from raw user search text.
//
// Interpolating a search box straight into `.or('col.ilike.%${q}%,...')`
// breaks on ordinary input: a comma or parenthesis ("ABC, Ltd",
// "Labels (Pvt)") is PostgREST filter syntax, so the request fails with a
// parse error instead of returning matches. `%` and `_` also silently act as
// LIKE wildcards. These helpers escape both layers.

/** Escape LIKE's own wildcards so they match literally. */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&');
}

/** `%q%` for a single-column `.ilike(column, pattern)` call. */
export function containsPattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

/**
 * Patterns for a size (a die's length or width) — matched on the whole
 * millimetre, ignoring anything after the decimal point, so 210 and 210.84
 * are the same size whichever one is typed. "210" finds "210", "210.84" and
 * "210.5", but not "1210" or "2100". Text that isn't a number falls back to
 * matching the whole value.
 */
export function sizePatterns(q: string): string[] {
  const m = /^0*(\d+)(?:\.\d*)?$/.exec(q.trim());
  if (!m) return [escapeLike(q.trim())];
  return [m[1], `${m[1]}.%`];
}

/** Double-quoted for `.or(...)`, so commas and parentheses inside it are
 *  data, not syntax; PostgREST unescapes `\"` and `\\` inside quotes. */
function quote(pattern: string): string {
  return `"${pattern.replace(/["\\]/g, '\\$&')}"`;
}

/** `col1.ilike."%q%",col2.ilike."%q%"` for `.or(...)`. */
export function orContains(columns: readonly string[], q: string): string {
  return orMatch(columns, [], q);
}

/** Contains-match on `contains` columns and size-match (see sizePatterns)
 *  on `sizes` ones, OR'd together for one `.or(...)`. */
export function orMatch(contains: readonly string[], sizes: readonly string[], q: string): string {
  const c = quote(containsPattern(q));
  const s = sizePatterns(q).map(quote);
  return [
    ...contains.map((col) => `${col}.ilike.${c}`),
    ...sizes.flatMap((col) => s.map((p) => `${col}.ilike.${p}`)),
  ].join(',');
}
