import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Plus, Repeat } from "lucide-react";
import { getCategory } from "../../shared/categories";
import { useSelectedMonth } from "../hooks/MonthContext";
import { useOverview } from "../lib/queries";
import { errorMessage } from "../lib/api";
import { MonthSwitcher } from "../components/MonthSwitcher";
import { Ledger } from "../components/Ledger";
import { CategoryBreakdown } from "../components/CategoryBreakdown";
import { EntryRow } from "../components/EntryCard";
import { SavingsSheet } from "../components/SavingsSheet";
import { Button, ErrorState, Panel, SectionTitle, Skeleton } from "../components/ui";
import { LevelBadge, Meter, Pill, Stat, money, shortDate } from "../components/v2";

export default function Overview() {
  const { month, setMonth } = useSelectedMonth();
  const o = useOverview(month);
  const navigate = useNavigate();
  const [savingsOpen, setSavingsOpen] = useState(false);

  if (o.isError) return <ErrorState message={errorMessage(o.error)} onRetry={() => o.refetch()} />;
  const d = o.data;

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={setMonth} />
      {!d ? (
        <Skeleton className="h-[420px] rounded-[30px]" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            {/* 1. Solde et budget disponible */}
            <Panel aria-labelledby="pos-title">
              <h2 id="pos-title" className="sr-only">Situation du mois</h2>
              <div className="grid grid-cols-2 gap-4">
                {d.accountBalanceCents !== null ? (
                  <Stat label="Solde du compte" value={money(d.accountBalanceCents)} hint="Solde de départ + flux réels" tone={d.accountBalanceCents < 0 ? "danger" : undefined} />
                ) : (
                  <Stat label="Solde du mois" value={money(d.position.cashCents)} hint="Reçu − dépensé" tone={d.position.cashCents < 0 ? "danger" : undefined} />
                )}
                <Stat label="Disponible" value={money(d.position.availableFundsCents)} hint="Après épargne déjà mise de côté" tone={d.position.availableFundsCents < 0 ? "danger" : undefined} />
              </div>
              <div className="mt-5 rounded-2xl bg-accent-soft p-4">
                <p className="text-[13px] font-medium text-muted">Dépense conseillée par jour</p>
                <p className="num mt-0.5 text-3xl font-semibold text-accent">{money(d.position.dailyAllowanceCents)}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {d.position.discretionaryCents > 0
                    ? `${money(d.position.discretionaryCents)} libres sur ${d.position.remainingDays} jour${d.position.remainingDays > 1 ? "s" : ""}, après charges à venir (${money(d.position.obligationsDueCents)}), épargne prévue (${money(d.position.plannedSavingsRemainingCents)}) et réserve (${money(d.position.safetyReserveCents)}).`
                    : d.position.shortfallCents > 0
                      ? `Il manque ${money(d.position.shortfallCents)} pour couvrir les charges à venir, l'épargne prévue et la réserve.`
                      : "Aucun montant libre pour le moment."}
                </p>
              </div>
              {d.position.expectedIncomeCents > 0 && (
                <p className="mt-3 text-[13px] text-muted">
                  <Pill tone="warn">Attendu</Pill> {money(d.position.expectedIncomeCents)} de revenus pas encore reçus : ils ne sont pas comptés dans votre disponible.
                </p>
              )}
            </Panel>

            {/* 2-3. Revenus, dépenses, épargne */}
            <Ledger totals={d.summary.totals} incomeCount={d.summary.incomes.length} onIncome={() => navigate("/finances?tab=revenus")} onSavings={() => setSavingsOpen(true)} />

            {/* 4. Catégories */}
            <CategoryBreakdown categories={d.summary.categories} totalCents={d.summary.totals.expenseCents} />

            {d.budgets.length > 0 && (
              <Panel aria-labelledby="bud-title">
                <SectionTitle id="bud-title" action={<Link to="/finances?tab=budgets" className="text-sm font-semibold text-accent">Gérer</Link>}>Budgets</SectionTitle>
                <ul className="flex flex-col gap-4">
                  {d.budgets.filter((b) => b.limitCents).slice(0, 5).map((b) => (
                    <li key={b.categoryId}>
                      <div className="mb-1.5 flex justify-between text-sm">
                        <span className="font-medium">{getCategory(b.categoryId).label}</span>
                        <span className="num text-muted">{money(b.status.spentCents)} / {money(b.status.limitCents)}</span>
                      </div>
                      <Meter ratio={b.status.ratio ?? 0} state={b.status.state} label={`Budget ${getCategory(b.categoryId).label}`} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {/* 5. Assistant : alertes calculées par règles */}
            <Panel aria-labelledby="ins-title">
              <SectionTitle id="ins-title" action={<Link to="/assistant" className="text-sm font-semibold text-accent">Assistant</Link>}>À savoir</SectionTitle>
              {d.insights.length === 0 ? (
                <p className="text-[15px] text-muted">Rien de particulier à signaler pour le moment.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d.insights.slice(0, 4).map((i, k) => (
                    <li key={k}>
                      <Link to={i.link} className="block rounded-2xl bg-raised/60 p-3 transition hover:bg-raised">
                        <LevelBadge level={i.level} />
                        <p className="mt-1.5 text-[15px] font-semibold">{i.title}</p>
                        <p className="text-sm text-muted">{i.body}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* 6. Échéances */}
            <Panel aria-labelledby="due-title">
              <SectionTitle id="due-title" action={<Link to="/finances?tab=abonnements" className="text-sm font-semibold text-accent">Voir</Link>}>Échéances à venir</SectionTitle>
              {d.obligations.length === 0 ? (
                <p className="text-[15px] text-muted">Aucune échéance enregistrée jusqu'à la fin du mois.</p>
              ) : (
                <ul>
                  {d.obligations.slice(0, 6).map((x, k) => (
                    <li key={x.id + x.dueDate + k} className="flex items-center gap-3 border-b border-line/60 py-2.5 last:border-0">
                      <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-raised text-muted">{x.kind === "subscription" ? <Repeat size={18} /> : <CalendarClock size={18} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{x.label}</span>
                        <span className={`text-[13px] ${x.dueDate < d.today ? "text-danger" : "text-faint"}`}>{x.dueDate < d.today ? "En retard · " : ""}{shortDate(x.dueDate)}</span>
                      </span>
                      <span className="num text-[15px] font-semibold">{money(x.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {d.tasksToday.length > 0 || d.tasksOverdueCount > 0 ? (
              <Panel aria-labelledby="task-title">
                <SectionTitle id="task-title" action={<Link to="/taches" className="text-sm font-semibold text-accent">Mes tâches</Link>}>Aujourd'hui</SectionTitle>
                {d.tasksOverdueCount > 0 && <p className="mb-2 text-sm text-danger">{d.tasksOverdueCount} tâche{d.tasksOverdueCount > 1 ? "s" : ""} en retard</p>}
                <ul className="flex flex-col gap-2">
                  {d.tasksToday.slice(0, 4).map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-[15px]"><span className="size-1.5 rounded-full bg-accent" aria-hidden />{t.title}{t.dueTime && <span className="text-faint"> · {t.dueTime}</span>}</li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {/* 7. Dernières transactions */}
            <Panel aria-labelledby="recent-title">
              <SectionTitle id="recent-title" action={d.recent.length > 0 ? <Link to="/finances?tab=transactions" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">Tout voir <ArrowRight size={14} aria-hidden /></Link> : undefined}>Dernières dépenses</SectionTitle>
              {d.recent.length === 0 ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[15px] text-muted">Aucune dépense enregistrée. Ajoutez votre première dépense pour suivre votre mois.</p>
                  <Button onClick={() => navigate("/depense/nouvelle")}><Plus size={18} aria-hidden /> Ajouter une dépense</Button>
                </div>
              ) : (
                <ul>{d.recent.slice(0, 5).map((e) => <li key={e.id}><EntryRow entry={e} /></li>)}</ul>
              )}
            </Panel>
          </div>
          <SavingsSheet open={savingsOpen} onClose={() => setSavingsOpen(false)} summary={d.summary} />
        </div>
      )}
    </div>
  );
}
