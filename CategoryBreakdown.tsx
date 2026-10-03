import type { CategoryTotal } from "../../shared/finance";
import { getCategory } from "../../shared/categories";
import { formatEUR, formatPercent } from "../../shared/money";
import { Panel, SectionTitle } from "./ui";

export function CategoryBreakdown({ categories, totalCents }: { categories: CategoryTotal[]; totalCents: number }) {
  const used = categories.filter((c) => c.amountCents > 0);
  const empty = categories.filter((c) => c.amountCents === 0);
  const max = Math.max(...categories.map((c) => c.amountCents), 1);

  return (
    <Panel aria-labelledby="where-title">
      <SectionTitle id="where-title">Où va mon argent ?</SectionTitle>

      {totalCents > 0 && (
        <div className="mb-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {used.map((c) => (
            <div key={c.categoryId} className="anim-grow h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${c.percent}%`, background: getCategory(c.categoryId).color }} />
          ))}
        </div>
      )}

      {used.length === 0 && <p className="mb-3 text-[15px] text-muted">Aucune dépense ce mois-ci. La répartition apparaîtra ici.</p>}

      <ul className="flex flex-col">
        {used.map((c) => {
          const cat = getCategory(c.categoryId);
          return (
            <li key={c.categoryId} className="py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-[15px]">
                  <span aria-hidden className="text-lg">{cat.emoji}</span>
                  {cat.label}
                </span>
                <span className="num flex items-baseline gap-2">
                  <span className="text-[15px] font-semibold">{formatEUR(c.amountCents)}</span>
                  <span className="w-14 text-right text-[13px] text-faint">{formatPercent(c.percent)}</span>
                </span>
              </div>
              <div className="mt-1.5 ml-8 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                <div className="anim-grow h-full rounded-full" style={{ width: `${(c.amountCents / max) * 100}%`, background: cat.color }} />
              </div>
            </li>
          );
        })}
      </ul>

      {empty.length > 0 && (
        <ul className={`grid grid-cols-2 gap-x-4 gap-y-2 ${used.length > 0 ? "mt-3 border-t border-line pt-3" : ""}`}>
          {empty.map((c) => {
            const cat = getCategory(c.categoryId);
            return (
              <li key={c.categoryId} className="flex min-w-0 items-center justify-between gap-2 text-sm text-faint">
                <span className="truncate">
                  <span aria-hidden>{cat.emoji}</span> {cat.label}
                </span>
                <span className="num shrink-0">0 €</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
