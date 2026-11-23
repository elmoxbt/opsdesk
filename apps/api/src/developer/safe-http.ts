import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

/**
 * Addresses a webhook must never reach: the server itself, the private
 * network (Postgres, Redis, MinIO live there), cloud metadata services.
 * Without this, "add a webhook URL" is a server-side request forgery hole.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("ff")
  );
}

export class BlockedAddressError extends Error {
  constructor(host: string, ip: string) {
    super(`Refusing to connect to ${host} (${ip}): private or reserved address`);
    this.name = "BlockedAddressError";
  }
}

/**
 * A DNS lookup that rejects private addresses AT CONNECT TIME. Checking the
 * URL's hostname up front isn't enough: a hostile DNS server can answer a
 * public IP for the check and 127.0.0.1 for the connection (DNS rebinding).
 * Validating inside the socket's own lookup closes that gap.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as unknown as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new BlockedAddressError(hostname, bad.address), "", 4);
    const first = list[0]!;
    if ((options as { all?: boolean }).all)
      (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    else callback(null, first.address, first.family);
  });
};

export interface SafePostResult {
  status: number;
  body: string;
  durationMs: number;
}

/** POST with a hard timeout, no redirects, a capped response body, and (unless allowed) no private targets. */
export function safePost(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { allowPrivate: boolean; timeoutMs?: number },
): Promise<SafePostResult> {
  const u = new URL(url);
  if (!opts.allowPrivate) {
    if (u.protocol !== "https:") return Promise.reject(new Error("Webhook URLs must use https"));
    if (isIP(u.hostname) && isPrivateAddress(u.hostname))
      return Promise.reject(new BlockedAddressError(u.hostname, u.hostname));
  }
  const started = Date.now();
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        timeout: opts.timeoutMs ?? 10_000,
        ...(opts.allowPrivate ? {} : { lookup: guardedLookup }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= 1024) chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8").slice(0, 1024),
            durationMs: Date.now() - started,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${opts.timeoutMs ?? 10_000} ms`)));
    req.on("error", reject);
    req.end(body);
  });
}
