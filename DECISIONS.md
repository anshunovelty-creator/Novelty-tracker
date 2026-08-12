# Decisions

A running log of non-obvious technical and product decisions made while building this
tracker, and the reasoning behind them — so a later session (or a later you) doesn't
have to re-derive *why* something is shaped the way it is.

Each entry: what was decided, what else was considered, why the chosen option won.
Newest entries at the bottom. Append here whenever a real choice is made — a fork
with a real alternative, a library pulled in, a tradeoff picked under a constraint.
Routine implementation (a new field, a new page following an existing pattern) does
not need an entry.

---

## 2026-08-11 — Bill of Material (BOM): per-line decisions, not per-request approval

**Decision:** Admin decides each material line independently (order / partial /
alternative / reject), not the request as a whole.

**Why:** The real answer to a requisition is almost never a flat yes/no. "Order the
paper, halve the foil, use 100gsm instead of 90gsm, skip the ink for now" is the
ordinary shape of an owner's response. A per-request approve/reject would force the
owner to either reject a request over one bad line or approve a line they didn't
actually want to fund.

**Considered:** Single approve/reject on the whole request (simpler UI, one click) —
rejected because it doesn't match how the owner actually decides.

---

## 2026-08-11 — Request status rolled up by a DB trigger, not computed in the API

**Decision:** `bom_requests.status` is written by a Postgres trigger
(`recalc_bom_request_status`) that recounts the child rows after every insert/update/
delete on `bom_request_items`, not by application code after each API call.

**Why:** Two admins can decide two different lines on the same request at nearly the
same time. If the header status were computed and written from the API layer, two
concurrent requests reading-then-writing the header could race and leave it in a
stale or wrong state (classic lost-update). Doing the recount inside the trigger,
scoped to the row being written, makes the rollup atomic with the write that
triggered it — there's no window for a second writer to observe stale state.

**Considered:** Compute status in the API route after the decision write — simpler to
read, but reintroduces the race described above under concurrent admins.

---

## 2026-08-11 — In-app badge for new requests, not email

**Decision:** The owner is alerted to a new/pending BOM request via a polled in-app
badge count, not an email notification.

**Why:** `/api/notifications/*` already sends real email/WhatsApp with no auth check
on the caller — a known and still-unfixed gap. Adding a new caller into that surface
for BOM would mean either accepting the same exposure for a new endpoint or blocking
BOM on fixing notifications first. Neither serves the feature. An in-app badge
sidesteps the whole surface.

**Considered:** Email to the owner on every new request — dropped for the reason
above, and because email is the exact channel this feature exists to *replace*.

---

## 2026-08-11 — Visibility: Admin + Production only, Viewer declined

**Decision:** BOM pages, API routes, and RLS policies all gate on
`department IN ('Admin', 'Production')`. Read-only Viewer access was proposed and
explicitly declined by the user.

**Why:** What the floor is asking to buy, and what the owner approved or turned down,
is not shop-wide information — it's closer to a purchasing conversation than a job
status. This mirrors the existing pattern elsewhere in the app: Prepress To-Do is
similarly Admin+department-only, not Viewer-visible, for the same reason (an
allow-list of departments that legitimately need the page, not a default-open one
gated shut for the rest).

