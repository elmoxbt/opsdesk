"use client";

import { formatMoney, type JobMediaDto, type JobPartDto } from "@opsdesk/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { useFeature } from "@opsdesk/ui/client-config";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { useId, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { useJobMedia, useJobParts } from "@/lib/api/hooks";

/** Photos, signature and parts from the technician app (each card only if its feature is on). */
export function FieldWork({ jobId }: { jobId: string }) {
  const photosOn = useFeature("technicianApp");
  const partsOn = useFeature("inventory");
  const media = useJobMedia(jobId, photosOn);
  const parts = useJobParts(jobId, partsOn);
  if (!photosOn && !partsOn) return null;
  return (
    <>
      {photosOn && <PhotosCard media={media.data} loading={media.isPending} />}
      {partsOn && <PartsCard parts={parts.data} loading={parts.isPending} />}
    </>
  );
}

function PhotosCard({ media, loading }: { media: JobMediaDto | undefined; loading: boolean }) {
  const before = media?.photos.filter((p) => p.kind === "BEFORE") ?? [];
  const after = media?.photos.filter((p) => p.kind === "AFTER") ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        {media && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{media.photos.length}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <Skeleton className="aspect-[4/3] rounded-xl" />
        ) : media && media.photos.length === 0 && !media.signature ? (
          <p className="text-sm text-muted-foreground">
            No photos yet. Technicians add them from the app on site.
          </p>
        ) : (
          <>
            {before[0] && after[0] && <BeforeAfter before={before[0].url} after={after[0].url} />}
            {(["Before", "After"] as const).map((label) => {
              const list = label === "Before" ? before : after;
              return list.length > 0 ? (
                <div key={label}>
                  <p className="mb-2 text-sm text-muted-foreground">{label}</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {list.map((p) => (
                      <li key={p.id}>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg"
                        >
                          <img
                            src={p.url}
                            alt={`${label} photo by ${p.uploadedBy?.name ?? "technician"}`}
                            loading="lazy"
                            className="aspect-square w-full object-cover transition-transform duration-200 hover:scale-[1.03]"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })}
            {media?.signature && (
              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground">Signed off by</p>
                <p className="font-medium">{media.signature.signedByName}</p>
                <img
                  src={media.signature.url}
                  alt={`Signature of ${media.signature.signedByName}`}
                  className="mt-2 h-20 rounded-lg border bg-white object-contain p-1"
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Drag (or arrow-key) comparison of the first before/after pair. A native range
 * input drives it, so keyboard and screen-reader users get it for free.
 */
export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted select-none">
        <img src={before} alt="Before" className="absolute inset-0 size-full object-cover" />
        <img
          src={after}
          alt="After"
          className="absolute inset-0 size-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]"
          style={{ left: `${pos}%` }}
          aria-hidden
        >
          <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-zinc-900 shadow-md">
            ⇆
          </span>
        </div>
        <span className="absolute top-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
          Before
        </span>
        <span className="absolute top-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
          After
        </span>
      </div>
      <label htmlFor={id} className="sr-only">
        Compare before and after
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="w-full accent-[var(--brand)]"
      />
    </div>
  );
}

function PartsCard({ parts, loading }: { parts: JobPartDto[] | undefined; loading: boolean }) {
  const { organization } = useSession();
  const total = (parts ?? []).reduce((sum, p) => sum + p.quantity * p.unitCostMinor, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parts used</CardTitle>
        {parts && parts.length > 0 && (
          <span className="font-mono text-sm tabular-nums">{formatMoney(total, organization.currency)}</span>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16" />
        ) : !parts?.length ? (
          <p className="text-sm text-muted-foreground">No parts recorded.</p>
        ) : (
          <ul className="divide-y text-sm">
            {parts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="flex-1">
                  {p.item.name} <span className="font-mono text-xs text-muted-foreground">{p.item.sku}</span>
                </span>
                <span className="font-mono tabular-nums">×{p.quantity}</span>
                <span className="w-24 text-right font-mono tabular-nums text-muted-foreground">
                  {formatMoney(p.quantity * p.unitCostMinor, organization.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
