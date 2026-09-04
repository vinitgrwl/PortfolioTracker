"use server";

import { revalidatePath } from "next/cache";
import { requireUser, str, num, optStr } from "@/lib/server-utils";
import type { CashAction } from "@/lib/types";

const SINGLE_SIDED: CashAction[] = ["deposit", "withdrawal", "interest", "fees"];

// ---------------------------------------------------------------------
// Deposit / Withdrawal / Interest / Fees — one row, one platform.
// ---------------------------------------------------------------------

export async function addCashTransaction(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const action = str(formData, "action") as CashAction;
  if (!SINGLE_SIDED.includes(action)) throw new Error("Invalid action for a single-sided entry");

  const row = {
    user_id: userId,
    member_id: str(formData, "member_id"),
    txn_date: str(formData, "txn_date"),
    platform: str(formData, "platform"),
    action,
    amount: num(formData, "amount"),
    currency: str(formData, "currency"),
    notes: optStr(formData, "notes"),
  };

  if (!row.member_id || !row.txn_date || !row.platform || !row.amount || !row.currency) {
    throw new Error("Missing required fields");
  }

  const { error } = await supabase.from("cash_transactions").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/cash");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------
// Transfer — one form, two linked rows (transfer_send at the source,
// transfer_deposit at the destination), sharing transfer_group_id.
// ---------------------------------------------------------------------

export async function addCashTransfer(formData: FormData) {
  const { supabase, userId } = await requireUser();

  const memberId = str(formData, "member_id");
  const txnDate = str(formData, "txn_date");
  const fromPlatform = str(formData, "from_platform");
  const toPlatform = str(formData, "to_platform");
  const amount = num(formData, "amount");
  const currency = str(formData, "currency");
  const notes = optStr(formData, "notes");

  if (!memberId || !txnDate || !fromPlatform || !toPlatform || !amount || !currency) {
    throw new Error("Missing required fields");
  }
  if (fromPlatform === toPlatform) {
    throw new Error("Transfer must be between two different platforms");
  }

  const transferGroupId = crypto.randomUUID();

  const { error } = await supabase.from("cash_transactions").insert([
    {
      user_id: userId,
      member_id: memberId,
      txn_date: txnDate,
      platform: fromPlatform,
      action: "transfer_send",
      amount,
      currency,
      transfer_group_id: transferGroupId,
      counterparty_platform: toPlatform,
      notes,
    },
    {
      user_id: userId,
      member_id: memberId,
      txn_date: txnDate,
      platform: toPlatform,
      action: "transfer_deposit",
      amount,
      currency,
      transfer_group_id: transferGroupId,
      counterparty_platform: fromPlatform,
      notes,
    },
  ]);
  if (error) throw new Error(error.message);

  revalidatePath("/cash");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------
// Delete — a transfer's two rows are deleted together via transfer_group_id;
// a single-sided entry is deleted by its own id.
// ---------------------------------------------------------------------

export async function deleteCashTransaction(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const id = str(formData, "id");
  const transferGroupId = optStr(formData, "transfer_group_id");

  const query = supabase.from("cash_transactions").delete().eq("user_id", userId);
  const { error } = transferGroupId
    ? await query.eq("transfer_group_id", transferGroupId)
    : await query.eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/cash");
  revalidatePath("/dashboard");
}
