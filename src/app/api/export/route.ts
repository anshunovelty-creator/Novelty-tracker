// src/app/api/export/route.ts
// ============================================================
// GET /api/export — one-click data export for the admin panel.
// Returns a ZIP of jobs.csv, dispatch-schedules.csv and print-runs.csv.
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { buildExportFiles } from '@/lib/export/adminExport';
import { createZip } from '@/lib/export/zip';

// zlib and Buffer — this cannot run on the edge runtime.
export const runtime = 'nodejs';
// Always a fresh dump; never serve a cached archive.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  // Admin only. This is a full dump of every job, party and remark — the
  // floor departments see their own pipeline, not the whole book of work.
  // Enforced here, not just by hiding the button: the route is reachable
  // directly by anyone with a session cookie.
  if (dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Admin can export data' },
      { status: 403 }
    );
  }

  try {
    // Service-role read: the export is a deliberate full dump, so it must
    // not be narrowed by the caller's row-level visibility.
    const { files, counts } = await buildExportFiles(createAdminClient());

    const now      = new Date();
    const istDay   = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const filename = `novelty-labels-export-${istDay}.zip`;
    const zip      = createZip(files, now);

    console.log(
      `[GET /api/export] ${dept} exported ${counts.jobs} jobs, ` +
      `${counts.schedules} releases, ${counts.runs} runs (${zip.length} bytes)`
    );

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(zip.length),
        'Cache-Control':       'no-store',
        // Lets the browser read the filename off the response when the
        // download is triggered from fetch() rather than a plain link.
        'X-Export-Filename':   filename,
        'Access-Control-Expose-Headers': 'X-Export-Filename',
      },
    });
  } catch (err) {
    console.error('[GET /api/export]', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
