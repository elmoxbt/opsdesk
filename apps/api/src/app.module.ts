import { type DynamicModule, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { ClientConfig } from "@opsdesk/config";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { ConfigModule } from "./config/config.module";
import { CustomersModule } from "./customers/customers.module";
import { ClientConfigController } from "./features/client-config.controller";
import { featureModules } from "./features/feature-modules";
import { HealthController } from "./health/health.controller";
import { InvitationsModule } from "./invitations/invitations.module";
import { JobsModule } from "./jobs/jobs.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.service";
import { DomainEventsModule } from "./realtime/domain-events";
import { RealtimeModule } from "./realtime/realtime.module";
import { ServiceTypesModule } from "./service-types/service-types.module";
import { StorageModule } from "./storage/storage.service";
import { SystemModule } from "./system/system-lookup.service";
import { IdempotencyInterceptor } from "./common/idempotency.interceptor";
import { UsersModule } from "./users/users.module";

/**
 * Built per deployment: core modules always, optional features only if enabled
 * in this client's config (see features/feature-modules.ts).
 */
@Module({})
export class AppModule {
  /**
   * `worker`: the background-job process. `realtime: false`: no WebSocket gateway (serverless
   * hosts can't hold sockets; clients fall back to refetching).
   */
  static forRoot(
    clientConfig: ClientConfig,
    opts: { worker?: boolean; realtime?: boolean } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(clientConfig),
        PrismaModule,
        StorageModule,
        QueueModule,
        SystemModule,
        DomainEventsModule,
        AuditModule,
        NotificationsModule,
        AuthModule,
        UsersModule,
        InvitationsModule,
        CustomersModule,
        ServiceTypesModule,
        JobsModule,
        BillingModule,
        ...(opts.worker || opts.realtime === false ? [] : [RealtimeModule]),
        ...featureModules(clientConfig),
      ],
      controllers: [HealthController, ClientConfigController],
      // Idempotency-Key support for every authenticated write (offline replays).
      providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
    };
  }
}
