import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { centsToInput, parseAmountToCents } from "../../../shared/money";
import { todayInZone } from "../../../shared/month";
import type { GoalDTO } from "../../../shared/types";
import { del, errorMessage, FormError, patch, post } from "../../lib/api";
import { useAction, useGoals, useMonthSummary, useSession } from "../../lib/queries";
import { useSelectedMonth } from "../../hooks/MonthContext";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { SavingsSheet } from "../../components/SavingsSheet";
import { ConfirmSheet, Sheet } from "../../components/Sheet";
import { Segmented } from "../../components/ui";
import { AmountInput, Button, ErrorState, Field, Panel, SectionTitle, Skeleton, TextInput } from "../../components/ui";
import { Empty, Meter, Pill, Stat, money, shortDate } from "../../components/v2";

function GoalForm({ editing, onDone }: { editing: GoalDTO | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [target, setTarget] = useState(editing ? centsToInput(editing.targetCents) : "");
  const [deadline, setDeadline] = useState(editing?.deadline ?? "");
  const [reserve, setReserve] = useState(editing?.isReserve ?? false);
  const save = useAction(async () => {
    const cents = parseAmountToCents(target);
    if (!name.trim()) throw new FormError("Donnez un nom à cet objectif.");
    if (cents === null || cents <= 0) throw new FormError("Indiquez un objectif supérieur à 0.");
    const body = { name: name.trim(), targetCents: cents, deadline: deadline || null, isReserve: reserve };
    return editing ? patch(`/goals/${editing.id}`, body) : post("/goals", body);
  }, { success: "Objectif enregistré", onDone });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined as never); }}>
      <Field label="Nom" htmlFor="gn"><TextInput id="gn" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Voyage, ordinateur, fonds d'urgence…" maxLength={60} /></Field>
      <Field label="Objectif" htmlFor="gt"><AmountInput id="gt" value={target} onChange={setTarget} /></Field>
      <Field label="Échéance (facultatif)" htmlFor="gd" hint="Avec une échéance, O-Budget calcule le versement mensuel nécessaire."><TextInput id="gd" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      <label className="flex items-center gap-3 text-[15px]"><input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} className="size-5 accent-[var(--accent)]" /> Réserve de sécurité (fonds d'urgence)</label>
      <Button type="submit" size="lg" loading={save.isPending}>{editing ? "Enregistrer" : "Créer l'objectif"}</Button>
    </form>
  );
}

function ContributionForm({ goal, onDone }: { goal: GoalDTO; onDone: () => void }) {
  const { settings } = useSession();
  const [mode, setMode] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInZone(settings.timezone));
  const save = useAction(async () => {
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) throw new FormError("Indiquez un montant supérieur à 0.");
    if (mode === "out" && cents > goal.savedCents) throw new FormError(`Vous ne pouvez pas retirer plus que ${money(goal.savedCents)}.`);
    return post(`/goals/${goal.id}/contributions`, { amountCents: mode === "in" ? cents : -cents, contributedOn: date });
  }, { success: mode === "in" ? "Versement enregistré" : "Retrait enregistré", keys: ["goals", "overview", "forecast"], onDone });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined as never); }}>
      <Segmented label="Type" value={mode} onChange={setMode} options={[{ value: "in", label: "Versement" }, { value: "out", label: "Retrait" }]} />
      <Field label="Montant" htmlFor="ca"><AmountInput id="ca" data-autofocus value={amount} onChange={setAmount} large /></Field>
      <Field label="Date" htmlFor="cd"><TextInput id="cd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <p className="text-xs text-faint">Ce suivi par objectif est indépendant de l'épargne mensuelle saisie dans « Épargne du mois ».</p>
      <Button type="submit" size="lg" loading={save.isPending}>Enregistrer</Button>
    </form>
  );
}

