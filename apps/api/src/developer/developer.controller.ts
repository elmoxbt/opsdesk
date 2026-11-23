import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  type ApiKeyDto,
  apiKeyInputSchema,
  type CreatedApiKeyDto,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  webhookEndpointInputSchema,
  type WebhookEndpointWithSecretDto,
} from "@opsdesk/shared";
import type { z } from "zod";
import type { RequestUser } from "../auth/auth.types";
import { ApiZodBody, CurrentUser, Roles } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DeveloperService } from "./developer.service";

/**
 * `publicApi` feature: owners manage API keys and webhook endpoints here.
 * Never reachable with an API key (no @ApiKeyScope): a key can't mint keys.
 */
@ApiTags("developer")
@ApiCookieAuth()
@Roles("OWNER")
@Controller("developer")
export class DeveloperController {
  constructor(private readonly dev: DeveloperService) {}

  @Get("api-keys")
  listKeys(): Promise<ApiKeyDto[]> {
    return this.dev.listKeys();
  }

  /** The full key is in this response only. Store it now. */
  @Post("api-keys")
  @ApiZodBody(apiKeyInputSchema)
  createKey(
    @Body(new ZodValidationPipe(apiKeyInputSchema)) body: z.output<typeof apiKeyInputSchema>,
    @CurrentUser() actor: RequestUser,
  ): Promise<CreatedApiKeyDto> {
    return this.dev.createKey(body, actor);
  }

  @Delete("api-keys/:id")
  @HttpCode(204)
  revokeKey(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.dev.revokeKey(id);
  }

  @Get("webhooks")
  listEndpoints(): Promise<WebhookEndpointDto[]> {
    return this.dev.listEndpoints();
  }

  /** The signing secret is in this response only. */
  @Post("webhooks")
  @ApiZodBody(webhookEndpointInputSchema)
  createEndpoint(
    @Body(new ZodValidationPipe(webhookEndpointInputSchema))
    body: z.output<typeof webhookEndpointInputSchema>,
  ): Promise<WebhookEndpointWithSecretDto> {
    return this.dev.createEndpoint(body);
  }

  @Put("webhooks/:id")
  @ApiZodBody(webhookEndpointInputSchema)
  updateEndpoint(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(webhookEndpointInputSchema))
    body: z.output<typeof webhookEndpointInputSchema>,
  ): Promise<WebhookEndpointDto> {
    return this.dev.updateEndpoint(id, body);
  }

  @Delete("webhooks/:id")
  @HttpCode(204)
  deleteEndpoint(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.dev.deleteEndpoint(id);
  }

  @Post("webhooks/:id/rotate-secret")
  @HttpCode(200)
  rotate(@Param("id", ParseUUIDPipe) id: string): Promise<WebhookEndpointWithSecretDto> {
    return this.dev.rotateSecret(id);
  }

  @Post("webhooks/:id/test")
  @HttpCode(200)
  test(@Param("id", ParseUUIDPipe) id: string): Promise<WebhookDeliveryDto> {
    return this.dev.sendTest(id);
  }

  @Get("webhooks/:id/deliveries")
  deliveries(@Param("id", ParseUUIDPipe) id: string): Promise<WebhookDeliveryDto[]> {
    return this.dev.deliveries(id);
  }

  @Post("webhooks/:id/deliveries/:deliveryId/redeliver")
  @HttpCode(202)
  redeliver(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("deliveryId", ParseUUIDPipe) deliveryId: string,
  ): Promise<void> {
    return this.dev.redeliver(id, deliveryId);
  }
}
