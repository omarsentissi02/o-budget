import { describe, expect, it } from "vitest";
import { applyMigrations, newDb, FakeD1 } from "./helpers/d1";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Base V1 réaliste : schéma 0001+0002 avec des données financières à préserver. */
function seedV1(db: FakeD1) {
  const q = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).run(...(p as never[]));
  q("INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations) VALUES ('u1','a@x.fr','A','h','s',100000)");
  q("INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations) VALUES ('u2','b@x.fr','B','h','s',100000)");
  q("INSERT INTO user_settings (user_id) VALUES ('u1')");
  q("INSERT INTO user_settings (user_id, default_alternance_cents) VALUES ('u2', 99900)");
  q("INSERT INTO payment_methods (id,user_id,name,position) VALUES ('pm1','u1','LCL',0)");
  q("INSERT INTO financial_periods (id,user_id,month) VALUES ('p1','u1','2026-10')");
  q("INSERT INTO financial_periods (id,user_id,month) VALUES ('p2','u2','2026-10')");
  q("INSERT INTO incomes (id,user_id,period_id,source,label,amount_cents) VALUES ('i1','u1','p1','alternance','Alternance',120200)");
  q("INSERT INTO incomes (id,user_id,period_id,source,label,amount_cents) VALUES ('i2','u1','p1','freelance','Freelance',50000)");
  q("INSERT INTO incomes (id,user_id,period_id,source,label,amount_cents,received_on) VALUES ('i3','u1','p1','other','Ajustement',15000,'2026-10-12')");
  q("INSERT INTO savings (period_id,user_id,amount_cents) VALUES ('p1','u1',30000)");
  q("INSERT INTO expense_entries (id,user_id,period_id,spent_on,location_type,country_code,country_name,city,payment_method_id,payment_label,description) VALUES ('e1','u1','p1','2026-10-03','france','FR','France','Paris','pm1','LCL','Courses')");
  q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents) VALUES ('a1','e1','alimentation',4590)");
  q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents) VALUES ('a2','e1','transport',1200)");
  q("INSERT INTO expense_entries (id,user_id,period_id,spent_on,location_type,country_code,country_name,city,payment_label) VALUES ('e2','u2','p2','2026-10-05','abroad','MA','Maroc',NULL,'Autre')");
  q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents) VALUES ('a3','e2','autre',7777)");
}

const snapshot = (db: FakeD1) => ({
  users: db.query("SELECT id,email,name,password_hash FROM users ORDER BY id"),
  periods: db.query("SELECT id,user_id,month FROM financial_periods ORDER BY id"),
  incomes: db.query("SELECT id,user_id,period_id,source,label,amount_cents,received_on FROM incomes ORDER BY id"),
  savings: db.query("SELECT period_id,user_id,amount_cents FROM savings ORDER BY period_id"),
  entries: db.query("SELECT id,user_id,spent_on,city,country_name,payment_label,description FROM expense_entries ORDER BY id"),
  amounts: db.query("SELECT id,entry_id,category_id,amount_cents FROM expense_amounts ORDER BY id"),
  settings: db.query("SELECT user_id,default_alternance_cents,default_freelance_cents,theme FROM user_settings ORDER BY user_id"),
});

