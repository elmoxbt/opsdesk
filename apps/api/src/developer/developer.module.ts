import { Module } from "@nestjs/common";
import { DeveloperController } from "./developer.controller";
import { DeveloperService } from "./developer.service";

/** `publicApi` feature: API keys, outgoing webhooks. (Key authentication itself lives in AuthGuard.) */
@Module({ controllers: [DeveloperController], providers: [DeveloperService] })
export class DeveloperModule {}
