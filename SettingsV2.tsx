import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ALERT_KINDS, DEFAULT_ALERT_PREFS, type AlertKind, type AlertLevel } from "../../shared/alerts";
import { centsToInput, parseAmountToCents } from "../../shared/money";
import { currentMonthKey, isValidTimeZone } from "../../shared/month";
import type { MeDTO } from "../../shared/types";
import { del, errorMessage, FormError, patch, post } from "../lib/api";
import { qk, useAiStatus, useSession, useTasks } from "../lib/queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../hooks/Toast";
import { AmountInput, Button, Field, TextInput } from "../components/ui";
import { Select } from "../components/v2";

const KIND_LABEL: Record<AlertKind, string> = {
  unusual_spending: "Dépense inhabituelle", budget_threshold: "Budget proche ou dépassé", subscription_renewal: "Renouvellement d'abonnement",
  obligation_due: "Charge fixe à payer", negative_balance_risk: "Risque de solde négatif", task_overdue: "Tâche en retard",
  task_deadline: "Échéance de tâche proche", duplicate_subscription: "Abonnement en double", overloaded_day: "Journée surchargée",
};
const TIMEZONES = ["Europe/Paris", "Africa/Casablanca", "Europe/Brussels", "Europe/London", "America/Montreal", "UTC"];

