import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Wand2 } from "lucide-react";
import { centsToInput, parseAmountToCents } from "../../../shared/money";
import { computeNetSalary, FREQUENCIES, INCOME_KINDS, INCOME_STATUSES, incomeKindLabel, incomeStatusLabel, frequencyLabel, type CashState } from "../../../shared/income";
import type { IncomeDTO, MonthSummaryDTO } from "../../../shared/types";
import { del, errorMessage, FormError, patch, post } from "../../lib/api";
import { useAction, useMonthSummary, useSession } from "../../lib/queries";
import { useSelectedMonth } from "../../hooks/MonthContext";
import { MonthSwitcher } from "../../components/MonthSwitcher";
import { ConfirmSheet, Sheet } from "../../components/Sheet";
import { AmountInput, Button, ErrorState, Field, Panel, SectionTitle, Skeleton, TextInput, useFieldId } from "../../components/ui";
import { Empty, Pill, Select, Stat, money } from "../../components/v2";

const STATE_LABEL: Record<CashState, { text: string; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  received: { text: "Reçu", tone: "ok" },
  expected: { text: "Attendu", tone: "warn" },
  indirect: { text: "Versé à un tiers", tone: "neutral" },
  excluded: { text: "Exclu", tone: "danger" },
};

interface Form {
  label: string; kind: string; status: string; frequency: string; expectedDate: string; receivedOn: string;
  gross: string; contributions: string; otherDeductions: string; withholding: string; amount: string;
  organization: string; benefitType: string; estimated: string; confirmed: string;
  paidTo: "user" | "third_party"; thirdParty: string; notes: string;
}

const fromIncome = (i: IncomeDTO): Form => ({
  label: i.label, kind: i.kind, status: i.status, frequency: i.frequency, expectedDate: i.expectedDate ?? "", receivedOn: i.receivedOn ?? "",
  gross: i.grossCents === null ? "" : centsToInput(i.grossCents),
  contributions: i.employeeContributionsCents === null ? "" : centsToInput(i.employeeContributionsCents),
  otherDeductions: i.otherDeductionsCents === null ? "" : centsToInput(i.otherDeductionsCents),
  withholding: i.withholdingCents === null ? "" : centsToInput(i.withholdingCents),
  amount: centsToInput(i.amountCents), organization: i.organization ?? "", benefitType: i.benefitType ?? "",
  estimated: i.estimatedCents === null ? "" : centsToInput(i.estimatedCents), confirmed: i.confirmedCents === null ? "" : centsToInput(i.confirmedCents),
  paidTo: i.paidTo, thirdParty: i.thirdPartyName ?? "", notes: i.notes ?? "",
});
const blank: Form = { label: "", kind: "salary", status: "expected", frequency: "monthly", expectedDate: "", receivedOn: "", gross: "", contributions: "", otherDeductions: "", withholding: "", amount: "", organization: "", benefitType: "", estimated: "", confirmed: "", paidTo: "user", thirdParty: "", notes: "" };

const isWork = (k: string) => ["alternance", "salary", "freelance", "bonus"].includes(k);
const isBenefit = (k: string) => ["caf", "apl", "prime_activite", "scholarship", "other_aid", "other_benefit"].includes(k);

