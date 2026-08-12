# Flow

How execution actually travels for each user-visible action — file, function, and
order, traced from the real code (not from what the architecture implies it should
do). Line numbers are correct as of 2026-08-12; re-check them if the referenced file
has since changed shape.

This complements [DECISIONS.md](./DECISIONS.md): that file says *why* a path is
shaped the way it is, this one says *what actually runs, in what order*. Update the
"Currently touching" section at the bottom whenever you're mid-change — that's the
part meant to be edited most often; the traced flows below only need a revisit when
the call chain itself changes.

Traced module: **Bill of Material (BOM)**, the only feature with request/response
flows non-obvious enough to be worth this treatment right now.

---

## Module map

```
src/app/admin/bom/page.tsx                              server component, access gate
src/components/admin/BomManager.tsx                     client component, all BOM UI + fetches
src/components/admin/AdminHeader.tsx                     nav badge (separate mount, own poll)
src/lib/constants/departments.ts                         canDeptUseBOM / canDeptDecideBOM (shared gate logic)
src/app/api/bom-requests/route.ts                         GET (list/badge/search), POST (raise)
src/app/api/bom-requests/[id]/route.ts                    PATCH (withdraw/reopen), DELETE
src/app/api/bom-requests/[id]/items/[itemId]/route.ts     PATCH (decide one line)
src/app/api/bom-materials/route.ts                        GET (catalogue, read-only)
supabase/migrations/031_bom_requests.sql                  bom_requests, bom_request_items, rollup trigger
supabase/migrations/032_bom_materials.sql                 bom_materials, generated name_key, seed
```

Every server route re-derives its own auth/department gate independently — nothing
is shared middleware. `requireBomAccess()` is duplicated (not imported across) in
`bom-requests/route.ts` and `bom-requests/[id]/route.ts`; the item-decision route
inlines the same three lines again rather than calling either. That's three copies
of the same check, not one shared helper — worth knowing before assuming a change to
one automatically covers the others.

---

## Flow 1 — Opening `/admin/bom`

```
browser → GET /admin/bom
  page.tsx                                                     (server component)
    createServerSupabaseClient()          [lib/supabase/server.ts]
    supabase.auth.getUser()                                    — no user → redirect('/login')
    parseDepartment(user.user_metadata.department)   [departments.ts:199]
    canDeptUseBOM(dept)                               [departments.ts:153]  — false → redirect('/admin')
    canDecide = canDeptDecideBOM(dept)                [departments.ts:165]
    renders <BomManager canDecide={canDecide} />                — client boundary; canDecide is the
                                                                    only thing crossing server→client
```

`canDecide` is computed once, server-side, and never re-checked client-side against
a live session — if department changed mid-session the client would still show
Admin controls until next page load. Every write those controls trigger is re-gated
server-side anyway (Flow 5, Flow 6), so this is a UI-only staleness, not a security
gap.

---

## Flow 2 — Initial list load (fires on every mount)

```
BomManager mounts, state: filter='open', search=''
  useEffect [BomManager.tsx:190]                — search is empty, debounce = 0ms
    load()                                [BomManager.tsx:171]
      URLSearchParams{ status: filter }            — no `search` param yet
      fetch GET /api/bom-requests?status=open
        route.ts GET                      [bom-requests/route.ts:64]
          requireBomAccess()              [route.ts:44]        — 401/403 short-circuit, else {user,dept,supabase}
          request.nextUrl...('count')                          — not 'pending', skip badge branch
          statusParam='open' → query.in('status', OPEN_STATUSES)   ['pending','in_review']
          search='' → skip the OR-clause block entirely          [route.ts:97-126]
          await query → { requests: data }
      setRequests(data.requests); setLoading(false)
```

Runs in parallel on the same mount:

```
useEffect [BomManager.tsx:208]
  loadMaterials()                        [BomManager.tsx:197]
    fetch GET /api/bom-materials
      route.ts GET                        [bom-materials/route.ts:15]
        auth.getUser() → canDeptUseBOM(dept)                    — 401/403, else continue
        select * from bom_materials order by name
    setMaterials(data.materials)                                 — silently no-ops on failure;
                                                                    the typeahead just has nothing to show
```

And the 30s background poll arms itself here too:

```
useEffect [BomManager.tsx:224]
  setInterval(30_000):
    if tab hidden → skip
    if raising (form open) or pending (line-decision editor open) → skip
    load(true)                                                   — quiet: no spinner, no error toast
```

---

## Flow 3 — Header badge (separate component, separate poll, mounts wherever `AdminHeader` renders)

```
AdminHeader mounts
  showBom = canDeptUseBOM(dept)          [AdminHeader.tsx:46]     — dept passed in as a prop from the
                                                                     server layout that rendered AdminHeader
  useEffect [AdminHeader.tsx:49]         — only runs if showBom
    refresh() immediately, then setInterval(60_000)
      if tab hidden → skip
      fetch GET /api/bom-requests?count=pending
        route.ts GET                      [bom-requests/route.ts:64]
          requireBomAccess()
          ?count==='pending' → head-only count query eq('status','pending')  [route.ts:70-78]
                                                                                 — never fetches item rows
          { pending: n }
      setBomPending(n)                                            — failures leave the last known count up,
                                                                       never toast (a badge isn't worth one)
```

