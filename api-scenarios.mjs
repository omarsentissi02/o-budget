// Scénarios de test de l'API O-Budget contre un serveur en cours d'exécution.
// Usage : npm run dev   (dans un terminal)   puis   npm run test:api
// Variable optionnelle : BASE_URL (par défaut http://localhost:5173)
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const stamp = Date.now();
let passed = 0;

function client() {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(BASE + "/api" + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: BASE },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, text };
  };
}

async function step(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "\n   ", e.message); process.exitCode = 1; }
}

const omar = client();
const other = client();
const anon = client();
const OCT = "2026-10";
let lcl, revolut, entryId, octSummary;

console.log(`Tests API sur ${BASE}\n`);

await step("1. Inscription d'un nouvel utilisateur", async () => {
  const r = await omar("POST", "/auth/register", { name: "Omar", email: `omar+${stamp}@example.com`, password: "motdepasse-solide" });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.data.paymentMethods.map((m) => m.name), ["CIH Bank", "LCL", "Revolut"]);
  assert.equal(r.data.settings.defaultAlternanceCents, 120200);
  lcl = r.data.paymentMethods.find((m) => m.name === "LCL").id;
  revolut = r.data.paymentMethods.find((m) => m.name === "Revolut").id;
});

await step("2. Connexion (mauvais puis bon mot de passe)", async () => {
  const bad = await anon("POST", "/auth/login", { email: `omar+${stamp}@example.com`, password: "faux" });
  assert.equal(bad.status, 401);
  const c2 = client();
  const ok = await c2("POST", "/auth/login", { email: `OMAR+${stamp}@example.com`, password: "motdepasse-solide" });
  assert.equal(ok.status, 200, ok.text);
});

