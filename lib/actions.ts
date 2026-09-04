"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, num, optStr, optNum } from "@/lib/server-utils";

// ---------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------

export async function addMember(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const name = str(formData, "name");
  if (!name) throw new Error("Name is required");

  const { error } = await supabase.from("members").insert({ user_id: userId, name });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/instruments");
}

export async function deleteMember(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("members")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/instruments");
}

// ---------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------

export async function addTransaction(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const action = str(formData, "action");
  const isDividend = action === "dividend";

  const row = {
    user_id: userId,
    member_id: str(formData, "member_id"),
    txn_date: str(formData, "txn_date"),
    platform: str(formData, "platform"),
    action,
    asset_ticker: str(formData, "asset_ticker").toUpperCase(),
    asset_name: optStr(formData, "asset_name"),
    isin: optStr(formData, "isin"),
    // dividend convention: quantity = 1, price = total cash amount
    quantity: isDividend ? 1 : num(formData, "quantity"),
    price: isDividend ? num(formData, "dividend_amount") : num(formData, "price"),
    fiat_fees: isDividend ? 0 : num(formData, "fiat_fees"),
    currency: str(formData, "currency"),
    country: str(formData, "country"),
    asset_class: str(formData, "asset_class"),
    sector: optStr(formData, "sector"),
    strategy: optStr(formData, "strategy"),
    notes: optStr(formData, "notes"),
  };

  if (!row.member_id || !row.txn_date || !row.platform || !row.asset_ticker) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("transactions").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

export async function deleteTransaction(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

export async function updateTransaction(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const id = str(formData, "id");
  const action = str(formData, "action");
  const assetClass = str(formData, "asset_class");
  const isDividend = action === "dividend";
  // Mutual Fund tickers are readable scheme names (set by the MF picker/import
  // flow) — don't uppercase those, only free-typed stock/crypto tickers.
  const rawTicker = str(formData, "asset_ticker");

  const row = {
    member_id: str(formData, "member_id"),
    txn_date: str(formData, "txn_date"),
    platform: str(formData, "platform"),
    action,
    asset_ticker: assetClass === "Mutual Fund" ? rawTicker : rawTicker.toUpperCase(),
    asset_name: optStr(formData, "asset_name"),
    isin: optStr(formData, "isin"),
    quantity: isDividend ? 1 : num(formData, "quantity"),
    price: isDividend ? num(formData, "dividend_amount") : num(formData, "price"),
    fiat_fees: isDividend ? 0 : num(formData, "fiat_fees"),
    currency: str(formData, "currency"),
    country: str(formData, "country"),
    asset_class: assetClass,
    sector: optStr(formData, "sector"),
    strategy: optStr(formData, "strategy"),
    notes: optStr(formData, "notes"),
  };

  if (!id || !row.member_id || !row.txn_date || !row.platform || !row.asset_ticker) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("transactions").update(row).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

// ---------------------------------------------------------------------
// Manual instruments (FD / ULIP)
// ---------------------------------------------------------------------

export async function addInstrument(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const assetType = str(formData, "asset_type");

  const row = {
    user_id: userId,
    member_id: str(formData, "member_id"),
    asset_type: assetType,
    label: str(formData, "label"),
    invested_amount: num(formData, "invested_amount"),
    rate: assetType === "FD" ? optNum(formData, "rate") : null,
    start_date: assetType === "FD" ? optStr(formData, "start_date") : null,
    maturity_date: assetType === "FD" ? optStr(formData, "maturity_date") : null,
    current_value: assetType === "ULIP" ? optNum(formData, "current_value") : null,
    current_value_updated_at: assetType === "ULIP" ? new Date().toISOString() : null,
    currency: str(formData, "currency") || "INR",
    notes: optStr(formData, "notes"),
  };

  if (!row.member_id || !row.label || !row.invested_amount) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("manual_instruments").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/instruments");
}

export async function updateInstrument(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const id = str(formData, "id");
  const assetType = str(formData, "asset_type");

  const row = {
    member_id: str(formData, "member_id"),
    asset_type: assetType,
    label: str(formData, "label"),
    invested_amount: num(formData, "invested_amount"),
    rate: assetType === "FD" ? optNum(formData, "rate") : null,
    start_date: assetType === "FD" ? optStr(formData, "start_date") : null,
    maturity_date: assetType === "FD" ? optStr(formData, "maturity_date") : null,
    currency: str(formData, "currency") || "INR",
    notes: optStr(formData, "notes"),
    updated_at: new Date().toISOString(),
  };

  if (!id || !row.member_id || !row.label || !row.invested_amount) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase
    .from("manual_instruments")
    .update(row)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/instruments");
}

export async function updateInstrumentValue(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");
  const currentValue = num(formData, "current_value");

  const { error } = await supabase
    .from("manual_instruments")
    .update({
      current_value: currentValue,
      current_value_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/instruments");
}

export async function deleteInstrument(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("manual_instruments")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/instruments");
}

// ---------------------------------------------------------------------
// Prices & exchange rate
// ---------------------------------------------------------------------

export async function upsertPrice(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const row = {
    user_id: userId,
    asset_ticker: str(formData, "asset_ticker").toUpperCase(),
    isin: optStr(formData, "isin"),
    currency: str(formData, "currency"),
    current_price: num(formData, "current_price"),
    updated_at: new Date().toISOString(),
  };

  if (!row.asset_ticker || !row.currency || !row.current_price) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase
    .from("latest_prices")
    .upsert(row, { onConflict: "user_id,asset_ticker,currency" });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/prices");
}

export async function deletePrice(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("latest_prices")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/prices");
}

export async function upsertExchangeRate(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const rate = num(formData, "rate");
  if (!rate) throw new Error("Rate is required");

  const { error } = await supabase.from("exchange_rates").upsert(
    {
      user_id: userId,
      pair: "USD_INR",
      rate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,pair" }
  );
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/prices");
}
