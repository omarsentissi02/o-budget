import { describe, expect, it } from "vitest";
import { addMonths, freshDb, makeClient, signup } from "./helpers/api";
import { todayInZone } from "../shared/month";

const today = () => todayInZone("Europe/Paris");
const thisMonth = () => today().slice(0, 7);
const dayOf = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

const expense = (over: Record<string, unknown> = {}) => ({
  date: today(),
  location: { type: "france", city: "Paris" },
  amounts: [{ categoryId: "alimentation", amountCents: 4590 }],
  paymentMethodId: null,
  ...over,
});

describe("authentification et sécurité", () => {
  it("refuse les routes protégées sans session (401)", async () => {
    const db = freshDb();
    const anon = makeClient(db);
    for (const path of ["/months/2026-10", "/overview", "/tasks", "/subscriptions", "/analytics/overview", "/taxonomy", "/ai/status"]) {
      expect((await anon("GET", path)).status, path).toBe(401);
    }
  });

  it("inscription, connexion insensible à la casse, mot de passe jamais renvoyé", async () => {
    const db = freshDb();
    const u = await signup(db, "Omar");
    const me = await u.call("GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.text).not.toMatch(/password|hash|salt/i);
    const other = makeClient(db);
    expect((await other("POST", "/auth/login", { email: u.email.toUpperCase(), password: "motdepasse-solide" })).status).toBe(200);
    expect((await other("POST", "/auth/login", { email: u.email, password: "faux" })).status).toBe(401);
  });

  it("CSRF : refuse une origine étrangère, « null », et l'absence totale d'indice d'origine", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("POST", "/tasks/quick", { text: "x" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await u.call("POST", "/tasks/quick", { text: "x" }, { Origin: "null" })).status).toBe(403);
    // Pas d'Origin ni de Sec-Fetch-Site : refusé (V1 laissait passer).
    const bare = await (await import("../worker/index")).default.fetch(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
      { DB: (await import("./helpers/d1")).asD1(db) },
    );
    expect(bare.status).toBe(403);
    // Sec-Fetch-Site: same-origin suffit pour un navigateur qui n'envoie pas Origin.
    const ok = await (await import("../worker/index")).default.fetch(
      new Request("http://localhost/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }),
      { DB: (await import("./helpers/d1")).asD1(db) },
    );
    expect(ok.status).toBe(204);
  });

  it("limite les essais de connexion (429)", async () => {
    const db = freshDb();
    const u = await signup(db);
    const c = makeClient(db);
    for (let i = 0; i < 10; i++) expect((await c("POST", "/auth/login", { email: u.email, password: "x" })).status).toBe(401);
    expect((await c("POST", "/auth/login", { email: u.email, password: "motdepasse-solide" })).status).toBe(429);
  });

  it("les réponses de l'API ne sont jamais mises en cache", async () => {
    const db = freshDb();
    const u = await signup(db);
    const r = await u.call("GET", "/overview");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("régression V1 : revenus, dépenses, totaux", () => {
  it("scénario octobre : revenus V1 confirmés, dépense multi-catégories, reste et taux d'épargne", async () => {
    const db = freshDb();
    const u = await signup(db);
    const oct = "2026-10";
    expect((await u.call("GET", `/months/${oct}`)).data.totals.incomeCents).toBe(0);

    // Comportement V1 : les montants par défaut copiés comme revenus confirmés.
    const d = await u.call("POST", `/months/${oct}/apply-defaults`, { status: "confirmed" });
    expect(d.data.totals.incomeCents).toBe(170200);
    expect(d.data.incomes.map((i: any) => i.source)).toEqual(["alternance", "freelance"]);
    // Idempotent
    expect((await u.call("POST", `/months/${oct}/apply-defaults`, { status: "confirmed" })).data.incomes).toHaveLength(2);

    const adj = await u.call("POST", "/incomes", { month: oct, source: "other", label: "Ajustement", amountCents: 15000, receivedOn: "2026-10-12" });
    expect(adj.status).toBe(201);
    expect(adj.data.totals.incomeCents).toBe(185200);

    const e = await u.call("POST", "/expenses", expense({
      date: "2026-10-03",
      amounts: [{ categoryId: "alimentation", amountCents: 4590 }, { categoryId: "transport", amountCents: 1200 }],
      paymentMethodId: u.lcl,
      description: "Courses + métro",
    }));
    expect(e.status).toBe(201);
    expect(e.data.totalCents).toBe(5790);

    await u.call("PUT", `/months/${oct}/savings`, { amountCents: 30000 });
    const s = (await u.call("GET", `/months/${oct}`)).data;
    expect(s.totals.expenseCents).toBe(5790);
    expect(s.totals.remainingCents).toBe(185200 - 5790); // l'épargne n'est pas soustraite deux fois
    expect(s.totals.savingsRate).toBeCloseTo((30000 / 185200) * 100, 4);
  });

  it("anti double-envoi, modification, suppression", async () => {
    const db = freshDb();
    const u = await signup(db);
    const id = crypto.randomUUID();
    const a = await u.call("POST", "/expenses", expense({ clientRequestId: id }));
    const b = await u.call("POST", "/expenses", expense({ clientRequestId: id }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.data.id).toBe(a.data.id);
    const put = await u.call("PUT", `/expenses/${a.data.id}`, expense({ amounts: [{ categoryId: "sante", amountCents: 999 }] }));
    expect(put.data.totalCents).toBe(999);
    expect((await u.call("DELETE", `/expenses/${a.data.id}`)).status).toBe(204);
    expect((await u.call("GET", `/expenses/${a.data.id}`)).status).toBe(404);
  });

  it("validation : montant nul, catégorie inconnue, date invalide", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("POST", "/expenses", expense({ amounts: [{ categoryId: "alimentation", amountCents: 0 }] }))).status).toBe(400);
    expect((await u.call("POST", "/expenses", expense({ amounts: [{ categoryId: "nope", amountCents: 100 }] }))).status).toBe(400);
    expect((await u.call("POST", "/expenses", expense({ date: "2026-13-40" }))).status).toBe(400);
  });

  it("isolation : un autre utilisateur ne voit ni ne modifie rien", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const e = await a.call("POST", "/expenses", expense());
    await a.call("POST", "/incomes", { month: thisMonth(), label: "Salaire", amountCents: 100000 });
    expect((await b.call("GET", `/expenses/${e.data.id}`)).status).toBe(404);
    expect((await b.call("PUT", `/expenses/${e.data.id}`, expense())).status).toBe(404);
    expect((await b.call("DELETE", `/expenses/${e.data.id}`)).status).toBe(404);
    expect((await b.call("GET", `/months/${thisMonth()}`)).data.totals.incomeCents).toBe(0);
    expect((await b.call("GET", `/expenses?month=${thisMonth()}`)).data).toEqual([]);
  });

  it("exports CSV : colonnes V1 conservées, aucun envoi de formule", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/expenses", expense({ description: "=HYPERLINK(\"http://x\")", amounts: [{ categoryId: "alimentation", amountCents: 1250 }] }));
    const csv = await u.call("GET", "/export?type=expenses&format=csv");
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toMatch(/^Date,Lieu,Pays,Catégorie,Montant \(EUR\),Moyen de paiement,Description,/);
    expect(csv.text).toContain("12.50");
    expect(csv.text).toContain("'=HYPERLINK"); // neutralisé
    const xl = await u.call("GET", "/export?type=expenses&format=excel");
    expect([...xl.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 pour Excel
    expect(xl.text).toContain("12,50");
    expect((await u.call("GET", "/export?type=hack")).status).toBe(400);
  });

  it("suppression des données par périmètre", async () => {
    const db = freshDb();
    const u = await signup(db);
    await u.call("POST", "/expenses", expense());
    await u.call("POST", "/tasks/quick", { text: "Appeler Paul" });
    expect((await u.call("DELETE", "/data", { confirm: "non" })).status).toBe(400);
    expect((await u.call("DELETE", "/data", { confirm: "SUPPRIMER", scope: "finance" })).status).toBe(204);
    expect((await u.call("GET", `/expenses?month=${thisMonth()}`)).data).toEqual([]);
    expect((await u.call("GET", "/tasks")).data.tasks).toHaveLength(1);
    await u.call("DELETE", "/data", { confirm: "SUPPRIMER", scope: "tasks" });
    expect((await u.call("GET", "/tasks")).data.tasks).toHaveLength(0);
  });
});

describe("dépenses V2 : sous-catégories, marchands, plateformes", () => {
  it("Alimentation → Fast-food → O'Tacos → Uber Eats, plateforme distincte de la catégorie", async () => {
    const db = freshDb();
    const u = await signup(db);
    const r = await u.call("POST", "/expenses", expense({
      channel: "delivery",
      amounts: [{ categoryId: "alimentation", subcategoryId: "fast_food", merchantId: "m_otacos", platformId: "ubereats", amountCents: 1490 }],
    }));
    expect(r.status).toBe(201);
    expect(r.data.amounts[0]).toMatchObject({ subcategoryId: "fast_food", subcategoryLabel: "Fast-food", merchantLabel: "O'Tacos", platformId: "ubereats" });
    const tax = (await u.call("GET", "/taxonomy")).data;
    const ot = tax.merchants.find((m: any) => m.id === "m_otacos");
    expect(ot.useCount).toBe(1); // mémorisé pour accélérer la prochaine saisie
    expect(ot.halalStatus).toBe("unknown"); // jamais déduit du nom
  });

  it("refuse une sous-catégorie qui n'appartient pas à la catégorie, ou un marchand inconnu", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("POST", "/expenses", expense({ amounts: [{ categoryId: "transport", subcategoryId: "fast_food", amountCents: 100 }] }))).status).toBe(400);
    expect((await u.call("POST", "/expenses", expense({ amounts: [{ categoryId: "alimentation", merchantId: "c_inconnu", amountCents: 100 }] }))).status).toBe(400);
    expect((await u.call("POST", "/expenses", expense({ amounts: [{ categoryId: "alimentation", platformId: "mcdelivery", amountCents: 100 }] }))).status).toBe(400);
  });

  it("marchands et sous-catégories personnalisés, strictement privés", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const m = await a.call("POST", "/merchants", { label: "Chez Karim", categoryId: "alimentation", subcategoryId: "fast_food" });
    expect(m.status).toBe(201);
    expect((await a.call("POST", "/merchants", { label: "chez karim" })).status).toBe(409);
    expect((await a.call("POST", "/merchants", { label: "Carrefour" })).status).toBe(409); // déjà dans l'annuaire
    const sub = await a.call("POST", "/subcategories", { categoryId: "sport", label: "Escalade" });
    expect(sub.status).toBe(201);
    const ok = await a.call("POST", "/expenses", expense({ amounts: [{ categoryId: "sport", subcategoryId: sub.data.id, amountCents: 1200 }, { categoryId: "alimentation", merchantId: m.data.id, amountCents: 800 }] }));
    expect(ok.status).toBe(201);
    expect(ok.data.amounts.find((x: any) => x.categoryId === "sport").subcategoryLabel).toBe("Escalade");
    // Bob ne peut utiliser ni le marchand ni la sous-catégorie d'Alice.
    expect((await b.call("POST", "/expenses", expense({ amounts: [{ categoryId: "alimentation", merchantId: m.data.id, amountCents: 100 }] }))).status).toBe(400);
    expect((await b.call("POST", "/expenses", expense({ amounts: [{ categoryId: "sport", subcategoryId: sub.data.id, amountCents: 100 }] }))).status).toBe(400);
    expect((await b.call("GET", "/taxonomy")).data.merchants.some((x: any) => x.id === m.data.id)).toBe(false);
    expect((await b.call("DELETE", `/merchants/${m.data.id}`)).status).toBe(404);
  });

  it("statut halal : « vérifié » exige une source", async () => {
    const db = freshDb();
    const u = await signup(db);
    expect((await u.call("PUT", "/merchants/m_chamas/halal", { halalStatus: "verified" })).status).toBe(400);
    const ok = await u.call("PUT", "/merchants/m_chamas/halal", { halalStatus: "verified", halalSource: "Certificat consulté sur le site officiel" });
    expect(ok.status).toBe(200);
    expect(ok.data.halalStatus).toBe("verified");
    expect(ok.data.halalVerifiedAt).toBeTruthy();
    expect((await u.call("PUT", "/merchants/m_inconnu/halal", { halalStatus: "claimed" })).status).toBe(404);
    // McDonald's / KFC / Burger King ne sont pas suggérés.
    const labels = (await u.call("GET", "/taxonomy")).data.merchants.map((m: any) => m.label.toLowerCase());
    expect(labels.some((l: string) => /mcdonald|kfc|burger king/.test(l))).toBe(false);
    expect(labels).toEqual(expect.arrayContaining(["auchan", "o'tacos", "chamas tacos", "zara", "ikea"]));
  });

  it("billet de train : départ, destination et date de voyage", async () => {
    const db = freshDb();
    const u = await signup(db);
    const r = await u.call("POST", "/expenses", expense({
      amounts: [{ categoryId: "transport", subcategoryId: "ouigo", amountCents: 2900, tripFrom: "Paris", tripTo: "Lyon", tripDate: dayOf(addMonths(thisMonth(), 1), 15) }],
    }));
    expect(r.data.amounts[0]).toMatchObject({ tripFrom: "Paris", tripTo: "Lyon" });
  });
});

