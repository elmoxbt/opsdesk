"use client";

import type { JobMediaDto } from "@opsdesk/shared";
import { Camera, CloudUpload, ImageOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { compressPhoto } from "@/offline/compress";
import { useSync } from "@/offline/sync-provider";
import type { OutboxEntry } from "@/offline/types";

type Kind = "BEFORE" | "AFTER";

/**
 * Photos are compressed on the device, queued with the blob in IndexedDB, and
 * shown immediately from a local object URL ("waiting to upload") until the
 * sync engine has PUT them to S3 and the server has confirmed them.
 */
export function PhotosSection({
  jobId,
  media,
  canAdd,
}: {
  jobId: string;
  media: JobMediaDto | undefined;
  canAdd: Record<Kind, boolean>;
}) {
  const { entries, enqueue, discard } = useSync();
  const pending = entries.filter(
    (e): e is Extract<OutboxEntry, { kind: "photo" }> => e.kind === "photo" && e.jobId === jobId,
  );

  return (
    <section aria-labelledby="photos" className="space-y-4 rounded-2xl border bg-card p-4">
      <h2 id="photos" className="font-semibold">
        Photos
      </h2>
      {(["BEFORE", "AFTER"] as const).map((kind) => (
        <PhotoRow
          key={kind}
          kind={kind}
          server={media?.photos.filter((p) => p.kind === kind) ?? []}
          pending={pending.filter((p) => p.photoKind === kind)}
          canAdd={canAdd[kind]}
          onAdd={async (files) => {
            for (const file of files) {
              try {
                const { blob, contentType } = await compressPhoto(file);
                await enqueue({ kind: "photo", jobId, photoKind: kind, blob, contentType });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't add that photo");
              }
            }
          }}
          onDiscard={(id) => void discard(id)}
        />
      ))}
    </section>
  );
}

function PhotoRow({
  kind,
  server,
  pending,
  canAdd,
  onAdd,
  onDiscard,
}: {
  kind: Kind;
  server: JobMediaDto["photos"];
  pending: Array<Extract<OutboxEntry, { kind: "photo" }>>;
  canAdd: boolean;
  onAdd: (files: File[]) => Promise<void>;
  onDiscard: (id: string) => void;
}) {
  const label = kind === "BEFORE" ? "Before" : "After";
  const localUrls = useMemo(
    () => pending.map((p) => ({ id: p.id, url: URL.createObjectURL(p.blob), stuck: p.state !== "pending" })),
    [pending],
  );
  useEffect(() => () => localUrls.forEach((u) => URL.revokeObjectURL(u.url)), [localUrls]);
  const count = server.length + pending.length;

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        {label} <span className="font-mono tabular-nums">({count})</span>
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {server.map((p) => (
          <li key={p.id}>
            <ServerThumb url={p.url} alt={`${label} photo`} />
          </li>
        ))}
        {localUrls.map((u) => (
          <li key={u.id} className="relative">
            <img
              src={u.url}
              alt={`${label} photo, waiting to upload`}
              className="aspect-square w-full rounded-xl object-cover"
            />
            <span className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded-md bg-black/60 py-0.5 text-[10px] text-white">
              <CloudUpload className="size-3" aria-hidden /> {u.stuck ? "Failed" : "Waiting"}
            </span>
            <button
              type="button"
              onClick={() => onDiscard(u.id)}
              className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/60 text-white"
              aria-label={`Remove this ${label.toLowerCase()} photo`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {canAdd && (
          <li>
            <label className="motion-press grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed text-muted-foreground transition-transform active:scale-[0.97] focus-within:outline-2 focus-within:outline-offset-2">
              <span className="flex flex-col items-center gap-1 text-xs font-medium">
                <Camera className="size-6" aria-hidden />
                Add {label.toLowerCase()}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void onAdd(files);
                }}
              />
            </label>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Presigned URLs expire and need signal; show a placeholder instead of a broken image. */
function ServerThumb({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="grid aspect-square place-items-center rounded-xl bg-muted text-muted-foreground"
        role="img"
        aria-label={`${alt} (not available offline)`}
      >
        <ImageOff className="size-5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-square w-full rounded-xl object-cover"
    />
  );
}
