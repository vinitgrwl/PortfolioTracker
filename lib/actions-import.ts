"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str } from "@/lib/server-utils";
import { parseVestedWorkbook } from "@/lib/parsers/vested";
import { parseVestedPdf } from "@/lib/parsers/vestedPdf";
import { parseZerodhaWorkbook } from "@/lib/parsers/zerodha";
import { parseGrowwWorkbook } from "@/lib/parsers/groww";
import { parseAngelOneWorkbook } from "@/lib/parsers/angelone";
import type { ParsedTransaction, ParseResult } from "@/lib/parsers/types";

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
    const result = name.endsWith(".pdf") ? await parseVestedPdf(buffer) : await parseVestedWorkbook(buffer);

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
  | { status: "done"; count: number };

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

  const rows = parsed.map((t) => ({
    user_id: userId,
    member_id: memberId,
    txn_date: t.txn_date,
    platform: t.platform,
    action: t.action,
    asset_ticker: t.asset_ticker,
    isin: t.isin,
    quantity: t.quantity,
    price: t.price,
    fiat_fees: t.fiat_fees,
    currency: t.currency,
    country: t.country,
    asset_class: t.asset_class,
    sector: null,
    notes: null,
  }));

  const { error } = await supabase.from("transactions").insert(rows);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/import");

  return { status: "done", count: rows.length };
}
