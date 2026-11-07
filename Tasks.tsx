import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Circle, Clock, Plus, Repeat } from "lucide-react";
import { addDaysISO, startOfWeekISO } from "../../shared/recurrence";
import { bucketTasks, PRIORITIES, RECURRENCES, priorityLabel, TASK_STATUSES } from "../../shared/tasks";
import { daysInMonth, dayLabel, firstWeekdayOfMonth, monthLabel, shiftMonth, timeInZone, todayInZone } from "../../shared/month";
import type { TaskCategoryDTO, TaskDTO } from "../../shared/types";
import { del, errorMessage, FormError, patch, post } from "../lib/api";
import { useAction, useSession, useTasks } from "../lib/queries";
import { ConfirmSheet, Sheet } from "../components/Sheet";
import { Button, ErrorState, Field, Panel, SectionTitle, Skeleton, TextInput } from "../components/ui";
import { Empty, PageHeader, Pill, Select, Tabs } from "../components/v2";

const VIEWS = [
  { value: "jour", label: "Ma journée" }, { value: "semaine", label: "Semaine" }, { value: "calendrier", label: "Calendrier" },
  { value: "avenir", label: "À venir" }, { value: "retard", label: "En retard" }, { value: "faites", label: "Terminées" },
] as const;
type View = (typeof VIEWS)[number]["value"];
const PRIO_TONE = { urgent: "danger", important: "warn", normal: "neutral" } as const;

