import { Logger } from "@nestjs/common";
import type { MailMessage, MailProvider } from "./mail.provider";

export class ConsoleMailProvider implements MailProvider {
  private readonly logger = new Logger("Mail");

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`\n--- email to ${message.to} ---\nSubject: ${message.subject}\n\n${message.text}\n---`);
  }
}