describe("revenus V2 : attendu vs confirmé, brut vs net, aides", () => {
  it("un revenu attendu n'est JAMAIS du cash tant qu'il n'est pas confirmé", async () => {
    const db = freshDb();
    const u = await signup(db);
    const m = thisMonth();
    const created = await u.call("POST", "/incomes", { month: m, kind: "salary", label: "Salaire", status: "expected", amountCents: 150000, expectedDate: dayOf(m, 28) });
    expect(created.status).toBe(201);
    expect(created.data.totals.incomeCents).toBe(0);
    expect(created.data.income).toMatchObject({ receivedCents: 0, expectedCents: 150000 });
    const inc = created.data.incomes[0];
    expect(inc.cashState).toBe("expected");

    const confirmed = await u.call("PATCH", `/incomes/${inc.id}`, { status: "confirmed", amountCents: 148750, receivedOn: dayOf(m, 27) });
    expect(confirmed.data.totals.incomeCents).toBe(148750); // montant réellement reçu, pas le prévu
    expect(confirmed.data.income.expectedCents).toBe(0);
  });

  it("brut → net : cotisations, retenues, prélèvement à la source", async () => {
    const db = freshDb();
    const u = await signup(db);
    const r = await u.call("POST", "/incomes", {
      month: thisMonth(), kind: "salary", label: "Salaire", status: "confirmed",
      grossCents: 250000, employeeContributionsCents: 55000, otherDeductionsCents: 5000, withholdingCents: 15000,
    });
    const inc = r.data.incomes[0];
    expect(inc.netCents).toBe(175000);
    expect(inc.amountCents).toBe(175000); // montant déduit du net quand non précisé
    expect(inc.grossCents).toBe(250000);
    expect(r.data.totals.incomeCents).toBe(175000); // le brut n'est jamais du cash
    const bad = await u.call("POST", "/incomes", { month: thisMonth(), kind: "salary", label: "X", grossCents: 1000, employeeContributionsCents: 5000 });
    expect(bad.status).toBe(400);
  });

  it("aide versée directement au propriétaire : suivie mais exclue du cash", async () => {
    const db = freshDb();
    const u = await signup(db);
    const r = await u.call("POST", "/incomes", {
      month: thisMonth(), kind: "apl", label: "APL", status: "confirmed", amountCents: 20000, paidTo: "third_party", thirdPartyName: "Propriétaire", organization: "CAF", benefitType: "Aide au logement",
    });
    expect(r.data.totals.incomeCents).toBe(0);
    expect(r.data.income.indirectCents).toBe(20000);
    expect(r.data.incomes[0].cashState).toBe("indirect");
  });

  it("statuts de prestation : suspendu/annulé exclus, accordé = attendu", async () => {
    const db = freshDb();
    const u = await signup(db);
    const m = thisMonth();
    await u.call("POST", "/incomes", { month: m, kind: "caf", label: "CAF", status: "approved", estimatedCents: 30000 });
    await u.call("POST", "/incomes", { month: m, kind: "prime_activite", label: "Prime d'activité", status: "suspended", amountCents: 12000 });
    const s = (await u.call("GET", `/months/${m}`)).data;
    expect(s.income).toMatchObject({ receivedCents: 0, expectedCents: 30000, excludedCents: 12000 });
  });

  it("règles de cohérence : date de réception sans confirmation, date hors mois", async () => {
    const db = freshDb();
    const u = await signup(db);
    const m = thisMonth();
    expect((await u.call("POST", "/incomes", { month: m, label: "X", amountCents: 100, status: "expected", receivedOn: dayOf(m, 2) })).status).toBe(400);
    expect((await u.call("POST", "/incomes", { month: m, label: "X", amountCents: 100, status: "confirmed", receivedOn: `${addMonths(m, 1)}-02` })).status).toBe(400);
    expect((await u.call("POST", "/incomes", { month: m, label: "Sans montant" })).status).toBe(400);
  });

  it("montants habituels : prévus (non cash) par défaut, jamais appliqués deux fois", async () => {
    const db = freshDb();
    const u = await signup(db);
    const m = thisMonth();
    const d = await u.call("POST", `/months/${m}/apply-defaults`);
    expect(d.data.totals.incomeCents).toBe(0);
    expect(d.data.income.expectedCents).toBe(170200);
    const again = await u.call("POST", `/months/${m}/apply-defaults`);
    expect(again.data.incomes).toHaveLength(2);
    // Un revenu V1 existant n'est pas transformé en « attendu » par un nouvel appel.
    const db2 = freshDb();
    const v = await signup(db2);
    await v.call("POST", "/incomes", { month: m, source: "alternance", label: "Alternance", amountCents: 100000 });
    const r = await v.call("POST", `/months/${m}/apply-defaults`);
    expect(r.data.incomes.find((i: any) => i.source === "alternance").cashState).toBe("received");
  });

  it("un autre utilisateur ne peut pas modifier mon revenu", async () => {
    const db = freshDb();
    const a = await signup(db, "Alice");
    const b = await signup(db, "Bob");
    const r = await a.call("POST", "/incomes", { month: thisMonth(), label: "Salaire", amountCents: 100000 });
    const id = r.data.incomes[0].id;
    expect((await b.call("PATCH", `/incomes/${id}`, { amountCents: 1 })).status).toBe(404);
    expect((await b.call("DELETE", `/incomes/${id}`)).status).toBe(404);
  });
});
