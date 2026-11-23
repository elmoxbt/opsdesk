import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { ClientConfig } from "@opsdesk/config";
import { ENV, loadEnv } from "./env";

/** DI token for this deployment's validated white-label config. */
export const CLIENT_CONFIG = Symbol("CLIENT_CONFIG");

/**
 * Two kinds of configuration, deliberately separate:
 * - ENV: infrastructure and secrets (database URL, JWT secret, S3 keys).
 * - CLIENT_CONFIG: who this deployment is for (branding, settings, features),
 *   from config/client.config.ts plus CLIENT_ and FEATURE_ env overrides.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(clientConfig: ClientConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useFactory: () => loadEnv() },
        { provide: CLIENT_CONFIG, useValue: clientConfig },
      ],
      exports: [ENV, CLIENT_CONFIG],
    };
  }
}
