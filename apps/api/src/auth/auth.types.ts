import type { Role } from "@opsdesk/shared";

/** Attached to `req.user` by the auth guard; always loaded fresh from the DB. */
export interface RequestUser {
  id: string;
  organizationId: string;
  role: Role;
  /**
   * Present when the caller is an API key rather than a person. Then `id` is the
   * key's id (never written as a user FK), `role` is office-level, and what the
   * key can actually do is limited by its scopes on each route (@ApiKeyScope).
   */
  apiKey?: { id: string; name: string; scopes: string[] };
}

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}
