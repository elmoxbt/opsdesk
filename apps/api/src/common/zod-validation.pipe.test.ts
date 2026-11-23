import { loginSchema } from "@opsdesk/shared";
import { describe, expect, it } from "vitest";
import { AppException } from "./app-exception";
import { ZodValidationPipe } from "./zod-validation.pipe";

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe(loginSchema);

  it("returns the parsed (normalised) value", () => {
    expect(pipe.transform({ email: " A@B.CO ", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
  });

  it("throws VALIDATION_FAILED with per-field details", () => {
    try {
      pipe.transform({ email: "nope" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      const err = e as AppException;
      expect(err.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(err.details ?? {})).toEqual(expect.arrayContaining(["email", "password"]));
    }
  });
});