This is a completely independent fetch loop from Flow 2's list poll — same
underlying table, two different requests, two different intervals, no shared cache.
Opening `/admin/bom` does not stop the header's own 60s poll; both run concurrently
while that page is open.

---

## Flow 4 — Raising a request

```
click "Raise request"        → setRaising(true)                  [BomManager.tsx:485]  — reveals the form
type in a material field     → applyMaterial(index, value)        [BomManager.tsx:247]
  looks up `materials` (already in state from Flow 2's loadMaterials — no fetch here)
  match on name_key = value.trim().toLowerCase()
  fills specification/size/unit ONLY where the draft field is still blank

click "Send to Admin"        → submitRequest()                    [BomManager.tsx:287]
  items.filter(material.trim() !== '')                            — client-side drop of blank rows
  empty → toast.error, return (no fetch)
  setSaving(true)
  fetch POST /api/bom-requests   body: {job_po, party, needed_by, priority, note, items[]}
    route.ts POST                       [bom-requests/route.ts:134]
      requireBomAccess()
      rawItems → text()/decimal() normalize each field             [route.ts:142-157]
      .filter(material !== null)                                   — server-side re-validation,
                                                                        doesn't trust the client's filter
      items.length===0 → 400, return                                 (belt-and-suspenders w/ client check above)
      createAdminClient()                                          — service-role; RLS bypassed for this write
      INSERT bom_requests (header)        [route.ts:168-180]
        DB: ref column defaults to 'BOM-' || nextval(bom_request_ref_seq)
      INSERT bom_request_items (all lines, request_id = header.id)  [route.ts:186-189]
        DB TRIGGER rollup_bom_request_status fires (AFTER INSERT on bom_request_items)
           recalc_bom_request_status() recounts siblings -> status stays 'pending'
           (all items start life as decision='pending')
      itemsError? -> DELETE the header row just inserted             [route.ts:194-203]  (manual rollback;
                                                                        see DECISIONS.md — no cross-call txn)
                     return 500
      await learnMaterials(items, actor)  [route.ts:225]            — AFTER save succeeds, errors swallowed
        dedupe items by material.trim().toLowerCase()  [route.ts:234-238]
        SELECT bom_materials.name_key IN (...)                      — find which are already known
        INSERT the unseen ones; insertError.code===23505 tolerated  — race with a concurrent identical insert
      return 201 { request: {...created, items: savedItems} }
  !res.ok → toast.error, return
  toast.success(ref); resetDraft(); setRaising(false)
  load(true)             — REFETCH, not prepend: new row may not match the active filter
  loadMaterials()          — refresh catalogue: any newly-learned material name now appears
                              in the typeahead the next time this form opens
  setSaving(false)
```

---

## Flow 5 — Reorder (client-only setup, then re-enters Flow 4 verbatim)

```
click "Reorder" on a past request  → reorder(request)             [BomManager.tsx:266]
  copies job_po, party, priority, note from `request`
  neededBy explicitly blanked                                     — the one field that never repeats
  items ← request.items mapped to fresh DraftItem[]                — decisions NOT carried over
  setRaising(true)                                                 — opens the same form Flow 4 uses
  scrollTo top; toast "Copied ... check the quantities"
  — no network call in this function —
click "Send to Admin"  → submitRequest()                           — identical to Flow 4 from here on
```

---

## Flow 6 — Admin decides a line

```
click Order / Decline        → decide(requestId, item, 'ordered'|'rejected')     [direct call]
click Part order / Alternative → setPending({itemId, decision, value, note})      [opens inline editor]
  click Save → savePendingDecision(requestId, item)  [BomManager.tsx:368]
    validates value (qty>0 for partial; non-empty for alternative)  — toast.error + return if invalid
    decide(requestId, item, decision, {approved_quantity | alternative_material, decision_note})

decide()                       [BomManager.tsx:332]
  setBusyId(item.id)
  fetch PATCH /api/bom-requests/{requestId}/items/{item.id}   body: {decision, ...extra}
    route.ts PATCH               [.../items/[itemId]/route.ts:33]
      auth.getUser() -> canDeptDecideBOM(dept)                      — 403 for Production here, even though
                                                                        Production passed the page-level gate
      decision not in DECISIONS -> 400
      pairing check: 'partial' needs approved_quantity, 'alternative' needs alternative_material  — 400 else
                                                                        (DB has no CHECK for this on purpose —
                                                                         would block a half-filled row mid-edit)
      createAdminClient()
      SELECT bom_request_items WHERE id=itemId AND request_id=id     — scoped by BOTH ids; mismatch -> 404
      UPDATE bom_request_items  SET decision, (only the relevant extra field, other nulled), decided_at, decided_by
        DB TRIGGER fires (AFTER UPDATE) -> recalc_bom_request_status()
           recounts ALL sibling items on this request -> writes bom_requests.status
           (never overwrites 'cancelled' — see migration 031 WHERE clause)
      SELECT the parent bom_requests row again, with items           — to hand back the fresh rolled-up status
        fails? -> degrade to returning just {item}, log server-side    [route.ts:125-130]
      return 200 { item, request }
  data.request present -> setRequests(...) REPLACES that whole card    [BomManager.tsx:352-354]
                                                                        (not a per-line patch — status came
                                                                         from the trigger, not from this call)
  setPending(null); toast; setBusyId(null)
```

