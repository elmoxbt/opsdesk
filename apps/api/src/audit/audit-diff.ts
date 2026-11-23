import type { Prisma } from "@opsdesk/db";

type Plain = Record<string, unknown>;

const normalise = (v: unknown): Prisma.InputJsonValue | null =>
  v instanceof Date ? v.toISOString() : ((v ?? null) as Prisma.InputJsonValue | null);

/**
 * Keeps only the fields that changed, so the audit trail (and the activity
 * timeline built from it) reads "price: 15,000 → 18,000" instead of two full snapshots.
 */
export function auditDiff<T extends Plain>(
  before: T,
  after: T,
  keys: ReadonlyArray<keyof T & string>,
): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } | null {
  const b: Record<string, Prisma.InputJsonValue | null> = {};
  const a: Record<string, Prisma.InputJsonValue | null> = {};
  for (const k of keys) {
    const bv = normalise(before[k]);
    const av = normalise(after[k]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv;
      a[k] = av;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export function snapshot<T extends Plain>(
  row: T,
  keys: ReadonlyArray<keyof T & string>,
): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const k of keys) out[k] = normalise(row[k]);
  return out;
}
