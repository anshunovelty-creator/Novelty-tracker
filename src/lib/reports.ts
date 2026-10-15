// src/lib/reports.ts
// The Reports page's numbers, computed from Job Separation rows — the order
// book as Prepress enters it. Pure, so it's testable and the API stays a
// thin fetch; the page recomputes on every period / unit / party change
// without asking the server again.
//
// Every row is dated by its PO date (created_at's IST day for the few legacy
// rows without one) — the same bucket the Sr. No. series uses, so "October"
// here is the OCT26-n rows on Job Separation. Cancelled rows are kept out of
// every figure and counted on their own.
//
// Later this will read production (jobs) as well; for now Job Separation is
// the one source the whole floor keeps up to date.
//
// Two lenses on top of the period figures:
//   - Customer groups: "UPL - 03" and "UPL - 13" are plants of one customer,
//     so parties also roll up to a group read off the name (groupKey).
//   - Reorder cycles: a party + PM code bought more than once has a usual
//     gap between orders; past that gap, the reorder is due or overdue.
//   - Rates: what a label costs by order size (smaller runs cost more a
//     label), and products billed lower than an earlier order at least as
//     big — the one rate change the size curve can't explain.
//   - Products: how much each month comes from products ordered before vs
//     new ones, and where each product stands (new, reordered, once, stopped).
//   - Forecast: the next four weeks from reorder cycles plus the recent pace
//     of new-product orders. Rough until there are ~6 months of history.
//   - Colour approval: shade cards matched to orders by PM code. Here the PO
//     comes first and the card follows (~a week later), so this measures how
//     long approval adds to an order and which orders wait on the customer.
//   - Customer segments (RFM): each plant scored on how recently, how often
//     and how much it orders, put in a segment with an action, and flagged
//     when it looks like it's slipping away.
//   - What changed: last period → this one as parts that add up exactly
//     (new / returning / lost plants, products added or dropped, labels,
//     rate), and the same days a year back once the data reaches that far.
//   - Pace: this month so far and where it's heading.
//   - Cohorts: plants by first-order month, and how many keep ordering.
//   - Self-checks: the forecast re-run on past weeks and scored, and order
//     lines that look mistyped.
//   Cycles, segments, cohorts and the checks look at all orders up to
//   today, whatever period is picked; that half is cached (standing()), so
//   switching periods stays instant however long the history gets.

export type SepRow = {
  id:            string;
  sr_no:         string | null;
  day:           string;          // 'YYYY-MM-DD' — po_date, or created_at's IST day
  party:         string;
  po_no:         string | null;
  pm_code:       string | null;
  material_name: string | null;
  quantity:      number | null;
  unit:          string | null;   // '1' | '2' | '1&2'
  rate:          number | null;
  order_value:   number | null;
  jc_status:     string | null;
  aw_send_to:    string | null;
  cancelled:     boolean;
};

export type Period = { from: string; to: string };                   // inclusive IST days
export type Filter = { unit: string | null; group: string | null; party: string | null };  // groupKey / partyKey

export type Totals = {
  value:    number;
  orders:   number;          // Job Separation lines
  pos:      number;          // distinct party + PO no.
  qty:      number;          // labels ordered
  parties:  number;
  avgOrder: number | null;   // value per line
  avgRate:  number | null;   // value per label
};

export type Slice = { key: string; label: string; value: number; orders: number; qty: number; share: number };

export type PartyRow = {
  key: string; party: string;
  plants: number;                   // 1 for a plant; how many plants for a group
  value: number; orders: number; pos: number; qty: number;
  avgRate: number | null; share: number;
  byUnit: Record<string, number>;   // unit key → value
  lastDay: string;
  prevValue: number;                // same party, previous period
};

export type ProductRow = {
  key: string; pm_code: string | null; material: string;
  value: number; orders: number; qty: number; parties: number; avgRate: number | null;
};

export type Analysis = {
  period:     Period;
  previous:   Period;
  totals:     Totals;
  prevTotals: Totals;
  cancelled:  { orders: number; value: number };
  trend:      { grain: 'day' | 'week' | 'month'; buckets: { key: string; label: string; value: number; orders: number; qty: number }[] };
  units:      Slice[];
  parties:    PartyRow[];
  products:   ProductRow[];
  sizes:      Slice[];
  artwork:    Slice[];
  jobCards:   Slice[];
  weekdays:   Slice[];
  newParties:   string[];                               // first order ever falls in the period
  quietParties: { party: string; prevValue: number }[]; // ordered last period, not this one
  top5Share:  number;                                   // % of value from the five biggest parties
  groups:     PartyRow[];                               // parties rolled up to customer groups
  top3GroupShare: number;                               // % of value from the three biggest groups
  reorders:   Cycle[];                                  // party + PM code, as of today
  partyCycles: Cycle[];                                 // party (plant), as of today
  duplicates: { a: string; b: string; aOrders: number; bOrders: number }[];  // likely the same party typed two ways
  customers:  CustomerRow[];                            // every plant, segmented, biggest lifetime value first
  priceCurve: { label: string; orders: number; qty: number; value: number; rate: number | null }[];  // the period, by labels per order
  rateChecks: RateCheck[];                              // products billed at more than one rate, as of today
  noPmCode:   SepRow[];                                 // live rows with no usable PM code, as of today
  approvals:  Approvals | null;                         // null until shade cards are passed in
  lifecycle:  Lifecycle;                                // as of today
  forecast:   Forecast;                                 // from today
  forecastCheck: ForecastCheck;                         // the forecast scored on past weeks
  pace:       Pace;                                     // this month so far, whatever period is picked
  bridge:     Bridge;                                   // previous period → this one
  yearAgo:    { period: Period; totals: Totals } | null;  // same days a year back, once the data reaches that far
  cohorts:    Cohort[];
  rowChecks:  RowCheck[];                               // rows that look mistyped, as of today
  lines:     SepRow[];                                 // the period's live rows after filters, oldest first
};

// ── Days and periods ──────────────────────────────────────────

const DAY = 86_400_000;
const toMs  = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDay(toMs(d) + n * DAY);
const daysIn = (p: Period) => Math.round((toMs(p.to) - toMs(p.from)) / DAY) + 1;
const minDay = (a: string, b: string) => (a < b ? a : b);

/** 'YYYY-MM' shifted by n months. */
export function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

export type Preset = 'month' | 'last-month' | '3months' | 'fy' | 'all';

/** The period a preset means on `today` (IST 'YYYY-MM-DD'). `earliest` bounds "All". */
export function presetPeriod(preset: Preset, today: string, earliest: string): Period {
  const m = today.slice(0, 7);
  switch (preset) {
    case 'month':      return { from: `${m}-01`, to: today };
    case 'last-month': return { from: `${addMonths(m, -1)}-01`, to: monthEnd(addMonths(m, -1)) };
    case '3months':    return { from: `${addMonths(m, -2)}-01`, to: today };
    case 'fy': {
      // Indian financial year: April to March.
      const y = +today.slice(0, 4) - (+today.slice(5, 7) < 4 ? 1 : 0);
      return { from: `${y}-04-01`, to: today };
    }
    case 'all': return { from: minDay(earliest, today), to: today };
  }
}

