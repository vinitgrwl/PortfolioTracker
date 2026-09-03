"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/dashboard", label: "Net worth" },
  { href: "/import", label: "Import" },
  { href: "/transactions", label: "Transactions" },
  { href: "/instruments", label: "FDs & ULIPs" },
  { href: "/prices", label: "Prices" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:min-h-screen bg-ink text-paper-raised px-5 py-6">
        <div className="mb-8">
          <div className="figure-large text-lg leading-tight">The Family Ledger</div>
          <div className="text-xs text-paper-raised/60 mt-1">Consolidated net worth</div>
        </div>
        <div className="flex flex-col gap-1">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-2 rounded-sm text-sm ${
                  active
                    ? "bg-paper-raised/10 text-brass-soft"
                    : "text-paper-raised/80 hover:text-paper-raised"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <button
          onClick={signOut}
          className="mt-auto text-left text-xs text-paper-raised/50 hover:text-paper-raised px-3 py-2"
        >
          Sign out
        </button>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-ink text-paper-raised flex justify-around py-2.5 z-20 border-t border-white/10">
        {LINKS.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[0.7rem] px-2 ${
                active ? "text-brass-soft" : "text-paper-raised/70"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
