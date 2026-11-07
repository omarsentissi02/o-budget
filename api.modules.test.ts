import { afterEach, describe, expect, it, vi } from "vitest";
import { addMonths, freshDb, makeClient, signup } from "./helpers/api";
import { addDaysISO } from "../shared/recurrence";
import { todayInZone } from "../shared/month";

const today = () => todayInZone("Europe/Paris");
const month = () => today().slice(0, 7);
const exp = (amountCents: number, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
  date: today(),
  location: { type: "france", city: "Paris" },
  amounts: [{ categoryId: "alimentation", amountCents, ...line }],
  paymentMethodId: null,
  ...over,
});

describe("abonnements", () => {
  it("coûts mensuels et annuels normalisés, doublons, renouvellements à venir", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = today();
    const mk = (body: Record<string, unknown>) => u.call("POST", "/subscriptions", { frequency: "monthly", renewalDate: addDaysISO(t, 5), ...body });
    expect((await mk({ name: "Canva", family: "pro", amountCents: 1199 })).status).toBe(201);
    expect((await mk({ name: "Free Mobile", family: "personal", amountCents: 1999 })).status).toBe(201);
    expect((await mk({ name: "Navigo", family: "transport", amountCents: 8870, categoryId: "transport", subcategoryId: "navigo" })).status).toBe(201);
    await mk({ name: "Adobe", family: "pro", amountCents: 6000, frequency: "yearly", renewalDate: addDaysISO(t, 200) });
    await mk({ name: "canva pro", family: "pro", amountCents: 1199 }); // doublon probable
    const o = (await u.call("GET", "/subscriptions")).data;
    expect(o.costs.monthlyCents).toBe(1199 + 1999 + 8870 + 500 + 1199);
    expect(o.costs.yearlyCents).toBe(12 * (1199 + 1999 + 8870 + 1199) + 6000);
    expect(o.costs.byFamily.transport.monthlyCents).toBe(8870);
    expect(o.duplicates).toHaveLength(1);
    expect(o.upcoming.map((s: any) => s.name)).not.toContain("Adobe"); // renouvellement dans 200 j
    expect(o.upcoming.length).toBe(4);
  });

  it("« payer » crée une vraie dépense, avance le renouvellement, refuse le double clic", async () => {
    const db = freshDb();
    const u = await signup(db);
    const due = today();
    const s = (await u.call("POST", "/subscriptions", { name: "ChatGPT", family: "pro", amountCents: 2400, frequency: "monthly", startDate: due, renewalDate: due, paymentMethodId: u.lcl })).data;
    const paid = await u.call("POST", `/subscriptions/${s.id}/pay`, { dueDate: due });
    expect(paid.status).toBe(200);
    expect(paid.data.renewalDate > due).toBe(true);
    expect(paid.data.lastPaidOn).toBe(due);
    const summary = (await u.call("GET", `/months/${month()}`)).data;
    expect(summary.totals.expenseCents).toBe(2400);
    expect(summary.categories.find((c: any) => c.categoryId === "abonnements").amountCents).toBe(2400);
    expect((await u.call("POST", `/subscriptions/${s.id}/pay`, { dueDate: due })).status).toBe(409);
    expect((await u.call("GET", `/months/${month()}`)).data.totals.expenseCents).toBe(2400); // pas de second paiement
  });

  it("résiliation : statut, date et informations conservées ; exclu des coûts", async () => {
    const db = freshDb();
    const u = await signup(db);
    const s = (await u.call("POST", "/subscriptions", { name: "Netflix", family: "personal", amountCents: 1399, frequency: "monthly", cancelUrl: "https://example.com/cancel", cancelNoticeDays: 7 })).data;
    const r = await u.call("PATCH", `/subscriptions/${s.id}`, { status: "cancelled", cancelNotes: "Résilié par e-mail" });
    expect(r.data).toMatchObject({ status: "cancelled", cancelNotes: "Résilié par e-mail", cancelUrl: "https://example.com/cancel" });
    expect(r.data.cancelledOn).toBe(today());
    expect((await u.call("GET", "/subscriptions")).data.costs.monthlyCents).toBe(0);
    expect((await u.call("POST", "/subscriptions", { name: "X", family: "pro", amountCents: 100, frequency: "monthly", cancelUrl: "javascript:alert(1)" })).status).toBe(400);
  });

  it("isolation entre utilisateurs", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const s = (await a.call("POST", "/subscriptions", { name: "Canva", family: "pro", amountCents: 1000, frequency: "monthly", renewalDate: today() })).data;
    expect((await b.call("PATCH", `/subscriptions/${s.id}`, { amountCents: 1 })).status).toBe(404);
    expect((await b.call("POST", `/subscriptions/${s.id}/pay`, {})).status).toBe(404);
    expect((await b.call("DELETE", `/subscriptions/${s.id}`)).status).toBe(404);
    expect((await b.call("GET", "/subscriptions")).data.items).toEqual([]);
  });
});

