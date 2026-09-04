"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, num, optStr } from "@/lib/server-utils";

export async function addCompanyEvent(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const eventType = str(formData, "event_type");
  const isRename = eventType === "rename";

  const row = {
    user_id: userId,
    event_type: eventType,
    old_ticker: str(formData, "old_ticker").toUpperCase(),
    old_isin: optStr(formData, "old_isin"),
    old_country: str(formData, "old_country"),
    new_ticker: str(formData, "new_ticker").toUpperCase(),
    new_isin: optStr(formData, "new_isin"),
    new_country: str(formData, "new_country"),
    // a rename is always 1:1 — the ratio fields only mean something for a merger
    ratio_from: isRename ? 1 : num(formData, "ratio_from"),
    ratio_to: isRename ? 1 : num(formData, "ratio_to"),
    effective_date: str(formData, "effective_date"),
  };

  if (
    !row.event_type ||
    !row.old_ticker ||
    !row.old_country ||
    !row.new_ticker ||
    !row.new_country ||
    !row.effective_date ||
    !row.ratio_from ||
    !row.ratio_to
  ) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase
    .from("company_events")
    .upsert(row, { onConflict: "user_id,old_ticker,old_country,effective_date" });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/returns");
  revalidatePath("/prices");
  revalidatePath("/rebalancing");
  revalidatePath("/sector-wise");
  revalidatePath("/invested-per-month");
}

export async function deleteCompanyEvent(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");

  const { error } = await supabase.from("company_events").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/returns");
  revalidatePath("/prices");
  revalidatePath("/rebalancing");
  revalidatePath("/sector-wise");
  revalidatePath("/invested-per-month");
}