await step("3. Octobre 2026 vide : aucun revenu supposé", async () => {
  const r = await omar("GET", `/months/${OCT}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.incomeCents, 0);
  assert.equal(r.data.categories.length, 10);
});

await step("4-6. Revenus d'octobre : Alternance 300, Freelance 500, régularisation 150", async () => {
  for (const [source, label, amountCents] of [["alternance", "Alternance", 30000], ["freelance", "Freelance", 50000], ["other", "Régularisation de salaire", 15000]]) {
    const r = await omar("POST", "/incomes", { month: OCT, source, label, amountCents });
    assert.equal(r.status, 201, r.text);
    octSummary = r.data;
  }
  assert.equal(octSummary.totals.incomeCents, 95000);
  const dup = await omar("POST", "/incomes", { month: OCT, source: "alternance", label: "Alternance", amountCents: 1 });
  assert.equal(dup.status, 409, "une deuxième ligne Alternance doit être refusée");
});

await step("7-8. Dépense multi-catégories à Paris (37 €)", async () => {
  const r = await omar("POST", "/expenses", {
    date: "2026-10-03", location: { type: "france", city: "Paris" }, paymentMethodId: lcl, description: null,
    amounts: [{ categoryId: "alimentation", amountCents: 1200 }, { categoryId: "transport", amountCents: 500 }, { categoryId: "shopping", amountCents: 2000 }],
    clientRequestId: crypto.randomUUID(),
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.totalCents, 3700);
  assert.equal(r.data.paymentLabel, "LCL");
  entryId = r.data.id;
});

await step("9-10. Dépenses à Montpellier et dans une autre ville française", async () => {
  for (const city of ["Montpellier", "Lyon"]) {
    const r = await omar("POST", "/expenses", { date: "2026-10-02", location: { type: "france", city }, paymentMethodId: revolut, amounts: [{ categoryId: "alimentation", amountCents: 1000 }] });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.data.location.city, city);
  }
});

await step("11. Dépense au Maroc sans ville", async () => {
  const r = await omar("POST", "/expenses", { date: "2026-10-01", location: { type: "abroad", countryCode: "MA", countryName: "Maroc" }, paymentMethodId: null, amounts: [{ categoryId: "loisirs", amountCents: 2550 }] });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.location.type, "abroad");
  assert.equal(r.data.paymentLabel, "Autre");
});

await step("Validation : montant négatif, nul, catégorie inconnue, date invalide", async () => {
  const base = { date: "2026-10-03", location: { type: "france", city: "Paris" }, paymentMethodId: lcl };
  for (const bad of [
    { ...base, amounts: [{ categoryId: "alimentation", amountCents: -100 }] },
    { ...base, amounts: [{ categoryId: "alimentation", amountCents: 0 }] },
    { ...base, amounts: [] },
    { ...base, amounts: [{ categoryId: "crypto", amountCents: 100 }] },
    { ...base, date: "2026-02-30", amounts: [{ categoryId: "alimentation", amountCents: 100 }] },
  ]) {
    const r = await omar("POST", "/expenses", bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(typeof r.data.error === "string");
  }
});

await step("Anti double-envoi : même clientRequestId = une seule dépense", async () => {
  const id = crypto.randomUUID();
  const body = { date: "2026-10-03", location: { type: "france", city: "Paris" }, paymentMethodId: lcl, amounts: [{ categoryId: "sante", amountCents: 900 }], clientRequestId: id };
  const [a, b] = await Promise.all([omar("POST", "/expenses", body), omar("POST", "/expenses", body)]);
  assert.equal(a.data.id, b.data.id);
  await omar("DELETE", `/expenses/${a.data.id}`);
});

await step("12. Modifier une dépense", async () => {
  const r = await omar("PUT", `/expenses/${entryId}`, {
    date: "2026-10-03", location: { type: "france", city: "Paris" }, paymentMethodId: lcl, description: "Déjeuner + achats",
    amounts: [{ categoryId: "alimentation", amountCents: 1500 }, { categoryId: "transport", amountCents: 200 }, { categoryId: "shopping", amountCents: 1000 }],
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.totalCents, 2700);
  assert.equal(r.data.description, "Déjeuner + achats");
});

await step("13. Supprimer une dépense", async () => {
  const c = await omar("POST", "/expenses", { date: "2026-10-04", location: { type: "france", city: "Paris" }, paymentMethodId: lcl, amounts: [{ categoryId: "autre", amountCents: 100 }] });
  assert.equal((await omar("DELETE", `/expenses/${c.data.id}`)).status, 204);
  assert.equal((await omar("GET", `/expenses/${c.data.id}`)).status, 404);
});

await step("14-16. Totaux, reste et épargne d'octobre", async () => {
  const s = await omar("PUT", `/months/${OCT}/savings`, { amountCents: 10000 });
  assert.equal(s.status, 200, s.text);
  const t = s.data.totals;
  // 27 + 10 + 10 + 25,50 = 72,50 €
  assert.equal(t.expenseCents, 7250);
  assert.equal(t.incomeCents, 95000);
  assert.equal(t.remainingCents, 95000 - 7250, "Reste = Revenus − Dépenses, épargne non soustraite");
  assert.equal(t.savingsCents, 10000);
  assert.ok(Math.abs(t.savingsRate - 10.526) < 0.01);
  const alim = s.data.categories.find((c) => c.categoryId === "alimentation");
  assert.equal(alim.amountCents, 3500);
  const pct = s.data.categories.reduce((a, c) => a + c.percent, 0);
  assert.ok(Math.abs(pct - 100) < 0.001);
  const list = await omar("GET", `/expenses?month=${OCT}`);
  assert.equal(list.data.length, 4);
});

await step("17. Novembre via montants par défaut + comparaison", async () => {
  const r = await omar("POST", `/months/2026-11/apply-defaults`);
  assert.equal(r.data.totals.incomeCents, 170200);
  const again = await omar("POST", `/months/2026-11/apply-defaults`);
  assert.equal(again.data.incomes.length, 2, "appliquer deux fois ne duplique pas");
  const a = await omar("GET", `/analysis?end=2026-11&count=3`);
  assert.deepEqual(a.data.map((m) => m.month), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(a.data[1].incomeCents, 95000);
  assert.equal(a.data[2].remainingCents, 170200);
});

await step("18-19. Changer le défaut ne modifie pas les mois existants", async () => {
  const r = await omar("PATCH", "/settings", { defaultAlternanceCents: 130000 });
  assert.equal(r.data.settings.defaultAlternanceCents, 130000);
  const nov = await omar("GET", `/months/2026-11`);
  assert.equal(nov.data.incomes.find((i) => i.source === "alternance").amountCents, 120200);
  const oct = await omar("GET", `/months/${OCT}`);
  assert.equal(oct.data.totals.incomeCents, 95000);
});

await step("20. Export CSV et Excel", async () => {
  const csv = await omar("GET", "/export?type=expenses&format=csv");
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^Date,Lieu,Pays,Catégorie,Montant \(EUR\),Moyen de paiement,Description/);
  assert.match(csv.text, /2026-10-01,,Maroc,Loisirs,25\.50,Autre,/);
  const xl = await omar("GET", "/export?type=expenses&format=excel");
  assert.ok(xl.text.startsWith("\uFEFFDate;"));
  assert.match(xl.text, /01\/10\/2026;;Maroc;Loisirs;25,50;Autre;/);
  const inc = await omar("GET", "/export?type=incomes&format=csv");
  assert.match(inc.text, /2026-10,Autre revenu,Régularisation de salaire,150\.00/);
  assert.match(inc.text, /2026-10,Épargne,Épargne du mois,100\.00/);
});

await step("24. Isolation : un autre utilisateur ne voit ni ne modifie rien", async () => {
  await other("POST", "/auth/register", { name: "Intrus", email: `intrus+${stamp}@example.com`, password: "motdepasse-solide" });
  assert.equal((await other("GET", `/expenses/${entryId}`)).status, 404);
  assert.equal((await other("PUT", `/expenses/${entryId}`, { date: "2026-10-03", location: { type: "france", city: "X" }, paymentMethodId: null, amounts: [{ categoryId: "autre", amountCents: 1 }] })).status, 404);
  assert.equal((await other("DELETE", `/expenses/${entryId}`)).status, 404);
  assert.equal((await other("GET", `/months/${OCT}`)).data.totals.incomeCents, 0);
  assert.equal((await other("GET", `/expenses?month=${OCT}`)).data.length, 0);
  const incomeId = octSummary.incomes[0].id;
  assert.equal((await other("PATCH", `/incomes/${incomeId}`, { amountCents: 1 })).status, 404);
  assert.equal((await other("POST", "/expenses", { date: "2026-10-03", location: { type: "france", city: "X" }, paymentMethodId: lcl, amounts: [{ categoryId: "autre", amountCents: 1 }] })).status, 400, "moyen de paiement d'un autre utilisateur refusé");
  assert.ok(!(await other("GET", "/export?type=expenses")).text.includes("Maroc"));
  assert.equal((await anon("GET", `/months/${OCT}`)).status, 401);
  assert.equal((await anon("GET", "/auth/me")).status, 401);
});

await step("CSRF : requête d'une autre origine refusée", async () => {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403);
});

await step("Limitation des tentatives de connexion (10 échecs → 429)", async () => {
  const target = `cible+${stamp}@example.com`;
  const c = client();
  await c("POST", "/auth/register", { name: "Cible", email: target, password: "bon-mot-de-passe" });
  const brute = client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await brute("POST", "/auth/login", { email: target, password: "mauvais-" + i })).status, 401);
  }
  const blocked = await brute("POST", "/auth/login", { email: target, password: "bon-mot-de-passe" });
  assert.equal(blocked.status, 429, "même le bon mot de passe est bloqué pendant la fenêtre");
  assert.match(blocked.data.error, /Trop de tentatives/);
});

await step("Suppression des données puis déconnexion", async () => {
  assert.equal((await omar("DELETE", "/data", { confirm: "non" })).status, 400);
  assert.equal((await omar("DELETE", "/data", { confirm: "SUPPRIMER" })).status, 204);
  assert.equal((await omar("GET", `/months/${OCT}`)).data.totals.incomeCents, 0);
  assert.equal((await omar("POST", "/auth/logout")).status, 204);
  assert.equal((await omar("GET", "/auth/me")).status, 401);
});

console.log(`\n${passed} scénarios réussis${process.exitCode ? ", certains ont échoué." : "."}`);