function IncomeForm({ month, editing, onDone }: { month: string; editing: IncomeDTO | null; onDone: () => void }) {
  const [f, setF] = useState<Form>(editing ? fromIncome(editing) : blank);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const ids = { label: useFieldId("il"), amount: useFieldId("ia") };
  const c = (s: string) => (s.trim() === "" ? null : parseAmountToCents(s));
  const gross = c(f.gross);
  const net = gross === null ? null : computeNetSalary({ grossCents: gross, employeeContributionsCents: c(f.contributions) ?? 0, otherDeductionsCents: c(f.otherDeductions) ?? 0, withholdingCents: c(f.withholding) ?? 0 });

  const save = useAction(
    async () => {
      if (!f.label.trim()) throw new FormError("Donnez un nom à ce revenu.");
      const amount = c(f.amount);
      if (f.amount.trim() && amount === null) throw new FormError("Montant reçu invalide.");
      if (!f.amount.trim() && net === null && !isBenefit(f.kind)) throw new FormError("Indiquez le montant (ou le brut pour calculer le net).");
      if (!f.amount.trim() && isBenefit(f.kind) && c(f.confirmed) === null && c(f.estimated) === null) throw new FormError("Indiquez un montant estimé ou confirmé.");
      const body = {
        month, label: f.label.trim(), kind: f.kind, status: f.status, frequency: f.frequency,
        expectedDate: f.expectedDate || null, receivedOn: f.receivedOn || null,
        grossCents: gross, employeeContributionsCents: c(f.contributions), otherDeductionsCents: c(f.otherDeductions), withholdingCents: c(f.withholding),
        organization: f.organization.trim() || null, benefitType: f.benefitType.trim() || null,
        estimatedCents: c(f.estimated), confirmedCents: c(f.confirmed),
        paidTo: f.paidTo, thirdPartyName: f.paidTo === "third_party" ? f.thirdParty.trim() || null : null, notes: f.notes.trim() || null,
        ...(amount !== null ? { amountCents: amount } : {}),
      };
      if (editing) {
        const { month: _m, ...rest } = body;
        return patch<MonthSummaryDTO>(`/incomes/${editing.id}`, rest);
      }
      return post<MonthSummaryDTO>("/incomes", body);
    },
    { success: editing ? "Revenu modifié" : "Revenu ajouté", onDone },
  );
  useEffect(() => {
    if (save.isError) setError(errorMessage(save.error));
  }, [save.isError, save.error]);

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(undefined as never); }}>
      <Field label="Nom" htmlFor={ids.label}><TextInput id={ids.label} data-autofocus value={f.label} onChange={(e) => set("label", e.target.value)} maxLength={60} placeholder="Salaire d'octobre" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="ik"><Select id="ik" value={f.kind} onChange={(v) => set("kind", v)}>{INCOME_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
        <Field label="Statut" htmlFor="is"><Select id="is" value={f.status} onChange={(v) => set("status", v)}>{INCOME_STATUSES.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
      </div>
      <p className="-mt-2 text-xs text-faint">Seuls les revenus « Confirmé » ou « Terminé » comptent comme argent reçu. Les autres sont des prévisions.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fréquence" htmlFor="if"><Select id="if" value={f.frequency} onChange={(v) => set("frequency", v)}>{FREQUENCIES.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select></Field>
        <Field label={f.status === "expected" || f.status === "pending" || f.status === "approved" ? "Date prévue" : "Date de réception"} htmlFor="id">
          <TextInput id="id" type="date" value={f.status === "confirmed" || f.status === "completed" ? f.receivedOn : f.expectedDate} onChange={(e) => (f.status === "confirmed" || f.status === "completed" ? set("receivedOn", e.target.value) : set("expectedDate", e.target.value))} />
        </Field>
      </div>

      {isWork(f.kind) && (
        <fieldset className="flex flex-col gap-3 rounded-2xl bg-raised/60 p-4">
          <legend className="px-1 text-sm font-semibold">Du brut au net (facultatif)</legend>
          <Field label="Salaire brut" htmlFor="g"><AmountInput id="g" value={f.gross} onChange={(v) => set("gross", v)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cotisations" htmlFor="co"><AmountInput id="co" value={f.contributions} onChange={(v) => set("contributions", v)} /></Field>
            <Field label="Autres retenues" htmlFor="od"><AmountInput id="od" value={f.otherDeductions} onChange={(v) => set("otherDeductions", v)} /></Field>
          </div>
          <Field label="Prélèvement à la source" htmlFor="wh"><AmountInput id="wh" value={f.withholding} onChange={(v) => set("withholding", v)} /></Field>
          {net !== null && <p className="text-sm">Net calculé : <span className="num font-semibold">{money(net)}</span></p>}
          <Field label="Employeur / client" htmlFor="org"><TextInput id="org" value={f.organization} onChange={(e) => set("organization", e.target.value)} maxLength={80} /></Field>
        </fieldset>
      )}

      {isBenefit(f.kind) && (
        <fieldset className="flex flex-col gap-3 rounded-2xl bg-raised/60 p-4">
          <legend className="px-1 text-sm font-semibold">Aide ou prestation</legend>
          <Field label="Organisme" htmlFor="org2"><TextInput id="org2" value={f.organization} onChange={(e) => set("organization", e.target.value)} maxLength={80} placeholder="CAF, CROUS…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Montant estimé" htmlFor="es"><AmountInput id="es" value={f.estimated} onChange={(v) => set("estimated", v)} /></Field>
            <Field label="Montant confirmé" htmlFor="cf"><AmountInput id="cf" value={f.confirmed} onChange={(v) => set("confirmed", v)} /></Field>
          </div>
          <p className="text-xs text-faint">O-Budget ne calcule pas vos droits : saisissez le montant indiqué par l'organisme.</p>
        </fieldset>
      )}

      <Field label={net !== null && !f.amount.trim() ? `Montant réellement reçu (par défaut : net ${money(net)})` : "Montant reçu ou prévu"} htmlFor={ids.amount}>
        <AmountInput id={ids.amount} value={f.amount} onChange={(v) => set("amount", v)} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-muted">Versé à</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["user", "third_party"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={f.paidTo === v} onClick={() => set("paidTo", v)} className={`h-11 rounded-xl text-sm font-semibold ${f.paidTo === v ? "bg-accent text-accent-ink" : "bg-raised text-muted"}`}>{v === "user" ? "Moi" : "Un tiers"}</button>
          ))}
        </div>
        {f.paidTo === "third_party" && (
          <>
            <TextInput aria-label="Nom du tiers" value={f.thirdParty} onChange={(e) => set("thirdParty", e.target.value)} placeholder="Propriétaire, bailleur…" maxLength={80} />
            <p className="text-xs text-faint">Un versement à un tiers n'entre jamais dans votre argent disponible.</p>
          </>
        )}
      </fieldset>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={save.isPending}>{editing ? "Enregistrer" : "Ajouter le revenu"}</Button>
    </form>
  );
}

