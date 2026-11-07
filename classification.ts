import { getSubcategory, isSystemSubcategory } from "../../shared/taxonomy";
import { getSystemMerchant, isSystemMerchantId } from "../../shared/merchants";
import { ApiError } from "./http";

/**
 * Valide la sous-catégorie d'une ligne : sous-catégorie système de la bonne catégorie,
 * ou sous-catégorie personnalisée de CET utilisateur (non archivée) rattachée à la même catégorie.
 */
export async function assertSubcategory(db: D1Database, userId: string, categoryId: string, subId: string | null | undefined) {
  if (!subId) return null;
  if (getSubcategory(subId)) {
    if (!isSystemSubcategory(categoryId, subId)) throw new ApiError(400, "Cette sous-catégorie n'appartient pas à la catégorie choisie.");
    return subId;
  }
  const row = await db
    .prepare("SELECT 1 AS ok FROM subcategories WHERE id = ? AND user_id = ? AND category_id = ? AND archived = 0")
    .bind(subId, userId, categoryId)
    .first();
  if (!row) throw new ApiError(400, "Sous-catégorie inconnue.");
  return subId;
}

/** Retourne le libellé à mémoriser (snapshot) pour un marchand système ou personnel de l'utilisateur. */
export async function resolveMerchant(db: D1Database, userId: string, merchantId: string | null | undefined) {
  if (!merchantId) return null;
  if (isSystemMerchantId(merchantId)) return { id: merchantId, label: getSystemMerchant(merchantId)!.label };
  const row = await db
    .prepare("SELECT label FROM merchants WHERE id = ? AND user_id = ? AND archived = 0")
    .bind(merchantId, userId)
    .first<{ label: string }>();
  if (!row) throw new ApiError(400, "Établissement inconnu.");
  return { id: merchantId, label: row.label };
}
