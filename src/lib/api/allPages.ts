// src/lib/api/allPages.ts
// ============================================================
// PostgREST answers at most 1000 rows per request, and says nothing when it
// stops there — a report or a count built on one request is quietly short
// once the table grows past that. allPages asks again, a page at a time,
// until a short page says there is nothing left.
//
// The caller builds each page's query, so filters and joins stay where they
// are read. That query must end in a total order — a unique column last
// (usually .order('id')) — or rows can be skipped or repeated across pages.
//
//   const rows = await allPages((from, to) =>
//     admin.from('job_status_logs').select('…')
//       .gte('changed_at', since)
//       .order('changed_at').order('id')
//       .range(from, to));
//
// For whole-table exports, lib/export/adminExport.ts has its own walker.
// ============================================================

export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row the query matches, fetched PAGE_SIZE at a time. Throws on the first failed page. */
export async function allPages<T>(page: (from: number, to: number) => Page<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