describe("budgets, charges fixes, épargne", () => {
  it("budget par catégorie : états ok / alerte / dépassé", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 10000 });
    await u.call("POST", "/expenses", exp(8500));
    let b = (await u.call("GET", `/budgets?month=${month()}`)).data;
    expect(b.rows.find((r: any) => r.categoryId === "alimentation").status.state).toBe("warning");
    await u.call("POST", "/expenses", exp(2000));
    b = (await u.call("GET", `/budgets?month=${month()}`)).data;
    const r = b.rows.find((x: any) => x.categoryId === "alimentation");
    expect(r.status).toMatchObject({ state: "over", remainingCents: -500 });
    expect((await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 0 })).status).toBe(400);
  });

  it("copie des budgets sans écraser l'existant", async () => {
    const db = freshDb();
    const u = await signup(db);
    const next = addMonths(month(), 1);
    await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 30000 });
    await u.call("PUT", "/budgets", { month: month(), categoryId: "transport", limitCents: 9000 });
    await u.call("PUT", "/budgets", { month: next, categoryId: "transport", limitCents: 5000 });
    const r = await u.call("POST", "/budgets/copy", { fromMonth: month(), toMonth: next });
    expect(r.data.copied).toBe(1);
    const b = (await u.call("GET", `/budgets?month=${next}`)).data.rows;
    expect(b.find((x: any) => x.categoryId === "transport").limitCents).toBe(5000);
    expect(b.find((x: any) => x.categoryId === "alimentation").limitCents).toBe(30000);
  });

  it("charge fixe : échéance dans les obligations, « payée » = dépense réelle + échéance suivante", async () => {
    const db = freshDb();
    const u = await signup(db);
    const due = addDaysISO(today(), 1);
    const r = (await u.call("POST", "/recurring", { label: "Loyer", amountCents: 65000, frequency: "monthly", nextDueDate: due, categoryId: "logement", subcategoryId: "loyer" })).data;
    const ov = (await u.call("GET", "/overview")).data;
    const endOfMonth = due.slice(0, 7) === month();
    expect(ov.position.obligationsDueCents).toBe(endOfMonth ? 65000 : 0);
    const paid = await u.call("POST", `/recurring/${r.id}/pay`, { dueDate: due, paidOn: today() });
    expect(paid.data.nextDueDate > due).toBe(true);
    expect((await u.call("POST", `/recurring/${r.id}/pay`, { dueDate: due })).status).toBe(409);
    expect((await u.call("GET", `/months/${month()}`)).data.totals.expenseCents).toBe(65000);
  });

  it("objectifs d'épargne : progression, versement mensuel requis, retrait limité, réserves", async () => {
    const db = freshDb();
    const u = await signup(db);
    const g = (await u.call("POST", "/goals", { name: "Voyage Maroc", targetCents: 120000, deadline: addDaysISO(today(), 183) })).data;
    expect(g.requiredMonthlyCents).toBe(Math.ceil(120000 / 7)); // 183 j → 7 mois
    const r = await u.call("POST", "/goals", { name: "Fonds d'urgence", targetCents: 300000, isReserve: true });
    await u.call("POST", `/goals/${g.id}/contributions`, { amountCents: 30000, contributedOn: today() });
    await u.call("POST", `/goals/${r.data.id}/contributions`, { amountCents: 50000, contributedOn: today() });
    const list = (await u.call("GET", "/goals")).data;
    expect(list.goals.find((x: any) => x.id === g.id)).toMatchObject({ savedCents: 30000, progress: 0.25 });
    expect(list.reservesCents).toBe(50000);
    expect((await u.call("POST", `/goals/${g.id}/contributions`, { amountCents: -40000, contributedOn: today() })).status).toBe(400);
    expect((await u.call("POST", `/goals/${g.id}/contributions`, { amountCents: 0, contributedOn: today() })).status).toBe(400);
  });

  it("isolation des objectifs, budgets et charges", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const g = (await a.call("POST", "/goals", { name: "X", targetCents: 1000 })).data;
    expect((await b.call("POST", `/goals/${g.id}/contributions`, { amountCents: 100, contributedOn: today() })).status).toBe(404);
    expect((await b.call("PATCH", `/goals/${g.id}`, { name: "Piraté" })).status).toBe(404);
    const r = (await a.call("POST", "/recurring", { label: "Loyer", amountCents: 100, frequency: "monthly", nextDueDate: today(), categoryId: "logement" })).data;
    expect((await b.call("POST", `/recurring/${r.id}/pay`, {})).status).toBe(404);
    expect((await b.call("PATCH", `/recurring/${r.id}`, { amountCents: 1 })).status).toBe(404);
  });
});

