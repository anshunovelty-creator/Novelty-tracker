// src/app/api/bom-materials/route.ts
// ============================================================
// GET /api/bom-materials — the material catalogue, for the request form's
//     typeahead. Production or Admin, the same gate as the rest of BOM.
//
// Read-only from the client's point of view: the catalogue fills itself
// from POST /api/bom-requests (see learnMaterials there), so there is no
// "add a material" step for anyone to remember or skip.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptUseBOM } from '@/lib/constants/departments';

export async function GET(_request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return NextResponse.json(
      { error: 'Bill of Material is Production and Admin only' },
      { status: 403 }
    );
  }

  // The whole catalogue in one go: this is a shop's material list, a few
  // dozen rows at most, and the form filters it client-side as you type.
  const { data, error } = await supabase
    .from('bom_materials')
    .select('*')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ materials: data ?? [] });
}