/**
 * The stretch just before `p` to compare against. A period that starts on
 * the 1st compares month-for-month: 1–13 Oct against 1–13 Sep, a whole
 * September against a whole August, Aug–Oct against May–Jul. Anything else
 * compares with the same number of days right before it.
 */
export function previousPeriod(p: Period): Period {
  if (p.from.endsWith('-01')) {
    const months = (+p.to.slice(0, 4) - +p.from.slice(0, 4)) * 12 + (+p.to.slice(5, 7) - +p.from.slice(5, 7)) + 1;
    const lastMonth = addMonths(p.to.slice(0, 7), -months);
    const to = p.to === monthEnd(p.to.slice(0, 7))
      ? monthEnd(lastMonth)
      : minDay(`${lastMonth}-${p.to.slice(8)}`, monthEnd(lastMonth));   // 31 Mar → 28 Feb
    return { from: `${addMonths(p.from.slice(0, 7), -months)}-01`, to };
  }
  const n = daysIn(p);
  return { from: addDays(p.from, -n), to: addDays(p.from, -1) };
}

export type Cycle = {
  key:          string;
  party:        string;
  pm_code:      string | null;   // null on a party-level cycle
  material:     string | null;
  orders:       number;          // orders seen (PO dates within 3 days count as one)
  cycleDays:    number;          // median gap between orders
  lastDay:      string;
  dueDay:       string;          // lastDay + cycleDays
  lateDays:     number;          // today − dueDay; negative = due in that many days
  typicalQty:   number;          // median labels per order
  typicalValue: number;          // median ₹ per order
  status:       'lapsed' | 'overdue' | 'due' | 'upcoming';
};

export type RateLine = { day: string; sr_no: string | null; qty: number; rate: number };

export type RateCheck = {
  key:      string;              // party + PM code: a rate is agreed per customer product
  party:    string;
  pm_code:  string;
  material: string | null;
  lines:    RateLine[];          // every order, oldest first
  low:      number;
  high:     number;
  latest:   number;
  atStake:  number;              // ₹ billed under an earlier order's rate on orders no bigger than it
  undercut: { line: RateLine; was: RateLine } | null;   // the biggest such gap
};

export type ProductStage = 'New' | 'Reordered' | 'Only once' | 'Stopped';
export const PRODUCT_STAGES: ProductStage[] = ['New', 'Reordered', 'Only once', 'Stopped'];

export type ProductLife = {
  key: string; party: string; pm_code: string; material: string | null;
  firstDay: string; lastDay: string; orders: number; value: number;
  stage: ProductStage;
};

export type Lifecycle = {
  products: ProductLife[];       // party + PM code, biggest value first
  months:   { month: string; label: string; repeat: number; fresh: number; freshProducts: number }[];
};

export type Forecast = {
  weeks:        { from: string; to: string; repeat: number; fresh: number; orders: number }[];  // next four weeks from today
  recentWeekly: number;          // actual ₹ a week over the last four weeks
  freshWeekly:  number;          // ₹ a week from first orders of new products, last eight weeks
};

/** The forecast, re-run as of past days on what was known then, against what arrived. */
export type ForecastCheck = {
  runs:  { asOf: string; predicted: number; actual: number }[];   // newest first
  error: number | null;          // median miss, % of actual, over the runs
};

/** The current month so far, and where it's heading. */
export type Pace = {
  month:     string;             // 'YYYY-MM'
  soFar:     number;             // ₹ from the 1st to today
  day:       number;             // today's day of the month
  daysIn:    number;
  projected: number;             // soFar + the forecast for the rest of the month
  lastMonth: number;             // the whole of last month
  lastMonthToDate: number;       // last month, the same days
};

export type BridgeKey = 'newCustomers' | 'returned' | 'lost' | 'addedProducts' | 'droppedProducts' | 'volume' | 'price';

/** Previous period's value → this period's, in parts that add up exactly. */
export type Bridge = {
  from:  number;
  to:    number;
  steps: { key: BridgeKey; value: number; count: number }[];   // count: parties or products behind it
};

/** Plants by the month of their first order, and how many ordered again in each month after. */
export type Cohort = {
  month:     string;
  customers: number;
  value:     number;             // ₹ from these plants so far
  active:    number[];           // % of the cohort ordering in month 0, 1, 2… up to this month
  partial:   boolean;            // the last month in `active` is this month, not over yet
  onBooks:   boolean;            // the data's first month: already customers, not new
};

export type RowCheck = { row: SepRow; issue: string };

export type ShadeCard = {
  id:       string;
  party:    string;
  product:  string | null;
  pm_code:  string | null;
  status:   string;              // 'Approved' | 'Pending Approval'
  prepared: string | null;       // 'YYYY-MM-DD'
  sent:     string | null;
  approved: string | null;
};

export type CardTrack = ShadeCard & {
  start:    string;              // sent, or prepared when never marked sent
  customer: string;              // the party as Job Separation spells it, when it can be matched
  poDay:    string | null;       // the order it's for (latest PO up to 60 days before), else the first PO after
  poValue:  number;              // ₹ on that PM code from that PO day on
  hasOrder: boolean;
  days:     number;              // pending: days since start; approved: start → approval
  sinceApproved: number | null;  // days from approval to today
};

export type Approvals = {
  since:  string;
  cards:  CardTrack[];           // since the order book starts, filtered, newest first
  steps:  Record<'poToCard' | 'cardToSent' | 'sentToApproved' | 'poToApproved', { days: number | null; n: number }>;  // median days, over n cards with both dates
  waiting:   CardTrack[];        // sent, not approved yet, oldest first
  notSent:   CardTrack[];        // pending but never marked sent: on our side, or the sheet wasn't updated
  noOrder:   CardTrack[];        // approved, no PO either side, oldest first
  byParty:   { customer: string; cards: number; pending: number; noOrder: number; sentToApproved: number | null }[];
};

export type Segment = 'Champion' | 'Loyal' | 'New' | 'Promising' | 'At risk' | 'Lost';

export type CustomerRow = {
  key:        string;
  party:      string;
  group:      string;
  firstDay:   string;
  lastDay:    string;
  daysSince:  number;            // days since the last order
  orders:     number;            // orders (PO dates within 3 days count as one)
  value:      number;            // ₹ across all history
  last30:     number;            // ₹ in the last 30 days
  prev30:     number;            // ₹ in the 30 days before that
  cycleDays:  number | null;     // usual gap between orders, once it has two
  score:      { r: number; f: number; m: number };   // 1–3 each, 3 best
  segment:    Segment;
  risk:       'high' | 'watch' | null;
  why:        string;            // the reason behind the risk flag, in words
};

/** What to do with each segment — shown beside it on the page. */
export const SEGMENT_ACTIONS: Record<Segment, string> = {
  'Champion':  'Protect: first in the queue, steady quality, no surprises on price.',
  'Loyal':     'Grow: offer the products and plants they don’t buy from us yet.',
  'New':       'Win them early: fast, perfect first deliveries.',
  'Promising': 'Ordered recently but small or rarely. Quote for more of their range.',
  'At risk':   'Used to order well, now quiet. Call this week and ask what changed.',
  'Lost':      'Small and quiet for a long time. A win-back offer, or let go.',
};
export const SEGMENTS = Object.keys(SEGMENT_ACTIONS) as Segment[];

