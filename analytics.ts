import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError, validate } from "../lib/http";
import { isValidISODate } from "../../shared/month";
import { addDaysISO, diffDays } from "../../shared/recurrence";
import {
  breakdown, buildSeries, compareTotals, detectUnusual, filterLines, periodRange, previousRange, DIMENSIONS,
  type Dimension, type Granularity, type LineFilter, type PeriodTotals,
} from "../../shared/analytics";
import { loadLines, loadReceivedIncomes, loadSavingsByMonth } from "../lib/data";
import { loadSettings, localNow } from "../lib/settings";

const isoDate = z.string().refine(isValidISODate, "Date invalide.");
const rangeQuery = z.object({
  granularity: z.enum(["day", "week", "month", "year"]).default("month"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Période par défaut selon la granularité (dates calendaires de l'utilisateur). */
function defaultRange(g: Granularity, today: string) {
  switch (g) {
    case "day":
      return { from: addDaysISO(today, -29), to: today };
    case "week":
      return { from: addDaysISO(periodRange(today, "week").from, -7 * 11), to: periodRange(today, "week").to };
    case "month": {
      const first = periodRange(today, "month").from;
      const [y, m] = first.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1 - 11, 1));
      return { from: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`, to: periodRange(today, "month").to };
    }
    case "year":
      return { from: `${Number(today.slice(0, 4)) - 4}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

function parseRange(raw: Record<string, string | undefined>, today: string) {
  const q = validate(rangeQuery, raw);
  const d = defaultRange(q.granularity, today);
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  if (from > to) throw new ApiError(400, "La date de début doit précéder la date de fin.");
  if (diffDays(from, to) > 3700) throw new ApiError(400, "Période trop longue (10 ans maximum).");
  return { granularity: q.granularity, from, to };
}

const filterQuery = z.object({
  category: z.string().max(64).optional(),
  sub: z.string().max(64).optional(),
  merchant: z.string().max(64).optional(),
  platform: z.string().max(64).optional(),
  payment: z.string().max(64).optional(),
  place: z.string().max(80).optional(),
});
const toFilter = (raw: Record<string, string | undefined>): LineFilter => {
  const f = validate(filterQuery, raw);
  return {
    categoryId: f.category, subcategoryId: f.sub, merchantId: f.merchant, platformId: f.platform, paymentLabel: f.payment, place: f.place,
  };
};

export const analytics = new Hono<AppEnv>()
  /** Évolutions (revenus reçus, dépenses, épargne), comparaison avec la période précédente, dépenses inhabituelles. */
  .get("/analytics/overview", async (c) => {
    const userId = c.get("userId");
    const db = c.env.DB;
    const settings = await loadSettings(db, userId);
    const { today } = localNow(settings);
    const { granularity, from, to } = parseRange(c.req.query(), today);
    const prev = previousRange(from, to);

    const [lines, incomes, savings, prevLines, prevIncomes, recent] = await Promise.all([
      loadLines(db, userId, from, to),
      loadReceivedIncomes(db, userId, from, to),
      loadSavingsByMonth(db, userId, from.slice(0, 7), to.slice(0, 7)),
      loadLines(db, userId, prev.from, prev.to),
      loadReceivedIncomes(db, userId, prev.from, prev.to),
      loadLines(db, userId, addDaysISO(today, -180), today),
    ]);
    const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
    const totals = (ls: typeof lines, is: typeof incomes): PeriodTotals => ({ incomeCents: sum(is), expenseCents: sum(ls), netCents: sum(is) - sum(ls) });

    return c.json({
      range: { granularity, from, to, previous: prev },
      series: buildSeries({ from, to, granularity, expenses: lines.map((l) => ({ date: l.date, amountCents: l.amountCents })), receivedIncomes: incomes, savingsByMonth: savings }),
      comparison: compareTotals(totals(lines, incomes), totals(prevLines, prevIncomes)),
      categories: breakdown(lines, "category"),
      unusual: detectUnusual(recent, today),
    });
  })

  /** Répartition par dimension, avec filtres cumulatifs pour l'exploration (catégorie → sous-catégorie → établissement / plateforme). */
  .get("/analytics/breakdown", async (c) => {
    const userId = c.get("userId");
    const settings = await loadSettings(c.env.DB, userId);
    const { from, to } = parseRange(c.req.query(), localNow(settings).today);
    const by = c.req.query("by") ?? "category";
    if (!DIMENSIONS.includes(by as Dimension)) throw new ApiError(400, "Dimension d'analyse inconnue.");
    const lines = await loadLines(c.env.DB, userId, from, to);
    return c.json({ from, to, by, ...breakdown(lines, by as Dimension, toFilter(c.req.query())) });
  })

  /** Les transactions exactes qui composent un total (même filtres que la répartition). */
  .get("/analytics/transactions", async (c) => {
    const userId = c.get("userId");
    const settings = await loadSettings(c.env.DB, userId);
    const { from, to } = parseRange(c.req.query(), localNow(settings).today);
    const lines = filterLines(await loadLines(c.env.DB, userId, from, to), toFilter(c.req.query()));
    return c.json({ from, to, totalCents: lines.reduce((s, l) => s + l.amountCents, 0), count: lines.length, lines: lines.slice(0, 300) });
  });
