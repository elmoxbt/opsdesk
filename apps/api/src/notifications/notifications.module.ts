import { Global, Module } from "@nestjs/common";
import { ConsoleMailProvider } from "./console-mail.provider";
import { JobNotificationsListener } from "./job-notifications.listener";
import { MAIL_PROVIDER } from "./mail.provider";
import { ConsoleMessagingProvider, SMS_PROVIDER, WHATSAPP_PROVIDER } from "./messaging.provider";
import { NotificationService } from "./notification.service";
import { NotificationsController } from "./notifications.controller";

/**
 * Providers are swapped per deployment by binding a different class to the
 * token (Resend/SMTP for mail, Termii/Twilio for SMS, Meta Cloud API for
 * WhatsApp). Locally all three log to the console.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: MAIL_PROVIDER, useClass: ConsoleMailProvider },
    { provide: SMS_PROVIDER, useValue: new ConsoleMessagingProvider("SMS") },
    { provide: WHATSAPP_PROVIDER, useValue: new ConsoleMessagingProvider("WhatsApp") },
    NotificationService,
    JobNotificationsListener,
  ],
  exports: [MAIL_PROVIDER, SMS_PROVIDER, WHATSAPP_PROVIDER, NotificationService],
})
export class NotificationsModule {}
