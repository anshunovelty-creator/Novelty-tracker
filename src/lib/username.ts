// src/lib/username.ts
// ============================================================
// The username Admin gives each login: shown top-right, beside every note
// and message, and typed as @username to tag that person. Kept in the Auth
// user's metadata (user_metadata.username) — there is no members table.
//
// Lowercase letters, digits, _ and -, 3 to 20 long. No dots or spaces, so
// "@ravi." at the end of a sentence still tags "ravi" — the same word rule
// the mention matcher in notesView.ts uses.
// ============================================================

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** What was typed, as it would be stored: trimmed, lowercased, no leading @. */
export function normalizeUsername(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/^@+/, '').toLowerCase() : '';
}

/** Why a (normalized) username can't be used, or null when it can. */
export function usernameProblem(u: string): string | null {
  if (u.length < USERNAME_MIN) return `Username needs at least ${USERNAME_MIN} characters`;
  if (u.length > USERNAME_MAX) return `Username can be at most ${USERNAME_MAX} characters`;
  if (!USERNAME_RE.test(u)) return 'Use lowercase letters, numbers, _ or - (start with a letter or number)';
  return null;
}

/** Letters and digits only — how mentions compare names ("@Prepress-Team" = "prepressteam"). */
export const mentionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A valid username made from a name or an email: "Anshu Pal" → "anshu_pal",
 * "anshupal320@gmail.com" → "anshupal320", "qc@x.in" → "qc1". Used for
 * logins that predate usernames, and as the suggestion when adding someone.
 */
export function suggestUsername(source: string): string {
  const base = source
    .replace(/@.*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX)
    .replace(/_+$/, '');
  if (!base) return 'user';
  return base.length < USERNAME_MIN ? (base + '123').slice(0, USERNAME_MIN) : base;
}

/**
 * The username a login goes by: the one Admin set, else one derived from its
 * old display name, else from its email. Never empty.
 */
export function usernameOf(meta: Record<string, unknown> | null | undefined, email: string | null | undefined): string {
  const set = normalizeUsername(meta?.username);
  if (set && !usernameProblem(set)) return set;
  const name = typeof meta?.name === 'string' && meta.name.trim() ? meta.name : '';
  return suggestUsername(name || email || '');
}

/**
 * Is `u` free? Another login holding it, or a department called the same
 * (so "@qc" would be ambiguous), makes it taken. Compared the way mentions
 * compare, so "prepress_team" clashes with the "Prepress Team" department.
 */
export function usernameClash(
  u: string,
  others: readonly string[],
  departments: readonly { key: string; display_name: string }[],
): string | null {
  const k = mentionKey(u);
  if (others.some((o) => mentionKey(o) === k)) return `@${u} is already taken`;
  const d = departments.find((x) => mentionKey(x.key) === k || mentionKey(x.display_name) === k);
  if (d) return `@${u} is the ${d.display_name} department's tag — pick another`;
  return null;
}

/**
 * The first free username starting from `base`: base itself, else base2,
 * base3, … — shortened so the number still fits in USERNAME_MAX. For a
 * login added with the username left blank, where "dispatch@…" would
 * otherwise clash with the Dispatch department's tag and fail the add.
 * A username Admin typed is checked with usernameClash instead, never
 * renumbered behind their back.
 */
export function freeUsername(
  base: string,
  others: readonly string[],
  departments: readonly { key: string; display_name: string }[],
): string {
  if (!usernameClash(base, others, departments)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const stem = base.slice(0, USERNAME_MAX - suffix.length).replace(/[_-]+$/, '');
    const next = `${stem}${suffix}`;
    if (!usernameClash(next, others, departments)) return next;
  }
}
