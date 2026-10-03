import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useSelectedMonth } from "../hooks/MonthContext";
import { useExpenses, useMonthSummary } from "../lib/queries";
import { errorMessage } from "../lib/api";
import { MonthSwitcher } from "../components/MonthSwitcher";
import { Ledger } from "../components/Ledger";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { EntryRow } from "../components/EntryCard";
import { IncomeSheet } from "../components/IncomeSheet";
import { SavingsSheet } from "../components/SavingsSheet";
import { Button, ErrorState, Panel, SectionTitle, Skeleton } from "../components/ui";

export default function Dashboard() {
  const { month, setMonth } = useSelectedMonth();
  const summary = useMonthSummary(month);
  const entries = useExpenses(month);
  const navigate = useNavigate();
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={setMonth} />

      {summary.isError ? (
        <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
      ) : !summary.data ? (
        <Skeleton className="h-[360px] rounded-[30px]" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <Ledger
              totals={summary.data.totals}
              incomeCount={summary.data.incomes.length}
              onIncome={() => setIncomeOpen(true)}
              onSavings={() => setSavingsOpen(true)}
            />

            <CategoryBreakdown categories={summary.data.categories} totalCents={summary.data.totals.expenseCents} />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Panel aria-labelledby="recent-title">
              <SectionTitle
                id="recent-title"
                action={
                  entries.data && entries.data.length > 0 ? (
                    <Link to="/historique" className="text-sm font-semibold text-accent">
                      Tout voir
                    </Link>
                  ) : undefined
                }
              >
                Dernières dépenses
              </SectionTitle>
              {!entries.data ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : entries.data.length === 0 ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[15px] text-muted">
                    Aucune dépense ce mois-ci. Ajoutez votre première dépense pour suivre votre mois.
                  </p>
                  <Button onClick={() => navigate("/depense/nouvelle")}>
                    <Plus size={18} aria-hidden /> Ajouter une dépense
                  </Button>
                </div>
              ) : (
                <ul>
                  {entries.data.slice(0, 5).map((e) => (
                    <li key={e.id}>
                      <EntryRow entry={e} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <IncomeSheet open={incomeOpen} onClose={() => setIncomeOpen(false)} summary={summary.data} />
          <SavingsSheet open={savingsOpen} onClose={() => setSavingsOpen(false)} summary={summary.data} />
        </div>
      )}
    </div>
  );
}
