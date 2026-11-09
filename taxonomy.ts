import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { merchantCreateSchema, merchantPrefSchema, subcategoryCreateSchema } from "../../shared/schemas";
import { SYSTEM_MERCHANTS, isSystemMerchantId, normalizeText, type HalalStatus, type MerchantView } from "../../shared/merchants";
import type { SubcategoryDTO, TaxonomyDTO } from "../../shared/types";
import { assertSubcategory } from "../lib/classification";

interface PrefRow {
  merchant_id: string;
  use_count: number;
  last_used_at: string | null;
  halal_status: HalalStatus;
  halal_source: string | null;
  halal_verified_at: string | null;
}

export async function loadMerchants(db: D1Database, userId: string): Promise<MerchantView[]> {
  const [custom, prefs] = await db.batch([
    db.prepare("SELECT id, label, category_id, subcategory_id FROM merchants WHERE user_id = ? AND archived = 0").bind(userId),
    db.prepare("SELECT merchant_id, use_count, last_used_at, halal_status, halal_source, halal_verified_at FROM merchant_prefs WHERE user_id = ?").bind(userId),
  ]);
  const prefBy = new Map((prefs.results as unknown as PrefRow[]).map((p) => [p.merchant_id, p]));
  const view = (id: string, label: string, system: boolean, categoryId: MerchantView["categoryId"], subs: string[], halalApplicable: boolean): MerchantView => {
    const p = prefBy.get(id);
    return {
      id,
      label,
      system,
      categoryId,
      subcategoryIds: subs,
      halalStatus: halalApplicable ? (p?.halal_status ?? "unknown") : null,
      halalSource: p?.halal_source ?? null,
      halalVerifiedAt: p?.halal_verified_at ?? null,
      useCount: p?.use_count ?? 0,
      lastUsedAt: p?.last_used_at ?? null,
    };
  };
  const sys = SYSTEM_MERCHANTS.map((m) => view(m.id, m.label, true, m.categoryId, m.subcategoryIds, m.halalStatus !== null));
  const mine = (custom.results as { id: string; label: string; category_id: string | null; subcategory_id: string | null }[]).map((m) =>
    view(m.id, m.label, false, m.category_id as MerchantView["categoryId"], m.subcategory_id ? [m.subcategory_id] : [], m.category_id === "alimentation"),
  );
  return [...sys, ...mine];
}

export const taxonomy = new Hono<AppEnv>()
  .get("/taxonomy", async (c) => {
    const userId = c.get("userId");
    const subs = await c.env.DB.prepare("SELECT id, category_id, label FROM subcategories WHERE user_id = ? AND archived = 0 ORDER BY label")
      .bind(userId)
      .all<{ id: string; category_id: SubcategoryDTO["categoryId"]; label: string }>();
    const body: TaxonomyDTO = {
      customSubcategories: subs.results.map((s) => ({ id: s.id, categoryId: s.category_id, label: s.label, system: false })),
      merchants: await loadMerchants(c.env.DB, userId),
    };
    return c.json(body);
  })

  .post("/merchants", async (c) => {
    const userId = c.get("userId");
    const input = validate(merchantCreateSchema, await readJson(c.req));
    if (input.categoryId && input.subcategoryId) await assertSubcategory(c.env.DB, userId, input.categoryId, input.subcategoryId);
    const norm = normalizeText(input.label);
    if (SYSTEM_MERCHANTS.some((m) => normalizeText(m.label) === norm)) {
      throw new ApiError(409, "Cet établissement existe déjà dans l'annuaire : sélectionnez-le dans la liste.");
    }
    const dup = await c.env.DB.prepare("SELECT 1 FROM merchants WHERE user_id = ? AND label = ? COLLATE NOCASE").bind(userId, input.label).first();
    if (dup) throw new ApiError(409, "Cet établissement existe déjà.");
    const id = `c_${uuid()}`;
    await c.env.DB.prepare("INSERT INTO merchants (id, user_id, label, category_id, subcategory_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, userId, input.label, input.categoryId ?? null, input.subcategoryId ?? null)
      .run();
    const created = (await loadMerchants(c.env.DB, userId)).find((m) => m.id === id);
    return c.json(created, 201);
  })

  .delete("/merchants/:id", async (c) => {
    const res = await c.env.DB.prepare("UPDATE merchants SET archived = 1 WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Établissement introuvable ou fourni par l'annuaire.");
    return c.body(null, 204);
  })

  /** Statut halal : attribut vérifiable, jamais déduit du nom. « verified » exige une source. */
  .put("/merchants/:id/halal", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const input = validate(merchantPrefSchema, await readJson(c.req));
    if (!isSystemMerchantId(id)) {
      const mine = await c.env.DB.prepare("SELECT 1 FROM merchants WHERE id = ? AND user_id = ?").bind(id, userId).first();
      if (!mine) throw new ApiError(404, "Établissement introuvable.");
    }
    await c.env.DB.prepare(
      `INSERT INTO merchant_prefs (user_id, merchant_id, halal_status, halal_source, halal_verified_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, merchant_id) DO UPDATE SET halal_status = excluded.halal_status, halal_source = excluded.halal_source,
         halal_verified_at = excluded.halal_verified_at`,
    )
      .bind(userId, id, input.halalStatus, input.halalStatus === "unknown" ? null : (input.halalSource ?? null), input.halalStatus === "verified" ? nowISO() : null)
      .run();
    const updated = (await loadMerchants(c.env.DB, userId)).find((m) => m.id === id);
    return c.json(updated);
  })

  .post("/subcategories", async (c) => {
    const userId = c.get("userId");
    const input = validate(subcategoryCreateSchema, await readJson(c.req));
    const id = `u_${uuid()}`;
    try {
      await c.env.DB.prepare("INSERT INTO subcategories (id, user_id, category_id, label) VALUES (?, ?, ?, ?)")
        .bind(id, userId, input.categoryId, input.label)
        .run();
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new ApiError(409, "Cette sous-catégorie existe déjà.");
      throw e;
    }
    const dto: SubcategoryDTO = { id, categoryId: input.categoryId, label: input.label, system: false };
    return c.json(dto, 201);
  })

  .delete("/subcategories/:id", async (c) => {
    const res = await c.env.DB.prepare("UPDATE subcategories SET archived = 1 WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
    if (!res.meta.changes) throw new ApiError(404, "Sous-catégorie introuvable.");
    return c.body(null, 204);
  });

