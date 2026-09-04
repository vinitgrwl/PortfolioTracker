import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction, CompanyEvent } from "./types";
import { applyCompanyEvents } from "./companyEvents";

export async function requireUser() {
  const supabase = await createClient();
  // Cookie-based, not a network round-trip: middleware (proxy.ts) already
  // called getUser() for this same request and redirects unauthenticated
  // requests to /login before a page ever renders, so re-verifying against
  // Supabase's auth server here would just be a second network call for
  // the same answer. getSession() reads the already-verified session
  // straight from the cookie.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not signed in");
  return { supabase, userId: session.user.id };
}

/**
 * Supabase's REST API caps any single select at 1000 rows by default
 * (project's "Max Rows" setting) — a query with no .range() silently
 * returns only the first page, which under-counts holdings once the
 * ledger grows past that. This fetches every row in a table by paging
 * through .range() until a page comes back short of the page size.
 *
 * Use this for any full-table read used in an aggregation (holdings,
 * net worth, realized P&L, history backfill) — anywhere a truncated
 * result would silently produce a wrong number rather than an error.
 */
export async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns = "*",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configure?: (query: any) => any,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(columns);
    if (configure) query = configure(query);
    const { data, error } = await query.range(from, from + pageSize - 1);

    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function num(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v === "" ? 0 : Number(v);
}

export function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v === "" ? null : v;
}

export function optNum(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  return v === "" ? null : Number(v);
}

// ---------------------------------------------------------------------
// Effective (company-event-adjusted) transactions — the single place
// that combines the raw ledger with company_events (renames/mergers)
// for every computed view (holdings, realized P&L, price lookups).
// The raw Transactions ledger page reads the table directly instead,
// so it always shows exactly what was logged.
// ---------------------------------------------------------------------

export async function fetchEffectiveTransactions(supabase: SupabaseClient): Promise<Transaction[]> {
  const [transactions, events] = await Promise.all([
    fetchAll<Transaction>(supabase, "transactions"),
    fetchAll<CompanyEvent>(supabase, "company_events"),
  ]);
  return applyCompanyEvents(transactions, events);
}
