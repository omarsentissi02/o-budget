import { addDaysISO, addMonthsISO, parseISO, weekdayIndex } from "./recurrence";

export const PRIORITIES = [
  { id: "urgent", label: "Urgent", weight: 0 },
  { id: "important", label: "Important", weight: 1 },
  { id: "normal", label: "Normal", weight: 2 },
] as const;
export type Priority = (typeof PRIORITIES)[number]["id"];
export const PRIORITY_IDS = PRIORITIES.map((p) => p.id) as [Priority, ...Priority[]];
export const priorityLabel = (id: string) => PRIORITIES.find((p) => p.id === id)?.label ?? id;
const weight = (p: Priority) => PRIORITIES.find((x) => x.id === p)?.weight ?? 2;

export const TASK_STATUSES = [
  { id: "todo", label: "À faire" },
  { id: "in_progress", label: "En cours" },
  { id: "done", label: "Terminée" },
  { id: "cancelled", label: "Annulée" },
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]["id"];
export const TASK_STATUS_IDS = TASK_STATUSES.map((s) => s.id) as [TaskStatus, ...TaskStatus[]];

export const RECURRENCES = [
  { id: "none", label: "Jamais" },
  { id: "daily", label: "Chaque jour" },
  { id: "weekdays", label: "Jours ouvrés" },
  { id: "weekly", label: "Chaque semaine" },
  { id: "monthly", label: "Chaque mois" },
  { id: "yearly", label: "Chaque année" },
] as const;
export type Recurrence = (typeof RECURRENCES)[number]["id"];
export const RECURRENCE_IDS = RECURRENCES.map((r) => r.id) as [Recurrence, ...Recurrence[]];

export interface TaskLike {
  id: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number | null;
}

export const isOpen = (t: Pick<TaskLike, "status">) => t.status === "todo" || t.status === "in_progress";

/** Date d'échéance suivante d'une tâche récurrente (jamais dans le passé relatif à l'échéance précédente). */
export function nextDueDate(due: string, rule: Recurrence): string | null {
  switch (rule) {
    case "none":
      return null;
    case "daily":
      return addDaysISO(due, 1);
    case "weekdays": {
      let next = addDaysISO(due, 1);
      while (weekdayIndex(next) > 4) next = addDaysISO(next, 1);
      return next;
    }
    case "weekly":
      return addDaysISO(due, 7);
    case "monthly":
      return addMonthsISO(due, 1);
    case "yearly":
      return addMonthsISO(due, 12);
  }
}

/** Tri : priorité, puis échéance (avec heure), puis titre. Les tâches sans date passent en dernier. */
export function compareTasks(a: TaskLike, b: TaskLike): number {
  const da = a.dueDate ? `${a.dueDate} ${a.dueTime ?? "23:59"}` : "9999";
  const db = b.dueDate ? `${b.dueDate} ${b.dueTime ?? "23:59"}` : "9999";
  return weight(a.priority) - weight(b.priority) || (da < db ? -1 : da > db ? 1 : 0) || a.title.localeCompare(b.title, "fr");
}

export interface TaskBuckets<T extends TaskLike> {
  overdue: T[];
  today: T[];
  upcoming: T[];
  later: T[];
  noDate: T[];
  done: T[];
}

/** `nowTime` « HH:MM » : une tâche du jour dont l'heure est passée est considérée en retard. */
export function bucketTasks<T extends TaskLike>(tasks: T[], today: string, nowTime = "00:00", upcomingDays = 7): TaskBuckets<T> {
  const b: TaskBuckets<T> = { overdue: [], today: [], upcoming: [], later: [], noDate: [], done: [] };
  const horizon = addDaysISO(today, upcomingDays);
  for (const t of tasks) {
    if (t.status === "done") b.done.push(t);
    else if (t.status === "cancelled") continue;
    else if (!t.dueDate) b.noDate.push(t);
    else if (t.dueDate < today || (t.dueDate === today && t.dueTime !== null && t.dueTime < nowTime)) b.overdue.push(t);
    else if (t.dueDate === today) b.today.push(t);
    else if (t.dueDate <= horizon) b.upcoming.push(t);
    else b.later.push(t);
  }
  for (const key of ["overdue", "today", "upcoming", "later", "noDate"] as const) b[key].sort(compareTasks);
  return b;
}

export const OVERLOAD = { minutes: 420, count: 8 };

