import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { centsToInput, formatEUR, formatPercent, parseAmountToCents } from "../../shared/money";
import { monthName } from "../../shared/month";
import type { MonthSummaryDTO } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { useRefreshFinance } from "../lib/queries";
import { useToast } from "../hooks/Toast";
import { Sheet } from "./Sheet";
import { AmountInput, Button, Field, useFieldId } from "./ui";

function SavingsForm({ summary, onDone }: { summary: MonthSummaryDTO; onDone: () => void }) {
  const [value, setValue] = useState(summary.savingsCents ? centsToInput(summary.savingsCents) : "");
  const [error, setError] = useState<string | null>(null);
  const refresh = useRefreshFinance();
  const toast = useToast();
  const id = useFieldId("savings");
  const cents = value === "" ? 0 : parseAmountToCents(value);
  const income = summary.totals.incomeCents;

  const save = useMutation({
    mutationFn: () => {
      if (cents === null) throw new Error("amount");
      return api<MonthSummaryDTO>(`/months/${summary.month}/savings`, { method: "PUT", body: { amountCents: cents } });
    },
    onSuccess: async (s) => {
      await refresh(s);
      toast("Épargne enregistrée");
      onDone();
    },
    onError: (e) => setError(e.message === "amount" ? "Indiquez un montant valide, par exemple 300." : errorMessage(e)),
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <Field
        label={`Montant épargné en ${monthName(summary.month)}`}
        htmlFor={id}
        error={error}
        hint={
          cents !== null && cents > 0 && income > 0
            ? `Taux d'épargne : ${formatPercent((cents / income) * 100)} de ${formatEUR(income)} de revenus.`
            : "L'épargne ne s'ajoute pas aux dépenses : elle indique la part du reste mise de côté."
        }
      >
        <AmountInput id={id} value={value} onChange={setValue} large data-autofocus />
      </Field>
      <Button type="submit" size="lg" block loading={save.isPending}>
        Enregistrer
      </Button>
    </form>
  );
}

export function SavingsSheet({ open, onClose, summary }: { open: boolean; onClose: () => void; summary: MonthSummaryDTO }) {
  return (
    <Sheet open={open} onClose={onClose} title="Épargne du mois">
      {open && <SavingsForm summary={summary} onDone={onClose} />}
    </Sheet>
  );
}