// ── Classifiers ───────────────────────────────────────────────

/** "ARYSTA", "Arysta" and "arysta " are one party. */
export const partyKey = (p: string) => p.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * The customer group a party belongs to, read off how plants are named:
 * "UPL - 03" → UPL, "SML - 1" → SML, "GINNI (HARIDWAR)" → GINNI. A party
 * with neither suffix is its own group.
 * ponytail: derived from the name; add a group column on parties when a
 * customer's plants don't share a name prefix.
 */
export const groupKey = (p: string) => {
  const k = partyKey(p);
  return k.replace(/\s*\(.*\)$/, '').replace(/\s*-?\s*\d+$/, '').trim() || k;
};

export const UNITS = ['1', '2', '1&2'] as const;
export const unitKey = (u: string | null) => {
  const k = (u ?? '').replace(/\s+/g, '');
  return (UNITS as readonly string[]).includes(k) ? k : '—';
};
export const unitLabel = (k: string) => (k === '—' ? 'Unit not set' : k === '1&2' ? 'Units 1 & 2' : `Unit ${k}`);

// Order value bands, in rupees (labelled in thousands, as Reports counts).
const SIZES: [string, number][] = [
  ['Under ₹5K', 5_000], ['₹5K – 25K', 25_000], ['₹25K – 100K', 100_000],
  ['₹100K – 500K', 500_000], ['₹500K and over', Infinity],
];

// Labels per order line — rate per label falls as runs get longer.
const QTY_BANDS: [string, number][] = [
  ['Under 1K', 1_000], ['1K – 2.5K', 2_500], ['2.5K – 5K', 5_000],
  ['5K – 10K', 10_000], ['10K – 25K', 25_000], ['25K and over', Infinity],
];

/** The PM code, uppercased, or null when it's blank or a placeholder ("0", "00", "-", "NA"). */
export function pmKey(code: string | null): string | null {
  const t = code?.trim().toUpperCase();
  return t && !/^(0+|-+|NA|N\/A)$/.test(t) ? t : null;
}

// AW Send To is free text. REPEAT anywhere means the artwork was reused;
// N/A or blank says nothing; anything else (KAROMI, SENT ON …, DONE, MAKE …)
// is artwork that had to go out.
export function artworkKind(aw: string | null): 'Repeat' | 'New artwork' | 'Not recorded' {
  const t = (aw ?? '').trim().toUpperCase();
  if (t.includes('REPEAT')) return 'Repeat';
  if (t === '' || t === 'N/A' || t === 'NA') return 'Not recorded';
  return 'New artwork';
}

// JC Status is free text too: DONE… means the job card exists; a hold or a
// cancel note means it's parked; N/A or blank means not made yet.
export function jobCardKind(jc: string | null): 'Job card made' | 'On hold / cancelled' | 'Not made yet' | 'Other note' {
  const t = (jc ?? '').trim().toUpperCase();
  if (t.startsWith('DONE')) return 'Job card made';
  if (/HOLD|CANCEL/.test(t)) return 'On hold / cancelled';
  if (t === '' || t === 'N/A' || t === 'NA') return 'Not made yet';
  return 'Other note';
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdayOf = (d: string) => (new Date(toMs(d)).getUTCDay() + 6) % 7;   // Mon = 0

// ── Aggregation ───────────────────────────────────────────────

const num = (n: number | null) => n ?? 0;
/** Append to a list in a map of lists — in place; a copy per row is quadratic on a busy party. */
function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v); else m.set(k, [v]);
}
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const inPeriod = (r: SepRow, p: Period) => r.day >= p.from && r.day <= p.to;
const poKey = (r: SepRow) => `${partyKey(r.party)}|${(r.po_no ?? '').trim().toUpperCase() || r.id}`;

function totalsOf(rows: SepRow[]): Totals {
  let value = 0, qty = 0;
  const pos = new Set<string>(), parties = new Set<string>();
  for (const r of rows) {
    value += num(r.order_value);
    qty   += num(r.quantity);
    pos.add(poKey(r));
    parties.add(partyKey(r.party));
  }
  return {
    value, orders: rows.length, pos: pos.size, qty, parties: parties.size,
    avgOrder: rows.length ? value / rows.length : null,
    avgRate:  qty ? value / qty : null,
  };
}

/** Rows grouped by a key. With `order`, every listed key appears in that order; otherwise biggest value first. */
function slices(rows: SepRow[], keyOf: (r: SepRow) => string, order?: readonly string[], labelOf: (k: string) => string = (k) => k): Slice[] {
  const acc = new Map<string, { value: number; orders: number; qty: number }>();
  for (const k of order ?? []) acc.set(k, { value: 0, orders: 0, qty: 0 });
  let total = 0;
  for (const r of rows) {
    const k = keyOf(r);
    const a = acc.get(k) ?? { value: 0, orders: 0, qty: 0 };
    a.value += num(r.order_value); a.orders += 1; a.qty += num(r.quantity);
    acc.set(k, a);
    total += num(r.order_value);
  }
  const out = Array.from(acc.entries()).map(([key, a]) => ({ key, label: labelOf(key), ...a, share: share(a.value, total) }));
  return order ? out : out.sort((a, b) => b.value - a.value);
}

function trendOf(rows: SepRow[], p: Period): Analysis['trend'] {
  const n = daysIn(p);
  const grain = n <= 45 ? 'day' : n <= 120 ? 'week' : 'month';
  // A day's bucket: itself, its Monday, or its month.
  const bucket = (d: string) => (grain === 'day' ? d : grain === 'month' ? d.slice(0, 7) : addDays(d, -weekdayOf(d)));
  const label  = (k: string) => (grain === 'month' ? `${MON[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}` : `${+k.slice(8, 10)} ${MON[+k.slice(5, 7) - 1]}`);

  const acc = new Map<string, { key: string; label: string; value: number; orders: number; qty: number }>();
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    const k = bucket(d);
    if (!acc.has(k)) acc.set(k, { key: k, label: label(k), value: 0, orders: 0, qty: 0 });
  }
  for (const r of rows) {
    const b = acc.get(bucket(r.day));
    if (!b) continue;
    b.value += num(r.order_value); b.orders += 1; b.qty += num(r.quantity);
  }
  return { grain, buckets: Array.from(acc.values()) };
}

/** Period figures per party — or per group, with groupKey as `keyOf`. */
function partiesOf(rows: SepRow[], prevRows: SepRow[], total: number, keyOf: (party: string) => string = partyKey): PartyRow[] {
  const byGroup = keyOf !== partyKey;
  const acc = new Map<string, PartyRow & { poSet: Set<string>; plantSet: Set<string> }>();
  for (const r of rows) {
    const k = keyOf(r.party);
    let a = acc.get(k);
    if (!a) {
      a = { key: k, party: byGroup ? k : r.party.trim(), plants: 0, value: 0, orders: 0, pos: 0, qty: 0, avgRate: null, share: 0, byUnit: {}, lastDay: r.day, prevValue: 0, poSet: new Set(), plantSet: new Set() };
      acc.set(k, a);
    }
    a.value += num(r.order_value); a.orders += 1; a.qty += num(r.quantity);
    a.poSet.add(poKey(r));
    a.plantSet.add(partyKey(r.party));
    const u = unitKey(r.unit);
    a.byUnit[u] = (a.byUnit[u] ?? 0) + num(r.order_value);
    if (r.day > a.lastDay) a.lastDay = r.day;
  }
  for (const r of prevRows) {
    const a = acc.get(keyOf(r.party));
    if (a) a.prevValue += num(r.order_value);
  }
  return Array.from(acc.values())
    .map(({ poSet, plantSet, ...a }) => ({ ...a, pos: poSet.size, plants: plantSet.size, avgRate: a.qty ? a.value / a.qty : null, share: share(a.value, total) }))
    .sort((a, b) => b.value - a.value);
}