describe("vue d'ensemble : position, revenus attendus, prévision", () => {
  it("revenus attendus exclus du disponible ; formule du montant journalier", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PATCH", "/settings", { safetyReserveCents: 10000, monthlySavingsTargetCents: 20000 });
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", amountCents: 200000, status: "confirmed" });
    await u.call("POST", "/incomes", { month: month(), label: "Prime", kind: "bonus", amountCents: 50000, status: "expected" });
    await u.call("POST", "/expenses", exp(30000));
    const p = (await u.call("GET", "/overview")).data.position;
    expect(p.receivedIncomeCents).toBe(200000);
    expect(p.expectedIncomeCents).toBe(50000);
    expect(p.cashCents).toBe(170000);
    expect(p.plannedSavingsRemainingCents).toBe(20000);
    expect(p.discretionaryCents).toBe(170000 - 20000 - 10000);
    expect(p.dailyAllowanceCents).toBe(Math.floor(140000 / p.remainingDays));
    expect(p.projectedEndCashWithExpectedCents - p.projectedEndCashCents).toBe(50000);
  });

  it("l'épargne déjà faite sort du disponible et couvre l'objectif", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PATCH", "/settings", { monthlySavingsTargetCents: 20000 });
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", amountCents: 100000, status: "confirmed" });
    await u.call("PUT", `/months/${month()}/savings`, { amountCents: 25000 });
    const p = (await u.call("GET", "/overview")).data.position;
    expect(p.availableFundsCents).toBe(75000);
    expect(p.plannedSavingsRemainingCents).toBe(0);
  });

  it("solde du compte : absent sans solde de départ, calculé avec", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", amountCents: 100000, status: "confirmed" });
    await u.call("POST", "/expenses", exp(20000));
    expect((await u.call("GET", "/overview")).data.accountBalanceCents).toBeNull();
    expect((await u.call("PATCH", "/settings", { openingBalanceCents: 50000 })).status).toBe(400); // mois requis
    await u.call("PATCH", "/settings", { openingBalanceCents: 50000, openingBalanceMonth: month() });
    expect((await u.call("GET", "/overview")).data.accountBalanceCents).toBe(50000 + 100000 - 20000);
  });

  it("paramètres : fuseau horaire validé", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("PATCH", "/settings", { timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await u.call("PATCH", "/settings", { timezone: "Africa/Casablanca" })).data.settings.timezone).toBe("Africa/Casablanca");
  });

  it("prévision : uniquement des éléments saisis, aucun revenu inventé", async () => {
    const db = freshDb();
    const u = await signup(db);
    const empty = (await u.call("GET", "/forecast?count=3")).data;
    expect(empty.months).toHaveLength(3);
    expect(empty.months.every((m: any) => m.expectedIncomeCents === 0 && m.obligationsCents === 0)).toBe(true);
    await u.call("POST", "/subscriptions", { name: "Canva", family: "pro", amountCents: 1000, frequency: "monthly", renewalDate: addDaysISO(today(), 3) });
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", kind: "salary", frequency: "monthly", amountCents: 150000, status: "confirmed" });
    const f = (await u.call("GET", "/forecast?count=2")).data;
    expect(f.months[0].obligationsCents).toBe(1000);
    expect(f.months[0].expectedIncomeCents).toBe(150000);
    expect(f.basis).toMatchObject({ incomeSources: 1, obligationSources: 1 });
  });
});

