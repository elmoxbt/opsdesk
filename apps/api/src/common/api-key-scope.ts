import { SetMetadata } from "@nestjs/common";
import type { ApiScope } from "@opsdesk/shared";

export const API_KEY_SCOPE = "apiKeyScope";

/**
 * Opens a route to API keys that hold `scope`. Routes WITHOUT it reject API
 * keys outright: the public API is an explicit allow-list, so a new internal
 * endpoint never becomes publicly scriptable by accident.
 */
export const ApiKeyScope = (scope: ApiScope) => SetMetadata(API_KEY_SCOPE, scope);
