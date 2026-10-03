import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { randomHex, sha256Hex } from "./crypto";
import { ApiError } from "./http";

export const SESSION_COOKIE = "ob_session";
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

function writeCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomHex(32);
  const id = await sha256Hex(token);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now + SESSION_DAYS * DAY_MS, now)
    .run();
  writeCookie(c, token);
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
}

/** Vérifie la session ; renouvelle automatiquement quand il reste moins de 15 jours. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) throw new ApiError(401, "Votre session a expiré. Reconnectez-vous.");
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; expires_at: number }>();
  const now = Date.now();
  if (!row || row.expires_at < now) {
    if (row) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    throw new ApiError(401, "Votre session a expiré. Reconnectez-vous.");
  }
  if (row.expires_at - now < 15 * DAY_MS) {
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(now + SESSION_DAYS * DAY_MS, id)
      .run();
    writeCookie(c, token);
  }
  c.set("userId", row.user_id);
  await next();
};

/** Protection CSRF : toute requête qui modifie des données doit venir du même site. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const host = new URL(c.req.url).host;
    if (origin && new URL(origin).host !== host) throw new ApiError(403, "Requête refusée.");
  }
  await next();
};
