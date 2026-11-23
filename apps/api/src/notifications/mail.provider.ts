/**
 * Provider interface: business code depends on this, never on a vendor SDK.
 * Locally it logs to the console; Resend/SMTP implementations plug in later
 * without touching callers.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");