export default function Savings() {
  const { month, setMonth } = useSelectedMonth();
  const { settings } = useSession();
  const summary = useMonthSummary(month);
  const goals = useGoals();
  const [monthOpen, setMonthOpen] = useState(false);
  const [goalSheet, setGoalSheet] = useState<{ editing: GoalDTO | null } | null>(null);
  const [contrib, setContrib] = useState<GoalDTO | null>(null);
  const [toDelete, setToDelete] = useState<GoalDTO | null>(null);
  const remove = useAction((id: string) => del(`/goals/${id}`), { success: "Objectif supprimé", onDone: () => setToDelete(null) });

  if (goals.isError) return <ErrorState message={errorMessage(goals.error)} onRetry={() => goals.refetch()} />;
  const target = settings.monthlySavingsTargetCents;
  const done = summary.data?.savingsCents ?? 0;
  const list = goals.data?.goals.filter((g) => !g.archived) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={setMonth} />
      <Panel aria-labelledby="sm-title">
        <SectionTitle id="sm-title" action={<Button variant="secondary" onClick={() => setMonthOpen(true)} disabled={!summary.data}>Modifier</Button>}>Épargne du mois</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Mise de côté" value={money(done)} tone="ok" />
          <Stat label="Objectif mensuel" value={target > 0 ? money(target) : "Non défini"} hint={target > 0 ? undefined : "À régler dans Paramètres"} />
        </div>
        {target > 0 && <div className="mt-4"><Meter ratio={done / target} state={done >= target ? "ok" : "warning"} label="Épargne du mois" /><p className="mt-1 text-xs text-faint">{done >= target ? "Objectif atteint ce mois-ci." : `Il reste ${money(target - done)} pour atteindre l'objectif.`}</p></div>}
      </Panel>

      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[17px] font-semibold">Objectifs et réserves</h2>
        <Button onClick={() => setGoalSheet({ editing: null })}><Plus size={16} aria-hidden /> Nouvel objectif</Button>
      </div>
      {!goals.data ? <Skeleton className="h-40 rounded-[26px]" /> : list.length === 0 ? (
        <Panel><Empty title="Aucun objectif">Créez un objectif (voyage, achat) ou une réserve de sécurité pour suivre votre progression.</Empty></Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((g) => (
            <li key={g.id}>
              <Panel>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setGoalSheet({ editing: g })} className="min-w-0 text-left">
                    <p className="truncate text-[17px] font-semibold">{g.isReserve && <ShieldCheck size={16} className="mr-1 inline text-save" aria-hidden />}{g.name}</p>
                    <p className="text-sm text-muted">{g.deadline ? `Pour le ${shortDate(g.deadline)}` : "Sans échéance"}</p>
                  </button>
                  <Button variant="secondary" onClick={() => setContrib(g)}>Verser / retirer</Button>
                </div>
                <div className="mt-4 flex items-baseline justify-between"><span className="num text-xl font-semibold">{money(g.savedCents)}</span><span className="num text-sm text-muted">sur {money(g.targetCents)}</span></div>
                <div className="mt-2"><Meter ratio={g.progress} state="ok" label={g.name} /></div>
                <p className="mt-2 text-xs text-faint">
                  {g.progress >= 1 ? <Pill tone="ok">Objectif atteint</Pill> : g.requiredMonthlyCents !== null ? `Pour y arriver à temps : ${money(g.requiredMonthlyCents)} par mois.` : `${Math.round(g.progress * 100)} %`}
                </p>
              </Panel>
            </li>
          ))}
        </ul>
      )}
      {goals.data && goals.data.reservesCents > 0 && <p className="px-1 text-sm text-muted">Réserves de sécurité : <span className="num font-semibold text-ink">{money(goals.data.reservesCents)}</span></p>}

      {summary.data && <SavingsSheet open={monthOpen} onClose={() => setMonthOpen(false)} summary={summary.data} />}
      <Sheet open={!!goalSheet} onClose={() => setGoalSheet(null)} title={goalSheet?.editing ? "Modifier l'objectif" : "Nouvel objectif"}>
        {goalSheet && (
          <>
            <GoalForm key={goalSheet.editing?.id ?? "new"} editing={goalSheet.editing} onDone={() => setGoalSheet(null)} />
            {goalSheet.editing && <Button variant="danger" block className="mt-3" onClick={() => { setToDelete(goalSheet.editing); setGoalSheet(null); }}>Supprimer cet objectif</Button>}
          </>
        )}
      </Sheet>
      <Sheet open={!!contrib} onClose={() => setContrib(null)} title={contrib ? contrib.name : ""} description={contrib ? `Actuellement ${money(contrib.savedCents)}` : undefined}>
        {contrib && <ContributionForm goal={contrib} onDone={() => setContrib(null)} />}
      </Sheet>
      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer cet objectif ?" message="L'historique de ses versements sera aussi supprimé. Votre épargne mensuelle n'est pas modifiée." confirmLabel="Supprimer" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}
