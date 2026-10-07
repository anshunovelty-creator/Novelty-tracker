// src/app/api/shade-cards/route.ts
// ============================================================
// GET  /api/shade-cards  — the shade card list (any authenticated user)
// POST /api/shade-cards  — add a card (Prepress, QC or Admin)
// ============================================================
// Migrated from the standalone Shade Card Tracker, which drove these through
// Next server actions. Rewritten as route handlers because that is how every
// other list in this app talks to the client (react-query + /api/*), and a
// second convention for one section would be the only one of its kind.

import { NextRequest, NextResponse } from 'next/server';
import { allPages } from '@/lib/api/allPages';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageShadeCards } from '@/lib/constants/departments';
import {
  SHADE_CARD_PAGE_SIZE,
  SHADE_CARD_SEARCH_COLUMNS,
  searchColumnFor,
  isSelectableStatus,
  isMakingStatus,
} from '@/lib/constants/shadeCards';
import { deptKeyOf } from '@/lib/identity';

/** Most cards one CSV export returns. */
const EXPORT_MAX = 10_000;

/** Columns the list may be ordered by — same reasoning as SEARCH_FIELDS. */
const SORTABLE = new Set([
  'updated_at', 'prepared_date', 'approval_date', 'status',
  'product_name', 'shade_card_number', 'pm_code', 'making_status',
]);

/** Strip the characters that carry meaning inside a PostgREST or() filter.
 *  Without this a party name containing a comma silently splits the filter
 *  into two clauses and the search returns nonsense. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()*]/g, ' ').trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/** An ISO date (YYYY-MM-DD) or null. Anything unparseable becomes null rather
 *  than reaching Postgres and erroring out mid-insert. */
function optionalDate(value: unknown): string | null {
  const s = optionalText(value);
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** Who made the change, for the card's "Updated by". The login's email —
 *  never a name from user_metadata, which the user can rewrite themself and
 *  would let them sign someone else's name to a change (migration 076). */
function actorName(user: { email?: string }): string {
  return user.email || 'Unknown';
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim() ?? '';
  const field  = searchParams.get('field')?.trim() ?? '';
  const status = searchParams.get('status')?.trim() ?? '';
  const making = searchParams.get('making')?.trim() ?? '';
  const from   = searchParams.get('from')?.trim() ?? '';
  const to     = searchParams.get('to')?.trim() ?? '';

  // Entry date, not prepared date — `from`/`to` above filter prepared_date,
  // which is the business date on the card and is NULL on many imported rows.
  // This one backs the "Added last 7 days" KPI, so it has to count the same
  // column that KPI counts. Unparseable values are dropped rather than passed
  // to Postgres, which would fail the whole list with a 500.
  const createdFromRaw = searchParams.get('created_from')?.trim() ?? '';
  const createdFrom = createdFromRaw && !Number.isNaN(Date.parse(createdFromRaw))
    ? createdFromRaw
    : '';

  const sortParam = searchParams.get('sort')?.trim() ?? '';
  const sort = SORTABLE.has(sortParam) ? sortParam : 'updated_at';
  const ascending = searchParams.get('dir') === 'asc';

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const offset = (page - 1) * SHADE_CARD_PAGE_SIZE;

  // Superseded rows are history: the list only ever shows the live version of
  // each card. The older versions stay reachable from the card's own page.
  // Built fresh per request so the export below can page through it.
  const filtered = (countRows: boolean) => {
    let query = supabase
      .from('shade_cards')
      .select('*', countRows ? { count: 'exact' } : undefined)
      .eq('is_current', true);

    const clean = sanitizeSearch(search);
    if (clean) {
      // searchColumnFor resolves against a fixed list, so the column can never
      // be a raw string from the query string — an unknown ?field= widens to
      // the multi-column search rather than erroring or matching nothing.
      const column = searchColumnFor(field);
      if (column) {
        query = query.ilike(column, `%${clean}%`);
      } else {
        query = query.or(SHADE_CARD_SEARCH_COLUMNS.map((f) => `${f}.ilike.%${clean}%`).join(','));
      }
    }
    // Validated against the same lists the UI offers, so an unknown value
    // narrows to nothing rather than being passed through to Postgres.
    if (status && isSelectableStatus(status)) query = query.eq('status', status);
    if (making && isMakingStatus(making))     query = query.eq('making_status', making);
    if (from) query = query.gte('prepared_date', from);
    if (to)   query = query.lte('prepared_date', to);
    if (createdFrom) query = query.gte('created_at', createdFrom);
    return query.order(sort, { ascending, nullsFirst: false });
  };

  // ?export=1 — every card matching the filters, not one screen's page, for
  // the CSV download. Same filters and order; id last so paging never skips
  // or repeats a card. Capped well above today's ~3,000 cards.
  if (searchParams.get('export') === '1') {
    try {
      const cards = await allPages((lo, hi) => filtered(false).order('id', { ascending: true }).range(lo, hi));
      return NextResponse.json({ cards: cards.slice(0, EXPORT_MAX), truncated: cards.length > EXPORT_MAX });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { data, error, count } = await filtered(true)
    .range(offset, offset + SHADE_CARD_PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    cards:    data ?? [],
    total:    count ?? 0,
    page,
    pageSize: SHADE_CARD_PAGE_SIZE,
  });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });
  if (!canDeptManageShadeCards(perms)) {
    return NextResponse.json({ error: 'Your department cannot add shade cards' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const party        = optionalText(body.party);
  const product_name = optionalText(body.product_name);
  if (!party)        return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  if (!product_name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });

  const name = actorName(user);

  // A new card defaults to "Pending Approval"; the form may set another
  // selectable status when the party has already responded. The insert
  // trigger records whichever it is as the first status-history entry.
  const { data, error } = await supabase
    .from('shade_cards')
    .insert({
      party,
      product_name,
      pm_code:            optionalText(body.pm_code),
      shade_card_number:  optionalText(body.shade_card_number),
      docket_number:      optionalText(body.docket_number),
      making_status:      isMakingStatus(body.making_status) ? body.making_status : 'Pending',
      prepared_date:      optionalDate(body.prepared_date),
      approval_date:      optionalDate(body.approval_date),
      sent_to_party_date: optionalDate(body.sent_to_party_date),
      received_back_date: optionalDate(body.received_back_date),
      qnap_path:          optionalText(body.qnap_path),
      notes:              optionalText(body.notes),
      status:             isSelectableStatus(body.status) ? body.status : 'Pending Approval',
      version:            1,
      is_current:         true,
      created_by:         user.id,
      created_by_name:    name,
      updated_by:         user.id,
      updated_by_name:    name,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ card: data }, { status: 201 });
}
