import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { taskCategorySchema, taskSchema, taskUpdateSchema } from "../../shared/schemas";
import { dayLoads, nextDueDate, parseQuickTask, type Recurrence } from "../../shared/tasks";
import type { TaskCategoryDTO, TaskDTO, TasksOverviewDTO } from "../../shared/types";
import { loadSettings, localNow } from "../lib/settings";
import { addDaysISO } from "../../shared/recurrence";

interface Row {
  id: string; title: string; description: string | null; priority: TaskDTO["priority"]; status: TaskDTO["status"];
  due_date: string | null; due_time: string | null; estimated_minutes: number | null; category_id: string | null;
  recurrence: Recurrence; series_id: string | null; created_at: string; completed_at: string | null;
}
const COLS = "id, title, description, priority, status, due_date, due_time, estimated_minutes, category_id, recurrence, series_id, created_at, completed_at";
const toDTO = (r: Row): TaskDTO => ({
  id: r.id, title: r.title, description: r.description, priority: r.priority, status: r.status, dueDate: r.due_date, dueTime: r.due_time,
  estimatedMinutes: r.estimated_minutes, categoryId: r.category_id, recurrence: r.recurrence, seriesId: r.series_id, createdAt: r.created_at, completedAt: r.completed_at,
});

async function assertTaskCategory(db: D1Database, userId: string, id: string | null | undefined) {
  if (!id) return null;
  const ok = await db.prepare("SELECT 1 FROM task_categories WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!ok) throw new ApiError(400, "Catégorie de tâche inconnue.");
  return id;
}

async function getOne(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(`SELECT ${COLS} FROM tasks WHERE id = ? AND user_id = ?`).bind(id, userId).first<Row>();
  if (!row) throw new ApiError(404, "Tâche introuvable.");
  return row;
}

export const tasks = new Hono<AppEnv>()
  /**
   * Liste : tâches ouvertes + terminées récentes (30 jours). `?from=&to=` filtre par échéance (calendrier).
   * Inclut la charge par jour sur 14 jours pour repérer les journées surchargées.
   */
  .get("/tasks", async (c) => {
    const userId = c.get("userId");
    const settings = await loadSettings(c.env.DB, userId);
    const { today } = localNow(settings);
    const doneSince = addDaysISO(today, -30);
    const { results } = await c.env.DB.prepare(
      `SELECT ${COLS} FROM tasks WHERE user_id = ? AND (status IN ('todo', 'in_progress') OR (status = 'done' AND completed_at >= ?)) ORDER BY due_date IS NULL, due_date, due_time, created_at`,
    ).bind(userId, `${doneSince}T00:00:00Z`).all<Row>();
    const cats = await c.env.DB.prepare("SELECT id, name, color FROM task_categories WHERE user_id = ? ORDER BY name").bind(userId).all<TaskCategoryDTO>();
    const list = results.map(toDTO);
    const body: TasksOverviewDTO = { tasks: list, categories: cats.results, loads: dayLoads(list, today, 14) };
    return c.json(body);
  })

  .post("/tasks", async (c) => {
    const userId = c.get("userId");
    const input = validate(taskSchema, await readJson(c.req));
    const categoryId = await assertTaskCategory(c.env.DB, userId, input.categoryId);
    const recurrence = input.recurrence ?? "none";
    if (recurrence !== "none" && !input.dueDate) throw new ApiError(400, "Une tâche récurrente a besoin d'une date d'échéance.");
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, description, priority, status, due_date, due_time, estimated_minutes, category_id, recurrence, series_id, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, input.title, input.description || null, input.priority ?? "normal", input.status ?? "todo", input.dueDate ?? null, input.dueTime ?? null,
      input.estimatedMinutes ?? null, categoryId, recurrence, recurrence !== "none" ? id : null, input.status === "done" ? nowISO() : null).run();
    return c.json(toDTO(await getOne(c.env.DB, userId, id)), 201);
  })

  /** Saisie rapide : « Appeler le médecin demain 14h30 !! ~20min » → la tâche est créée directement. */
  .post("/tasks/quick", async (c) => {
    const userId = c.get("userId");
    const body = (await readJson(c.req)) as { text?: unknown; defaultDate?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length === 0) throw new ApiError(400, "Écrivez le titre de la tâche.");
    if (body.text.length > 300) throw new ApiError(400, "Texte trop long.");
    const settings = await loadSettings(c.env.DB, userId);
    const { today } = localNow(settings);
    const parsed = parseQuickTask(body.text, today);
    if (!parsed.title) throw new ApiError(400, "Écrivez le titre de la tâche.");
    const defaultDate = typeof body.defaultDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.defaultDate) ? body.defaultDate : null;
    const id = uuid();
    await c.env.DB.prepare(
      "INSERT INTO tasks (id, user_id, title, priority, due_date, due_time, estimated_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, userId, parsed.title.slice(0, 160), parsed.priority, parsed.dueDate ?? defaultDate, parsed.dueTime, parsed.estimatedMinutes).run();
    return c.json(toDTO(await getOne(c.env.DB, userId, id)), 201);
  })

  .patch("/tasks/:id", async (c) => {
    const userId = c.get("userId");
    const input = validate(taskUpdateSchema, await readJson(c.req));
    const cur = await getOne(c.env.DB, userId, c.req.param("id"));
    const pick = <T>(v: T | undefined, d: T) => (v !== undefined ? v : d);
    const categoryId = input.categoryId !== undefined ? await assertTaskCategory(c.env.DB, userId, input.categoryId) : cur.category_id;
    const status = pick(input.status, cur.status);
    const dueDate = pick(input.dueDate, cur.due_date);
    const dueTime = dueDate ? pick(input.dueTime, cur.due_time) : null;
    const recurrence = pick(input.recurrence, cur.recurrence);
    if (recurrence !== "none" && !dueDate) throw new ApiError(400, "Une tâche récurrente a besoin d'une date d'échéance.");
    const completing = status === "done" && cur.status !== "done";
    const reopening = status !== "done" && cur.status === "done";
    const completedAt = completing ? nowISO() : reopening ? null : cur.completed_at;
    const stmts = [
      c.env.DB.prepare(
        `UPDATE tasks SET title = ?, description = ?, priority = ?, status = ?, due_date = ?, due_time = ?, estimated_minutes = ?, category_id = ?,
           recurrence = ?, series_id = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).bind(pick(input.title, cur.title), pick(input.description, cur.description) || null, pick(input.priority, cur.priority), status, dueDate, dueTime,
        pick(input.estimatedMinutes, cur.estimated_minutes), categoryId, recurrence, recurrence === "none" ? null : (cur.series_id ?? cur.id), completedAt, nowISO(), cur.id, userId),
    ];
    // Terminer une tâche récurrente crée l'occurrence suivante (à partir de l'échéance prévue).
    if (completing && recurrence !== "none" && dueDate) {
      const next = nextDueDate(dueDate, recurrence);
      if (next) {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO tasks (id, user_id, title, description, priority, status, due_date, due_time, estimated_minutes, category_id, recurrence, series_id)
             VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
          ).bind(uuid(), userId, pick(input.title, cur.title), pick(input.description, cur.description) || null, pick(input.priority, cur.priority), next, dueTime,
            pick(input.estimatedMinutes, cur.estimated_minutes), categoryId, recurrence, cur.series_id ?? cur.id),
        );
      }
    }
    await c.env.DB.batch(stmts);
    return c.json(toDTO(await getOne(c.env.DB, userId, cur.id)));
  })

  .delete("/tasks/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Tâche introuvable.");
    return c.body(null, 204);
  })

  .post("/task-categories", async (c) => {
    const userId = c.get("userId");
    const input = validate(taskCategorySchema, await readJson(c.req));
    const id = uuid();
    try {
      await c.env.DB.prepare("INSERT INTO task_categories (id, user_id, name, color) VALUES (?, ?, ?, ?)").bind(id, userId, input.name, input.color ?? "#4F5BD5").run();
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new ApiError(409, "Cette catégorie existe déjà.");
      throw e;
    }
    const dto: TaskCategoryDTO = { id, name: input.name, color: input.color ?? "#4F5BD5" };
    return c.json(dto, 201);
  })

  .delete("/task-categories/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM task_categories WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Catégorie introuvable.");
    return c.body(null, 204);
  });
