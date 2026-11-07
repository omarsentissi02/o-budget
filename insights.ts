import { computeAlerts, type AlertDraft, type AlertInput } from "../../shared/alerts";
import { detectUnusual } from "../../shared/analytics";
import { budgetStatus } from "../../shared/budget";
import { addDaysISO } from "../../shared/recurrence";
import { findDuplicateSubscriptions } from "../../shared/subscriptions";
import { dayLoads, type TaskLike } from "../../shared/tasks";
import type { SettingsDTO } from "../../shared/types";
import { loadDueItems, loadLines, loadMonthFacts, loadSubscriptionLikes, type MonthFacts } from "./data";
import { loadSettings, localNow } from "./settings";

export interface Snapshot {
  settings: SettingsDTO;
  today: string;
  time: string;
  month: string;
  facts: MonthFacts;
  budgets: AlertInput["budgets"];
  alertInput: AlertInput;
  tasks: (TaskLike & { open: boolean })[];
}

/** Rassemble tout ce dont les règles déterministes ont besoin, depuis la base, pour UN utilisateur. */
export async function buildSnapshot(db: D1Database, userId: string, now = new Date()): Promise<Snapshot> {
  const settings = await loadSettings(db, userId);
  const { today, time } = localNow(settings, now);
  const month = today.slice(0, 7);
  const facts = await loadMonthFacts(db, userId, month, settings, today);

  const budgetRows = await db.prepare("SELECT category_id, limit_cents FROM budgets WHERE user_id = ? AND month = ?").bind(userId, month).all<{ category_id: string; limit_cents: number }>();
  const spentBy = new Map(facts.summary.categories.map((c) => [c.categoryId as string, c.amountCents]));
  const budgets = budgetRows.results.map((b) => ({
    categoryId: b.category_id,
    status: budgetStatus(spentBy.get(b.category_id) ?? 0, b.limit_cents, settings.alertPrefs.budgetWarnAt),
  }));

  const lines = await loadLines(db, userId, addDaysISO(today, -180), today);
  const unusual = detectUnusual(lines, today);

  const subs = await loadSubscriptionLikes(db, userId);
  const duplicates = findDuplicateSubscriptions(subs);
  const soon = await loadDueItems(db, userId, addDaysISO(today, 3));

  const taskRows = await db
    .prepare("SELECT id, title, priority, status, due_date, due_time, estimated_minutes FROM tasks WHERE user_id = ? AND status IN ('todo', 'in_progress')")
    .bind(userId)
    .all<{ id: string; title: string; priority: TaskLike["priority"]; status: TaskLike["status"]; due_date: string | null; due_time: string | null; estimated_minutes: number | null }>();
  const tasks = taskRows.results.map((t) => ({
    id: t.id, title: t.title, priority: t.priority, status: t.status, dueDate: t.due_date, dueTime: t.due_time, estimatedMinutes: t.estimated_minutes, open: true,
  }));

  const alertInput: AlertInput = {
    today, month, position: facts.position, budgets, unusual, subscriptions: subs, duplicates,
    obligations: soon.map((o) => ({ id: o.id, label: o.label, amountCents: o.amountCents, dueDate: o.dueDate, kind: o.kind })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime, open: true })),
    nowTime: time,
    dayLoads: dayLoads(tasks, today, 7),
  };
  return { settings, today, time, month, facts, budgets, alertInput, tasks };
}

export const snapshotAlerts = (s: Snapshot): AlertDraft[] => computeAlerts(s.alertInput, s.settings.alertPrefs);

/** Écrit les alertes nouvelles (clé de dédoublonnage) sans jamais réactiver une alerte déjà fermée. */
export async function syncNotifications(db: D1Database, userId: string, alerts: AlertDraft[]) {
  if (alerts.length === 0) return;
  await db.batch(
    alerts.map((a) =>
      db
        .prepare(
          `INSERT INTO notifications (id, user_id, dedupe_key, kind, level, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), userId, a.dedupeKey, a.kind, a.level, a.title, a.body, a.link),
    ),
  );
}
