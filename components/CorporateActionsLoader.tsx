"use client";

import { useState, useTransition } from "react";
import { listCorporateActions } from "@/lib/actions-corp-actions";
import CorporateActionsManager from "@/components/CorporateActionsManager";
import type { CorporateAction } from "@/lib/types";

export default function CorporateActionsLoader({ approxCount }: { approxCount: number }) {
  const [actions, setActions] = useState<CorporateAction[] | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => startTransition(async () => setActions(await listCorporateActions()));

  if (actions === null) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-sm text-ink-soft mb-3">
          {approxCount > 0 ? `${approxCount} corporate action${approxCount === 1 ? "" : "s"} logged.` : "None logged yet."}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={load}
          className="bg-ink text-paper-raised text-sm px-5 py-2 disabled:opacity-60"
        >
          {pending ? "Loading…" : "Load corporate actions"}
        </button>
      </div>
    );
  }

  return <CorporateActionsManager actions={actions} onRefresh={load} />;
}
