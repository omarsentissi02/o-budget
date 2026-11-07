import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { SELECTABLE_CATEGORIES, getCategory, type CategoryId } from "../../../shared/categories";
import { FREQUENCIES, frequencyLabel } from "../../../shared/income";
import { centsToInput, parseAmountToCents } from "../../../shared/money";
import { monthLabel, shiftMonth, todayInZone } from "../../../shared/month";
import type { BudgetRowDTO, RecurringItemDTO } from "../../../shared/types";
import { del, errorMessage, FormError, patch, post, put } from "../../lib/api";
import { useAction, useBudgets, useForecast, useRecurring, useSession } from "../../lib/queries";
import { useSelectedMonth } from "../../hooks/MonthContext";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { ConfirmSheet, Sheet } from "../../components/Sheet";
import { AmountInput, Button, ErrorState, Field, Panel, SectionTitle, Skeleton, TextInput } from "../../components/ui";
import { Empty, Meter, Pill, Select, money, shortDate } from "../../components/v2";
import { subcategoriesOf } from "../../../shared/taxonomy";

const FREQS = FREQUENCIES.filter((f) => f.id !== "once");
const STATE_TEXT = { ok: "Dans le budget", warning: "Presque atteint", over: "Dépassé", none: "" } as const;

function BudgetEditor({ month, row, onDone }: { month: string; row: BudgetRowDTO; onDone: () => void }) {
  const [v, setV] = useState(row.limitCents ? centsToInput(row.limitCents) : "");
  const save = useAction(async () => {
    const cents = parseAmountToCents(v);
    if (cents === null || cents <= 0) throw new FormError("Indiquez un montant supérieur à 0, ou supprimez le budget.");
    return put("/budgets", { month, categoryId: row.categoryId, limitCents: cents });
  }, { success: "Budget enregistré", onDone });
  const remove = useAction(() => del(`/budgets/${month}/${row.categoryId}`), { success: "Budget supprimé", onDone });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined as never); }}>
      <p className="text-sm text-muted">Déjà dépensé ce mois-ci : <span className="num font-semibold text-ink">{money(row.status.spentCents)}</span></p>
      <Field label="Limite mensuelle" htmlFor="bl"><AmountInput id="bl" data-autofocus value={v} onChange={setV} large /></Field>
      <Button type="submit" size="lg" loading={save.isPending}>Enregistrer</Button>
      {row.limitCents && <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined as never)}>Supprimer ce budget</Button>}
    </form>
  );
}

function RecurringForm({ editing, onDone }: { editing: RecurringItemDTO | null; onDone: () => void }) {
  const { settings } = useSession();
  const [label, setLabel] = useState(editing?.label ?? "");
  const [amount, setAmount] = useState(editing ? centsToInput(editing.amountCents) : "");
  const [frequency, setFrequency] = useState<string>(editing?.frequency ?? "monthly");
  const [next, setNext] = useState(editing?.nextDueDate ?? todayInZone(settings.timezone));
  const [cat, setCat] = useState<string>(editing?.categoryId ?? "logement");
  const [sub, setSub] = useState(editing?.subcategoryId ?? "");
  const save = useAction(async () => {
    const cents = parseAmountToCents(amount);
    if (!label.trim()) throw new FormError("Donnez un nom à cette charge.");
    if (cents === null || cents <= 0) throw new FormError("Indiquez un montant supérieur à 0.");
    const body = { label: label.trim(), amountCents: cents, frequency, nextDueDate: next, categoryId: cat, subcategoryId: sub || null };
    return editing ? patch(`/recurring/${editing.id}`, body) : post("/recurring", body);
  }, { success: "Charge enregistrée", onDone });
  const subs = subcategoriesOf(cat as CategoryId);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined as never); }}>
      <Field label="Nom" htmlFor="rl"><TextInput id="rl" data-autofocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Loyer, assurance, crédit…" maxLength={60} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Montant" htmlFor="ra"><AmountInput id="ra" value={amount} onChange={setAmount} /></Field>
        <Field label="Fréquence" htmlFor="rf"><Select id="rf" value={frequency} onChange={setFrequency}>{FREQS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
      </div>
      <Field label="Prochaine échéance" htmlFor="rn"><TextInput id="rn" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catégorie" htmlFor="rc"><Select id="rc" value={cat} onChange={(v) => { setCat(v); setSub(""); }}>{SELECTABLE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Sous-catégorie" htmlFor="rs"><Select id="rs" value={sub} onChange={setSub}><option value="">—</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
      </div>
      <Button type="submit" size="lg" loading={save.isPending}>{editing ? "Enregistrer" : "Ajouter la charge"}</Button>
    </form>
  );
}

