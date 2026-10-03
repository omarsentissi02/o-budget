import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, monthLabel, shiftMonth } from "../../shared/month";

export function MonthSwitcher({ month, onChange, size = "lg" }: { month: string; onChange: (m: string) => void; size?: "lg" | "md" }) {
  const isCurrent = month === currentMonthKey();
  const btn = "grid size-11 place-items-center rounded-full text-muted transition hover:bg-raised hover:text-ink";
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" className={btn} onClick={() => onChange(shiftMonth(month, -1))} aria-label="Mois précédent">
        <ChevronLeft size={22} />
      </button>
      <div className="flex min-w-0 flex-col items-center">
        <h1 aria-live="polite" className={`font-semibold tracking-tight ${size === "lg" ? "text-[26px] leading-8" : "text-xl"}`}>
          {monthLabel(month)}
        </h1>
        {!isCurrent && (
          <button type="button" onClick={() => onChange(currentMonthKey())} className="text-[13px] font-medium text-accent">
            Revenir au mois en cours
          </button>
        )}
      </div>
      <button type="button" className={btn} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Mois suivant">
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
