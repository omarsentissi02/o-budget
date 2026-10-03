import { ChevronRight } from "lucide-react";
import type { MonthTotals } from "../../shared/finance";
import { formatEUR, formatPercent } from "../../shared/money";
import { AnimatedNumber } from "./AnimatedNumber";

function Row({
  label,
  cents,
  hint,
  onClick,
  actionLabel,
  dot,
}: {
  label: string;
  cents: number;
  hint?: string;
  onClick?: () => void;
  actionLabel?: string;
  dot: string;
}) {
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="flex min-w-0 flex-col items-start">
          <span className="text-[15px] font-medium">{label}</span>
          {hint && <span className="truncate text-[13px] text-faint">{hint}</span>}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <AnimatedNumber cents={cents} className="text-[17px] font-semibold" />
        {onClick && <ChevronRight size={18} className="text-faint" aria-hidden />}
      </span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} : ${formatEUR(cents)}. ${actionLabel ?? ""}`}
      className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-2xl px-2 text-left transition hover:bg-raised"
    >
      {content}
    </button>
  ) : (
    <div className="flex min-h-14 items-center justify-between gap-3">{content}</div>
  );
}

/**
 * Le récapitulatif du mois se lit comme un ticket : revenus, dépenses, épargne, puis le reste.
 * La barre montre comment les revenus se répartissent ; l'épargne est une part du reste (jamais soustraite deux fois).
 */
export function Ledger({
  totals,
  incomeCount,
  onIncome,
  onSavings,
}: {
  totals: MonthTotals;
  incomeCount: number;
  onIncome: () => void;
  onSavings: () => void;
}) {
  const { incomeCents, expenseCents, savingsCents, remainingCents, savingsRate } = totals;
  const negative = remainingCents < 0;
  const base = Math.max(incomeCents, expenseCents, 1);
  const spentPct = (expenseCents / base) * 100;
  const savedPct = (Math.min(savingsCents, Math.max(remainingCents, 0)) / base) * 100;
  const usedPct = incomeCents > 0 ? Math.round((expenseCents / incomeCents) * 100) : null;

  return (
    <section aria-label="Récapitulatif du mois" className="anim-ledger rounded-[30px] bg-surface p-5 pb-6">
      <Row
        label="Revenus"
        cents={incomeCents}
        dot="bg-ink/25"
        hint={incomeCount === 0 ? "À renseigner pour ce mois" : `${incomeCount} source${incomeCount > 1 ? "s" : ""}`}
        onClick={onIncome}
        actionLabel="Modifier les revenus"
      />
      <Row label="Dépenses" cents={expenseCents} dot="bg-ink" />
      <Row
        label="Épargne"
        cents={savingsCents}
        dot="bg-save"
        hint={savingsRate !== null && savingsCents > 0 ? `Taux d'épargne ${formatPercent(savingsRate)}` : "Touchez pour indiquer votre épargne"}
        onClick={onSavings}
        actionLabel="Modifier l'épargne"
      />

      <div className="mt-3 border-t border-dashed border-line pt-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 shrink-0">
            <p className="text-[15px] font-medium">Reste</p>
            <p className="text-[13px] whitespace-nowrap text-faint">Revenus − dépenses</p>
          </div>
          <AnimatedNumber
            cents={remainingCents}
            className={`text-right text-[clamp(28px,9.5vw,44px)] leading-none font-semibold tracking-[-0.03em] ${negative ? "text-danger" : "text-accent"}`}
          />
        </div>

        <div
          className="mt-5 flex h-3 overflow-hidden rounded-full bg-accent/20"
          role="img"
          aria-label={
            usedPct === null
              ? "Aucun revenu renseigné"
              : `${usedPct} % des revenus dépensés${savingsCents > 0 ? `, dont l'épargne mise de côté sur le reste` : ""}`
          }
        >
          <div className="anim-grow h-full bg-ink" style={{ width: `${spentPct}%` }} />
          {savedPct > 0 && (
            <div className="anim-grow h-full border-l-2 border-surface bg-save" style={{ width: `${savedPct}%` }} />
          )}
        </div>
        <p className="mt-2.5 text-[13px] text-muted">
          {usedPct === null
            ? "Ajoutez vos revenus pour voir ce qu'il vous reste."
            : negative
              ? `Vous avez dépensé ${formatEUR(-remainingCents)} de plus que vos revenus.`
              : `${usedPct} % des revenus dépensés${savingsCents > 0 ? `, dont ${formatEUR(Math.min(savingsCents, remainingCents))} épargnés sur le reste` : ""}.`}
        </p>
      </div>
    </section>
  );
}
