import { Global, Injectable, Module } from "@nestjs/common";
import type { PaymentProvider } from "@opsdesk/db";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The few questions that must be answered BEFORE we know the tenant: "whose
 * invoice is this public token?", "whose payment is this webhook about?",
 * "which organizations exist?" (for scheduled jobs). Each returns only an
 * organizationId; callers then do the real work inside
 * tenantContext.runAsync({ organizationId }), with isolation back on.
 *
 * This file is on the ESLint allowlist for the unscoped client: keeping the
 * cross-tenant lookups here, read-only and tiny, makes them easy to review.
 */
@Injectable()
export class SystemLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async organizationForInvoiceToken(publicToken: string): Promise<string | null> {
    const row = await this.prisma.unscoped.invoice.findUnique({
      where: { publicToken },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }

  async organizationForPayment(provider: PaymentProvider, reference: string): Promise<string | null> {
    const row = await this.prisma.unscoped.payment.findUnique({
      where: { provider_reference: { provider, reference } },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }

  async organizationBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.unscoped.organization.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }

  async organizationForBookingToken(bookingToken: string): Promise<string | null> {
    const row = await this.prisma.unscoped.job.findUnique({
      where: { bookingToken },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }

  async allOrganizationIds(): Promise<string[]> {
    const rows = await this.prisma.unscoped.organization.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }
}

@Global()
@Module({ providers: [SystemLookupService], exports: [SystemLookupService] })
export class SystemModule {}
