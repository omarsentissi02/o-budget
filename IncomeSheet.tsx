import { useState } from "react";
import { Plus } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { centsToInput, formatEUR, parseAmountToCents } from "../../shared/money";
import { monthName } from "../../shared/month";
import type { IncomeDTO, IncomeSource, MonthSummaryDTO } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { useRefreshFinance, useSession } from "../lib/queries";
import { useToast } from "../hooks/Toast";
import { Sheet } from "./Sheet";
import { AmountInput, Button, Field, TextInput, useFieldId } from "./ui";

const SUGGESTIONS = ["Régularisation de salaire", "CAF", "Mobili-Jeune", "Bourse", "Remboursement", "Prime"];
const SOURCE_NAME: Record<IncomeSource, string> = { alternance: "Alternance", freelance: "Freelance", other: "Autre revenu" };

type Editing = { kind: "edit"; income: IncomeDTO } | { kind: "create"; source: IncomeSource } | null;

function IncomeForm({
  month,
  editing,
  defaultCents,
  onDone,
}: {
  month: string;
  editing: Exclude<Editing, null>;
  defaultCents: number | null;
  onDone: () => void;
}) {
  const refresh = useRefreshFinance();
  const toast = useToast();
  const source = editing.kind === "edit" ? editing.income.source : editing.source;
  const [label, setLabel] = useState(editing.kind === "edit" ? editing.income.label : source === "other" ? "" : SOURCE_NAME[source]);
  const [amount, setAmount] = useState(editing.kind === "edit" ? centsToInput(editing.income.amountCents) : "");
  const [error, setError] = useState<string | null>(null);
  const labelId = useFieldId("income-label");
  const amountId = useFieldId("income-amount");

  const save = useMutation({
    mutationFn: () => {
      const cents = parseAmountToCents(amount);
      if (cents === null) throw new Error("amount");
      if (!label.trim()) throw new Error("label");
      return editing.kind === "edit"
        ? api<MonthSummaryDTO>(`/incomes/${editing.income.id}`, { method: "PATCH", body: { label: label.trim(), amountCents: cents } })
        : api<MonthSummaryDTO>("/incomes", { method: "POST", body: { month, source, label: label.trim(), amountCents: cents } });
    },
    onSuccess: async (summary) => {
      await refresh(summary);
      toast(editing.kind === "edit" ? "Revenu modifié" : "Revenu ajouté");
      onDone();
    },
    onError: (e) =>
      setError(
        e.message === "amount" ? "Indiquez un montant valide, par exemple 300 ou 1202,50." : e.message === "label" ? "Donnez un nom à ce revenu." : errorMessage(e),
      ),
  });

  const remove = useMutation({
    mutationFn: () => api<MonthSummaryDTO>(`/incomes/${(editing as { income: IncomeDTO }).income.id}`, { method: "DELETE" }),
    onSuccess: async (summary) => {
      await refresh(summary);
      toast("Revenu supprimé");
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <form
      className="anim-fade flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {source === "other" && (
        <Field label="Nom du revenu" htmlFor={labelId}>
          <TextInput id={labelId} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Ex. CAF" autoFocus />
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setLabel(s)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${label === s ? "bg-accent text-accent-ink" : "bg-raised text-muted hover:text-ink"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field
        label={`Montant reçu en ${monthName(month)}`}
        htmlFor={amountId}
        error={error}
        hint={
          defaultCents !== null ? (
            <>
              Montant habituel : {formatEUR(defaultCents)}.{" "}
              <button type="button" className="font-semibold text-accent" onClick={() => setAmount(centsToInput(defaultCents))}>
                Utiliser
              </button>
            </>
          ) : undefined
        }
      >
        <AmountInput id={amountId} value={amount} onChange={setAmount} large autoFocus={source !== "other"} />
      </Field>
      <div className="flex gap-2">
        {editing.kind === "edit" && (
          <Button type="button" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            Supprimer
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" className="flex-1" loading={save.isPending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function IncomeSheet({ open, onClose, summary }: { open: boolean; onClose: () => void; summary: MonthSummaryDTO }) {
  const { settings } = useSession();
  const refresh = useRefreshFinance();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const has = (s: IncomeSource) => summary.incomes.some((i) => i.source === s);
  const defaults: Record<IncomeSource, number | null> = {
    alternance: settings.defaultAlternanceCents,
    freelance: settings.defaultFreelanceCents,
    other: null,
  };

  const applyDefaults = useMutation({
    mutationFn: () => api<MonthSummaryDTO>(`/months/${summary.month}/apply-defaults`, { method: "POST" }),
    onSuccess: async (s) => {
      await refresh(s);
      toast("Montants habituels appliqués");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={`Revenus de ${monthName(summary.month)}`} description="Saisissez ce que vous avez réellement reçu ce mois-ci.">
      {editing ? (
        <IncomeForm
          key={editing.kind === "edit" ? editing.income.id : editing.source}
          month={summary.month}
          editing={editing}
          defaultCents={defaults[editing.kind === "edit" ? editing.income.source : editing.source]}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {summary.incomes.length > 0 ? (
            <ul className="flex flex-col">
              {summary.incomes.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ kind: "edit", income: i })}
                    className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center justify-between rounded-2xl px-2 text-left hover:bg-raised"
                  >
                    <span className="flex flex-col">
                      <span className="text-[15px] font-medium">{i.label}</span>
                      {i.label !== SOURCE_NAME[i.source] && <span className="text-[13px] text-faint">{SOURCE_NAME[i.source]}</span>}
                    </span>
                    <span className="num text-[15px] font-semibold">{formatEUR(i.amountCents)}</span>
                  </button>
                </li>
              ))}
              <li className="mt-2 flex justify-between border-t border-line pt-3 text-[15px] font-semibold">
                <span>Total</span>
                <span className="num">{formatEUR(summary.totals.incomeCents)}</span>
              </li>
            </ul>
          ) : (
            <p className="rounded-2xl bg-raised p-4 text-[15px] text-muted">
              Aucun revenu saisi pour ce mois. Si vous avez touché vos montants habituels, appliquez-les en un geste ; sinon, saisissez le montant réel.
            </p>
          )}

          {!has("alternance") && !has("freelance") && (
            <Button variant="secondary" block onClick={() => applyDefaults.mutate()} loading={applyDefaults.isPending}>
              Appliquer les montants habituels ({formatEUR(settings.defaultAlternanceCents + settings.defaultFreelanceCents)})
            </Button>
          )}

          <div className="flex flex-wrap gap-2">
            {(["alternance", "freelance"] as const).map(
              (s) =>
                !has(s) && (
                  <Button key={s} variant="secondary" onClick={() => setEditing({ kind: "create", source: s })}>
                    <Plus size={18} aria-hidden /> {SOURCE_NAME[s]}
                  </Button>
                ),
            )}
            <Button variant="secondary" onClick={() => setEditing({ kind: "create", source: "other" })}>
              <Plus size={18} aria-hidden /> Autre revenu
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
