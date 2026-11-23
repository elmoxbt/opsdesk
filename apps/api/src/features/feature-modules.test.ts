import { Module } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type ClientConfig, defineClientConfig, resolveClientConfig } from "@opsdesk/config";
import { describe, expect, it } from "vitest";
import { AppException } from "../common/app-exception";
import { featureModules } from "./feature-modules";
import { FeatureGuard } from "./require-feature";

@Module({})
class InventoryStub {}
@Module({})
class AnalyticsStub {}

const config = (features: Partial<ClientConfig["features"]>): ClientConfig =>
  resolveClientConfig(
    defineClientConfig({
      business: { name: "Test Co", slug: "test-co", email: "a@test.co", timezone: "UTC", currency: "USD" },
      branding: { primaryColor: "#000000" },
      features: {
        inventory: false,
        payments: false,
        bookingPortal: false,
        technicianApp: false,
        analytics: false,
        publicApi: false,
        ...features,
      },
      owner: { name: "O", email: "o@test.co" },
      domains: { app: "app.test.co" },
    }),
    {},
  );

const map = {
  inventory: [InventoryStub],
  analytics: [AnalyticsStub],
  payments: [],
  bookingPortal: [],
  technicianApp: [],
  publicApi: [],
};

describe("featureModules", () => {
  it("imports only the modules of enabled features", () => {
    expect(featureModules(config({ inventory: true }), map)).toEqual([InventoryStub]);
    expect(featureModules(config({ inventory: true, analytics: true }), map)).toEqual([
      InventoryStub,
      AnalyticsStub,
    ]);
    expect(featureModules(config({}), map)).toEqual([]);
  });
});

describe("FeatureGuard", () => {
  const ctx = {} as ExecutionContext;
  const guardFor = (cfg: ClientConfig, required: string | undefined) => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => required as never;
    Object.assign(ctx, { getHandler: () => () => undefined, getClass: () => class {} });
    return new FeatureGuard(reflector, cfg);
  };

  it("passes routes without a feature, and routes whose feature is on", () => {
    expect(guardFor(config({}), undefined).canActivate(ctx)).toBe(true);
    expect(guardFor(config({ inventory: true }), "inventory").canActivate(ctx)).toBe(true);
  });

  it("404s routes whose feature is off", () => {
    expect(() => guardFor(config({}), "inventory").canActivate(ctx)).toThrow(AppException);
  });
});