function productsOf(rows: SepRow[]): ProductRow[] {
  const acc = new Map<string, ProductRow & { partySet: Set<string> }>();
  for (const r of rows) {
    const code = r.pm_code?.trim() || null;
    const k = (code ?? r.material_name ?? '—').trim().toUpperCase();
    let a = acc.get(k);
    if (!a) {
      a = { key: k, pm_code: code, material: r.material_name?.trim() || '—', value: 0, orders: 0, qty: 0, parties: 0, avgRate: null, partySet: new Set() };
      acc.set(k, a);
    }
    a.value += num(r.order_value); a.orders += 1; a.qty += num(r.quantity);
    a.partySet.add(partyKey(r.party));
  }
  return Array.from(acc.values())
    .map(({ partySet, ...a }) => ({ ...a, parties: partySet.size, avgRate: a.qty ? a.value / a.qty : null }))
    .sort((a, b) => b.value - a.value);
}

/** Rows (sorted by day) as orders: PO dates within 3 days of each other are one order. */
function ordersOf(sorted: SepRow[]): { first: string; last: string; qty: number; value: number }[] {
  const orders: { first: string; last: string; qty: number; value: number }[] = [];
  for (const r of sorted) {
    const o = orders[orders.length - 1];
    if (o && daysBetween(o.last, r.day) < 3) { o.last = r.day; o.qty += num(r.quantity); o.value += num(r.order_value); }
    else orders.push({ first: r.day, last: r.day, qty: num(r.quantity), value: num(r.order_value) });
  }
  return orders;
}

/**
 * Reorder cycles, as of `today`: rows grouped by `keyOf`; PO dates within
 * 3 days of each other are one order (a PO split over a couple of days);
 * the usual gap is the median gap between orders. Needs two orders.
 *
 * Past the due day by more than a grace (a quarter of the cycle, at least
 * 3 days) it's overdue; past by more than two whole cycles it has probably
 * lapsed; due within the next 14 days, it's due.
 */
export function cyclesOf(rows: SepRow[], keyOf: (r: SepRow) => string | null, today: string): Cycle[] {
  const by = new Map<string, SepRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k || r.day > today) continue;
    push(by, k, r);
  }
  const out: Cycle[] = [];
  for (const [key, list] of Array.from(by.entries())) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const orders = ordersOf(list);
    if (orders.length < 2) continue;
    const gaps = orders.slice(1).map((o, i) => daysBetween(orders[i].first, o.first));
    const cycleDays = Math.max(1, Math.round(median(gaps)));
    const lastDay = orders[orders.length - 1].first;
    const dueDay = addDays(lastDay, cycleDays);
    const lateDays = daysBetween(dueDay, today);
    const grace = Math.max(3, Math.round(cycleDays / 4));
    const last = list[list.length - 1];
    out.push({
      key, party: last.party.trim(),
      pm_code: last.pm_code?.trim() || null, material: last.material_name?.trim() || null,
      orders: orders.length, cycleDays, lastDay, dueDay, lateDays,
      typicalQty: median(orders.map((o) => o.qty)), typicalValue: median(orders.map((o) => o.value)),
      status: lateDays > 2 * cycleDays ? 'lapsed' : lateDays > grace ? 'overdue' : lateDays >= -14 ? 'due' : 'upcoming',
    });
  }
  return out;
}

/**
 * 1–3 by where a value sits among all of them (thirds), 3 the best end —
 * for frequency and money, which only mean something next to each other.
 * ponytail: thirds, not the usual fifths: with ~40 plants, fifths of eight
 * would swing on a single order. Move to fifths past ~150 customers.
 */
function tertile(values: number[], higherIsBetter: boolean): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (v) => {
    // Binary search for how many sit below (or above) v: a scan per customer is quadratic.
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (higherIsBetter ? sorted[mid] < v : sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    const below = higherIsBetter ? lo : sorted.length - lo;
    const pos = sorted.length > 1 ? below / (sorted.length - 1) : 1;
    return pos >= 2 / 3 ? 3 : pos >= 1 / 3 ? 2 : 1;
  };
}

/**
 * Every plant (party) as of `today`, from its whole order history: RFM
 * scores (recency by days: ≤14 → 3, ≤45 → 2; frequency and money by
 * thirds), a segment, and a churn-risk flag.
 *
 * Segments, first that fits: New (first order in the last 30 days) ·
 * Champion (recent and frequent) · At risk (quiet, but ordered often or
 * big) · Lost (quiet, small and rare) · Loyal (frequent, not quiet) ·
 * Promising (recent, the rest).
 *
 * Risk: high when it's At risk, has gone over two usual gaps without an
 * order, or is a top-third spender past its usual gap; watch when it's past
 * its usual gap or its last 30 days are under half the 30 before.
 */
export function segmentsOf(rows: SepRow[], today: string, cycles: Cycle[]): CustomerRow[] {
  const by = new Map<string, SepRow[]>();
  for (const r of rows) {
    if (r.day > today) continue;
    const k = partyKey(r.party);
    push(by, k, r);
  }
  const cycleOf = new Map(cycles.map((c) => [c.key, c]));
  const base = Array.from(by.entries()).map(([key, list]) => {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const orders = ordersOf(list);
    let last30 = 0, prev30 = 0;
    for (const r of list) {
      const ago = daysBetween(r.day, today);
      if (ago < 30) last30 += num(r.order_value);
      else if (ago < 60) prev30 += num(r.order_value);
    }
    const party = list[list.length - 1].party.trim();
    return {
      key, party, group: groupKey(party),
      firstDay: list[0].day, lastDay: list[list.length - 1].day,
      daysSince: daysBetween(list[list.length - 1].day, today),
      orders: orders.length,
      value: list.reduce((s, r) => s + num(r.order_value), 0),
      last30, prev30,
    };
  });

  // Recency is days, not a rank: ordered in the last two weeks is recent
  // however everyone else is doing; quiet for over 45 days is quiet.
  const R = (days: number) => (days <= 14 ? 3 : days <= 45 ? 2 : 1);
  const F = tertile(base.map((b) => b.orders), true);
  const M = tertile(base.map((b) => b.value), true);

  return base.map((b) => {
    const score = { r: R(b.daysSince), f: F(b.orders), m: M(b.value) };
    const segment: Segment =
      daysBetween(b.firstDay, today) < 30 ? 'New'
      : score.r === 3 && score.f === 3 ? 'Champion'
      : score.r === 1 && (score.f >= 2 || score.m >= 2) ? 'At risk'
      : score.r === 1 ? 'Lost'
      : score.f >= 2 ? 'Loyal'
      : 'Promising';
    const c = cycleOf.get(b.key);
    const late = c && (c.status === 'overdue' || c.status === 'lapsed');
    const dropped = b.prev30 > 0 && b.last30 < b.prev30 / 2;
    const risk: CustomerRow['risk'] =
      segment === 'At risk' || c?.status === 'lapsed' || (late && score.m === 3) ? 'high'
      : late || dropped ? 'watch' : null;
    const why =
      segment === 'At risk' ? `No order for ${b.daysSince} days, after ${b.orders} order${b.orders === 1 ? '' : 's'}`
      : late ? `${c!.lateDays} days past its usual ${c!.cycleDays}-day gap`
      : dropped ? 'Last 30 days under half of the 30 before'
      : '';
    return { ...b, cycleDays: c?.cycleDays ?? null, score, segment, risk, why };
  }).sort((x, y) => y.value - x.value);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Party names one or two letters apart — COROMANDAL / COROMANDEL — which
 * split one customer's figures in two. Plants of a group ("SML - 1" /
 * "SML - 2") differ by design and aren't flagged.
 */
