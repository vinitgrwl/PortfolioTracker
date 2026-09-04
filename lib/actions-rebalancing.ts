"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, num, optStr } from "@/lib/server-utils";

export async function upsertClassTarget(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const row = {
    user_id: userId,
    asset_class: str(formData, "asset_class"),
    target_weight_pct: num(formData, "target_weight_pct"),
    updated_at: new Date().toISOString(),
  };

  if (!row.asset_class) throw new Error("Asset class is required");

  const { error } = await supabase
    .from("asset_class_targets")
    .upsert(row, { onConflict: "user_id,asset_class" });
  if (error) throw new Error(error.message);

  revalidatePath("/rebalancing");
}

export async function deleteClassTarget(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("asset_class_targets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/rebalancing");
}

export async function upsertTickerTarget(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const row = {
    user_id: userId,
    asset_class: str(formData, "asset_class"),
    asset_ticker: str(formData, "asset_ticker").toUpperCase(),
    isin: optStr(formData, "isin"),
    target_weight_pct: num(formData, "target_weight_pct"),
    updated_at: new Date().toISOString(),
  };

  if (!row.asset_class || !row.asset_ticker) throw new Error("Missing required fields");

  const { error } = await supabase
    .from("ticker_targets")
    .upsert(row, { onConflict: "user_id,asset_class,asset_ticker" });
  if (error) throw new Error(error.message);

  revalidatePath("/rebalancing");
}

export async function deleteTickerTarget(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase
    .from("ticker_targets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/rebalancing");
}
