import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate } from "../lib/http";
import { aiChatSchema } from "../../shared/schemas";
import { aiConfig, buildContext, callModel, extractProposals, systemPrompt, type ChatTurn } from "../lib/ai";
import { buildSnapshot, snapshotAlerts } from "../lib/insights";
import { buildRecommendations } from "../../shared/recommendations";
import { bucketTasks } from "../../shared/tasks";
import { subscriptionCosts, findDuplicateSubscriptions } from "../../shared/subscriptions";
import { loadSubscriptionLikes, monthBounds } from "../lib/data";
import { addDaysISO } from "../../shared/recurrence";
import type { AiMessageDTO, AiStatusDTO } from "../../shared/types";

interface MsgRow { id: string; role: "user" | "assistant"; content: string; meta: string | null; created_at: string }

const toDTO = (r: MsgRow): AiMessageDTO => {
  let proposals: AiMessageDTO["proposals"];
  try {
    proposals = r.meta ? (JSON.parse(r.meta) as { proposals?: AiMessageDTO["proposals"] }).proposals : undefined;
  } catch {
    proposals = undefined;
  }
  return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at, proposals };
};

export const ai = new Hono<AppEnv>()
  .get("/ai/status", (c) => {
    const cfg = aiConfig(c.env);
    const body: AiStatusDTO = { configured: !!cfg, provider: cfg?.provider ?? null, model: cfg?.model ?? null };
    return c.json(body);
  })

  .get("/ai/messages", async (c) => {
    const { results } = await c.env.DB.prepare("SELECT id, role, content, meta, created_at FROM ai_messages WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
      .bind(c.get("userId")).all<MsgRow>();
    return c.json(results.reverse().map(toDTO));
  })

  .delete("/ai/messages", async (c) => {
    await c.env.DB.prepare("DELETE FROM ai_messages WHERE user_id = ?").bind(c.get("userId")).run();
    return c.body(null, 204);
  })

  /** Recommandations déterministes (finance, productivité, argent × temps) : disponibles sans aucun fournisseur IA. */
  .get("/ai/recommendations", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const snap = await buildSnapshot(db, userId);
    const subs = await loadSubscriptionLikes(db, userId);
    const costs = subscriptionCosts(subs);
    const buckets = bucketTasks(snap.tasks, snap.today, snap.time);
    const trips = await db.prepare(
      `SELECT a.trip_date AS date, a.trip_to AS dest, SUM(a.amount_cents) AS total FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
       WHERE e.user_id = ? AND a.trip_date > ? AND a.trip_date <= ? GROUP BY a.trip_date, a.trip_to ORDER BY a.trip_date`,
    ).bind(userId, snap.today, addDaysISO(snap.today, 30)).all<{ date: string; dest: string | null; total: number }>();
    const recommendations = buildRecommendations({
      today: snap.today,
      position: snap.facts.position,
      topCategories: snap.facts.summary.categories.filter((x) => x.amountCents > 0).slice(0, 3),
      subscriptionsMonthlyCents: costs.monthlyCents,
      subscriptionsCount: subs.filter((s) => s.status === "active" || s.status === "trial").length,
      duplicateGroups: findDuplicateSubscriptions(subs).length,
      taskBuckets: buckets,
      loads: snap.alertInput.dayLoads,
      upcomingTrips: trips.results.map((t) => ({ date: t.date, to: t.dest, amountCents: t.total })),
    });
    return c.json({ today: snap.today, recommendations, alerts: snapshotAlerts(snap) });
  })

  .post("/ai/chat", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const { message } = validate(aiChatSchema, await readJson(c.req));
    const cfg = aiConfig(c.env);
    if (!cfg) {
      throw new ApiError(503, "L'assistant conversationnel n'est pas configuré. Définissez AI_PROVIDER, AI_API_KEY et AI_MODEL côté serveur (voir le README). Les recommandations automatiques restent disponibles.");
    }
    const snap = await buildSnapshot(db, userId);
    let topMerchants: { label: string; amountCents: number }[] | undefined;
    if (snap.settings.aiShareDetail) {
      const { from, to } = monthBounds(snap.month);
      const rows = await db.prepare(
        `SELECT a.merchant_label AS label, SUM(a.amount_cents) AS total FROM expense_amounts a JOIN expense_entries e ON e.id = a.entry_id
         WHERE e.user_id = ? AND e.spent_on BETWEEN ? AND ? AND a.merchant_label IS NOT NULL GROUP BY a.merchant_id ORDER BY total DESC LIMIT 5`,
      ).bind(userId, from, to).all<{ label: string; total: number }>();
      topMerchants = rows.results.map((r) => ({ label: r.label, amountCents: r.total }));
    }
    const history = await db.prepare("SELECT role, content FROM ai_messages WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10").bind(userId).all<ChatTurn>();
    const turns: ChatTurn[] = [...history.results.reverse(), { role: "user", content: message }];
    const raw = await callModel(cfg, systemPrompt(buildContext(snap, { shareDetail: snap.settings.aiShareDetail, topMerchants })), turns);
    const { text, proposals } = extractProposals(raw);
    const userMsg = { id: uuid(), role: "user" as const, content: message };
    const botMsg = { id: uuid(), role: "assistant" as const, content: text };
    await db.batch([
      db.prepare("INSERT INTO ai_messages (id, user_id, role, content) VALUES (?, ?, 'user', ?)").bind(userMsg.id, userId, userMsg.content),
      db.prepare("INSERT INTO ai_messages (id, user_id, role, content, meta) VALUES (?, ?, 'assistant', ?, ?)").bind(botMsg.id, userId, botMsg.content, JSON.stringify({ model: cfg.model, proposals })),
    ]);
    const now = new Date().toISOString();
    const out: AiMessageDTO[] = [
      { ...userMsg, createdAt: now },
      { ...botMsg, createdAt: now, proposals },
    ];
    return c.json(out);
  });
