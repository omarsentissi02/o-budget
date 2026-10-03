import { Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getCategory } from "../../shared/categories";
import { flagEmoji } from "../../shared/countries";
import { formatEUR } from "../../shared/money";
import { dayShort } from "../../shared/month";
import { locationLabel, type ExpenseEntryDTO } from "../../shared/types";

/** Ligne compacte (tableau de bord). */
export function EntryRow({ entry }: { entry: ExpenseEntryDTO }) {
  const cats = entry.amounts.map((a) => getCategory(a.categoryId));
  return (
    <Link
      to={`/depense/${entry.id}`}
      className="-mx-2 flex min-h-16 items-center gap-3 rounded-2xl px-2 transition hover:bg-raised"
      aria-label={`${dayShort(entry.date)}, ${cats.map((c) => c.label).join(", ")}, ${formatEUR(entry.totalCents)}. Modifier`}
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-xl">
        {cats[0]?.emoji}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">
          {entry.description || cats.map((c) => c.label).join(" · ")}
        </span>
        <span className="truncate text-[13px] text-faint">
          {dayShort(entry.date)}, {entry.location.type === "france" ? entry.location.city : entry.location.countryName}
          {cats.length > 1 ? `, ${cats.length} catégories` : ""}
        </span>
      </span>
      <span className="num text-[15px] font-semibold">{formatEUR(entry.totalCents)}</span>
    </Link>
  );
}

/** Détail complet (historique). */
export function EntryDetail({ entry, onDelete }: { entry: ExpenseEntryDTO; onDelete: (e: ExpenseEntryDTO) => void }) {
  const flag = entry.location.type === "abroad" ? flagEmoji(entry.location.countryCode) : "🇫🇷";
  return (
    <article className="rounded-2xl bg-raised/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {entry.description && <p className="truncate text-[15px] font-semibold">{entry.description}</p>}
          <p className="text-[13px] text-muted">
            <span aria-hidden>{flag}</span> {locationLabel(entry.location)}, payé avec {entry.paymentLabel}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Link
            to={`/depense/${entry.id}`}
            aria-label="Modifier cette dépense"
            className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"
          >
            <Pencil size={18} />
          </Link>
          <button
            type="button"
            onClick={() => onDelete(entry)}
            aria-label="Supprimer cette dépense"
            className="grid size-10 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {entry.amounts.map((a) => {
          const c = getCategory(a.categoryId);
          return (
            <li key={a.categoryId} className="flex items-center justify-between text-[15px]">
              <span>
                <span aria-hidden>{c.emoji}</span> {c.label}
              </span>
              <span className="num">{formatEUR(a.amountCents)}</span>
            </li>
          );
        })}
      </ul>
      {entry.amounts.length > 1 && (
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-[15px] font-semibold">
          <span>Total</span>
          <span className="num">{formatEUR(entry.totalCents)}</span>
        </div>
      )}
    </article>
  );
}