export function likelyDuplicates(all: SepRow[]): Analysis['duplicates'] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of all) {
    if (r.cancelled) continue;
    const k = partyKey(r.party);
    const c = counts.get(k) ?? { name: r.party.trim(), n: 0 };
    c.n += 1;
    counts.set(k, c);
  }
  const keys = Array.from(counts.keys());
  const out: Analysis['duplicates'] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]];
      if (Math.min(a.length, b.length) < 5 || (groupKey(a) === groupKey(b) && a !== groupKey(a) && b !== groupKey(b))) continue;
      if (editDistance(a, b) > 2) continue;
      const [x, y] = [counts.get(a)!, counts.get(b)!];
      out.push(x.n >= y.n ? { a: y.name, b: x.name, aOrders: y.n, bOrders: x.n } : { a: x.name, b: y.name, aOrders: x.n, bOrders: y.n });
    }
  }
  return out;
}

/**
 * Rates per party + PM code, as of `today`, for products billed at more
 * than one rate. Smaller runs cost more a label, so a higher rate on a
 * smaller order is expected; what isn't is an order billed lower than an
 * earlier or same-day one at least as big. `atStake` adds up, over those orders, the
 * labels × the difference to that earlier rate — the most it could be
 * short, if the cut wasn't agreed.
 */
export function rateChecksOf(rows: SepRow[], today: string): RateCheck[] {
  const by = new Map<string, SepRow[]>();
  for (const r of rows) {
    const pm = pmKey(r.pm_code);
    if (!pm || r.day > today || !r.rate || !r.quantity) continue;
    const k = `${partyKey(r.party)}|${pm}`;
    push(by, k, r);
  }
  const out: RateCheck[] = [];
  for (const [key, list] of Array.from(by.entries())) {
    if (new Set(list.map((r) => r.rate)).size < 2) continue;
    list.sort((a, b) => a.day.localeCompare(b.day));
    const lines = list.map((r) => ({ day: r.day, sr_no: r.sr_no, qty: r.quantity!, rate: r.rate! }));
    let atStake = 0;
    let undercut: RateCheck['undercut'] = null, worst = 0;
    for (const line of lines) {
      const was = lines
        .filter((e) => e !== line && e.day <= line.day && e.qty >= line.qty && e.rate > line.rate)
        .reduce<RateLine | null>((m, e) => (!m || e.rate > m.rate ? e : m), null);
      if (!was) continue;
      const gap = line.qty * (was.rate - line.rate);
      atStake += gap;
      if (gap > worst) { worst = gap; undercut = { line, was }; }
    }
    const rates = lines.map((l) => l.rate);
    const last = list[list.length - 1];
    out.push({
      key, party: last.party.trim(), pm_code: last.pm_code!.trim(), material: last.material_name?.trim() || null,
      lines, low: Math.min(...rates), high: Math.max(...rates), latest: lines[lines.length - 1].rate,
      atStake, undercut,
    });
  }
  return out.sort((x, y) => y.atStake - x.atStake || y.high / y.low - x.high / x.low);
}

/**
 * Products (party + PM code) as of `today`. A line is a new product's
 * first order when it falls within 3 days of the product's first PO date;
 * products first seen in the data's first two weeks count as repeat — they
 * were most likely running before the data starts.
 *
 * Stage: one order, under 30 days ago → New; one order, older → Only once;
 * two or more → Reordered, or Stopped once over two usual gaps late.
 */
export function lifecycleOf(rows: SepRow[], today: string, start: string, cycles: Cycle[]): Lifecycle {
  const by = new Map<string, SepRow[]>();
  for (const r of rows) {
    const pm = pmKey(r.pm_code);
    if (!pm || r.day > today) continue;
    const k = `${partyKey(r.party)}|${pm}`;
    push(by, k, r);
  }
  const lapsed = new Set(cycles.filter((c) => c.status === 'lapsed').map((c) => c.key));
  const settled = addDays(start, 14);
  const months = new Map<string, Lifecycle['months'][number]>();
  for (let m = start.slice(0, 7); m <= today.slice(0, 7); m = addMonths(m, 1)) {
    months.set(m, { month: m, label: `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`, repeat: 0, fresh: 0, freshProducts: 0 });
  }
  const products: ProductLife[] = [];
  for (const [key, list] of Array.from(by.entries())) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const firstDay = list[0].day;
    const isNew = firstDay >= settled;
    for (const r of list) {
      const m = months.get(r.day.slice(0, 7));
      if (!m) continue;
      if (isNew && daysBetween(firstDay, r.day) < 3) m.fresh += num(r.order_value);
      else m.repeat += num(r.order_value);
    }
    if (isNew) months.get(firstDay.slice(0, 7))!.freshProducts += 1;
    const orders = ordersOf(list).length;
    const last = list[list.length - 1];
    products.push({
      key, party: last.party.trim(), pm_code: last.pm_code!.trim(), material: last.material_name?.trim() || null,
      firstDay, lastDay: last.day, orders,
      value: list.reduce((s, r) => s + num(r.order_value), 0),
      stage: orders >= 2 ? (lapsed.has(key) ? 'Stopped' : 'Reordered') : daysBetween(firstDay, today) < 30 ? 'New' : 'Only once',
    });
  }
  return { products: products.sort((a, b) => b.value - a.value), months: Array.from(months.values()) };
}

/**
 * The next four weeks, from `today`: each live reorder cycle (not lapsed)
 * lands its typical order on its due day and every usual gap after — an
 * overdue one is expected this week — plus new products at their pace over
 * the last eight weeks.
 * Back-tested on Sep 2026 (cut-offs 1, 8, 15 Sep): the four-week total
 * came within 2–11% of actual, against 11–15% for "same as the last four
 * weeks"; single weeks missed by ~40% — one-off big orders decide a week.
 * ponytail: medians, no seasonality; re-run the back-test as history grows.
 */