export default function Budgets() {
  const { month, setMonth } = useSelectedMonth();
  const { settings } = useSession();
  const today = todayInZone(settings.timezone);
  const budgets = useBudgets(month);
  const recurring = useRecurring();
  const forecast = useForecast(6);
  const [editRow, setEditRow] = useState<BudgetRowDTO | null>(null);
  const [rec, setRec] = useState<{ editing: RecurringItemDTO | null } | null>(null);
  const [toDelete, setToDelete] = useState<RecurringItemDTO | null>(null);
  const copy = useAction(() => post<{ copied: number }>("/budgets/copy", { fromMonth: shiftMonth(month, -1), toMonth: month }), { success: "Budgets du mois précédent copiés" });
  const pay = useAction((r: RecurringItemDTO) => post(`/recurring/${r.id}/pay`, { dueDate: r.nextDueDate }), { success: "Paiement enregistré dans vos dépenses" });
  const remove = useAction((id: string) => del(`/recurring/${id}`), { success: "Charge supprimée", onDone: () => setToDelete(null) });

  if (budgets.isError) return <ErrorState message={errorMessage(budgets.error)} onRetry={() => budgets.refetch()} />;
  const rows = (budgets.data?.rows ?? []);
  const withLimit = rows.filter((r) => r.limitCents);
  const without = rows.filter((r) => !r.limitCents);

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={setMonth} />
      <Panel aria-labelledby="b-title">
        <SectionTitle id="b-title" action={<Button variant="ghost" onClick={() => copy.mutate(undefined as never)} loading={copy.isPending}><Copy size={16} aria-hidden /> Copier {monthLabel(shiftMonth(month, -1)).split(" ")[0].toLowerCase()}</Button>}>Budgets par catégorie</SectionTitle>
        {!budgets.data ? <Skeleton className="h-32" /> : (
          <>
            {withLimit.length === 0 && <Empty title="Aucun budget défini">Fixez une limite par catégorie pour être alerté avant de la dépasser.</Empty>}
            <ul className="flex flex-col gap-4">
              {withLimit.map((r) => (
                <li key={r.categoryId}>
                  <button type="button" onClick={() => setEditRow(r)} className="block w-full text-left">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{getCategory(r.categoryId).emoji} {getCategory(r.categoryId).label} {r.status.state !== "ok" && <Pill tone={r.status.state === "over" ? "danger" : "warn"}>{STATE_TEXT[r.status.state]}</Pill>}</span>
                      <span className="num text-muted">{money(r.status.spentCents)} / {money(r.status.limitCents)}</span>
                    </div>
                    <Meter ratio={r.status.ratio ?? 0} state={r.status.state} label={`Budget ${getCategory(r.categoryId).label}`} />
                    <p className="mt-1 text-xs text-faint">{r.status.remainingCents >= 0 ? `Reste ${money(r.status.remainingCents)}` : `Dépassé de ${money(-r.status.remainingCents)}`}</p>
                  </button>
                </li>
              ))}
            </ul>
            {without.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-accent">Ajouter un budget</summary>
                <ul className="mt-2 grid grid-cols-2 gap-2">
                  {without.map((r) => <li key={r.categoryId}><button type="button" onClick={() => setEditRow(r)} className="flex h-11 w-full items-center gap-2 rounded-xl bg-raised px-3 text-left text-sm font-medium"><span aria-hidden>{getCategory(r.categoryId).emoji}</span><span className="truncate">{getCategory(r.categoryId).label}</span></button></li>)}
                </ul>
              </details>
            )}
          </>
        )}
      </Panel>

      <Panel aria-labelledby="r-title">
        <SectionTitle id="r-title" action={<Button variant="secondary" onClick={() => setRec({ editing: null })}><Plus size={16} aria-hidden /> Ajouter</Button>}>Charges fixes</SectionTitle>
        {!recurring.data ? <Skeleton className="h-24" /> : recurring.data.length === 0 ? <Empty title="Aucune charge fixe">Loyer, assurance, crédit : elles sont déduites de votre montant conseillé par jour jusqu'à leur paiement.</Empty> : (
          <ul>
            {recurring.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-line/60 py-3 last:border-0">
                <button type="button" onClick={() => setRec({ editing: r })} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[15px] font-medium">{r.label}</span>
                  <span className={`text-[13px] ${r.nextDueDate < today ? "text-danger" : "text-faint"}`}>{frequencyLabel(r.frequency)} · prochaine échéance {shortDate(r.nextDueDate)}{r.nextDueDate < today ? " (en retard)" : ""}</span>
                </button>
                <span className="num font-semibold">{money(r.amountCents)}</span>
                {r.active && <Button variant="secondary" loading={pay.isPending && pay.variables?.id === r.id} onClick={() => pay.mutate(r)}>Payé</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-labelledby="f-title">
        <SectionTitle id="f-title">Prévision sur 6 mois</SectionTitle>
        {!forecast.data ? <Skeleton className="h-40" /> : (
          <>
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="num w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-faint"><th className="py-1.5 font-medium">Mois</th><th className="font-medium">Revenus</th><th className="font-medium">Charges</th><th className="font-medium">Variable</th><th className="text-right font-medium">Trésorerie</th></tr></thead>
                <tbody>
                  {forecast.data.months.map((m) => (
                    <tr key={m.month} className="border-t border-line/60">
                      <td className="py-2 font-medium">{monthLabel(m.month).split(" ")[0]}</td>
                      <td>{money(m.expectedIncomeCents)}</td><td>{money(m.obligationsCents)}</td><td>{money(m.variableSpendCents)}</td>
                      <td className={`text-right font-semibold ${m.endCashCents < 0 ? "text-danger" : ""}`}>{money(m.endCashCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-faint">
              Calculée uniquement avec ce que vous avez saisi : {forecast.data.basis.incomeSources} revenu{forecast.data.basis.incomeSources > 1 ? "s" : ""} récurrent{forecast.data.basis.incomeSources > 1 ? "s" : ""}, {forecast.data.basis.obligationSources} charge{forecast.data.basis.obligationSources > 1 ? "s" : ""} ou abonnement{forecast.data.basis.obligationSources > 1 ? "s" : ""}, dépenses variables moyennes de {money(forecast.data.basis.avgVariableSpendCents)} par mois et épargne prévue de {money(forecast.data.basis.plannedSavingsCents)}. Aucun revenu n'est supposé.
            </p>
          </>
        )}
      </Panel>

      <Sheet open={!!editRow} onClose={() => setEditRow(null)} title={editRow ? `Budget ${getCategory(editRow.categoryId).label}` : ""}>
        {editRow && <BudgetEditor month={month} row={editRow} onDone={() => setEditRow(null)} />}
      </Sheet>
      <Sheet open={!!rec} onClose={() => setRec(null)} title={rec?.editing ? "Modifier la charge" : "Nouvelle charge fixe"}>
        {rec && (
          <>
            <RecurringForm key={rec.editing?.id ?? "new"} editing={rec.editing} onDone={() => setRec(null)} />
            {rec.editing && <Button variant="danger" block className="mt-3" onClick={() => { setToDelete(rec.editing); setRec(null); }}>Supprimer cette charge</Button>}
          </>
        )}
      </Sheet>
      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer cette charge ?" message="Les dépenses déjà enregistrées sont conservées." confirmLabel="Supprimer" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}
