import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ENV, type Env } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { FeatureGuard } from "../features/require-feature";
import { RolesGuard } from "./roles.guard";
import { SessionService } from "./session.service";
import { TokenService } from "./token.service";
import { RateLimitGuard } from "../common/rate-limit";
import { ApiKeyAuthService } from "./api-key-auth.service";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ secret: env.JWT_ACCESS_SECRET, signOptions: { algorithm: "HS256" } }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    // Order matters: hide disabled features first (404 for everyone), then authenticate, then authorise, then rate-limit.
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Last, so it knows the caller (per-API-key budgets).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    ApiKeyAuthService,
  ],
  exports: [AuthService, PasswordService, TokenService, SessionService],
})
export class AuthModule {}
