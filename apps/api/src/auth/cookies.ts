import type { CookieOptions, Response } from "express";
import type { Env } from "../config/env";

export const ACCESS_COOKIE = "opsdesk_at";
export const REFRESH_COOKIE = "opsdesk_rt";
/** The refresh cookie is only ever sent to the auth endpoints, shrinking its exposure. */
export const REFRESH_COOKIE_PATH = "/api/auth";

/**
 * Both cookies are httpOnly, so page JavaScript (and therefore XSS) cannot read them.
 * SameSite=Lax on the access cookie stops it being sent on cross-site POST/PATCH/DELETE,
 * which is our CSRF defence as long as GET requests never mutate state.
 */
export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const base: CookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    sameSite: "lax",
    path: "/",
    maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  const base: CookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE };
  res.clearCookie(ACCESS_COOKIE, { ...base, sameSite: "lax", path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base, sameSite: "strict", path: REFRESH_COOKIE_PATH });
}
