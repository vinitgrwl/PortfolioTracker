import { createClient } from "@/lib/supabase/server";
import type { Member } from "@/lib/types";
import BrokerImportForm from "@/components/BrokerImportForm";
import {
  parseVestedAction,
  parseZerodhaAction,
  parseGrowwAction,
  parseAngelOneAction,
} from "@/lib/actions-import";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("*").order("name");
  const members = (data ?? []) as Member[];

  return (
    <div>
      <h1 className="figure-large text-2xl mb-6">Import from a broker</h1>

      {members.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Add a family member on the Transactions page first — every import needs to be
          assigned to someone.
        </p>
      ) : (
        <>
          <Section title="Vested (US equities)">
            <BrokerImportForm
              members={members}
              parseAction={parseVestedAction}
              brokerLabel="Vested"
              hintLabel="Statement name"
            />
            <p className="px-3 pb-4 text-xs text-ink-soft">
              PDF fallback isn&rsquo;t wired up yet — export and upload the .xlsx from Vested.
            </p>
          </Section>

          <Section title="Zerodha (Tradebook for Equity)">
            <BrokerImportForm
              members={members}
              parseAction={parseZerodhaAction}
              brokerLabel="Zerodha Tradebook"
              hintLabel="Client ID on statement"
            />
            <p className="px-3 pb-4 text-xs text-ink-soft">
              No brokerage/STT/GST columns in this file, so fees aren&rsquo;t captured — current-FY
              cost basis will be slightly approximate until the Tax P&amp;L report parser exists.
            </p>
          </Section>

          <Section title="Groww (Stocks Order History)">
            <BrokerImportForm
              members={members}
              parseAction={parseGrowwAction}
              brokerLabel="Groww Order History"
              hintLabel="Statement name"
            />
            <p className="px-3 pb-4 text-xs text-ink-soft">
              Only rows with status &ldquo;Executed&rdquo; are imported. No fee columns here either —
              same approximation as Zerodha until the Capital Gains Report parser exists.
            </p>
          </Section>

          <Section title="AngelOne (TradesAndCharges)">
            <BrokerImportForm
              members={members}
              parseAction={parseAngelOneAction}
              brokerLabel="AngelOne TradesAndCharges"
              hintLabel="Client code on statement"
            />
            <p className="px-3 pb-4 text-xs text-ink-soft">
              Most accurate fees of the four — full brokerage/GST/STT/stamp-duty breakdown is
              captured per trade. But this export has no ISIN, only the full company name, so
              these holdings won&rsquo;t automatically merge with the same company imported from
              another broker yet.
            </p>
          </Section>
        </>
      )}

      <Section title="Coming later">
        <p className="px-3 py-4 text-sm text-ink-soft">
          Dhan follows the same pattern — mapped once a sample statement is available.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm text-ink-soft mb-2">{title}</h2>
      <div className="bg-paper-raised border border-rule">{children}</div>
    </div>
  );
}
