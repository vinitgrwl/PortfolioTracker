"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, fetchAll } from "@/lib/server-utils";
import { parseVestedWorkbook } from "@/lib/parsers/vested";
import { parseZerodhaWorkbook } from "@/lib/parsers/zerodha";
import { parseGrowwWorkbook } from "@/lib/parsers/groww";
import { parseAngelOneWorkbook } from "@/lib/parsers/angelone";
import type { ParsedTransaction, ParseResult } from "@/lib/parsers/types";
import { transactionFingerprint } from "@/lib/txnFingerprint";

export type ImportParseState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "parsed";
      accountHint: string | null;
      transactionsJson: string;
      count: number;
      buyCount: number;
      sellCount: number;
      dividendCount: number;
      warnings: string[];
    };

async function runParse(
  formData: FormData,
  parser: (buffer: ArrayBuffer) => Promise<ParseResult>
): Promise<ImportParseState> {
  await requireUser(); // gate behind auth; parsing itself needs no DB access

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", message: "Only .xlsx files are supported right now." };
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = await parser(buffer);

    if (result.transactions.length === 0) {
      return {
        status: "error",
        message:
          result.warnings[0] ??
          "No Buy/Sell/Dividend rows found. Make sure this is the broker's own export, unedited.",
      };
    }

    return {
      status: "parsed",
      accountHint: result.accountHint,
      transactionsJson: JSON.stringify(result.transactions),
      count: result.transactions.length,
      buyCount: result.transactions.filter((t) => t.action === "buy").length,
      sellCount: result.transactions.filter((t) => t.action === "sell").length,
      dividendCount: result.transactions.filter((t) => t.action === "dividend").length,
      warnings: result.warnings,
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not read that file.",
    };
  }
}

export async function parseVestedAction(
  _prevState: ImportParseState,
  formData: FormData
): Promise<ImportParseState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".pdf")) {
    return { status: "error", message: "Only .xlsx or .pdf files are supported." };
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = name.endsWith(".pdf")
      ? await (await import("@/lib/parsers/vestedPdf")).parseVestedPdf(buffer)
      : await parseVestedWorkbook(buffer);

    if (result.transactions.length === 0) {
      return {
        status: "error",
        message:
          result.warnings[0] ??
          "No Buy/Sell/Dividend rows found. Make sure this is Vested's own export, unedited.",
      };
    }

    return {
      status: "parsed",
      accountHint: result.accountHint,
      transactionsJson: JSON.stringify(result.transactions),
      count: result.transactions.length,
      buyCount: result.transactions.filter((t) => t.action === "buy").length,
      sellCount: result.transactions.filter((t) => t.action === "sell").length,
      dividendCount: result.transactions.filter((t) => t.action === "dividend").length,
      warnings: result.warnings,
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not read that file.",
    };
  }
}

export async function parseZerodhaAction(
  _prevState: ImportParseState,
  formData: FormData
): Promise<ImportParseState> {
  return runParse(formData, parseZerodhaWorkbook);
}

export async function parseGrowwAction(
  _prevState: ImportParseState,
  formData: FormData
): Promise<ImportParseState> {
  return runParse(formData, parseGrowwWorkbook);
}

export async function parseAngelOneAction(
  _prevState: ImportParseState,
  formData: FormData
): Promise<ImportParseState> {
  return runParse(formData, parseAngelOneWorkbook);
}

// ---------------------------------------------------------------------
// Confirm & insert — identical for every broker once parsed, since every
// parser emits the same ParsedTransaction shape.
// ---------------------------------------------------------------------

export type ImportConfirmState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; count: number; duplicateCount: number };

export async function confirmImportAction(
  _prevState: ImportConfirmState,
  formData: FormData
): Promise<ImportConfirmState> {
  const { supabase, userId } = await requireUser();

  const memberId = str(formData, "member_id");
  const transactionsJson = str(formData, "transactions_json");

  if (!memberId) {
    return { status: "error", message: "Choose which family member this statement belongs to." };
  }
  if (!transactionsJson) {
    return { status: "error", message: "Nothing to import — parse a file first." };
  }

  let parsed: ParsedTransaction[];
  try {
    parsed = JSON.parse(transactionsJson);
  } catch {
    return { status: "error", message: "Could not read the parsed data — upload the file again." };
  }

  // Dedup against this member's existing ledger — catches re-uploading the
  // same file and overlapping date-range exports (e.g. Zerodha's per-FY
  // tradebooks) without needing the user to track what's already imported.
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

  const rows: {
    user_id: string;
    member_id: string;
    txn_date: string;
    platform: string;
    action: string;
    asset_ticker: string;
    asset_name: string | null;
    isin: string | null;
    quantity: number;
    price: number;
    fiat_fees: number;
    currency: string;
    country: string;
    asset_class: string;
    sector: null;
    notes: null;
  }[] = [];
  let duplicateCount = 0;

  for (const t of parsed) {
    const fp = transactionFingerprint({ ...t, member_id: memberId });
    if (seen.has(fp)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fp); // also catches duplicate rows within this same file
    rows.push({
      user_id: userId,
      member_id: memberId,
      txn_date: t.txn_date,
      platform: t.platform,
      action: t.action,
      asset_ticker: t.asset_ticker,
      asset_name: t.asset_name,
      isin: t.isin,
      quantity: t.quantity,
      price: t.price,
      fiat_fees: t.fiat_fees,
      currency: t.currency,
      country: t.country,
      asset_class: t.asset_class,
      sector: null,
      notes: null,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) {
      return { status: "error", message: error.message };
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/import");

  return { status: "done", count: rows.length, duplicateCount };
}