describe("tâches", () => {
  it("saisie rapide en français : date, heure, priorité, durée", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = (await u.call("POST", "/tasks/quick", { text: "Appeler le médecin demain 14h30 !! ~20min" })).data;
    expect(t).toMatchObject({ title: "Appeler le médecin", priority: "urgent", dueDate: addDaysISO(today(), 1), dueTime: "14:30", estimatedMinutes: 20, status: "todo" });
    const plain = (await u.call("POST", "/tasks/quick", { text: "Acheter du pain", defaultDate: today() })).data;
    expect(plain).toMatchObject({ title: "Acheter du pain", dueDate: today(), priority: "normal" });
    expect((await u.call("POST", "/tasks/quick", { text: "   " })).status).toBe(400);
  });

  it("terminer une tâche récurrente crée l'occurrence suivante ; rouvrir efface la date de fin", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = (await u.call("POST", "/tasks", { title: "Payer le loyer", dueDate: today(), recurrence: "monthly", priority: "important" })).data;
    const done = await u.call("PATCH", `/tasks/${t.id}`, { status: "done" });
    expect(done.data.completedAt).toBeTruthy();
    const list = (await u.call("GET", "/tasks")).data.tasks;
    const open = list.filter((x: any) => x.status === "todo");
    expect(open).toHaveLength(1);
    expect(open[0].dueDate > today()).toBe(true);
    expect(open[0].seriesId).toBe(t.id);
    const re = await u.call("PATCH", `/tasks/${t.id}`, { status: "todo" });
    expect(re.data.completedAt).toBeNull();
  });

  it("validation : heure sans date, récurrence sans date, catégorie d'un autre utilisateur", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    expect((await a.call("POST", "/tasks", { title: "X", dueTime: "10:00" })).status).toBe(400);
    expect((await a.call("POST", "/tasks", { title: "X", recurrence: "daily" })).status).toBe(400);
    const cat = (await a.call("POST", "/task-categories", { name: "Admin", color: "#112233" })).data;
    expect((await b.call("POST", "/tasks", { title: "Y", categoryId: cat.id })).status).toBe(400);
    expect((await a.call("POST", "/tasks", { title: "Y", categoryId: cat.id })).status).toBe(201);
  });

  it("isolation : lecture, modification, suppression", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const t = (await a.call("POST", "/tasks", { title: "Secret" })).data;
    expect((await b.call("GET", "/tasks")).data.tasks).toEqual([]);
    expect((await b.call("PATCH", `/tasks/${t.id}`, { title: "Piraté" })).status).toBe(404);
    expect((await b.call("DELETE", `/tasks/${t.id}`)).status).toBe(404);
  });

  it("charge par jour : journée surchargée détectée", async () => {
    const db = freshDb();
    const u = await signup(db);
    for (let i = 0; i < 3; i++) await u.call("POST", "/tasks", { title: `Gros chantier ${i}`, dueDate: addDaysISO(today(), 2), estimatedMinutes: 180 });
    const loads = (await u.call("GET", "/tasks")).data.loads;
    expect(loads.find((l: any) => l.date === addDaysISO(today(), 2))).toMatchObject({ count: 3, minutes: 540, overloaded: true });
  });
});