export function forecastOf(rows: SepRow[], today: string, cycles: Cycle[], life: Lifecycle, start: string): Forecast {
  const weeks = [0, 1, 2, 3].map((i) => ({ from: addDays(today, i * 7), to: addDays(today, i * 7 + 6), repeat: 0, fresh: 0, orders: 0 }));
  const end = weeks[3].to;
  for (const c of cycles) {
    if (c.status === 'lapsed') continue;
    for (let d = c.dueDay < today ? today : c.dueDay; d <= end; d = addDays(d, c.cycleDays)) {
      const w = weeks[Math.floor(daysBetween(today, d) / 7)];
      w.repeat += c.typicalValue; w.orders += 1;
    }
  }
  // New-product pace: first orders of products first seen in the last eight
  // weeks, but not before the data had two weeks to settle.
  const from = [addDays(today, -55), addDays(start, 14)].sort()[1];
  const span = Math.max(1, daysBetween(from, today) + 1) / 7;
  const firstOf = new Map(life.products.map((p) => [p.key, p.firstDay]));
  let fresh = 0, recent = 0;
  for (const r of rows) {
    if (r.day > today) continue;
    if (daysBetween(r.day, today) < 28) recent += num(r.order_value);
    const pm = pmKey(r.pm_code);
    const first = pm ? firstOf.get(`${partyKey(r.party)}|${pm}`) : undefined;
    if (first && first >= from && daysBetween(first, r.day) < 3) fresh += num(r.order_value);
  }
  const freshWeekly = fresh / span;
  for (const w of weeks) w.fresh = freshWeekly;
  return { weeks, recentWeekly: recent / 4, freshWeekly };
}

const productKey = (r: SepRow) => (pmKey(r.pm_code) ? `${partyKey(r.party)}|${pmKey(r.pm_code)}` : null);
const sumValue = (rows: SepRow[]) => rows.reduce((s, r) => s + num(r.order_value), 0);

/**
 * The forecast scored on itself: re-run as of 28, 35, 42… days ago with
 * only the orders dated up to then, and compared with what was dated in
 * the four weeks after. Needs six weeks of history before a cut-off, so it
 * stays empty for a new data set and gets more runs (and a truer error) as
 * months add up.
 * Each run sees the two years before its cut-off: reorder gaps run weeks
 * to months, and it keeps the cost flat however long the history gets.
 * ponytail: four runs; raise `runs` when the error needs more to settle.
 */
export function forecastCheckOf(rows: SepRow[], today: string, start: string, runs = 4): ForecastCheck {
  const out: ForecastCheck['runs'] = [];
  for (let k = 0; k < runs; k++) {
    const asOf = addDays(today, -28 - 7 * k);
    if (daysBetween(start, asOf) < 42) break;
    const from = addDays(asOf, -730);
    const known = rows.filter((r) => r.day <= asOf && r.day >= from);
    const cycles = cyclesOf(known, productKey, asOf);
    const s = [start, from].sort()[1];
    const f = forecastOf(known, asOf, cycles, lifecycleOf(known, asOf, s, cycles), s);
    const end = addDays(asOf, 27);
    out.push({
      asOf,
      predicted: f.weeks.reduce((s, w) => s + w.repeat + w.fresh, 0),
      actual: sumValue(rows.filter((r) => r.day >= asOf && r.day <= end)),
    });
  }
  const misses = out.filter((r) => r.actual > 0).map((r) => (Math.abs(r.predicted - r.actual) / r.actual) * 100);
  return { runs: out, error: misses.length ? Math.round(median(misses)) : null };
}

/** This month so far, and soFar + the forecast's share of the days left. */
export function paceOf(rows: SepRow[], today: string, forecast: Forecast): Pace {
  const month = today.slice(0, 7), end = monthEnd(month);
  const last = previousPeriod({ from: `${month}-01`, to: today });
  let soFar = 0, lastMonth = 0, lastMonthToDate = 0;
  for (const r of rows) {
    if (r.day >= `${month}-01` && r.day <= today) soFar += num(r.order_value);
    if (r.day >= last.from && r.day <= monthEnd(last.from.slice(0, 7))) {
      lastMonth += num(r.order_value);
      if (r.day <= last.to) lastMonthToDate += num(r.order_value);
    }
  }
  // Each forecast week counts for the days of it still left this month.
  let rest = 0;
  for (const w of forecast.weeks) {
    const from = [w.from, addDays(today, 1)].sort()[1], to = minDay(w.to, end);
    if (from <= to) rest += ((w.repeat + w.fresh) * (daysBetween(from, to) + 1)) / 7;
  }
  return { month, soFar, day: +today.slice(8), daysIn: +end.slice(8), projected: soFar + rest, lastMonth, lastMonthToDate };
}

/**
 * What moved the value from the previous period to this one, in parts that
 * add up exactly: plants that are new, came back or didn't order; and, for
 * plants in both, products added or not reordered, then on products in
 * both, more or fewer labels (at the old rate) and the rate per label
 * (on the new labels). The rate part includes run size: a shorter run
 * bills more a label.
 */
export function bridgeOf(rows: SepRow[], prevRows: SepRow[], firstOrder: Map<string, string>, period: Period): Bridge {
  const agg = (list: SepRow[]) => {
    const m = new Map<string, { party: string; value: number; qty: number }>();
    for (const r of list) {
      const party = partyKey(r.party);
      const k = `${party}|${pmKey(r.pm_code) ?? (r.material_name ?? '').trim().toUpperCase()}`;
      const a = m.get(k) ?? { party, value: 0, qty: 0 };
      a.value += num(r.order_value); a.qty += num(r.quantity);
      m.set(k, a);
    }
    return m;
  };
  const now = agg(rows), before = agg(prevRows);
  const partiesNow = new Set(rows.map((r) => partyKey(r.party)));
  const partiesBefore = new Set(prevRows.map((r) => partyKey(r.party)));
  const v: Record<BridgeKey, number> = { newCustomers: 0, returned: 0, lost: 0, addedProducts: 0, droppedProducts: 0, volume: 0, price: 0 };
  const who: Record<BridgeKey, Set<string>> = { newCustomers: new Set(), returned: new Set(), lost: new Set(), addedProducts: new Set(), droppedProducts: new Set(), volume: new Set(), price: new Set() };
  const add = (k: BridgeKey, value: number, id: string) => { v[k] += value; if (value) who[k].add(id); };

  for (const [k, n] of Array.from(now.entries())) {
    const b = before.get(k);
    if (!partiesBefore.has(n.party)) add((firstOrder.get(n.party) ?? '') >= period.from ? 'newCustomers' : 'returned', n.value, n.party);
    else if (!b) add('addedProducts', n.value, k);
    else {
      // Volume at the old rate; whatever's left is the rate. No labels on either side → all volume.
      const volume = b.qty > 0 && n.qty > 0 ? (n.qty - b.qty) * (b.value / b.qty) : n.value - b.value;
      add('volume', volume, k);
      add('price', n.value - b.value - volume, k);
    }
  }
  for (const [k, b] of Array.from(before.entries())) {
    if (now.has(k)) continue;
    if (!partiesNow.has(b.party)) add('lost', -b.value, b.party);
    else add('droppedProducts', -b.value, k);
  }
  return {
    from: sumValue(prevRows), to: sumValue(rows),
    steps: (Object.keys(v) as BridgeKey[]).map((key) => ({ key, value: v[key], count: who[key].size })),
  };
}

