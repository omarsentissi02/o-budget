import { useState } from "react";
import { BellRing, Plus } from "lucide-react";
import { SUBSCRIPTION_FAMILIES, SUBSCRIPTION_PRESETS, SUBSCRIPTION_STATUSES, familyLabel, type SubscriptionFamily } from "../../../shared/subscriptions";
import { FREQUENCIES, frequencyLabel } from "../../../shared/income";
import { centsToInput, parseAmountToCents } from "../../../shared/money";
import type { SubscriptionDTO } from "../../../shared/types";
import { del, errorMessage, FormError, patch, post } from "../../lib/api";
import { useAction, useSession, useSubscriptions } from "../../lib/queries";
import { ConfirmSheet, Sheet } from "../../components/Sheet";
import { AmountInput, Button, ErrorState, Field, Panel, SectionTitle, Skeleton, TextInput } from "../../components/ui";
import { Empty, Pill, Select, Stat, money, shortDate } from "../../components/v2";
import { todayInZone } from "../../../shared/month";

const FREQS = FREQUENCIES.filter((f) => f.id !== "once");

function SubscriptionForm({ editing, onDone, onDelete }: { editing: SubscriptionDTO | null; onDone: () => void; onDelete?: () => void }) {
  const { paymentMethods } = useSession();
  const [name, setName] = useState(editing?.name ?? "");
  const [family, setFamily] = useState<SubscriptionFamily>(editing?.family ?? "pro");
  const [amount, setAmount] = useState(editing ? centsToInput(editing.amountCents) : "");
  const [frequency, setFrequency] = useState<string>(editing?.frequency ?? "monthly");
  const [renewal, setRenewal] = useState(editing?.renewalDate ?? "");
  const [start, setStart] = useState(editing?.startDate ?? "");
  const [pm, setPm] = useState(editing?.paymentMethodId ?? "");
  const [status, setStatus] = useState<string>(editing?.status ?? "active");
  const [noticeDays, setNoticeDays] = useState(editing?.cancelNoticeDays?.toString() ?? "");
  const [cancelUrl, setCancelUrl] = useState(editing?.cancelUrl ?? "");
  const [cancelNotes, setCancelNotes] = useState(editing?.cancelNotes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useAction(
    async () => {
      const cents = parseAmountToCents(amount);
      if (!name.trim()) throw new FormError("Donnez un nom à cet abonnement.");
      if (cents === null || cents <= 0) throw new FormError("Indiquez un montant supérieur à 0.");
      const body = {
        name: name.trim(), family, amountCents: cents, frequency, renewalDate: renewal || null, startDate: start || null,
        paymentMethodId: pm || null, status,
        cancelNoticeDays: noticeDays.trim() === "" ? null : Number(noticeDays),
        cancelUrl: cancelUrl.trim() || null, cancelNotes: cancelNotes.trim() || null,
      };
      return editing ? patch<SubscriptionDTO>(`/subscriptions/${editing.id}`, body) : post<SubscriptionDTO>("/subscriptions", body);
    },
    { success: editing ? "Abonnement modifié" : "Abonnement ajouté", onDone },
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(undefined as never, { onError: (err) => setError(errorMessage(err)) }); }}>
      <Field label="Nom" htmlFor="sn">
        <TextInput id="sn" data-autofocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} list="sub-presets" />
        <datalist id="sub-presets">{SUBSCRIPTION_PRESETS.map((p) => <option key={p.name} value={p.name} />)}</datalist>
      </Field>
      <Field label="Famille" htmlFor="sf"><Select id="sf" value={family} onChange={(v) => setFamily(v as SubscriptionFamily)}>{SUBSCRIPTION_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prix" htmlFor="sa"><AmountInput id="sa" value={amount} onChange={setAmount} /></Field>
        <Field label="Facturation" htmlFor="sq"><Select id="sq" value={frequency} onChange={setFrequency}>{FREQS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prochain renouvellement" htmlFor="sr"><TextInput id="sr" type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} /></Field>
        <Field label="Début" htmlFor="ss"><TextInput id="ss" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payé avec" htmlFor="sp"><Select id="sp" value={pm} onChange={setPm}><option value="">Non précisé</option>{paymentMethods.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Statut" htmlFor="st"><Select id="st" value={status} onChange={setStatus}>{SUBSCRIPTION_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
      </div>
      <fieldset className="flex flex-col gap-3 rounded-2xl bg-raised/60 p-4">
        <legend className="px-1 text-sm font-semibold">Résiliation</legend>
        <Field label="Préavis (jours)" htmlFor="sd"><TextInput id="sd" inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
        <Field label="Lien pour résilier" htmlFor="su"><TextInput id="su" type="url" value={cancelUrl} onChange={(e) => setCancelUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Notes" htmlFor="sno"><TextInput id="sno" value={cancelNotes} onChange={(e) => setCancelNotes(e.target.value)} maxLength={500} /></Field>
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={save.isPending}>{editing ? "Enregistrer" : "Ajouter l'abonnement"}</Button>
      {onDelete && <Button type="button" variant="danger" onClick={onDelete}>Supprimer</Button>}
    </form>
  );
}

export default function Subscriptions() {
  const subs = useSubscriptions();
  const { settings } = useSession();
  const today = todayInZone(settings.timezone);
  const [sheet, setSheet] = useState<{ editing: SubscriptionDTO | null } | null>(null);
  const [toDelete, setToDelete] = useState<SubscriptionDTO | null>(null);
  const pay = useAction((s: SubscriptionDTO) => post<SubscriptionDTO>(`/subscriptions/${s.id}/pay`, { dueDate: s.renewalDate ?? undefined }), { success: "Paiement enregistré dans vos dépenses" });
  const remove = useAction((id: string) => del(`/subscriptions/${id}`), { success: "Abonnement supprimé", onDone: () => setToDelete(null) });

  if (subs.isError) return <ErrorState message={errorMessage(subs.error)} onRetry={() => subs.refetch()} />;
  const d = subs.data;
  if (!d) return <Skeleton className="h-64 rounded-[26px]" />;
  const nameOf = (id: string) => d.items.find((s) => s.id === id)?.name ?? "";

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Par mois" value={money(d.costs.monthlyCents)} />
          <Stat label="Par an" value={money(d.costs.yearlyCents)} />
        </div>
        <ul className="mt-4 grid grid-cols-3 gap-2 text-center">
          {SUBSCRIPTION_FAMILIES.map((f) => (
            <li key={f.id} className="rounded-xl bg-raised/60 p-2">
              <p className="text-xs text-muted">{f.label}</p>
              <p className="num text-sm font-semibold">{money(d.costs.byFamily[f.id].monthlyCents)}</p>
              <p className="text-[11px] text-faint">{d.costs.byFamily[f.id].count} actif{d.costs.byFamily[f.id].count > 1 ? "s" : ""}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {d.duplicates.length > 0 && (
        <div role="note" className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">
          <p className="font-semibold">Doublon possible</p>
          {d.duplicates.map((g, i) => <p key={i}>{g.map(nameOf).join(" et ")} ressemblent à un même abonnement. Vérifiez que vous ne payez pas deux fois.</p>)}
        </div>
      )}

      <Button onClick={() => setSheet({ editing: null })}><Plus size={18} aria-hidden /> Ajouter un abonnement</Button>

      {d.upcoming.length > 0 && (
        <Panel aria-labelledby="up-title">
          <SectionTitle id="up-title">À renouveler bientôt</SectionTitle>
          <ul>
            {d.upcoming.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-b border-line/60 py-3 last:border-0">
                <BellRing size={18} className="text-warn" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{s.name}</span>
                  <span className="text-[13px] text-faint">{s.inDays < 0 ? `En retard de ${-s.inDays} j` : s.inDays === 0 ? "Aujourd'hui" : `Dans ${s.inDays} j`} · {s.renewalDate && shortDate(s.renewalDate)}</span>
                </span>
                <span className="num font-semibold">{money(s.amountCents)}</span>
                <Button variant="secondary" loading={pay.isPending && pay.variables?.id === s.id} onClick={() => pay.mutate(s)}>Payé</Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">« Payé » crée une vraie dépense à la date d'échéance et avance le prochain renouvellement. Rien n'est enregistré automatiquement.</p>
        </Panel>
      )}

      <Panel aria-labelledby="all-title">
        <SectionTitle id="all-title">Tous les abonnements</SectionTitle>
        {d.items.length === 0 ? <Empty title="Aucun abonnement">Ajoutez vos abonnements pour voir ce qu'ils coûtent vraiment par mois et par an.</Empty> : (
          <ul>
            {d.items.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSheet({ editing: s })} className="flex w-full items-center gap-3 border-b border-line/60 py-3 text-left last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] font-medium ${s.status === "cancelled" ? "text-faint line-through" : ""}`}>{s.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      {familyLabel(s.family)} · {frequencyLabel(s.frequency).toLowerCase()}
                      {s.status !== "active" && <Pill tone={s.status === "cancelled" ? "danger" : "neutral"}>{SUBSCRIPTION_STATUSES.find((x) => x.id === s.status)?.label}</Pill>}
                      {s.renewalDate && s.status !== "cancelled" && <> · renouvellement {shortDate(s.renewalDate)}{s.renewalDate < today ? " (dépassé)" : ""}</>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="num block font-semibold">{money(s.amountCents)}</span>
                    {s.frequency !== "monthly" && <span className="num text-xs text-faint">{money(s.monthlyCents)}/mois</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.editing ? "Modifier l'abonnement" : "Nouvel abonnement"}>
        {sheet && <SubscriptionForm key={sheet.editing?.id ?? "new"} editing={sheet.editing} onDone={() => setSheet(null)} onDelete={sheet.editing ? () => { setToDelete(sheet.editing); setSheet(null); } : undefined} />}
      </Sheet>
      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer cet abonnement ?" message="Les dépenses déjà enregistrées sont conservées." confirmLabel="Supprimer" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}