**Considered:** Viewer read access (so anyone could see what's been requested/ordered)
— offered, declined by the user.

---

## 2026-08-11 — Job link is a free-text PO reference, not a foreign key to `jobs`

**Decision:** `bom_requests.job_po` is a plain nullable `TEXT` column, not a foreign
key to the `jobs` table.

**Why:** Raw material requests routinely precede the job that will consume them —
paper gets ordered in bulk ahead of a PO existing, or against a customer's standing
order rather than one specific job row. Forcing an FK would mean either blocking the
request until a job exists (wrong order of operations for real purchasing) or
inventing placeholder job rows just to satisfy the constraint. Free text lets
Production write whatever reference makes sense to them (a PO number, "standing
order", a customer name) without the schema getting in the way.

**Considered:** FK to `jobs.id` (would enable "show me this job's material spend") —
rejected because it assumes an ordering of events that doesn't hold in practice.

---

## 2026-08-11 — POST does a manual rollback instead of a DB transaction

**Decision:** `POST /api/bom-requests` inserts the header row, then the item rows;
if the item insert fails, the route explicitly deletes the header it just created.

**Why:** This isn't the preferred approach — a single transaction wrapping both
inserts would be — but PostgREST (the Supabase REST layer this project talks to) has
no way to open a transaction spanning two separate HTTP calls from application code.
Given that constraint, the choice is between "a materialless orphan request sits in
the owner's queue if the second insert fails" and "roll it back by hand." The latter
is chosen, and the rollback failure itself is logged (with the orphan id) so a
rollback-of-the-rollback failure is at least visible, not silent.

**Considered:** A Postgres function (`SECURITY DEFINER` RPC) that does both inserts
server-side in one real transaction — would remove the manual-rollback code
entirely, and is the more correct fix, but was skipped for this pass to keep the
migration and API surface smaller. Worth revisiting if orphan rollback failures are
ever actually observed in logs.

---

## 2026-08-11 — Material search resolves child-table matches before querying the header

**Decision:** Searching BOM requests by material name first queries
`bom_request_items` for matching rows, collects their `request_id`s, then adds
`id.in.(...)` to an `.or()` clause against the header table — rather than a single
joined query.

**Why:** PostgREST cannot express "match this column on the parent OR that column on
a related child" in one query — its `.or()` only operates within a single table's
columns. Two queries (child lookup, then header filter) is the workaround inside
that constraint, not the first choice.

**Considered:** A Postgres view or function that pre-joins requests to a searchable
text blob — more efficient for a large table, but this table is a shop's material
requests (dozens to low hundreds of rows), so the two-query approach is simple and
fast enough; revisit only if request volume grows by orders of magnitude.

---

## 2026-08-11 — Material catalogue: a generated, deduplicating `name_key` column

**Decision:** `bom_materials.name_key` is `GENERATED ALWAYS AS (lower(btrim(name)))
STORED`, with a unique constraint on it — rather than deduplicating in application
code before insert.

**Why:** Within a day of the feature going live, the same paper had already been
typed as both "CHROMO 80GSM" and "Chromo Paper 80gsm" — two rows, two spellings, and
"what did we spend on chromo this year" becomes unanswerable. A generated column
guarantees the identity used for dedup can never drift from `name`, and the unique
constraint is the actual guard — enforced by Postgres regardless of which code path
inserts a row, not just the one path a developer remembered to add a check to.

**Considered:** Case-insensitive dedup logic living only in the API's
`learnMaterials()` function — rejected because it's a guard that only holds as long
as every future write path remembers to call it; the DB constraint holds regardless.

---

## 2026-08-11 — Catalogue grows from usage (`learnMaterials`), not curated upfront

**Decision:** `bom_materials` has no "add a material" admin UI. Every successful
`POST /api/bom-requests` adds any material name the catalogue hasn't seen before
(`learnMaterials()`, called after the request is safely saved, errors swallowed).

**Why:** A curated-upfront catalogue needs someone to seed it, and needs someone to
remember to add each new material as it comes up — an extra step in the way of
Production actually raising a request. Growing it from real usage means the
typeahead gets more useful the more the feature is used, with zero admin overhead.
Deliberately placed *after* the request is saved and wrapped so it can never fail
the request: a purchasing request must never be rejected because a lookup-table
convenience feature misbehaved.

**Considered:** A dedicated admin screen to manage the catalogue up front — more
correct in principle, more friction in practice, and still needed eventually (see
Open Questions below) for pruning typo entries that do slip through before the
generated-column dedup catches them (e.g. "Chromo 80 gsm" vs "Chromo 80gsm" — same
material, different `name_key`).

---

## 2026-08-11 — 30s/60s visibility-aware polling, not Supabase Realtime

**Decision:** BOM's list refresh and the header's pending-count badge poll on a
timer (visibility-aware — paused when the tab isn't active), not via Supabase
Realtime subscriptions.

**Why:** This follows the existing pattern already in place for room displays:
Realtime is blocked project-wide on an RLS change that hasn't been approved yet, so
it isn't an available option for any feature right now, BOM included. Polling is the
fallback that works today without touching that unresolved dependency.

**Considered:** Supabase Realtime subscription on `bom_requests` — would give instant
updates, but blocked on the same unapproved RLS change blocking it everywhere else
in the app.

---

## 2026-08-11 — Nothing committed or pushed for this feature

**Decision:** All BOM work (migrations, API routes, UI) was built and left as
uncommitted working-tree changes.

**Why:** Explicit user instruction ("Hold off entirely") when asked how to handle
committing. Not a technical decision — recorded here so a future session doesn't
assume silence means "forgotten" rather than "deliberately held."

---

## Open questions / deliberately deferred

Things considered during the BOM build, not built, and why — so they aren't
re-litigated from scratch later:

- **Cost/rate per line + request total** — offered, not selected. Would need a
  source of truth for current material pricing, which doesn't exist in this system
  yet; adding a price field without one just invites stale numbers.
- **"Received" step + Label Stock link** — offered, not selected. Would tie BOM to
  inventory tracking, which is a larger feature on its own.
- **Supplier field, overdue tinting, decision audit trail** — offered, not selected;
  no blocking reason, just not prioritized in this pass.
- **"Order everything" bulk action** — flagged as in tension with the standing
  product preference elsewhere in this app: departments work items individually by
  design (stage updates are one-by-one, not bulk), so a bulk button here would be the
  odd one out. Would need explicit buy-in before adding.
- **No UI to prune typo entries from the material catalogue** — the generated
  `name_key` column stops *exact* duplicates (case/whitespace) but not near-duplicates
  ("Chromo 80 gsm" vs "Chromo 80gsm"). Noticed, not yet addressed.