describe("analytics : agrégation correcte et exploration", () => {
  it("répartition, exploration et transactions : mêmes totaux, aucun double comptage", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = today();
    await u.call("POST", "/expenses", exp(1490, { date: t }, { subcategoryId: "fast_food", merchantId: "m_otacos", platformId: "ubereats" }));
    await u.call("POST", "/expenses", exp(1190, { date: t }, { subcategoryId: "fast_food", merchantId: "m_chamas", platformId: "deliveroo" }));
    await u.call("POST", "/expenses", exp(890, { date: t }, { subcategoryId: "fast_food", merchantId: "m_otacos" }));
    await u.call("POST", "/expenses", exp(5000, { date: t }, { subcategoryId: "supermarche", merchantId: "m_auchan" }));
    await u.call("POST", "/expenses", { ...exp(0), amounts: [{ categoryId: "transport", amountCents: 200 }, { categoryId: "sante", amountCents: 300 }] });
    const q = `granularity=month&from=${month()}-01&to=${t}`;
    const cat = (await u.call("GET", `/analytics/breakdown?${q}&by=category`)).data;
    expect(cat.totalCents).toBe(1490 + 1190 + 890 + 5000 + 500);
    expect(cat.rows.reduce((s: number, r: any) => s + r.amountCents, 0)).toBe(cat.totalCents);
    expect(cat.rows[0]).toMatchObject({ key: "alimentation", amountCents: 8570 });

    const subs = (await u.call("GET", `/analytics/breakdown?${q}&by=subcategory&category=alimentation`)).data;
    expect(subs.rows.map((r: any) => [r.key, r.amountCents])).toEqual([["supermarche", 5000], ["fast_food", 3570]]);

    const platforms = (await u.call("GET", `/analytics/breakdown?${q}&by=platform&category=alimentation&sub=fast_food`)).data;
    expect(Object.fromEntries(platforms.rows.map((r: any) => [r.key, r.amountCents]))).toEqual({ ubereats: 1490, deliveroo: 1190, none: 890 });

    const merchants = (await u.call("GET", `/analytics/breakdown?${q}&by=merchant&category=alimentation&sub=fast_food`)).data;
    expect(merchants.rows.find((r: any) => r.key === "m_otacos").amountCents).toBe(2380);

    const uber = (await u.call("GET", `/analytics/transactions?${q}&category=alimentation&sub=fast_food&platform=ubereats`)).data;
    expect(uber).toMatchObject({ totalCents: 1490, count: 1 });
    expect(uber.lines[0].merchantLabel).toBe("O'Tacos");

    const city = (await u.call("GET", `/analytics/breakdown?${q}&by=city`)).data;
    expect(city.rows[0]).toMatchObject({ key: "Paris", amountCents: 9070 });
    expect((await u.call("GET", `/analytics/breakdown?${q}&by=colour`)).status).toBe(400);
  });

  it("séries jour/semaine/mois/année : périodes vides incluses, revenus = argent reçu", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = today();
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", amountCents: 100000, status: "confirmed", receivedOn: t });
    await u.call("POST", "/incomes", { month: month(), label: "Prime", kind: "bonus", amountCents: 70000, status: "expected" });
    await u.call("POST", "/expenses", exp(2500, { date: t }));
    const sum = (series: any[], k: string) => series.reduce((s, p) => s + p[k], 0);
    const day = (await u.call("GET", `/analytics/overview?granularity=day&from=${addDaysISO(t, -6)}&to=${t}`)).data;
    expect(day.series).toHaveLength(7);
    expect(sum(day.series, "incomeCents")).toBe(100000); // la prime attendue n'est pas comptée
    expect(sum(day.series, "expenseCents")).toBe(2500);
    expect(day.series[0].savingsCents).toBeNull(); // épargne mensuelle : inconnue à la journée
    for (const g of ["week", "month", "year"]) {
      const r = (await u.call("GET", `/analytics/overview?granularity=${g}`)).data;
      expect(sum(r.series, "expenseCents"), g).toBe(2500);
      expect(sum(r.series, "incomeCents"), g).toBe(100000);
    }
    const monthly = (await u.call("GET", "/analytics/overview?granularity=month")).data;
    expect(monthly.series).toHaveLength(12);
    expect(monthly.comparison.current.netCents).toBe(97500 - 0);
  });

  it("comparaison avec la période précédente et validation des bornes", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = today();
    await u.call("POST", "/expenses", exp(1000, { date: t }));
    await u.call("POST", "/expenses", exp(500, { date: addDaysISO(t, -10) }));
    const r = (await u.call("GET", `/analytics/overview?granularity=day&from=${addDaysISO(t, -4)}&to=${t}`)).data;
    expect(r.comparison.current.expenseCents).toBe(1000);
    expect(r.comparison.previous.expenseCents).toBe(0);
    expect(r.comparison.expenseChangePct).toBeNull();
    expect((await u.call("GET", `/analytics/overview?from=${t}&to=${addDaysISO(t, -1)}`)).status).toBe(400);
    expect((await u.call("GET", "/analytics/overview?granularity=decade")).status).toBe(400);
  });

  it("dépense inhabituelle détectée à partir de l'historique de la catégorie", async () => {
    const db = freshDb();
    const u = await signup(db);
    const t = today();
    for (let i = 0; i < 8; i++) await u.call("POST", "/expenses", exp(2500 + i * 100, { date: addDaysISO(t, -60 - i * 5) }));
    await u.call("POST", "/expenses", exp(25000, { date: addDaysISO(t, -2) }));
    const r = (await u.call("GET", "/analytics/overview?granularity=month")).data;
    const lineHits = r.unusual.filter((x: any) => x.kind === "line");
    expect(lineHits).toHaveLength(1);
    expect(lineHits[0].line.amountCents).toBe(25000);
  });

  it("isolation : les analyses ne mélangent jamais deux utilisateurs", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    await a.call("POST", "/expenses", exp(9999));
    const q = `granularity=month&from=${month()}-01&to=${today()}`;
    expect((await b.call("GET", `/analytics/breakdown?${q}&by=category`)).data.totalCents).toBe(0);
    expect((await b.call("GET", `/analytics/transactions?${q}`)).data.count).toBe(0);
  });
});

