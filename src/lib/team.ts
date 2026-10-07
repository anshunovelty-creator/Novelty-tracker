// src/lib/team.ts
// Small helpers for the Team page and its API: the display name kept in an
// Auth user's metadata, initials for the avatar, and "signed in 4 min ago".
// Supabase only records the last sign-in, not activity, so the wording says
// "signed in" — never "active", which it can't know.

/** A trimmed display name of at most 60 characters, or null. */
export function cleanName(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null;
}

/** Two letters for the avatar: "Prepress Team" → "PT", "qc@x.in" → "QC". */
export function initials(label: string): string {
  const words = label.replace(/@.*/, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** "Signed in just now", "… 12 min ago", "… 3 h ago", "… 4 days ago", or "Never signed in". */
export function signedInWords(iso: string | null, now: Date = new Date()): { text: string; recent: boolean } {
  if (!iso) return { text: 'Never signed in', recent: false };
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  const recent = mins < 24 * 60;
  if (mins < 2)        return { text: 'Signed in just now', recent };
  if (mins < 60)       return { text: `Signed in ${mins} min ago`, recent };
  if (mins < 24 * 60)  return { text: `Signed in ${Math.floor(mins / 60)} h ago`, recent };
  const days = Math.floor(mins / (24 * 60));
  if (days < 60)       return { text: `Signed in ${days} day${days === 1 ? '' : 's'} ago`, recent };
  return { text: `Signed in ${Math.floor(days / 30)} months ago`, recent };
}
