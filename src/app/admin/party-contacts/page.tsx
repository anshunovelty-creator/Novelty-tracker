// src/app/admin/party-contacts/page.tsx
// Folded into /admin/dispatch-notifications as the "Party contacts" tab —
// it configures the party-facing audience of that page's email. Left as a
// redirect so existing bookmarks and links still land in the right place.
//
// Permission is deliberately NOT re-checked here: the target page gates each
// tab on its own feature key (and keeps the view/edit split — Dispatch sees
// who will be emailed, only Admin may change it), so this cannot be used to
// reach anything.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function PartyContactsPage() {
  redirect('/admin/dispatch-notifications?tab=parties');
}
