import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets we must be able to read back (webhook signing
 * secrets: unlike passwords they can't be hashed, we need them to sign).
 * Format: "v1:<iv>:<tag>:<ciphertext>" (base64url), so the scheme can rotate.
 * A stolen database dump alone doesn't reveal the secrets.
 */
export class SecretBox {
  private readonly key: Buffer;

  /** `keyB64` is DATA_ENCRYPTION_KEY (32 bytes). Dev/test fall back to a key derived from `fallbackSeed`. */
  constructor(keyB64: string | undefined, fallbackSeed: string) {
    this.key = keyB64
      ? Buffer.from(keyB64, "base64")
      : createHash("sha256").update(`secret-box:${fallbackSeed}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
      .join(":");
  }

  open(sealed: string): string {
    const [v, iv, tag, ct] = sealed.split(":");
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised sealed secret");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  }
}
