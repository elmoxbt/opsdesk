import { z } from "zod";
import { PASSWORD_MIN_LENGTH, ROLES } from "../constants";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  // bcrypt silently truncates input beyond 72 bytes; reject instead of surprising users.
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Password is too long");

// No signup schema: deployments are single-business. The owner is created by
// `bootstrap` from config/client.config.ts; everyone else joins by invitation.

export const loginSchema = z.object({
  email: emailSchema,
  // Don't apply strength rules on login: just require something.
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const roleSchema = z.enum(ROLES);

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: roleSchema.exclude(["OWNER"]),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1, "Enter your name").max(100),
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const updateUserRoleSchema = z.object({
  role: roleSchema.exclude(["OWNER"]),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

/** What the API returns for the signed-in user. Never includes secrets. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: (typeof ROLES)[number];
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    brandColor: string;
  };
}
