// src/app/api/bom-requests/route.ts
// ============================================================
// GET  /api/bom-requests — the material requisitions, newest first, each
//      with its line items attached. Production or Admin.
//      ?status=open|all|<status>  — 'open' (default) hides finished ones
//      ?count=pending             — returns { pending: n } only, for the
//                                   nav badge; skips fetching any rows.
// POST /api/bom-requests — raise a request (header + at least one line).
//      Production or Admin.
//
// Read is gated as tightly as write here, same as /api/register: what the
// floor is asking to buy, and what the owner approved, is not shop-wide
// information. RLS on bom_requests/bom_request_items enforces the same rule
// a second time, so a missed check here still returns nothing.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptUseBOM } from '@/lib/constants/departments';

// Statuses that still want someone's attention — the default list view.
const OPEN_STATUSES = ['pending', 'in_review'] as const;

const ALL_STATUSES = [
  'pending', 'in_review', 'ordered', 'partially_fulfilled', 'rejected', 'cancelled',
] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resolves the caller and rejects anyone who isn't Production or Admin.
 * Both verbs on this route gate identically — raising a request and reading
 * the list are the same privilege.
 */
async function requireBomAccess() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) {
    return {
      error: NextResponse.json(
        { error: 'Bill of Material is Production and Admin only' },
        { status: 403 }
      ),
    } as const;
  }

  return { user, perms: perms!, supabase } as const;
}

export async function GET(request: NextRequest) {
  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  // Badge path: the header polls this on every admin page, so it must not
  // drag the whole list (and its items) across the wire just to show "3".
  if (request.nextUrl.searchParams.get('count') === 'pending') {
    const { count, error } = await gate.supabase
      .from('bom_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pending: count ?? 0 });
  }

  const statusParam = request.nextUrl.searchParams.get('status') ?? 'open';
  const search = (request.nextUrl.searchParams.get('search') ?? '').trim();

  let query = gate.supabase
    .from('bom_requests')
    .select('*, items:bom_request_items(*)')
    .order('created_at', { ascending: false })
    // Lines come back in the order they were typed, not insert-race order.
    .order('position', { referencedTable: 'bom_request_items', ascending: true });

  if (statusParam === 'open') {
    query = query.in('status', OPEN_STATUSES as unknown as string[]);
  } else if ((ALL_STATUSES as readonly string[]).includes(statusParam)) {
    query = query.eq('status', statusParam);
  }
  // Anything else (including 'all') falls through unfiltered.

  if (search) {
    // "Which requisition had the metallic poly on it?" is the question this
    // answers, so the material name has to be searchable — but it lives on
    // the child table, and PostgREST can't OR across a join. Resolve the
    // matching request ids first, then widen the header search with them.
    // Characters with meaning inside an or() clause are stripped rather
    // than escaped: this is a search box, not an expression language.
    const escaped = search.replace(/[%,()]/g, ' ');

    const { data: itemMatches, error: itemError } = await gate.supabase
      .from('bom_request_items')
      .select('request_id')
      .ilike('material', `%${escaped}%`);

    if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });

    // Array.from, not spread: the project's TS target predates
    // downlevelIteration, so spreading a Set is a compile error here.
    const ids = Array.from(new Set((itemMatches ?? []).map((row) => row.request_id)));

    const clauses = [
      `ref.ilike.%${escaped}%`,
      `job_po.ilike.%${escaped}%`,
      `party.ilike.%${escaped}%`,
      `note.ilike.%${escaped}%`,
    ];
    if (ids.length > 0) clauses.push(`id.in.(${ids.join(',')})`);

    query = query.or(clauses.join(','));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireBomAccess();
  if ('error' in gate) return gate.error;

  const body = await request.json();

  // A requisition with no materials on it is not a requisition. Validate the
  // lines before inserting the header so we never leave an empty orphan.
  const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        position:      index + 1,
        material:      text(item.material),
        specification: text(item.specification),
        size:          text(item.size),
        quantity:      decimal(item.quantity),
        unit:          text(item.unit),
        note:          text(item.note),
      };
    })
    // A line with no material name is a blank row on the form, not a request.
    .filter((item) => item.material !== null);

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one material to the request' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: created, error: headerError } = await admin
    .from('bom_requests')
    .insert({
      job_po:    text(body.job_po),
      party:     text(body.party),
      needed_by: text(body.needed_by),
      priority:  body.priority === 'urgent' ? 'urgent' : 'normal',
      note:      text(body.note),
      raised_by_department: gate.perms.key,
      raised_by: gate.user.email ?? gate.perms.key,
    })
    .select()
    .single();

  if (headerError) {
    return NextResponse.json({ error: headerError.message }, { status: 500 });
  }

  const { data: savedItems, error: itemsError } = await admin
    .from('bom_request_items')
    .insert(items.map((item) => ({ ...item, request_id: created.id })))
    .select();

  // PostgREST has no transaction across two calls, so if the lines fail we
  // roll the header back by hand rather than leaving a materialless request
  // sitting in the owner's queue.
  if (itemsError) {
    const { error: rollbackError } = await admin
      .from('bom_requests')
      .delete()
      .eq('id', created.id);
    if (rollbackError) {
      console.error('bom_requests rollback failed:', rollbackError, 'orphan id:', created.id);
    }
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // Grow the catalogue from what was actually asked for. Deliberately after
  // the request is safely saved and never allowed to fail the call: a
  // requisition must not be rejected because a lookup table misbehaved.
  await learnMaterials(items, gate.user.email ?? gate.perms.key);

  return NextResponse.json(
    { request: { ...created, items: savedItems ?? [] } },
    { status: 201 }
  );
}

/**
 * Adds any material name the catalogue has not seen before, so the
 * typeahead fills itself out of real usage instead of needing curation.
 *
 * Existing entries are left alone — the first spelling of a material stays
 * its spelling, which is the entire point of having the table. The unique
 * constraint on name_key is the real guard; the pre-check just avoids
 * writing rows we know are already there.
 */
async function learnMaterials(
  items: { material: string | null; specification: string | null; size: string | null; unit: string | null }[],
  actor: string,
): Promise<void> {
  try {
    const admin = createAdminClient();

    // Deduplicate by name_key within this one request, so a form listing the
    // same material twice doesn't try to insert it twice.
    const names = Array.from(new Map(
      items
        .filter((item): item is typeof item & { material: string } => item.material !== null)
        .map((item) => [item.material.trim().toLowerCase(), item] as const)
    ).values());
    if (names.length === 0) return;

    const { data: existing, error: lookupError } = await admin
      .from('bom_materials')
      .select('name_key')
      .in('name_key', names.map((item) => item.material.trim().toLowerCase()));

    if (lookupError) {
      console.error('bom_materials lookup failed:', lookupError);
      return;
    }

    const known = new Set((existing ?? []).map((row) => row.name_key));
    const fresh = names.filter((item) => !known.has(item.material.trim().toLowerCase()));
    if (fresh.length === 0) return;

    const { error: insertError } = await admin.from('bom_materials').insert(
      fresh.map((item) => ({
        name:          item.material.trim(),
        specification: item.specification,
        default_size:  item.size,
        default_unit:  item.unit,
        created_by:    actor,
      }))
    );

    // 23505 = unique violation: another request added the same material
    // between the lookup and the insert. That is the constraint doing its
    // job, not a failure.
    if (insertError && insertError.code !== '23505') {
      console.error('bom_materials insert failed:', insertError);
    }
  } catch (error) {
    console.error('learnMaterials threw:', error);
  }
}
