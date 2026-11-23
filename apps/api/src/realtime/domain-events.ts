import { Global, Injectable, Module } from "@nestjs/common";
import type { InvoicePaidEvent, JobChangeKind, JobDto } from "@opsdesk/shared";
import { Observable, Subject } from "rxjs";

export interface JobChanged {
  type: "job.changed";
  organizationId: string;
  kind: JobChangeKind;
  job: JobDto;
  /** Set when a job moved away from a technician, so they're told too. */
  previousTechnicianId: string | null;
  actorId: string | null;
}

export interface UserDeactivated {
  type: "user.deactivated";
  organizationId: string;
  userId: string;
}

/** Money arrived on an invoice (any channel: webhook, manual entry). */
export interface InvoicePaid {
  type: "invoice.paid";
  organizationId: string;
  event: InvoicePaidEvent;
}

export type DomainEvent = JobChanged | UserDeactivated | InvoicePaid;

/**
 * In-process event bus. Services publish facts AFTER their transaction commits
 * (never inside it), so nobody is told about a change that later rolls back.
 * Subscribers today: the realtime gateway. Later: outgoing webhooks (Phase 8) via BullMQ.
 */
@Injectable()
export class DomainEvents {
  private readonly subject = new Subject<DomainEvent>();
  readonly stream$: Observable<DomainEvent> = this.subject.asObservable();

  publish(event: DomainEvent): void {
    this.subject.next(event);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
