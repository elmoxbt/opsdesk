import { describe, expect, it } from "vitest";
import { SecretBox } from "./secret-box";

describe("SecretBox", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  it("round-trips and never stores the plaintext", () => {
    const box = new SecretBox(key, "x");
    const sealed = box.seal("whsec_abc");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("whsec_abc");
    expect(box.open(sealed)).toBe("whsec_abc");
    expect(box.seal("whsec_abc")).not.toBe(sealed); // fresh IV each time
  });
  it("rejects tampering and the wrong key", () => {
    const box = new SecretBox(key, "x");
    const sealed = box.seal("secret");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => box.open(parts.join(":"))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 2).toString("base64"), "x").open(sealed)).toThrow();
  });
});
