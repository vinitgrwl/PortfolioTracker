import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, userId: user.id };
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
