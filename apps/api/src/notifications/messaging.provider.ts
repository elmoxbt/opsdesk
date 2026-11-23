import { Logger } from "@nestjs/common";

/**
 * Text-message channels (SMS, WhatsApp). Same shape, separate tokens, so a
 * deployment can use Termii for SMS and Meta's Cloud API for WhatsApp, or
 * neither. Business code never imports a vendor SDK.
 */
export interface TextMessage {
  /** E.164-ish phone number, as the customer gave it. */
  to: string;
  text: string;
}

export interface MessagingProvider {
  send(message: TextMessage): Promise<void>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");

/** Local/dev stand-in: logs what would have been sent. */
export class ConsoleMessagingProvider implements MessagingProvider {
  private readonly logger: Logger;
  constructor(channel: string) {
    this.logger = new Logger(channel);
  }
  async send(m: TextMessage): Promise<void> {
    this.logger.log(`to ${m.to}: ${m.text}`);
  }
}
