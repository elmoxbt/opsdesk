import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ClientConfig, Feature } from "@opsdesk/config";
import { AppException } from "../common/app-exception";
import { CLIENT_CONFIG } from "../config/config.module";

export const FEATURE_KEY = "requiredFeature";

/** Marks a route/controller as part of an optional feature. Disabled → 404, as if it didn't exist. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature);

/**
 * Runs BEFORE authentication, so a disabled feature looks identical to a
 * missing route for everyone (no 401 vs 404 difference to probe).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CLIENT_CONFIG) private readonly config: ClientConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (feature && !this.config.features[feature]) {
      throw new AppException("NOT_FOUND", "Not found");
    }
    return true;
  }
}