export interface DayLoad {
  date: string;
  count: number;
  minutes: number;
  overloaded: boolean;
}

/** Charge par jour (tâches ouvertes) : surchargé au-delà de 7 h estimées ou de 8 tâches. */
export function dayLoads(tasks: TaskLike[], from: string, days: number): DayLoad[] {
  const out: DayLoad[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(from, i);
    const list = tasks.filter((t) => isOpen(t) && t.dueDate === date);
    const minutes = list.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
    out.push({ date, count: list.length, minutes, overloaded: minutes > OVERLOAD.minutes || list.length >= OVERLOAD.count });
  }
  return out;
}

// --- Saisie rapide en langage naturel (français) ------------------------------------------------------

export interface ParsedTask {
  title: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  estimatedMinutes: number | null;
}

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/**
 * « Appeler le médecin demain 14h30 !! ~20min » → titre, échéance, heure, priorité, durée.
 *  - « !! » ou « !urgent » = urgent ; « ! » ou « !important » = important
 *  - « aujourd'hui », « demain », « après-demain », un jour de la semaine (prochaine occurrence), « le 12/11 »
 *  - heure : « 14h », « 14h30 », « 14:30 », « à 9h »
 *  - durée : « ~30min », « ~1h », « ~1h30 »
 * Tout le reste devient le titre. Aucune date n'est inventée : sans indication, dueDate vaut null.
 */
export function parseQuickTask(input: string, today: string): ParsedTask {
  let text = ` ${input.trim()} `;
  let priority: Priority = "normal";
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let estimatedMinutes: number | null = null;
  const strip = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.replace(re, " ");
    return m;
  };

  if (strip(/\s(!!|!urgent)(?=\s)/i)) priority = "urgent";
  else if (strip(/\s(!|!important)(?=\s)/i)) priority = "important";

  const dur = strip(/\s~\s?(?:(\d{1,2})\s?h(?:\s?(\d{1,2}))?|(\d{1,3})\s?(?:min|m))(?=\s)/i);
  if (dur) {
    estimatedMinutes = dur[3] ? Number(dur[3]) : Number(dur[1]) * 60 + (dur[2] ? Number(dur[2]) : 0);
    if (estimatedMinutes <= 0 || estimatedMinutes > 24 * 60) estimatedMinutes = null;
  }

  const time = strip(/\s(?:à\s)?(\d{1,2})\s?(?:h|:)\s?(\d{2})?(?=\s)/i);
  if (time) {
    const h = Number(time[1]);
    const mi = time[2] ? Number(time[2]) : 0;
    if (h <= 23 && mi <= 59) dueTime = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }

  const lower = () => text.toLowerCase();
  if (/\saprès-demain(?=\s)/.test(lower())) {
    text = text.replace(/\saprès-demain(?=\s)/i, " ");
    dueDate = addDaysISO(today, 2);
  } else if (/\sdemain(?=\s)/.test(lower())) {
    text = text.replace(/\sdemain(?=\s)/i, " ");
    dueDate = addDaysISO(today, 1);
  } else if (/\saujourd['’]hui(?=\s)/.test(lower())) {
    text = text.replace(/\saujourd['’]hui(?=\s)/i, " ");
    dueDate = today;
  } else {
    const day = WEEKDAYS.find((d) => new RegExp(`\\s${d}(?=\\s)`, "i").test(text));
    if (day) {
      text = text.replace(new RegExp(`\\s${day}(?=\\s)`, "i"), " ");
      const target = WEEKDAYS.indexOf(day);
      const diff = ((target - weekdayIndex(today) + 7) % 7) || 7;
      dueDate = addDaysISO(today, diff);
    } else {
      const dm = strip(/\s(?:le\s)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?=\s)/);
      if (dm) {
        const day2 = Number(dm[1]);
        const month = Number(dm[2]);
        const year = dm[3] ? Number(dm[3]) : parseISO(today).y;
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day2).padStart(2, "0")}`;
        const probe = new Date(Date.UTC(year, month - 1, day2));
        if (probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day2) {
          dueDate = !dm[3] && iso < today ? `${year + 1}-${iso.slice(5)}` : iso;
        }
      }
    }
  }
  if (dueTime && !dueDate) dueDate = today;

  const title = text.replace(/\s+/g, " ").trim();
  return { title, priority, dueDate, dueTime, estimatedMinutes };
}