describe("alertes et notifications", () => {
  it("dédoublonnées, fermables, et jamais réactivées", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 10000 });
    await u.call("POST", "/expenses", exp(12000));
    await u.call("POST", "/overview".replace("/overview", "/notifications/refresh"));
    await u.call("GET", "/overview");
    await u.call("GET", "/overview");
    const list = (await u.call("GET", "/notifications")).data;
    const budget = list.filter((n: any) => n.kind === "budget_threshold");
    expect(budget).toHaveLength(1);
    expect(budget[0].level).toBe("critical");
    await u.call("POST", `/notifications/${budget[0].id}`, { action: "dismiss" });
    await u.call("GET", "/overview");
    expect((await u.call("GET", "/notifications")).data.filter((n: any) => n.kind === "budget_threshold")).toHaveLength(0);
  });

  it("préférences : un type d'alerte désactivé n'est plus généré", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PATCH", "/settings", { alertPrefs: { disabledKinds: ["budget_threshold"], minLevel: "info", budgetWarnAt: 0.8 } });
    await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 10000 });
    await u.call("POST", "/expenses", exp(12000));
    await u.call("GET", "/overview");
    expect((await u.call("GET", "/notifications")).data.filter((n: any) => n.kind === "budget_threshold")).toHaveLength(0);
  });

  it("une notification d'un autre utilisateur est introuvable", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    await a.call("POST", "/tasks", { title: "Urgent", priority: "urgent", dueDate: addDaysISO(today(), -1) });
    await a.call("GET", "/overview");
    const n = (await a.call("GET", "/notifications")).data[0];
    expect(n).toBeTruthy();
    expect((await b.call("POST", `/notifications/${n.id}`, { action: "dismiss" })).status).toBe(404);
  });
});

