import type { DynamicModule, Type } from "@nestjs/common";
import { type ClientConfig, type Feature, FEATURES } from "@opsdesk/config";
import { AnalyticsModule } from "../analytics/analytics.module";
import { BookingModule } from "../booking/booking.module";
import { DeveloperModule } from "../developer/developer.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PaymentsModule } from "../payments/payments.module";
import { TechnicianAppModule } from "./technician-app.module";

type ModuleRef = Type | DynamicModule;

/**
 * Which Nest modules make up each optional feature. A disabled feature's
 * modules are never imported: no routes, no providers, no background jobs, so
 * its endpoints simply don't exist (404), rather than existing behind an `if`.
 *
 * Endpoints that live inside a core module but belong to a feature (e.g.
 * "parts used" on a job) use @RequireFeature() instead.
 */
export const FEATURE_MODULES: Readonly<Record<Feature, readonly ModuleRef[]>> = {
  inventory: [InventoryModule],
  technicianApp: [TechnicianAppModule],
  payments: [PaymentsModule],
  bookingPortal: [BookingModule],
  analytics: [AnalyticsModule],
  publicApi: [DeveloperModule],
};

export function featureModules(
  config: ClientConfig,
  map: Readonly<Record<Feature, readonly ModuleRef[]>> = FEATURE_MODULES,
): ModuleRef[] {
  return FEATURES.filter((f) => config.features[f]).flatMap((f) => map[f]);
}