/**
 * Plants grouped by the month of their first order, and the share of each
 * group that ordered in every month since. Plants already ordering when the
 * data starts land in its first month, marked as on the books. Last 12
 * cohorts, 12 months each.
 */
export function cohortsOf(rows: SepRow[], today: string, start: string): Cohort[] {
  const months = new Map<string, Set<string>>();   // party → months it ordered in
  const value = new Map<string, number>();
  for (const r of rows) {
    if (r.day > today) continue;
    const k = partyKey(r.party);
    const s = months.get(k) ?? new Set<string>();
    s.add(r.day.slice(0, 7));
    months.set(k, s);
    value.set(k, (value.get(k) ?? 0) + num(r.order_value));
  }
  const cohorts = new Map<string, string[]>();
  for (const [k, s] of Array.from(months.entries())) push(cohorts, Array.from(s).sort()[0], k);
  const now = today.slice(0, 7);
  return Array.from(cohorts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, parties]) => {
      const active: number[] = [];
      for (let m = month, i = 0; m <= now && i < 12; m = addMonths(m, 1), i++) {
        active.push(share(parties.filter((p) => months.get(p)!.has(m)).length, parties.length));
      }
      return {
        month, customers: parties.length,
        value: parties.reduce((s, p) => s + value.get(p)!, 0),
        active, partial: addMonths(month, active.length - 1) === now,
        onBooks: month === start.slice(0, 7),
      };
    });
}

/**
 * Rows that look mistyped, from every order so far: value isn't labels ×
 * rate, no value at all, or ten times the labels the product usually runs
 * (median of its orders, once it has three) — an extra zero inflates every
 * total. Far fewer than usual isn't flagged: small top-ups and samples are
 * normal in label printing.
 */
export function rowChecksOf(rows: SepRow[], today: string): RowCheck[] {
  const out: RowCheck[] = [];
  const byProduct = new Map<string, SepRow[]>();
  for (const r of rows) {
    if (r.day > today) continue;
    const v = num(r.order_value), q = num(r.quantity), rt = num(r.rate);
    if (!v) out.push({ row: r, issue: 'No order value' });
    else if (q && rt && Math.abs(q * rt - v) > Math.max(1, v / 100)) {
      out.push({ row: r, issue: `Value ₹${Math.round(v).toLocaleString('en-US')}, but labels × rate is ₹${Math.round(q * rt).toLocaleString('en-US')}` });
    }
    const k = productKey(r);
    if (k && q) push(byProduct, k, r);
  }
  for (const list of Array.from(byProduct.values())) {
    if (list.length < 3) continue;
    // One median for the product, the odd row included: it barely moves a median.
    const usual = median(list.map((x) => num(x.quantity)));
    for (const r of list) {
      const q = num(r.quantity);
      if (usual > 0 && q >= usual * 10) {
        out.push({ row: r, issue: `${q.toLocaleString('en-US')} labels; this product usually runs ${Math.round(usual).toLocaleString('en-US')}. An extra zero?` });
      }
    }
  }
  return out.sort((x, y) => y.row.day.localeCompare(x.row.day));
}

