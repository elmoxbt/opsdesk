"use client";

import type { JobDto, JobMediaDto } from "@opsdesk/shared";
import { BottomSheet } from "@opsdesk/ui/bottom-sheet";
import { Button } from "@opsdesk/ui/button";
import { Field } from "@opsdesk/ui/field";
import { Input } from "@opsdesk/ui/input";
import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { useSync } from "@/offline/sync-provider";

/**
 * Sign-off: who signed + their signature, then queue the completion. It
 * applies on the server as one transaction (status + signature) whenever there's signal.
 * Gentle warnings, not blockers: the technician knows the job; the office sees the record.
 */
export function CompleteSheet({
  open,
  onOpenChange,
  server,
  view,
  media,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  server: JobDto;
  view: JobDto;
  media: JobMediaDto | undefined;
  onCompleted: () => void;
}) {
  const { enqueue, entries } = useSync();
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(server.customer.name);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);

  const unticked = view.checklist.filter((i) => !i.done).length;
  const afterPhotos =
    (media?.photos.filter((p) => p.kind === "AFTER").length ?? 0) +
    entries.filter((e) => e.kind === "photo" && e.jobId === server.id && e.photoKind === "AFTER").length;

  const submit = async () => {
    const signature = await pad.current?.toBlob();
    if (!signature || !name.trim()) return;
    setBusy(true);
    try {
      await enqueue({
        kind: "complete",
        jobId: server.id,
        version: server.version,
        signedByName: name.trim(),
        signature,
      });
      onOpenChange(false);
      onCompleted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Complete job"
      description="Get the customer's sign-off."
      footer={
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={!signed || !name.trim()}
          loading={busy}
          onClick={() => void submit()}
        >
          Complete job
        </Button>
      }
    >
      <div className="space-y-4">
        {(unticked > 0 || afterPhotos === 0) && (
          <ul className="space-y-1 rounded-xl bg-status-en-route/10 p-3 text-sm">
            {unticked > 0 && (
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-en-route" aria-hidden />
                {unticked} checklist item{unticked === 1 ? " isn't" : "s aren't"} ticked.
              </li>
            )}
            {afterPhotos === 0 && (
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-en-route" aria-hidden />
                No "after" photos yet.
              </li>
            )}
          </ul>
        )}
        <Field label="Customer name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            className="h-11 text-base"
          />
        </Field>
        <SignaturePad ref={pad} label="Customer signature" onChange={setSigned} />
      </div>
    </BottomSheet>
  );
}
