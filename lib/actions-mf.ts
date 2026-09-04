"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, num, optStr, fetchAll } from "@/lib/server-utils";
import { searchMfSchemes, bestMfMatch, getSchemeByCode, type MfSchemeRecord } from "@/lib/mfSchemes";
import { fetchMfApiHistory, ForwardFiller } from "@/lib/historicalPrices";
import { parseMfBulkWorkbook } from "@/lib/parsers/mfBulk";
import { transactionFingerprint } from "@/lib/txnFingerprint";

// ---------------------------------------------------------------------
// Search — used directly (not as a form action) by the MfSchemePicker
// client component for its autocomplete dropdown.
// ---------------------------------------------------------------------

export async function searchMfSchemesAction(query: string): Promise<MfSchemeRecord[]> {
  await requireUser();
  return searchMfSchemes(query);
}

// ---------------------------------------------------------------------
// Single manual add — Transactions page. Fund + date + amount in,
// NAV fetched for that date, units computed, one transaction inserted.
// ---------------------------------------------------------------------

export type MfAddState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; schemeName: string; units: number; nav: number };

export async function addMfTransactionByAmount(
  _prevState: MfAddState,
  formData: FormData
): Promise<MfAddState> {
  const { supabase, userId } = await requireUser();

  const memberId = str(formData, "member_id");
  const txnDate = str(formData, "txn_date");
  const schemeCode = str(formData, "scheme_code");
  const amount = num(formData, "amount");
  const action = str(formData, "action") || "buy";
  const platform = optStr(formData, "platform") ?? "Direct";

  if (!memberId || !txnDate || !schemeCode || !amount) {
    return { status: "error", message: "Pick a fund, a date, a member and an amount." };
  }

  const scheme = await getSchemeByCode(schemeCode);
  if (!scheme) {
    return { status: "error", message: "Couldn't find that fund — search and pick it again." };
  }

  const history = await fetchMfApiHistory(schemeCode);
  if (history.size === 0) {
    return {
      status: "error",
      message: "Couldn't fetch NAV history for this fund right now — try again shortly.",
    };
  }
  const nav = new ForwardFiller(history).valueAt(txnDate);
  if (nav === undefined) {
    return {
      status: "error",
      message: "No NAV available on or before that date for this fund.",
    };
  }

  const units = amount / nav;

  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    member_id: memberId,
    txn_date: txnDate,
    platform,
    action,
    asset_ticker: scheme.schemeName,
    asset_name: scheme.schemeName,
    isin: scheme.isin,
    quantity: units,
    price: nav,
    fiat_fees: 0,
    currency: "INR",
    country: "India",
    asset_class: "Mutual Fund",
    sector: null,
    notes: null,
  });

  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/transactions");

  return { status: "done", schemeName: scheme.schemeName, units, nav };
}

// ---------------------------------------------------------------------
// Bulk import — Import page. Parse a Fund/Date/Amount sheet, auto-match
// each row to an AMFI scheme (user can correct in the preview), then
// insert on confirm.
// ---------------------------------------------------------------------

export interface MfBulkPreviewRow {
  rowNumber: number;
  fundNameRaw: string;
  txn_date: string;
  amount: number;
  schemeCode: string | null;
  schemeName: string | null;
  isin: string | null;
  confident: boolean;
}

export type MfBulkParseState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "parsed"; rowsJson: string; count: number; unmatchedCount: number; warnings: string[] };

export async function parseMfBulkAction(
  _prevState: MfBulkParseState,
  formData: FormData
): Promise<MfBulkParseState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", message: "Only .xlsx files are supported right now." };
  }

  try {
    const buffer = await file.arrayBuffer();
    const parsed = await parseMfBulkWorkbook(buffer);

    if (parsed.rows.length === 0) {
      return {
        status: "error",
        message: parsed.warnings[0] ?? "No rows found — check the Fund Name/Date/Amount columns.",
      };
    }

    const previewRows: MfBulkPreviewRow[] = await Promise.all(
      parsed.rows.map(async (r) => {
        const match = await bestMfMatch(r.fundNameRaw);
        return {
          rowNumber: r.rowNumber,
          fundNameRaw: r.fundNameRaw,
          txn_date: r.txn_date,
          amount: r.amount,
          schemeCode: match?.record.schemeCode ?? null,
          schemeName: match?.record.schemeName ?? null,
          isin: match?.record.isin ?? null,
          confident: match?.confident ?? false,
        };
      })
    );

    const unmatchedCount = previewRows.filter((r) => !r.schemeCode || !r.confident).length;

    return {
      status: "parsed",
      rowsJson: JSON.stringify(previewRows),
      count: previewRows.length,
      unmatchedCount,
      warnings: parsed.warnings,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not read that file." };
  }
}

