import { Hono } from "hono";
import type { AppEnv } from "../env";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { ApiError, readJson, uuid, validate, nowISO } from "../lib/http";
import { createSession, destroySession, requireAuth } from "../lib/session";
import { loginSchema, passwordChangeSchema, profileSchema, registerSchema } from "../../shared/schemas";
import type { MeDTO, Theme } from "../../shared/types";

const DEFAULT_PAYMENT_METHODS = ["CIH Bank", "LCL", "Revolut"];
// Hash factice pour que la réponse prenne le même temps quand l'e-mail n'existe pas.
const DUMMY_SALT = "00000000000000000000000000000000";
// Limitation des essais : au-delà, la connexion est refusée pendant 15 minutes.
const THROTTLE_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_EMAIL = 10;
const MAX_FAILS_PER_IP = 30;

export async function loadMe(db: D1Database, userId: string): Promise<MeDTO> {
  const [user, settings, methods] = await db.batch([
    db.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(userId),
    db
      .prepare("SELECT default_alternance_cents, default_freelance_cents, currency, theme FROM user_settings WHERE user_id = ?")
      .bind(userId),
    db
      .prepare("SELECT id, name, archived FROM payment_methods WHERE user_id = ? ORDER BY position, created_at")
      .bind(userId),
  ]);
  const u = user.results[0] as { id: string; email: string; name: string } | undefined;
  if (!u) throw new ApiError(401, "Votre session a expiré. Reconnectez-vous.");
  const s = settings.results[0] as
    | { default_alternance_cents: number; default_freelance_cents: number; theme: Theme }
    | undefined;
  return {
    user: u,
    settings: {
      defaultAlternanceCents: s?.default_alternance_cents ?? 120200,
      defaultFreelanceCents: s?.default_freelance_cents ?? 50000,
      currency: "EUR",
      theme: s?.theme ?? "system",
    },
    paymentMethods: (methods.results as { id: string; name: string; archived: number }[]).map((m) => ({
      id: m.id,
      name: m.name,
      archived: m.archived === 1,
    })),
  };
}

export const auth = new Hono<AppEnv>()
  .post("/register", async (c) => {
    if (c.env.ALLOW_SIGNUP === "false") throw new ApiError(403, "Les inscriptions sont fermées sur cette instance.");
    const input = validate(registerSchema, await readJson(c.req));
    const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(input.email).first();
    if (exists) throw new ApiError(409, "Un compte existe déjà avec cette adresse e-mail.");
    const { hash, salt, iterations } = await hashPassword(input.password);
    const userId = uuid();
    const db = c.env.DB;
    await db.batch([
      db
        .prepare("INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, input.email, input.name, hash, salt, iterations),
      db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").bind(userId),
      ...DEFAULT_PAYMENT_METHODS.map((name, i) =>
        db.prepare("INSERT INTO payment_methods (id, user_id, name, position) VALUES (?, ?, ?, ?)").bind(uuid(), userId, name, i),
      ),
    ]);
    await createSession(c, userId);
    return c.json(await loadMe(db, userId), 201);
  })

  .post("/login", async (c) => {
    const input = validate(loginSchema, await readJson(c.req));
    const db = c.env.DB;
    // CF-Connecting-IP est toujours fourni par Cloudflare en production ; absent en local.
    const ip = c.req.header("CF-Connecting-IP");
    const keys = { email: `email:${input.email}`, ip: ip ? `ip:${ip}` : "ip:none" };
    const since = Date.now() - THROTTLE_WINDOW_MS;
    const counts = await db
      .prepare(
        `SELECT SUM(key = ?) AS by_email, SUM(key = ?) AS by_ip FROM auth_attempts
         WHERE key IN (?, ?) AND created_at > ?`,
      )
      .bind(keys.email, keys.ip, keys.email, keys.ip, since)
      .first<{ by_email: number | null; by_ip: number | null }>();
    if ((counts?.by_email ?? 0) >= MAX_FAILS_PER_EMAIL || (ip && (counts?.by_ip ?? 0) >= MAX_FAILS_PER_IP)) {
      throw new ApiError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
    }
    const user = await c.env.DB.prepare(
      "SELECT id, password_hash, password_salt, password_iterations FROM users WHERE email = ?",
    )
      .bind(input.email)
      .first<{ id: string; password_hash: string; password_salt: string; password_iterations: number }>();
    const ok = user
      ? await verifyPassword(input.password, user.password_hash, user.password_salt, user.password_iterations)
      : (await hashPassword(input.password, DUMMY_SALT), false);
    if (!user || !ok) {
      const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO auth_attempts (key, created_at) VALUES (?, ?), (?, ?)").bind(keys.email, now, keys.ip, now),
        // Nettoyage opportuniste des anciennes tentatives.
        db.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(since),
      ]);
      throw new ApiError(401, "E-mail ou mot de passe incorrect.");
    }
    await db.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(keys.email).run();
    // Nettoyage opportuniste des sessions expirées de cet utilisateur.
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(user.id, Date.now()).run();
    await createSession(c, user.id);
    return c.json(await loadMe(c.env.DB, user.id));
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  })

  .get("/me", requireAuth, async (c) => c.json(await loadMe(c.env.DB, c.get("userId"))))

  .patch("/profile", requireAuth, async (c) => {
    const userId = c.get("userId");
    const input = validate(profileSchema, await readJson(c.req));
    const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").bind(input.email, userId).first();
    if (taken) throw new ApiError(409, "Cette adresse e-mail est déjà utilisée.");
    await c.env.DB.prepare("UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, input.email, nowISO(), userId)
      .run();
    return c.json(await loadMe(c.env.DB, userId));
  })

  .post("/password", requireAuth, async (c) => {
    const userId = c.get("userId");
    const input = validate(passwordChangeSchema, await readJson(c.req));
    const user = await c.env.DB.prepare("SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?")
      .bind(userId)
      .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
    if (!user || !(await verifyPassword(input.currentPassword, user.password_hash, user.password_salt, user.password_iterations))) {
      throw new ApiError(400, "Le mot de passe actuel est incorrect.");
    }
    const { hash, salt, iterations } = await hashPassword(input.newPassword);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
        .bind(hash, salt, iterations, nowISO(), userId),
      // Déconnecte tous les appareils, puis on recrée une session pour celui-ci.
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    ]);
    await createSession(c, userId);
    return c.body(null, 204);
  });