/** The same days a year earlier; 29 Feb → 28 Feb. */
const yearBefore = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4) === '-02-29' ? '-02-28' : d.slice(4)}`;

/** "UPL-3", "UPL - 03" and "SML LIMITED-2" / "SML - 2" alike: no spaces, dashes, LIMITED/LTD or leading zeros. */
const looseKey = (p: string) => partyKey(p).replace(/\b(LIMI+TED|LTD)\b\.?/g, '').replace(/[\s.-]+/g, '').replace(/(\D)0+(\d)/g, '$1$2');

/**
 * Shade cards since `since` (the order book's first day — an older card's
 * PO can't be seen), each matched to Job Separation by PM code. The PO
 * usually comes first; a PO up to 60 days before the card is the order it's
 * for, else the first PO after it counts. Party names are spelled
 * differently on the two sheets, so a card takes the Job Separation
 * spelling when a loose match finds one.
 */
export function approvalsOf(cards: ShadeCard[], rows: SepRow[], since: string, today: string, keep: (customer: string) => boolean = () => true): Approvals {
  const names = new Map(rows.map((r) => [looseKey(r.party), r.party.trim()]));
  const byPm = new Map<string, SepRow[]>();
  for (const r of rows) {
    const pm = pmKey(r.pm_code);
    if (pm) push(byPm, pm, r);
  }
  const tracks: CardTrack[] = [];
  for (const c of cards) {
    const start = c.sent ?? c.prepared;
    if (!start || start < since || start > today) continue;
    const customer = names.get(looseKey(c.party)) ?? c.party.trim();
    if (!keep(customer)) continue;
    const pos = byPm.get(pmKey(c.pm_code) ?? '') ?? [];
    const before = pos.filter((r) => r.day <= start && daysBetween(r.day, start) <= 60).map((r) => r.day).sort().pop();
    const after = pos.filter((r) => r.day > start).map((r) => r.day).sort()[0];
    const poDay = before ?? after ?? null;
    tracks.push({
      ...c, start,
      customer,
      poDay, hasOrder: poDay != null,
      poValue: poDay ? pos.filter((r) => r.day >= poDay).reduce((s, r) => s + num(r.order_value), 0) : 0,
      days: c.status === 'Approved' && c.approved ? daysBetween(start, c.approved) : daysBetween(start, today),
      sinceApproved: c.approved ? daysBetween(c.approved, today) : null,
    });
  }
  tracks.sort((a, b) => b.start.localeCompare(a.start));

  const known = (xs: (number | null)[]) => xs.filter((x): x is number => x != null && x >= 0);
  const med = (xs: (number | null)[]) => (known(xs).length ? median(known(xs)) : null);
  const step = (xs: (number | null)[]) => ({ days: med(xs), n: known(xs).length });
  const gap = (a: string | null, b: string | null) => (a && b ? daysBetween(a, b) : null);
  const ordered = tracks.filter((t) => t.poDay && t.poDay <= t.start);
  const pending = (t: CardTrack) => t.status !== 'Approved';
  const oldest = (a: CardTrack, b: CardTrack) => a.start.localeCompare(b.start);

  const parties = new Map<string, CardTrack[]>();
  for (const t of tracks) push(parties, t.customer, t);

  return {
    since, cards: tracks,
    steps: {
      poToCard:       step(ordered.map((t) => gap(t.poDay, t.prepared ?? t.start))),
      cardToSent:     step(tracks.map((t) => gap(t.prepared, t.sent))),
      sentToApproved: step(tracks.map((t) => gap(t.sent, t.approved))),
      poToApproved:   step(ordered.map((t) => gap(t.poDay, t.approved))),
    },
    waiting: tracks.filter((t) => pending(t) && t.sent).sort(oldest),
    notSent: tracks.filter((t) => pending(t) && !t.sent).sort(oldest),
    noOrder: tracks.filter((t) => !pending(t) && !t.hasOrder).sort(oldest),
    byParty: Array.from(parties.entries()).map(([customer, ts]) => ({
      customer, cards: ts.length,
      pending: ts.filter(pending).length,
      noOrder: ts.filter((t) => !t.hasOrder).length,
      sentToApproved: med(ts.map((t) => gap(t.sent, t.approved))),
    })).sort((a, b) => b.cards - a.cards),
  };
}

/** The earliest day in the data — where "All" starts. */
export function earliestDay(all: SepRow[]): string | null {
  let d: string | null = null;
  for (const r of all) if (d === null || r.day < d) d = r.day;
  return d;
}

type Standing = Pick<Analysis,
  'reorders' | 'partyCycles' | 'lifecycle' | 'forecast' | 'forecastCheck' | 'pace' | 'customers' | 'duplicates'
  | 'rateChecks' | 'noPmCode' | 'approvals' | 'cohorts' | 'rowChecks'> & { first: Map<string, { day: string; party: string }> };

// The last standing() answer. It depends on the rows, unit / party and
// today — not the period — so flicking between periods reuses it instead
// of re-running cycles, the forecast and its back-test.
let standingMemo: { all: SepRow[]; cards?: ShadeCard[]; key: string; value: Standing } | null = null;

/** Everything "as of today": every order so far for these filters, whatever period is picked. */
function standing(all: SepRow[], live: SepRow[], filter: Filter, today: string, start: string | null, cards?: ShadeCard[]): Standing {
  const key = `${filter.unit}|${filter.group}|${filter.party}|${today}`;
  if (standingMemo && standingMemo.all === all && standingMemo.cards === cards && standingMemo.key === key) return standingMemo.value;

  const s = start ?? today;
  const partyCycles = cyclesOf(live, (r) => partyKey(r.party), today);
  const reorders  = cyclesOf(live, productKey, today);
  const lifecycle = lifecycleOf(live, today, s, reorders);
  const forecast  = forecastOf(live, today, reorders, lifecycle, s);
  const first = new Map<string, { day: string; party: string }>();
  for (const r of live) {
    const k = partyKey(r.party);
    const f = first.get(k);
    if (!f || r.day < f.day) first.set(k, { day: r.day, party: r.party.trim() });
  }
  const value: Standing = {
    first, reorders, partyCycles, lifecycle, forecast,
    forecastCheck: forecastCheckOf(live, today, s),
    pace:        paceOf(live, today, forecast),
    customers:   segmentsOf(live, today, partyCycles),
    duplicates:  likelyDuplicates(all),
    rateChecks:  rateChecksOf(live, today),
    noPmCode:    live.filter((r) => r.day <= today && !pmKey(r.pm_code)).sort((x, y) => y.day.localeCompare(x.day)),
    cohorts:     cohortsOf(live, today, s),
    rowChecks:   rowChecksOf(live, today),
    // Unit doesn't apply to approvals: a card has none.
    approvals:   cards && start ? approvalsOf(cards, all.filter((r) => !r.cancelled), start, today,
      (c) => (!filter.group || groupKey(c) === filter.group) && (!filter.party || partyKey(c) === filter.party)) : null,
  };
  standingMemo = { all, cards, key, value };
  return value;
}

export function analyse(all: SepRow[], period: Period, filter: Filter, today: string, cards?: ShadeCard[]): Analysis {
  const previous = previousPeriod(period);
  const matches = (r: SepRow) =>
    (!filter.unit || unitKey(r.unit) === filter.unit)
    && (!filter.group || groupKey(r.party) === filter.group)
    && (!filter.party || partyKey(r.party) === filter.party);

  const live      = all.filter((r) => !r.cancelled && matches(r));
  const rows      = live.filter((r) => inPeriod(r, period));
  const prevRows  = live.filter((r) => inPeriod(r, previous));
  const cancelled = all.filter((r) => r.cancelled && matches(r) && inPeriod(r, period));
  const totals    = totalsOf(rows);
  const parties   = partiesOf(rows, prevRows, totals.value);
  const groups    = partiesOf(rows, prevRows, totals.value, groupKey);
  const start     = earliestDay(all);
  const { first, ...st } = standing(all, live, filter, today, start, cards);

  // New = the party's first order ever lands in the period. A party whose
  // first order is on the data's very first day isn't new — the data just
  // starts there.
  const newParties = Array.from(first.values())
    .filter((f) => f.day >= period.from && f.day <= period.to && f.day !== start)
    .map((f) => f.party)
    .sort((a, b) => a.localeCompare(b));

  const now = new Set(parties.map((p) => p.key));
  const quiet = new Map<string, { party: string; prevValue: number }>();
  for (const r of prevRows) {
    const k = partyKey(r.party);
    if (now.has(k)) continue;
    const q = quiet.get(k) ?? { party: r.party.trim(), prevValue: 0 };
    q.prevValue += num(r.order_value);
    quiet.set(k, q);
  }

  const lastYear = { from: yearBefore(period.from), to: yearBefore(period.to) };

  return {
    ...st,
    period, previous, totals,
    prevTotals: totalsOf(prevRows),
    bridge:     bridgeOf(rows, prevRows, new Map(Array.from(first.entries()).map(([k, f]) => [k, f.day])), period),
    yearAgo:    start && start <= lastYear.from ? { period: lastYear, totals: totalsOf(live.filter((r) => inPeriod(r, lastYear))) } : null,
    cancelled:  { orders: cancelled.length, value: cancelled.reduce((s, r) => s + num(r.order_value), 0) },
    trend:      trendOf(rows, period),
    units:      slices(rows, (r) => unitKey(r.unit), [...UNITS, '—'], unitLabel).filter((s) => s.key !== '—' || s.orders > 0),
    parties,
    products:   productsOf(rows),
    sizes:      slices(rows, (r) => SIZES.find(([, max]) => num(r.order_value) < max)![0], SIZES.map(([l]) => l)),
    artwork:    slices(rows, (r) => artworkKind(r.aw_send_to), ['Repeat', 'New artwork', 'Not recorded']),
    jobCards:   slices(rows, (r) => jobCardKind(r.jc_status), ['Job card made', 'Not made yet', 'On hold / cancelled', 'Other note']).filter((s) => s.orders > 0),
    weekdays:   slices(rows, (r) => WEEKDAYS[weekdayOf(r.day)], WEEKDAYS),
    newParties,
    quietParties: Array.from(quiet.values()).sort((a, b) => b.prevValue - a.prevValue),
    top5Share:  share(parties.slice(0, 5).reduce((s, p) => s + p.value, 0), totals.value),
    lines:      [...rows].sort((x, y) => x.day.localeCompare(y.day)),
    groups,
    top3GroupShare: share(groups.slice(0, 3).reduce((s, g) => s + g.value, 0), totals.value),
    priceCurve:  QTY_BANDS.map(([label, max], i) => {
      const band = rows.filter((r) => num(r.quantity) < max && num(r.quantity) >= (i ? QTY_BANDS[i - 1][1] : 0));
      const t = totalsOf(band);
      return { label, orders: t.orders, qty: t.qty, value: t.value, rate: t.avgRate };
    }),
  };
}

/** Every party seen, for the filter list: one display name per key, with its group, A–Z. */
export function partyOptions(all: SepRow[]): { key: string; party: string; group: string }[] {
  const m = new Map<string, string>();
  for (const r of all) if (!m.has(partyKey(r.party))) m.set(partyKey(r.party), r.party.trim());
  return Array.from(m.entries())
    .map(([key, party]) => ({ key, party, group: groupKey(party) }))
    .sort((a, b) => a.party.localeCompare(b.party, undefined, { numeric: true }));
}
