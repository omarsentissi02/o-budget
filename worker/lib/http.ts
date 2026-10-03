import type { ZodType, ZodTypeDef } from "zod";

/** Erreur destinée à l'utilisateur : le message est affiché tel quel (en français). */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
  ) {
    super(message);
  }
}

export function validate<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(400, issue?.message && !issue.message.startsWith("Expected") && !issue.message.startsWith("Required") ? issue.message : "Données invalides. Vérifiez votre saisie.");
  }
  return result.data;
}

export async function readJson(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Requête invalide.");
  }
}

export const nowISO = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
