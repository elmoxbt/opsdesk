import { describe, expect, it } from "vitest";
import { isPrivateAddress, safePost } from "./safe-http";

describe("isPrivateAddress", () => {
  it("blocks loopback, private ranges, link-local metadata and IPv6 equivalents", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "102.89.1.1", "2606:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("safePost", () => {
  it("refuses plain http and private IP literals in production mode", async () => {
    await expect(safePost("http://example.com/hook", "{}", {}, { allowPrivate: false })).rejects.toThrow(
      /https/,
    );
    await expect(safePost("https://127.0.0.1/hook", "{}", {}, { allowPrivate: false })).rejects.toThrow(
      /private/,
    );
    await expect(
      safePost("https://169.254.169.254/latest", "{}", {}, { allowPrivate: false }),
    ).rejects.toThrow(/private/);
  });
  it("refuses hostnames that RESOLVE to private addresses (checked at connect time)", async () => {
    await expect(
      safePost("https://localhost/hook", "{}", {}, { allowPrivate: false, timeoutMs: 2000 }),
    ).rejects.toThrow(/private|reserved/);
  });
});