export default function Incomes() {
  const { month, setMonth } = useSelectedMonth();
  const { settings } = useSession();
  const summary = useMonthSummary(month);
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<{ editing: IncomeDTO | null } | null>(params.get("nouveau") ? { editing: null } : null);
  const [toDelete, setToDelete] = useState<IncomeDTO | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  const close = () => {
    setSheet(null);
    if (params.get("nouveau")) { params.delete("nouveau"); setParams(params, { replace: true }); }
  };
  const remove = useAction((id: string) => del<MonthSummaryDTO>(`/incomes/${id}`), { success: "Revenu supprimé", onDone: () => setToDelete(null) });
  const defaults = useAction((status: "expected" | "confirmed") => post<MonthSummaryDTO>(`/months/${month}/apply-defaults`, { status }), { success: "Revenus habituels ajoutés", onDone: () => setDefaultsOpen(false) });

  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const d = summary.data;
  const hasDefaults = settings.defaultAlternanceCents > 0 || settings.defaultFreelanceCents > 0;

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={setMonth} />
      {!d ? <Skeleton className="h-64 rounded-[26px]" /> : (
        <>
          <Panel>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Reçu" value={money(d.income.receivedCents)} tone="ok" />
              <Stat label="Attendu" value={money(d.income.expectedCents)} tone="warn" />
              <Stat label="Versé à un tiers" value={money(d.income.indirectCents)} />
            </div>
            <p className="mt-3 text-xs text-faint">Seul le montant « Reçu » entre dans votre solde et votre budget disponible.</p>
          </Panel>
          <div className="flex gap-2">
            <Button onClick={() => setSheet({ editing: null })}><Plus size={18} aria-hidden /> Ajouter un revenu</Button>
            {hasDefaults && d.incomes.length === 0 && <Button variant="secondary" onClick={() => setDefaultsOpen(true)}><Wand2 size={18} aria-hidden /> Revenus habituels</Button>}
          </div>
          <Panel aria-labelledby="inc-title">
            <SectionTitle id="inc-title">Revenus du mois</SectionTitle>
            {d.incomes.length === 0 ? <Empty title="Aucun revenu ce mois-ci">Ajoutez un salaire, une aide ou un remboursement. Rien n'est ajouté automatiquement.</Empty> : (
              <ul>
                {d.incomes.map((i) => {
                  const st = STATE_LABEL[i.cashState];
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => setSheet({ editing: i })} className="flex w-full items-center gap-3 border-b border-line/60 py-3 text-left last:border-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{i.label}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                            <Pill tone={st.tone}>{st.text}</Pill> {incomeKindLabel(i.kind)} · {incomeStatusLabel(i.status)}{i.frequency !== "once" ? ` · ${frequencyLabel(i.frequency)}` : ""}
                            {i.grossCents !== null && i.netCents !== null && <> · brut {money(i.grossCents)} → net {money(i.netCents)}</>}
                            {i.paidTo === "third_party" && <> · versé à {i.thirdPartyName ?? "un tiers"}</>}
                          </span>
                        </span>
                        <span className={`num text-[15px] font-semibold ${i.cashState === "received" ? "" : "text-faint"}`}>{money(i.amountCents)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      )}

      <Sheet open={!!sheet} onClose={close} title={sheet?.editing ? "Modifier le revenu" : "Nouveau revenu"}>
        {sheet && (
          <>
            <IncomeForm key={sheet.editing?.id ?? "new"} month={month} editing={sheet.editing} onDone={close} />
            {sheet.editing && <Button variant="danger" block className="mt-3" onClick={() => { setToDelete(sheet.editing); close(); }}>Supprimer ce revenu</Button>}
          </>
        )}
      </Sheet>
      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer ce revenu ?" message={toDelete ? `${toDelete.label}, ${money(toDelete.amountCents)}. Cette action est définitive.` : ""} confirmLabel="Supprimer" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
      <Sheet open={defaultsOpen} onClose={() => setDefaultsOpen(false)} title="Revenus habituels" description="Ajoute vos montants par défaut (Paramètres) pour ce mois. Choisissez comment les enregistrer.">
        <div className="flex flex-col gap-2">
          <Button data-autofocus loading={defaults.isPending} onClick={() => defaults.mutate("expected")}>Comme attendus (recommandé)</Button>
          <Button variant="secondary" loading={defaults.isPending} onClick={() => defaults.mutate("confirmed")}>Comme déjà reçus</Button>
        </div>
      </Sheet>
    </div>
  );
}