function TaskItem({ t, cats, today, onOpen, onToggle }: { t: TaskDTO; cats: TaskCategoryDTO[]; today: string; onOpen: (t: TaskDTO) => void; onToggle: (t: TaskDTO) => void }) {
  const done = t.status === "done";
  const cat = cats.find((c) => c.id === t.categoryId);
  return (
    <li className="flex items-start gap-3 border-b border-line/60 py-3 last:border-0">
      <button type="button" onClick={() => onToggle(t)} aria-label={done ? `Rouvrir ${t.title}` : `Terminer ${t.title}`} className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 transition ${done ? "border-save bg-save text-white" : "border-line text-transparent hover:border-accent hover:text-accent"}`}>
        {done ? <Check size={16} aria-hidden /> : <Circle size={0} aria-hidden />}
      </button>
      <button type="button" onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
        <span className={`block text-[15px] font-medium ${done ? "text-faint line-through" : ""}`}>{t.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
          {t.priority !== "normal" && <Pill tone={PRIO_TONE[t.priority]}>{priorityLabel(t.priority)}</Pill>}
          {t.dueDate && <span className={t.dueDate < today && !done ? "text-danger" : ""}>{t.dueDate === today ? "Aujourd'hui" : dayLabel(t.dueDate)}{t.dueTime ? ` · ${t.dueTime}` : ""}</span>}
          {t.estimatedMinutes && <span className="inline-flex items-center gap-0.5"><Clock size={12} aria-hidden />{t.estimatedMinutes} min</span>}
          {t.recurrence !== "none" && <span className="inline-flex items-center gap-0.5"><Repeat size={12} aria-hidden />{RECURRENCES.find((r) => r.id === t.recurrence)?.label}</span>}
          {cat && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: cat.color }} aria-hidden />{cat.name}</span>}
        </span>
      </button>
    </li>
  );
}

function TaskForm({ editing, cats, defaultDate, onDone, onDelete }: { editing: TaskDTO | null; cats: TaskCategoryDTO[]; defaultDate: string; onDone: () => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [priority, setPriority] = useState<string>(editing?.priority ?? "normal");
  const [date, setDate] = useState(editing ? editing.dueDate ?? "" : defaultDate);
  const [time, setTime] = useState(editing?.dueTime ?? "");
  const [minutes, setMinutes] = useState(editing?.estimatedMinutes?.toString() ?? "");
  const [cat, setCat] = useState(editing?.categoryId ?? "");
  const [rec, setRec] = useState<string>(editing?.recurrence ?? "none");
  const [status, setStatus] = useState<string>(editing?.status ?? "todo");
  const [error, setError] = useState<string | null>(null);
  const save = useAction(async () => {
    if (!title.trim()) throw new FormError("Donnez un titre à la tâche.");
    if (time && !date) throw new FormError("Indiquez une date pour fixer une heure.");
    if (rec !== "none" && !date) throw new FormError("Une tâche récurrente a besoin d'une date.");
    const body = { title: title.trim(), description: desc.trim() || null, priority, dueDate: date || null, dueTime: time || null, estimatedMinutes: minutes ? Number(minutes) : null, categoryId: cat || null, recurrence: rec, ...(editing ? { status } : {}) };
    return editing ? patch<TaskDTO>(`/tasks/${editing.id}`, body) : post<TaskDTO>("/tasks", body);
  }, { success: editing ? "Tâche modifiée" : "Tâche ajoutée", keys: ["tasks", "overview", "ai-reco"], onDone });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(undefined as never, { onError: (err) => setError(errorMessage(err)) }); }}>
      <Field label="Titre" htmlFor="tt"><TextInput id="tt" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
      <Field label="Notes" htmlFor="td"><TextInput id="td" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="tdate"><TextInput id="tdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Heure" htmlFor="ttime"><TextInput id="ttime" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priorité" htmlFor="tp"><Select id="tp" value={priority} onChange={setPriority}>{PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Durée (min)" htmlFor="tm"><TextInput id="tm" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 4))} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Répétition" htmlFor="tr"><Select id="tr" value={rec} onChange={setRec}>{RECURRENCES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
        <Field label="Catégorie" htmlFor="tc"><Select id="tc" value={cat} onChange={setCat}><option value="">Aucune</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </div>
      {editing && <Field label="Statut" htmlFor="ts"><Select id="ts" value={status} onChange={setStatus}>{TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" loading={save.isPending}>{editing ? "Enregistrer" : "Ajouter la tâche"}</Button>
      {onDelete && <Button type="button" variant="danger" onClick={onDelete}>Supprimer</Button>}
    </form>
  );
}

export default function Tasks() {
  const { settings } = useSession();
  const today = todayInZone(settings.timezone);
  const now = timeInZone(settings.timezone);
  const data = useTasks();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("jour");
  const [quick, setQuick] = useState("");
  const [sheet, setSheet] = useState<{ editing: TaskDTO | null } | null>(params.get("nouvelle") ? { editing: null } : null);
  const [toDelete, setToDelete] = useState<TaskDTO | null>(null);
  const [calMonth, setCalMonth] = useState(today.slice(0, 7));
  const [calDay, setCalDay] = useState<string>(today);

  const keys = ["tasks", "overview", "ai-reco"];
  const add = useAction((text: string) => post<TaskDTO>("/tasks/quick", { text, defaultDate: view === "jour" ? today : undefined }), { success: "Tâche ajoutée", keys, onDone: () => setQuick("") });
  const toggle = useAction((t: TaskDTO) => patch<TaskDTO>(`/tasks/${t.id}`, { status: t.status === "done" ? "todo" : "done" }), { keys });
  const remove = useAction((id: string) => del(`/tasks/${id}`), { success: "Tâche supprimée", keys, onDone: () => setToDelete(null) });

  const tasks = data.data?.tasks ?? [];
  const cats = data.data?.categories ?? [];
  const buckets = useMemo(() => bucketTasks(tasks, today, now, 7), [tasks, today, now]);
  const loads = new Map((data.data?.loads ?? []).map((l) => [l.date, l]));
  const closeSheet = () => { setSheet(null); if (params.get("nouvelle")) { params.delete("nouvelle"); setParams(params, { replace: true }); } };

  if (data.isError) return <ErrorState message={errorMessage(data.error)} onRetry={() => data.refetch()} />;

  const list = (items: TaskDTO[], empty: string) =>
    items.length === 0 ? <Empty title={empty} /> : <ul>{items.map((t) => <TaskItem key={t.id} t={t} cats={cats} today={today} onOpen={(x) => setSheet({ editing: x })} onToggle={(x) => toggle.mutate(x)} />)}</ul>;

  const weekStart = startOfWeekISO(today);
  const lead = firstWeekdayOfMonth(calMonth);
  const byDay = (d: string) => tasks.filter((t) => t.dueDate === d && t.status !== "cancelled");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Tâches" subtitle={data.data ? `${buckets.today.length + buckets.overdue.length} à traiter aujourd'hui` : undefined} action={<Button onClick={() => setSheet({ editing: null })}><Plus size={18} aria-hidden /> Détaillée</Button>} />
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (quick.trim()) add.mutate(quick); }} className="flex gap-2">
        <TextInput aria-label="Ajout rapide" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Appeler la CAF demain 14h !" maxLength={200} />
        <Button type="submit" loading={add.isPending} disabled={!quick.trim()} className="shrink-0">Ajouter</Button>
      </form>
      <Tabs label="Vues des tâches" value={view} onChange={setView} tabs={VIEWS.map((v) => ({ ...v, label: v.value === "retard" && buckets.overdue.length ? `${v.label} (${buckets.overdue.length})` : v.label }))} />

      {!data.data ? <Skeleton className="h-64 rounded-[26px]" /> : (
        <>
          {view === "jour" && (
            <>
              {buckets.overdue.length > 0 && <Panel><SectionTitle>En retard</SectionTitle>{list(buckets.overdue, "")}</Panel>}
              <Panel><SectionTitle>Aujourd'hui</SectionTitle>{list(buckets.today, "Rien de prévu aujourd'hui.")}</Panel>
              {loads.get(today)?.overloaded && <p role="note" className="rounded-2xl bg-warn-soft p-3 text-sm text-warn">Journée chargée : {loads.get(today)!.count} tâches, environ {Math.round(loads.get(today)!.minutes / 60)} h estimées. Pensez à décaler une tâche.</p>}
              {buckets.noDate.length > 0 && <Panel><SectionTitle>Sans date</SectionTitle>{list(buckets.noDate, "")}</Panel>}
            </>
          )}
          {view === "semaine" && (
            <ul className="flex flex-col gap-3">
              {Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)).map((d) => (
                <li key={d}><Panel>
                  <SectionTitle action={loads.get(d)?.overloaded ? <Pill tone="warn">Chargé</Pill> : loads.get(d) ? <span className="text-xs text-faint">{loads.get(d)!.count} tâche{loads.get(d)!.count > 1 ? "s" : ""}</span> : undefined}>{d === today ? "Aujourd'hui" : dayLabel(d)}</SectionTitle>
                  {list(byDay(d), "Rien de prévu.")}
                </Panel></li>
              ))}
            </ul>
          )}
          {view === "calendrier" && (
            <>
              <Panel className="p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" aria-label="Mois précédent" onClick={() => setCalMonth(shiftMonth(calMonth, -1))} className="grid size-10 place-items-center rounded-full hover:bg-raised"><ChevronLeft size={20} /></button>
                  <p className="font-semibold">{monthLabel(calMonth)}</p>
                  <button type="button" aria-label="Mois suivant" onClick={() => setCalMonth(shiftMonth(calMonth, 1))} className="grid size-10 place-items-center rounded-full hover:bg-raised"><ChevronRight size={20} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} className="pb-1 text-center text-xs font-semibold text-faint">{d}</div>)}
                  {Array.from({ length: lead }, (_, i) => <div key={`p${i}`} aria-hidden />)}
                  {Array.from({ length: daysInMonth(calMonth) }, (_, i) => {
                    const iso = `${calMonth}-${String(i + 1).padStart(2, "0")}`;
                    const n = byDay(iso).filter((t) => t.status !== "done").length;
                    return (
                      <button key={iso} type="button" onClick={() => setCalDay(iso)} aria-pressed={calDay === iso} aria-label={`${dayLabel(iso)} : ${n} tâche${n > 1 ? "s" : ""}`} className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition ${calDay === iso ? "bg-accent text-accent-ink" : iso === today ? "bg-accent-soft font-bold text-accent" : "hover:bg-raised"}`}>
                        {i + 1}
                        {n > 0 && <span className={`mt-0.5 h-1 w-1 rounded-full ${calDay === iso ? "bg-accent-ink" : loads.get(iso)?.overloaded ? "bg-warn" : "bg-accent"}`} aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </Panel>
              <Panel><SectionTitle>{dayLabel(calDay)}</SectionTitle>{list(byDay(calDay), "Aucune tâche ce jour-là.")}</Panel>
            </>
          )}
          {view === "avenir" && <Panel>{list([...buckets.upcoming, ...buckets.later], "Rien à venir.")}</Panel>}
          {view === "retard" && <Panel>{list(buckets.overdue, "Rien en retard. Bien joué !")}</Panel>}
          {view === "faites" && <Panel>{list(buckets.done.slice(0, 50), "Aucune tâche terminée.")}</Panel>}
        </>
      )}

      <Sheet open={!!sheet} onClose={closeSheet} title={sheet?.editing ? "Modifier la tâche" : "Nouvelle tâche"}>
        {sheet && <TaskForm key={sheet.editing?.id ?? "new"} editing={sheet.editing} cats={cats} defaultDate={view === "calendrier" ? calDay : today} onDone={closeSheet} onDelete={sheet.editing ? () => { setToDelete(sheet.editing); closeSheet(); } : undefined} />}
      </Sheet>
      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer cette tâche ?" message={toDelete ? `« ${toDelete.title} » sera définitivement supprimée.` : ""} confirmLabel="Supprimer" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}
