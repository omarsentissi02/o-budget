import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, List, CalendarDays, Plus } from "lucide-react";
import { formatEUR, formatEURRounded } from "../../shared/money";
import { dayLabel, daysInMonth, firstWeekdayOfMonth, todayISO } from "../../shared/month";
import type { ExpenseEntryDTO } from "../../shared/types";
import { useSelectedMonth } from "../hooks/MonthContext";
import { useToast } from "../hooks/Toast";
import { api, errorMessage } from "../lib/api";
import { useExpenses, useRefreshFinance } from "../lib/queries";
import { MonthSwitcher } from "../components/MonthSwitcher";
import { EntryDetail } from "../components/EntryCard";
import { ConfirmSheet } from "../components/Sheet";
import { Button, ErrorState, Panel, Segmented, Skeleton } from "../components/ui";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const WEEKDAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function groupByDay(entries: ExpenseEntryDTO[]) {
  const map = new Map<string, ExpenseEntryDTO[]>();
  for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
  return [...map.entries()].map(([date, list]) => ({ date, list, total: list.reduce((s, e) => s + e.totalCents, 0) }));
}

function DayGroup({ date, list, total, defaultOpen, onDelete }: { date: string; list: ExpenseEntryDTO[]; total: number; defaultOpen: boolean; onDelete: (e: ExpenseEntryDTO) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `day-${date}`;
  return (
    <li className="rounded-[22px] bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-16 w-full items-center justify-between gap-3 rounded-[22px] px-5 text-left"
      >
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold">{dayLabel(date)}</span>
          <span className="text-[13px] text-faint">
            {list.length} saisie{list.length > 1 ? "s" : ""}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="num text-[17px] font-semibold">{formatEUR(total)}</span>
          <ChevronDown size={18} aria-hidden className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div id={panelId} className="anim-fade flex flex-col gap-2 px-3 pb-3">
          {list.map((e) => (
            <EntryDetail key={e.id} entry={e} onDelete={onDelete} />
          ))}
        </div>
      )}
    </li>
  );
}

function Calendar({ month, entries, selected, onSelect }: { month: string; entries: ExpenseEntryDTO[]; selected: string | null; onSelect: (d: string) => void }) {
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.date, (m.get(e.date) ?? 0) + e.totalCents);
    return m;
  }, [entries]);
  const max = Math.max(...totals.values(), 1);
  const lead = firstWeekdayOfMonth(month);
  const days = daysInMonth(month);
  const today = todayISO();

  return (
    <Panel className="p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Calendrier des dépenses">
        <div role="row" className="contents">
          {WEEKDAYS.map((d, i) => (
            <div key={i} role="columnheader" aria-label={WEEKDAY_NAMES[i]} className="pb-1 text-center text-[12px] font-semibold text-faint">
              {d}
            </div>
          ))}
        </div>
        <div role="row" className="contents">
          {Array.from({ length: lead }, (_, i) => (
            <div key={`pad-${i}`} role="gridcell" aria-hidden />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
            const total = totals.get(iso) ?? 0;
            const isSel = selected === iso;
            const intensity = total > 0 ? 0.12 + 0.38 * (total / max) : 0;
            return (
              <div key={iso} role="gridcell">
                <button
                  type="button"
                  onClick={() => onSelect(iso)}
                  aria-pressed={isSel}
                  aria-label={`${dayLabel(iso)} : ${total > 0 ? formatEUR(total) : "aucune dépense"}`}
                  className={`relative flex aspect-[4/5] w-full flex-col items-center justify-start gap-0.5 rounded-xl pt-1.5 transition ${
                    isSel ? "ring-2 ring-accent" : ""
                  } ${iso === today ? "font-bold text-accent" : ""}`}
                  style={total > 0 ? { background: `color-mix(in srgb, var(--accent) ${intensity * 100}%, transparent)` } : undefined}
                >
                  <span className="text-[14px]">{i + 1}</span>
                  {total > 0 && <span className="num text-[10px] leading-tight font-semibold sm:text-[11px]">{formatEURRounded(total)}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

export default function History() {
  const { month, setMonth } = useSelectedMonth();
  const entries = useExpenses(month);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshFinance();
  const [view, setView] = useState<"list" | "calendar">(() => (sessionStorage.getItem("ob:view") === "calendar" ? "calendar" : "list"));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ExpenseEntryDTO | null>(null);

  const groups = useMemo(() => groupByDay(entries.data ?? []), [entries.data]);
  const monthTotal = groups.reduce((s, g) => s + g.total, 0);

  const del = useMutation({
    mutationFn: (id: string) => api<void>(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setToDelete(null);
      await refresh();
      toast("Dépense supprimée");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const changeView = (v: "list" | "calendar") => {
    sessionStorage.setItem("ob:view", v);
    setView(v);
  };

  const dayGroup = selectedDay ? groups.find((g) => g.date === selectedDay) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <MonthSwitcher month={month} onChange={(m) => { setMonth(m); setSelectedDay(null); }} />
      <div className="flex items-center justify-between px-1">
        <p className="text-[15px] text-muted">
          Total du mois <span className="num font-semibold text-ink">{formatEUR(monthTotal)}</span>
        </p>
      </div>
      <Segmented
        label="Affichage"
        value={view}
        onChange={changeView}
        options={[
          { value: "list", label: <><List size={16} aria-hidden /> Liste</> },
          { value: "calendar", label: <><CalendarDays size={16} aria-hidden /> Calendrier</> },
        ]}
      />

      {entries.isError ? (
        <ErrorState message={errorMessage(entries.error)} onRetry={() => entries.refetch()} />
      ) : !entries.data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : view === "list" ? (
        groups.length === 0 ? (
          <Panel className="flex flex-col items-start gap-3">
            <p className="text-[15px] text-muted">Aucune dépense ce mois-ci. Ajoutez votre première dépense pour suivre votre mois.</p>
            <Button onClick={() => navigate("/depense/nouvelle")}>
              <Plus size={18} aria-hidden /> Ajouter une dépense
            </Button>
          </Panel>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((g, i) => (
              <DayGroup key={g.date} {...g} defaultOpen={i === 0} onDelete={setToDelete} />
            ))}
          </ul>
        )
      ) : (
        <>
          <Calendar month={month} entries={entries.data} selected={selectedDay} onSelect={setSelectedDay} />
          {selectedDay && (
            <section aria-live="polite" className="anim-fade flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-[17px] font-semibold">{dayLabel(selectedDay)}</h2>
                {dayGroup && <span className="num font-semibold">{formatEUR(dayGroup.total)}</span>}
              </div>
              {dayGroup ? (
                dayGroup.list.map((e) => <EntryDetail key={e.id} entry={e} onDelete={setToDelete} />)
              ) : (
                <p className="px-1 text-[15px] text-muted">Aucune dépense ce jour-là.</p>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmSheet
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Supprimer cette dépense ?"
        message={toDelete ? `${dayLabel(toDelete.date)}, ${formatEUR(toDelete.totalCents)}. Cette action est définitive.` : ""}
        confirmLabel="Supprimer la dépense"
        loading={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}