describe("assistant IA", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("non configuré : aucune réponse simulée, 503 explicite, rien n'est enregistré", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("GET", "/ai/status")).data).toEqual({ configured: false, provider: null, model: null });
    const r = await u.call("POST", "/ai/chat", { message: "Où part mon argent ?" });
    expect(r.status).toBe(503);
    expect(r.data.error).toMatch(/AI_API_KEY/);
    expect((await u.call("GET", "/ai/messages")).data).toEqual([]);
  });

  it("les recommandations déterministes fonctionnent sans fournisseur IA", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/incomes", { month: month(), label: "Salaire", amountCents: 200000, status: "confirmed" });
    await u.call("POST", "/tasks", { title: "Déclaration", priority: "urgent", dueDate: addDaysISO(today(), -2) });
    const r = (await u.call("GET", "/ai/recommendations")).data;
    expect(r.recommendations.some((x: any) => x.domain === "productivity" && /en retard/.test(x.title))).toBe(true);
    expect(r.recommendations.some((x: any) => x.domain === "finance")).toBe(true);
  });

  it("configuré : clé côté serveur uniquement, contexte sans données personnelles, propositions validées", async () => {
    const db = freshDb();
    const env = { AI_PROVIDER: "anthropic", AI_API_KEY: "sk-test-SECRET", AI_MODEL: "modele-test" };
    const a = await signup(db, "Alice", env);
    await a.call("POST", "/incomes", { month: month(), label: "Salaire confidentiel", amountCents: 200000, status: "confirmed" });
    await a.call("POST", "/expenses", exp(4200, {}, { merchantId: "m_auchan" }));
    const status = await a.call("GET", "/ai/status");
    expect(status.text).not.toContain("SECRET");

    const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        content: [{ type: "text", text: 'Voici un plan.\n```proposals\n[{"title":"Faire les courses","dueDate":"2030-01-02","priority":"important","reason":"Frigo vide"},{"title":"","priority":"zzz"}]\n```' }],
      }), { status: 200 });
    });
    const r = await a.call("POST", "/ai/chat", { message: "Aide-moi à planifier ma semaine" });
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("sk-test-SECRET");
    const sent = JSON.stringify(seen[0].body);
    expect(sent).not.toContain(a.email); // pas d'e-mail
    expect(sent).not.toContain("Salaire confidentiel"); // pas de libellé de revenu
    expect(sent).not.toContain("Auchan"); // détail par établissement désactivé par défaut
    expect(sent).toContain("revenus_recus");
    expect(r.text).not.toContain("SECRET");
    // La proposition invalide fait ignorer tout le bloc (validation stricte) : aucune tâche inventée.
    expect(r.data[1].proposals).toEqual([]);
    expect(r.data[1].content).toBe("Voici un plan.");
    expect((await a.call("GET", "/ai/messages")).data).toHaveLength(2);
    // Aucune tâche n'a été créée automatiquement.
    expect((await a.call("GET", "/tasks")).data.tasks).toEqual([]);
  });

  it("propositions valides renvoyées telles quelles (à l'utilisateur de les appliquer)", async () => {
    const db = freshDb();
    const u = await signup(db, "Alice", { AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "m" });
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.headers.authorization).toBe("Bearer k");
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK\n```proposals\n[{"title":"Payer la CAF","dueDate":"2030-01-02","dueTime":"09:00","priority":"urgent","estimatedMinutes":15,"reason":"Échéance proche"}]\n```' } }] }), { status: 200 });
    });
    const r = await u.call("POST", "/ai/chat", { message: "Organise-moi" });
    expect(r.data[1].proposals).toEqual([{ type: "task", title: "Payer la CAF", dueDate: "2030-01-02", dueTime: "09:00", priority: "urgent", estimatedMinutes: 15, reason: "Échéance proche" }]);
  });

  it("le détail par établissement n'est envoyé que si l'utilisateur l'autorise", async () => {
    const db = freshDb();
    const u = await signup(db, "Alice", { AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "m" });
    await u.call("POST", "/expenses", exp(4200, {}, { merchantId: "m_auchan" }));
    await u.call("PATCH", "/settings", { aiShareDetail: true });
    let sent = "";
    vi.stubGlobal("fetch", async (_url: string, init: any) => {
      sent = init.body;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });
    await u.call("POST", "/ai/chat", { message: "Analyse" });
    expect(sent).toContain("Auchan");
  });

  it("erreur du fournisseur : message générique, pas de fuite, rien d'enregistré", async () => {
    const db = freshDb();
    const u = await signup(db, "Alice", { AI_PROVIDER: "openai", AI_API_KEY: "sk-very-secret", AI_MODEL: "m" });
    vi.stubGlobal("fetch", async () => new Response("invalid key sk-very-secret", { status: 401 }));
    const r = await u.call("POST", "/ai/chat", { message: "Bonjour" });
    expect(r.status).toBe(502);
    expect(r.text).not.toContain("sk-very-secret");
    expect((await u.call("GET", "/ai/messages")).data).toEqual([]);
  });

  it("configuration incomplète ou URL non sécurisée = non configuré", async () => {
    const db = freshDb();
    const bad = await signup(db, "Alice", { AI_PROVIDER: "openai-compatible", AI_API_KEY: "k", AI_MODEL: "m", AI_BASE_URL: "http://evil.example/v1" });
    expect((await bad.call("GET", "/ai/status")).data.configured).toBe(false);
    const noModel = await signup(db, "Bob", { AI_PROVIDER: "anthropic", AI_API_KEY: "k" });
    expect((await noModel.call("GET", "/ai/status")).data.configured).toBe(false);
  });

  it("l'historique de conversation est privé et supprimable", async () => {
    const db = freshDb();
    const env = { AI_PROVIDER: "openai", AI_API_KEY: "k", AI_MODEL: "m" };
    const a = await signup(db, "Alice", env);
    const b = await signup(db, "Bob", env);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    await a.call("POST", "/ai/chat", { message: "Secret d'Alice" });
    expect((await b.call("GET", "/ai/messages")).data).toEqual([]);
    expect((await a.call("DELETE", "/ai/messages")).status).toBe(204);
    expect((await a.call("GET", "/ai/messages")).data).toEqual([]);
  });
});