function useSettingsSave(success: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => patch<MeDTO>("/settings", body),
    onSuccess: async (me) => {
      qc.setQueryData(qk.me, me);
      await Promise.all(["overview", "forecast", "notifications", "ai-reco"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(success);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

export function BudgetSettings() {
  const { settings } = useSession();
  const save = useSettingsSave("Paramètres du budget enregistrés");
  const [reserve, setReserve] = useState(centsToInput(settings.safetyReserveCents));
  const [target, setTarget] = useState(centsToInput(settings.monthlySavingsTargetCents));
  const [opening, setOpening] = useState(settings.openingBalanceCents === null ? "" : centsToInput(settings.openingBalanceCents));
  const [openingMonth, setOpeningMonth] = useState(settings.openingBalanceMonth ?? currentMonthKey());
  const [tz, setTz] = useState(settings.timezone);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setError(null);
    const r = parseAmountToCents(reserve || "0");
    const t = parseAmountToCents(target || "0");
    const o = opening.trim() === "" ? null : parseAmountToCents(opening);
    if (r === null || t === null || (opening.trim() !== "" && o === null)) return setError(errorMessage(new FormError("Montant invalide.")));
    if (!isValidTimeZone(tz)) return setError("Fuseau horaire inconnu.");
    save.mutate({ safetyReserveCents: r, monthlySavingsTargetCents: t, timezone: tz, openingBalanceCents: o, openingBalanceMonth: o === null ? null : openingMonth });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label="Réserve de sécurité" htmlFor="sr" hint="Montant que vous ne voulez pas dépenser ce mois-ci : il est retiré de votre dépense conseillée."><AmountInput id="sr" value={reserve} onChange={setReserve} /></Field>
      <Field label="Objectif d'épargne mensuel" htmlFor="st"><AmountInput id="st" value={target} onChange={setTarget} /></Field>
      <Field label="Solde de départ du compte (facultatif)" htmlFor="so" hint="Avec un solde de départ, O-Budget affiche le solde du compte : départ + revenus reçus − dépenses − épargne."><AmountInput id="so" value={opening} onChange={setOpening} /></Field>
      {opening.trim() !== "" && <Field label="Mois de ce solde" htmlFor="sm" hint="Les flux de ce mois et des suivants sont ajoutés au solde."><TextInput id="sm" type="month" value={openingMonth} onChange={(e) => setOpeningMonth(e.target.value)} /></Field>}
      <Field label="Fuseau horaire" htmlFor="tz"><Select id="tz" value={tz} onChange={setTz}>{[...new Set([settings.timezone, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}</Select></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={save.isPending}>Enregistrer</Button>
    </form>
  );
}

export function AlertSettings() {
  const { settings } = useSession();
  const save = useSettingsSave("Préférences d'alertes enregistrées");
  const prefs = settings.alertPrefs ?? DEFAULT_ALERT_PREFS;
  const send = (next: Partial<typeof prefs>) => save.mutate({ alertPrefs: { ...prefs, ...next } });
  const toggle = (k: AlertKind) => send({ disabledKinds: prefs.disabledKinds.includes(k) ? prefs.disabledKinds.filter((x) => x !== k) : [...prefs.disabledKinds, k] });
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {ALERT_KINDS.map((k) => (
          <li key={k}><label className="flex min-h-12 items-center justify-between gap-3 border-b border-line/60 text-[15px] last:border-0">{KIND_LABEL[k]}<input type="checkbox" className="size-5 accent-[var(--accent)]" checked={!prefs.disabledKinds.includes(k)} onChange={() => toggle(k)} disabled={save.isPending} /></label></li>
        ))}
      </ul>
      <Field label="Niveau minimum affiché" htmlFor="ml"><Select id="ml" value={prefs.minLevel} onChange={(v) => send({ minLevel: v as AlertLevel })}><option value="info">Tout (info, attention, critique)</option><option value="attention">Attention et critique</option><option value="critical">Critique seulement</option></Select></Field>
      <Field label={`Alerte budget à ${Math.round(prefs.budgetWarnAt * 100)} % de la limite`} htmlFor="bw"><input id="bw" type="range" min={50} max={95} step={5} value={Math.round(prefs.budgetWarnAt * 100)} onChange={(e) => send({ budgetWarnAt: Number(e.target.value) / 100 })} className="w-full accent-[var(--accent)]" /></Field>
      <p className="text-xs text-faint">Les alertes restent dans l'application. Elles sont calculées par des règles fixes, jamais par l'IA.</p>
    </div>
  );
}

export function AiSettings() {
  const { settings } = useSession();
  const status = useAiStatus();
  const save = useSettingsSave("Préférence enregistrée");
  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <p>{status.data?.configured ? <>Assistant activé : <span className="font-semibold">{status.data.provider}</span> ({status.data.model}).</> : "Assistant conversationnel non configuré sur ce serveur. Conseils et alertes fonctionnent sans IA."}</p>
      <label className="flex items-start justify-between gap-3">
        <span>Partager le détail des établissements<span className="block text-sm text-muted">Par défaut, l'assistant ne reçoit que des totaux par catégorie. Activez pour lui permettre de citer vos commerçants les plus fréquents.</span></span>
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--accent)]" checked={settings.aiShareDetail} onChange={(e) => save.mutate({ aiShareDetail: e.target.checked })} />
      </label>
      <p className="text-sm text-muted">Votre e-mail, votre nom, les libellés de vos revenus et vos notes ne sont jamais envoyés au fournisseur.</p>
    </div>
  );
}

export function TaskCategories() {
  const tasks = useTasks();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4F5BD5");
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const add = useMutation({ mutationFn: () => post("/task-categories", { name: name.trim(), color }), onSuccess: async () => { setName(""); await refresh(); toast("Catégorie ajoutée"); }, onError: (e) => toast(errorMessage(e), "error") });
  const remove = useMutation({ mutationFn: (id: string) => del(`/task-categories/${id}`), onSuccess: async () => { await refresh(); toast("Catégorie supprimée"); }, onError: (e) => toast(errorMessage(e), "error") });
  return (
    <div className="flex flex-col gap-3">
      <ul>
        {(tasks.data?.categories ?? []).map((c) => (
          <li key={c.id} className="flex min-h-12 items-center gap-3 border-b border-line/60 last:border-0"><span className="size-3 rounded-full" style={{ background: c.color }} aria-hidden /><span className="flex-1 text-[15px]">{c.name}</span><button type="button" aria-label={`Supprimer ${c.name}`} onClick={() => remove.mutate(c.id)} className="grid size-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-danger"><Trash2 size={17} /></button></li>
        ))}
      </ul>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <input type="color" aria-label="Couleur" value={color} onChange={(e) => setColor(e.target.value)} className="size-12 shrink-0 rounded-xl border border-line bg-surface p-1" />
        <TextInput aria-label="Nom de la catégorie" value={name} onChange={(e) => setName(e.target.value)} placeholder="Études, Administratif…" maxLength={30} />
        <Button type="submit" disabled={!name.trim()} loading={add.isPending}>Ajouter</Button>
      </form>
    </div>
  );
}