---

## Flow 7 — Withdraw

```
click "Withdraw" (only rendered when request.status==='pending')  [BomManager.tsx:774]
  -> setConfirming({id, action:'withdraw'})            — first tap, arms the confirm slot
click "Confirm"
  -> withdraw(request)                    [BomManager.tsx:394]
    fetch PATCH /api/bom-requests/{id}   body: {action:'cancel'}
      route.ts PATCH                      [bom-requests/[id]/route.ts:40]
        requireBomAccess()                                         — Production OR Admin (not decide-gated;
                                                                       withdrawing your own request is allowed)
        action not 'cancel'|'reopen' -> 400
        SELECT existing.status; !== 'pending' -> 409                — can't withdraw once anyone's acted on it
        UPDATE status='cancelled', cancelled_at, cancelled_by
          trigger fires but recalc_bom_request_status explicitly skips rows already 'cancelled'
             and never sets a request back OUT of 'cancelled' from a recount
        return { request }
    toast; load(true)                                              — card drops off the list if filter='open'
```

`reopen` (same route, lines 93-111) exists server-side and is fully wired to flip a
`cancelled` request back to `pending` — but no button in `BomManager.tsx` calls it.
It's a live, tested endpoint with no client entry point right now.

---

## Flow 8 — Delete (Admin only)

```
click trash icon (only rendered when canDecide)      [BomManager.tsx:783]
  -> setConfirming({id, action:'delete'})
click "Delete for good"
  -> removeRequest(request)               [BomManager.tsx:420]
    fetch DELETE /api/bom-requests/{id}
      route.ts DELETE                     [bom-requests/[id]/route.ts:114]
        requireBomAccess()                                         — lets Production through this far
        canDeptDecideBOM(gate.dept)                                 — THEN rejects Production here, 403
        createAdminClient() -> DELETE FROM bom_requests WHERE id=...
          DB: ON DELETE CASCADE removes the bom_request_items children (schema-level, migration 031)
        return { success: true }
    setRequests(prev => prev.filter(...))                          — removed from state directly,
                                                                        no refetch needed (row is gone)
    toast
```

---

## Flow 9 — Search

```
type in search box  -> setSearch(value)
  useEffect [BomManager.tsx:190]  — debounces 300ms (vs 0ms when search is empty) -> load()
    fetch GET /api/bom-requests?status={filter}&search={value}
      route.ts GET                        [bom-requests/route.ts:97-126]
        SELECT bom_request_items.request_id WHERE material ILIKE %search%     — child-table pass FIRST
        ids = distinct request_id list from that
        .or([ref ILIKE, job_po ILIKE, party ILIKE, note ILIKE, (id.in.(ids) if any)])
          — PostgREST can't OR across a join, so this is two queries standing in for one
        applied ON TOP OF the existing status filter (open/pending/etc.)
setRequests(...) as usual, OR EmptyState with the search-aware message  [BomManager.tsx:1093]
```

---

## Flow 10 — CSV export (no server round-trip at all)

```
click export button
  exportRows = useMemo(...)              [BomManager.tsx:212]      — flattens the CURRENT in-memory
                                                                       `requests` (already filtered+searched)
                                                                       x items -> one row per material line
  CsvExportButton (rows, BOM_EXPORT_COLUMNS)                        — builds the CSV string client-side
                                                                       from state already on the page and
                                                                       triggers a browser download
```

Nothing here ever leaves the browser except the file save — the export can never be
stale relative to the screen, but it also can't include anything the current
filter/search has hidden.

---

## Currently touching

*(Update this section per work session — this is the part meant to change often;
the traced flows above should only need a revisit when the call chain itself does.)*

**As of 2026-08-12:** Nothing is mid-edit. The last completed change was the full
BOM feature above (uncommitted — see DECISIONS.md, "Hold off entirely"), plus one
small follow-up just applied:

- Material field placeholder — `BomManager.tsx:585` — was
  `"Material, e.g. Chromo Paper 80gsm"` (a paper-only example), now `"Material name"`.
- Specification field placeholder — `BomManager.tsx:593` — was `"Spec / gsm"` (gsm is
  a paper-weight unit ink has no use for), now `"Specification"`.
- `UNITS` array (`BomManager.tsx:88`) was deliberately **not** changed — user asked
  to skip adding `'litres'`, so the unit datalist stays
  `['rolls', 'kg', 'sheets', 'reams', 'pcs', 'boxes']`.

Neither placeholder change touches the request/response paths traced above —
`material` and `specification` were already free text end-to-end (Flow 4), so this
was copy polish, not a new flow.
