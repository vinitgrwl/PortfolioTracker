"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, optStr, optNum } from "@/lib/server-utils";

export async function addWatchlistItem(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const row = {
    user_id: userId,
    asset_ticker: str(formData, "asset_ticker").toUpperCase(),
    asset_name: optStr(formData, "asset_name"),
    country: str(formData, "country"),
    asset_class: str(formData, "asset_class"),
    currency: str(formData, "currency"),
    target_price: optNum(formData, "target_price"),
    notes: optStr(formData, "notes"),
  };

  if (!row.asset_ticker || !row.country || !row.asset_class || !row.currency) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("watchlist_items").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/watchlist");
}

export async function deleteWatchlistItem(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("watchlist_items")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/watchlist");
}