describe("régressions corrigées pendant la recette visuelle", () => {
  it("un abonnement proche ne génère qu'une alerte (pas aussi une alerte d'échéance)", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/subscriptions", { name: "Canva", family: "pro", amountCents: 1199, frequency: "monthly", renewalDate: addDaysISO(today(), 2) });
    await u.call("GET", "/overview");
    const kinds = (await u.call("GET", "/notifications")).data.map((n: any) => n.kind);
    expect(kinds).toContain("subscription_renewal");
    expect(kinds).not.toContain("obligation_due");
  });

  it("les liens des alertes pointent vers des routes existantes de l'interface", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("PUT", "/budgets", { month: month(), categoryId: "alimentation", limitCents: 1000 });
    await u.call("POST", "/expenses", exp(5000));
    await u.call("POST", "/tasks", { title: "X", priority: "urgent", dueDate: addDaysISO(today(), -1) });
    await u.call("GET", "/overview");
    const links = (await u.call("GET", "/notifications")).data.map((n: any) => n.link).filter(Boolean);
    const valid = ["/", "/finances?tab=budgets", "/finances?tab=abonnements", "/analyses", "/taches"];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(valid, l).toContain(l);
  });

  it("un revenu « alternance » créé à la main bloque l'ajout des revenus habituels en double", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/incomes", { month: month(), label: "Alternance", kind: "alternance", status: "confirmed", amountCents: 100000 });
    const r = await u.call("POST", `/months/${month()}/apply-defaults`, { status: "expected" });
    expect(r.data.incomes.filter((i: any) => i.kind === "alternance")).toHaveLength(1);
  });
});
