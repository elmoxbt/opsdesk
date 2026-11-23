import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ACCESS_COOKIE } from "./auth/cookies";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { requestContextMiddleware } from "./common/request-context.middleware";
import type { ClientConfig } from "@opsdesk/config";
import { API_INTRO } from "./api-docs";
import { CLIENT_CONFIG } from "./config/config.module";
import { ENV, type Env } from "./config/env";
import { CorsIoAdapter } from "./realtime/io-adapter";

/** Shared by main.ts and the integration tests, so tests exercise the real app setup. */
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<Env>(ENV);
  // Behind Caddy, req.ip must come from X-Forwarded-For (set by the ONE proxy we trust),
  // or every visitor shares the proxy's IP and per-IP limits become global.
  const http = app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void };
  http.set?.("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.useWebSocketAdapter(new CorsIoAdapter(app, env.WEB_ORIGIN));
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // Docs: always in development; in production only for deployments that offer the public API.
  const client = app.get<ClientConfig>(CLIENT_CONFIG);
  if (env.NODE_ENV !== "production" || client.features.publicApi) {
    const config = new DocumentBuilder()
      .setTitle(`${client.branding.appName ?? client.business.name} API`)
      .setDescription(API_INTRO)
      .setVersion("1.0.0")
      .addCookieAuth(ACCESS_COOKIE)
      .addBearerAuth({ type: "http", scheme: "bearer", description: "API key: opsk_…" }, "apiKey")
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    // Every operation accepts the API-key scheme; the guard decides per route and scope.
    for (const path of Object.values(doc.paths))
      for (const op of Object.values(path) as Array<{ security?: unknown[] }>)
        op.security = [...(op.security ?? []), { apiKey: [] }];
    SwaggerModule.setup("api/docs", app, doc, { customSiteTitle: "API reference" });
  }
  return app;
}
