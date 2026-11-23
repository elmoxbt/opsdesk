import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { type ClientConfig, type PublicClientConfig, toPublicConfig } from "@opsdesk/config";
import { Public } from "../common/decorators";
import { CLIENT_CONFIG } from "../config/config.module";

@ApiTags("config")
@Controller("config")
export class ClientConfigController {
  constructor(@Inject(CLIENT_CONFIG) private readonly config: ClientConfig) {}

  /** Branding + enabled features for frontends (the tech PWA, the booking portal). No secrets. */
  @Public()
  @Get()
  get(): PublicClientConfig {
    return toPublicConfig(this.config);
  }
}