export type MfBulkConfirmState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; count: number; skipped: number; duplicateCount: number };

export async function confirmMfBulkAction(
  _prevState: MfBulkConfirmState,
  formData: FormData
): Promise<MfBulkConfirmState> {
  const { supabase, userId } = await requireUser();

  const memberId = str(formData, "member_id");
  const rowsJson = str(formData, "rows_json");
  const platform = optStr(formData, "platform") ?? "Direct";

  if (!memberId) return { status: "error", message: "Choose which family member this belongs to." };
  if (!rowsJson) return { status: "error", message: "Nothing to import — upload a file first." };

  let rows: MfBulkPreviewRow[];
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { status: "error", message: "Could not read the parsed data — upload the file again." };
  }

  const matched = rows.filter((r) => r.schemeCode);
  const skipped = rows.length - matched.length;

  // Fetch NAV history once per distinct scheme, not once per row.
  const schemeCodes = Array.from(new Set(matched.map((r) => r.schemeCode!)));
  const historyByCode = new Map<string, ForwardFiller>();
  await Promise.all(
    schemeCodes.map(async (code) => {
      const history = await fetchMfApiHistory(code);
      historyByCode.set(code, new ForwardFiller(history));
    })
  );

  const insertRows: {
    user_id: string;
    member_id: string;
    txn_date: string;
    platform: string;
    action: "buy";
    asset_ticker: string;
    asset_name: string | null;
    isin: string | null;
    quantity: number;
    price: number;
    fiat_fees: number;
    currency: "INR";
    country: "India";
    asset_class: "Mutual Fund";
    sector: null;
    notes: null;
  }[] = [];

  // Dedup against this member's existing ledger — same purpose as the
  // broker-import fix: catches the same MF sheet (or an overlapping range
  // of it) being uploaded twice.
  const existing = await fetchAll<{
    platform: string;
    asset_ticker: string;
    isin: string | null;
    txn_date: string;
    action: string;
    quantity: number;
    price: number;
  }>(supabase, "transactions", "platform, asset_ticker, isin, txn_date, action, quantity, price", (q) =>
    q.eq("member_id", memberId)
  );
  const seen = new Set(existing.map((t) => transactionFingerprint({ ...t, member_id: memberId })));

  let navMissing = 0;
  let duplicateCount = 0;
  for (const r of matched) {
    const filler = historyByCode.get(r.schemeCode!);
    const nav = filler?.valueAt(r.txn_date);
    if (nav === undefined) {
      navMissing += 1;
      continue;
    }
    const quantity = r.amount / nav;
    const fp = transactionFingerprint({
      member_id: memberId,
      platform,
      asset_ticker: r.schemeName!,
      isin: r.isin,
      txn_date: r.txn_date,
      action: "buy",
      quantity,
      price: nav,
    });
    if (seen.has(fp)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fp);
    insertRows.push({
      user_id: userId,
      member_id: memberId,
      txn_date: r.txn_date,
      platform,
      action: "buy",
      asset_ticker: r.schemeName!,
      asset_name: r.schemeName!,
      isin: r.isin,
      quantity,
      price: nav,
      fiat_fees: 0,
      currency: "INR",
      country: "India",
      asset_class: "Mutual Fund",
      sector: null,
      notes: null,
    });
  }

  if (insertRows.length === 0) {
    return {
      status: "error",
      message:
        duplicateCount > 0
          ? `All matched rows were already in the ledger (${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}) — nothing new to import.`
          : "None of the matched rows had a usable NAV — nothing imported.",
    };
  }

  const { error } = await supabase.from("transactions").insert(insertRows);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/import");

  return { status: "done", count: insertRows.length, skipped: skipped + navMissing, duplicateCount };
}
