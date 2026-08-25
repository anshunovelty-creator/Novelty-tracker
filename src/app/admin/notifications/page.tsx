// src/app/admin/notifications/page.tsx
// Folded into /admin/dispatch-notifications as the "Team recipients" tab —
// it configures one of the two audiences of that page's email, and kept its
// own nav entry only by accident of history. Left as a redirect so existing
// bookmarks and links still land in the right place.
//
// Permission is deliberately NOT re-checked here: the target page gates each
// tab on its own feature key and falls back to the first tab the department
// can see, so this cannot be used to reach anything.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function NotificationsPage() {
  redirect('/admin/dispatch-notifications?tab=team');
}
