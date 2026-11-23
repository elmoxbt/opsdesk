import { describe, expect, it } from "vitest";
import { createInvitationSchema, loginSchema, passwordSchema } from "./auth";

describe("loginSchema", () => {
  it("normalises email to trimmed lowercase", () => {
    expect(loginSchema.parse({ email: "  ADA@Example.com ", password: "x" }).email).toBe("ada@example.com");
  });
});

describe("passwordSchema", () => {
  it("rejects short passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
  });

  it("rejects passwords over bcrypt's 72-byte limit", () => {
    expect(passwordSchema.safeParse("é".repeat(37)).success).toBe(false); // 74 bytes
  });
});

describe("createInvitationSchema", () => {
  it("does not allow inviting an OWNER", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", role: "OWNER" }).success).toBe(false);
  });
});
