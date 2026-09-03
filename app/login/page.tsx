"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createClient();

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      setInfo("Account created. Check the inbox to confirm the email, then sign in.");
      setMode("sign-in");
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="figure-large text-2xl text-ink">The Family Ledger</div>
          <div className="text-sm text-ink-soft mt-1">One account for the whole family</div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-paper-raised border border-rule px-6 py-6"
        >
          <label className="block text-sm text-ink-soft mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-rule bg-white px-3 py-2 mb-4 text-sm outline-none focus:border-ink"
          />

          <label className="block text-sm text-ink-soft mb-1">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-rule bg-white px-3 py-2 mb-4 text-sm outline-none focus:border-ink"
          />

          {error && <p className="text-loss text-sm mb-4">{error}</p>}
          {info && <p className="text-gain text-sm mb-4">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-paper-raised py-2.5 text-sm disabled:opacity-60"
          >
            {loading ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
              setInfo(null);
            }}
            className="w-full text-center text-xs text-ink-soft mt-4 hover:text-ink"
          >
            {mode === "sign-in"
              ? "First time — create the family account"
              : "Already have an account — sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
