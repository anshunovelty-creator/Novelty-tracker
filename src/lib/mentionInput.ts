// src/lib/mentionInput.ts
// ============================================================
// The @ popup in note and message boxes: which word is being typed after an
// @, which people and departments match it, and the text after one is
// picked. Pure, so MentionTextarea and its tests share the rules.
// ============================================================

export type MentionOption = {
  /** What gets inserted after the trigger (@ or #). */
  handle: string;
  /** A second line: the person's department, "Department", or a job's party. */
  hint: string;
  kind: 'person' | 'department' | 'job';
};

/** What follows each trigger: @usernames, or #job references like AUG26-1 or 3370/A. */
export type Trigger = '@' | '#';
const TOKEN: Record<Trigger, string> = { '@': 'A-Za-z0-9_-', '#': 'A-Za-z0-9./_-' };

/**
 * The @word the caret is in, if any: { start } is where the @ sits and
 * { query } what follows it so far. An @ inside a word ("qc@x.in") does not
 * open the popup — the same rule the matcher in notesView.ts applies.
 */
export function mentionQuery(text: string, caret: number, trigger: Trigger = '@'): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  // "&" is excluded before # so an HTML-ish "&#39;" never opens the job list.
  const lead = trigger === '#' ? '[^A-Za-z0-9&]' : '[^A-Za-z0-9]';
  const m = before.match(new RegExp(`(?:^|${lead})\\${trigger}([${TOKEN[trigger]}]*)$`));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Replace the @word (or #word) at [start, caret) with "@handle " and say where the caret goes. */
export function applyMention(
  text: string, start: number, caret: number, handle: string, trigger: Trigger = '@',
): { text: string; caret: number } {
  const after = text.slice(caret).replace(new RegExp(`^[${TOKEN[trigger]}]*`), '');
  const spaced = after.startsWith(' ');
  const insert = `${trigger}${handle}${spaced ? '' : ' '}`;
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length + (spaced ? 1 : 0) };
}

/**
 * People first, then departments; within each, handles starting with the
 * query before ones merely containing it (or whose hint does). At most `limit`.
 */
export function rankOptions(options: readonly MentionOption[], query: string, limit = 6): MentionOption[] {
  const q = query.toLowerCase();
  const score = (o: MentionOption) => {
    const h = o.handle.toLowerCase();
    const hit = !q || h.startsWith(q) ? 0 : h.includes(q) || o.hint.toLowerCase().includes(q) ? 1 : -1;
    return hit < 0 ? -1 : (o.kind === 'person' ? 0 : 2) + hit;
  };
  return options
    .map((o) => ({ o, s: score(o) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.o.handle.localeCompare(b.o.handle))
    .slice(0, limit)
    .map((x) => x.o);
}

/** Split text into plain runs and @tags, so a renderer can highlight the tags. */
export function splitMentions(text: string): { text: string; tag: boolean }[] {
  const out: { text: string; tag: boolean }[] = [];
  const re = /(^|[^A-Za-z0-9])(@[A-Za-z0-9][A-Za-z0-9_-]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = m.index + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at), tag: false });
    out.push({ text: m[2], tag: true });
    last = at + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), tag: false });
  return out;
}
