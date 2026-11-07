import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, validate } from "../lib/http";
import { monthKey, notificationActionSchema } from "../../shared/schemas";
import { levelRank } from "../../shared/alerts";
import { formatEUR } from "../../shared/money";
import { SELECTABLE_CATEGORIES } from "../../shared/categories";
import type { InsightDTO, NotificationDTO, OverviewDTO, TaskDTO } from "../../shared/types";
import { buildSnapshot, snapshotAlerts, syncNotifications } from "../lib/insights";
import { loadAccountBalance, loadMonthFacts } from "../lib/data";
import { listRecentEntries } from "../lib/periods";
import { budgetStatus } from "../../shared/budget";
import { bucketTasks } from "../../shared/tasks";

export const overview = new Hono<AppEnv>()
  .get("/overview", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const snap = await buildSnapshot(db, userId);
    const requested = c.req.query("month");
    const month = requested ? validate(monthKey, requested) : snap.month;
    const isCurrent = month === snap.month;
    const facts = isCurrent ? snap.facts : await loadMonthFacts(db, userId, month, snap.settings, snap.today);

    // Alertes : persistées (une fois chacune) uniquement pour le mois courant.
    const alerts = snapshotAlerts(snap);
    if (isCurrent) await syncNotifications(db, userId, alerts);

    const insights: InsightDTO[] = alerts
      .sort((a, b) => levelRank(b.level) - levelRank(a.level))
      .slice(0, 3)
      .map((a) => ({ level: a.level, title: a.title, body: a.body, link: a.link }));
    if (isCurrent && facts.position.dailyAllowanceCents > 0 && insights.length < 3) {
      insights.push({
        level: "info",
        title: `Vous pouvez dépenser environ ${formatEUR(facts.position.dailyAllowanceCents)} par jour`,
        body: `Calcul : (disponible − échéances − épargne prévue − réserve) ÷ ${facts.position.remainingDays} jours restants.`,
        link: "/assistant",
      });
    }

    const budgetRows = await db.prepare("SELECT category_id, limit_cents FROM budgets WHERE user_id = ? AND month = ?").bind(userId, month).all<{ category_id: string; limit_cents: number }>();
    const spentBy = new Map(facts.summary.categories.map((x) => [x.categoryId as string, x.amountCents]));
    const budgets = budgetRows.results
      .filter((b) => SELECTABLE_CATEGORIES.some((s) => s.id === b.category_id) || b.category_id === "autre")
      .map((b) => ({ categoryId: b.category_id as never, limitCents: b.limit_cents, status: budgetStatus(spentBy.get(b.category_id) ?? 0, b.limit_cents, snap.settings.alertPrefs.budgetWarnAt) }))
      .sort((a, b) => (b.status.ratio ?? 0) - (a.status.ratio ?? 0));

    const taskRows = await db
      .prepare("SELECT id, title, description, priority, status, due_date, due_time, estimated_minutes, category_id, recurrence, series_id, created_at, completed_at FROM tasks WHERE user_id = ? AND status IN ('todo','in_progress')")
      .bind(userId)
      .all<Record<string, string | number | null>>();
    const tasks: TaskDTO[] = taskRows.results.map((r) => ({
      id: r.id as string, title: r.title as string, description: r.description as string | null, priority: r.priority as TaskDTO["priority"], status: r.status as TaskDTO["status"],
      dueDate: r.due_date as string | null, dueTime: r.due_time as string | null, estimatedMinutes: r.estimated_minutes as number | null, categoryId: r.category_id as string | null,
      recurrence: r.recurrence as TaskDTO["recurrence"], seriesId: r.series_id as string | null, createdAt: r.created_at as string, completedAt: r.completed_at as string | null,
    }));
    const buckets = bucketTasks(tasks, snap.today, snap.time);

    const unread = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND dismissed_at IS NULL AND read_at IS NULL").bind(userId).first<{ n: number }>();

    const body: OverviewDTO = {
      month,
      today: snap.today,
      position: facts.position,
      summary: facts.summary,
      accountBalanceCents: await loadAccountBalance(db, userId, snap.settings, snap.today),
      obligations: facts.obligations.slice(0, 8),
      budgets,
      insights,
      recent: await listRecentEntries(db, userId, 5),
      tasksToday: buckets.today.slice(0, 5),
      tasksOverdueCount: buckets.overdue.length,
      unreadNotifications: unread?.n ?? 0,
    };
    return c.json(body);
  })

  .get("/notifications", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, kind, level, title, body, link, created_at, read_at FROM notifications
       WHERE user_id = ? AND dismissed_at IS NULL ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, created_at DESC LIMIT 100`,
    ).bind(c.get("userId")).all<{ id: string; kind: string; level: NotificationDTO["level"]; title: string; body: string; link: string | null; created_at: string; read_at: string | null }>();
    const out: NotificationDTO[] = results.map((r) => ({ id: r.id, kind: r.kind, level: r.level, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, readAt: r.read_at }));
    return c.json(out);
  })

  /** Recalcule les alertes à la demande (jamais en arrière-plan : aucune notification push n'est envoyée). */
  .post("/notifications/refresh", async (c) => {
    const snap = await buildSnapshot(c.env.DB, c.get("userId"));
    const alerts = snapshotAlerts(snap);
    await syncNotifications(c.env.DB, c.get("userId"), alerts);
    return c.json({ evaluated: alerts.length });
  })

  .post("/notifications/read-all", async (c) => {
    await c.env.DB.prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL").bind(c.get("userId")).run();
    return c.body(null, 204);
  })

  .post("/notifications/:id", async (c) => {
    const { action } = validate(notificationActionSchema, await readJson(c.req));
    const col = action === "read" ? "read_at" : "dismissed_at";
    const res = await c.env.DB.prepare(`UPDATE notifications SET ${col} = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Notification introuvable.");
    return c.body(null, 204);
  });