const integrityQueries = () =>
  readFileSync(join(__dirname, "..", "docs", "integrity-checks.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((q) => q.trim())
    .filter(Boolean);

describe("migration V1 → V2", () => {
  it("préserve intégralement les données financières V1", () => {
    const db = newDb("0002_login_throttle.sql");
    seedV1(db);
    const before = snapshot(db);
    applyMigrations(db, { after: "0002_login_throttle.sql" });
    expect(snapshot(db)).toEqual(before);
  });

  it("les nouvelles colonnes valent NULL / défaut pour les données V1", () => {
    const db = newDb("0002_login_throttle.sql");
    seedV1(db);
    applyMigrations(db, { after: "0002_login_throttle.sql" });
    const line = db.query<Record<string, unknown>>("SELECT * FROM expense_amounts WHERE id='a1'")[0];
    expect(line.subcategory_id).toBeNull();
    expect(line.merchant_id).toBeNull();
    expect(line.platform_id).toBeNull();
    const s = db.query<Record<string, unknown>>("SELECT * FROM user_settings WHERE user_id='u1'")[0];
    expect(s.timezone).toBe("Europe/Paris");
    expect(s.safety_reserve_cents).toBe(0);
    expect(s.opening_balance_cents).toBeNull();
    expect(db.query("SELECT count(*) AS n FROM income_details")[0]).toEqual({ n: 0 });
  });

  it("ajoute les 8 nouvelles catégories sans toucher aux 10 anciennes", () => {
    const db = newDb();
    const ids = db.query<{ id: string }>("SELECT id FROM categories ORDER BY position").map((r) => r.id);
    expect(ids).toHaveLength(18);
    expect(ids.slice(0, 10)).toEqual(["logement", "alimentation", "transport", "sport", "loisirs", "abonnements", "etudes", "shopping", "sante", "autre"]);
  });

  it("les contrôles d'intégrité ne renvoient aucune anomalie après migration", () => {
    const db = newDb("0002_login_throttle.sql");
    seedV1(db);
    applyMigrations(db, { after: "0002_login_throttle.sql" });
    for (const q of integrityQueries()) {
      expect(db.query(q), q).toEqual([]);
    }
  });

  it("les contrôles détectent une anomalie injectée", () => {
    const db = newDb();
    db.raw.exec("PRAGMA foreign_keys = OFF");
    db.raw.exec("INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations) VALUES ('u','z@z.fr','Z','h','s',1)");
    db.raw.exec("INSERT INTO financial_periods (id,user_id,month) VALUES ('p','u','2026-10')");
    db.raw.exec("INSERT INTO expense_entries (id,user_id,period_id,spent_on,location_type,country_name,payment_label) VALUES ('e','u','p','2026-10-03','france','France','Autre')");
    const q = integrityQueries()[0];
    expect(db.query(q).length).toBe(1);
  });

  it("refuse un statut halal vérifié sans source", () => {
    const db = newDb();
    db.raw.exec("INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations) VALUES ('u','z@z.fr','Z','h','s',1)");
    expect(() =>
      db.raw.exec("INSERT INTO merchant_prefs (user_id,merchant_id,halal_status) VALUES ('u','m_otacos','verified')"),
    ).toThrow();
    db.raw.exec("INSERT INTO merchant_prefs (user_id,merchant_id,halal_status,halal_source) VALUES ('u','m_otacos','verified','Certificat consulté le 01/11')");
  });

  it("un enfant ne peut pas référencer le revenu d'un autre utilisateur", () => {
    const db = newDb("0002_login_throttle.sql");
    seedV1(db);
    applyMigrations(db, { after: "0002_login_throttle.sql" });
    expect(() =>
      db.raw.exec("INSERT INTO income_details (income_id,user_id,kind) VALUES ('i1','u2','salary')"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("le script de retour arrière rend une base V1 exploitable sans perdre un centime de dépense ni de revenu reçu", () => {
    const db = newDb("0002_login_throttle.sql");
    seedV1(db);
    const q = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).run(...(p as never[]));
    const v1Before = snapshot(db);
    applyMigrations(db, { after: "0002_login_throttle.sql" });
    db.raw.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)");
    for (const n of ["0003_v2_expenses_taxonomy.sql", "0004_v2_income_budget_subscriptions.sql", "0005_v2_tasks_alerts_ai.sql"]) q("INSERT INTO d1_migrations (name) VALUES (?)", n);
    // Données V2 : une ligne « telecom » à côté d'une ligne « autre » (fusion), un revenu attendu, un revenu confirmé détaillé.
    q("INSERT INTO expense_entries (id,user_id,period_id,spent_on,location_type,country_code,country_name,city,payment_label) VALUES ('e9','u1','p1','2026-10-20','france','FR','France','Paris','Autre')");
    q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents) VALUES ('b1','e9','autre',1000)");
    q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents,merchant_label) VALUES ('b2','e9','telecom',1999,'Free')");
    q("INSERT INTO expense_amounts (id,entry_id,category_id,amount_cents) VALUES ('b3','e9','assurance',3000)");
    q("INSERT INTO incomes (id,user_id,period_id,source,label,amount_cents) VALUES ('i9','u1','p1','other','Prime attendue',88800)");
    q("INSERT INTO income_details (income_id,user_id,kind,status) VALUES ('i9','u1','bonus','expected')");
    q("INSERT INTO incomes (id,user_id,period_id,source,label,amount_cents) VALUES ('i8','u1','p1','other','Salaire',100000)");
    q("INSERT INTO income_details (income_id,user_id,kind,status,gross_cents) VALUES ('i8','u1','salary','confirmed',130000)");
    q("INSERT INTO tasks (id,user_id,title) VALUES ('t1','u1','x')");
    const total = (sql: string) => (db.query<{ t: number }>(sql)[0].t);
    const expensesBefore = total("SELECT SUM(amount_cents) AS t FROM expense_amounts");

    db.raw.exec(readFileSync(join(__dirname, "..", "docs", "rollback-v2.sql"), "utf8"));

    expect(total("SELECT SUM(amount_cents) AS t FROM expense_amounts")).toBe(expensesBefore); // aucune dépense perdue
    expect(db.query("SELECT category_id, amount_cents FROM expense_amounts WHERE entry_id='e9'")).toEqual([{ category_id: "autre", amount_cents: 5999 }]);
    expect(db.query("SELECT id FROM incomes WHERE id='i9'")).toEqual([]); // revenu attendu supprimé (jamais du cash)
    expect(db.query("SELECT amount_cents FROM incomes WHERE id='i8'")).toEqual([{ amount_cents: 100000 }]); // revenu reçu conservé
    expect(db.query("SELECT count(*) AS n FROM categories")[0]).toEqual({ n: 10 });
    for (const t of ["tasks", "subscriptions", "budgets", "income_details", "merchants", "notifications", "ai_messages"]) {
      expect(db.query(`SELECT name FROM sqlite_master WHERE name='${t}'`), t).toEqual([]);
    }
    expect(db.query("SELECT name FROM pragma_table_info('expense_amounts')").map((r: any) => r.name)).toEqual(["id", "entry_id", "category_id", "amount_cents"]);
    expect(db.query("SELECT name FROM d1_migrations")).toEqual([{ name: "0001_initial.sql" }].slice(0, 0));
    expect(db.query("PRAGMA foreign_key_check")).toEqual([]);
    // Les données V1 d'origine (hors lignes ajoutées par le test) sont intactes.
    const after = snapshot(db);
    expect(after.users).toEqual(v1Before.users);
    expect(after.savings).toEqual(v1Before.savings);
    expect(after.incomes.filter((r: any) => ["i1", "i2", "i3"].includes(r.id))).toEqual(v1Before.incomes);
    expect(after.amounts.filter((r: any) => ["a1", "a2", "a3"].includes(r.id))).toEqual(v1Before.amounts);
  });
});
