import { z } from "zod";
import { paginationQuerySchema, searchQuery } from "./common";

// ---------------------------------------------------------------------------
// Photos & signatures (direct-to-S3 uploads)
// ---------------------------------------------------------------------------

export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_KINDS = ["BEFORE", "AFTER", "SIGNATURE"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Step 1: ask the API for a short-lived presigned PUT URL. */
export const uploadRequestSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.enum(PHOTO_CONTENT_TYPES, { message: "Only JPEG, PNG or WebP images" }),
  sizeBytes: z.int().min(1).max(MAX_UPLOAD_BYTES, "Images must be 10 MB or smaller"),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

/** Step 3: after the browser PUTs to S3, confirm so the API verifies and records it. */
export const confirmPhotoSchema = z.object({
  key: z.string().min(10).max(300),
  kind: z.enum(["BEFORE", "AFTER"]),
});
export type ConfirmPhotoInput = z.infer<typeof confirmPhotoSchema>;

/** Technician completion: signature (already uploaded) + who signed, version-checked. */
export const completeJobSchema = z.object({
  signatureKey: z.string().min(10).max(300),
  signedByName: z.string().trim().min(1, "Enter the customer's name").max(100),
  version: z.int().min(1),
});
export type CompleteJobInput = z.infer<typeof completeJobSchema>;

// ---------------------------------------------------------------------------
// Checklist, parts, inventory
// ---------------------------------------------------------------------------

/** Per-item toggle: commutative, so two people ticking different items never conflict. */
export const checklistItemPatchSchema = z.object({ done: z.boolean() });

/** `id` is generated on the device, which makes "add part" idempotent across offline replays. */
export const addPartSchema = z.object({
  id: z.uuid(),
  inventoryItemId: z.uuid("Choose a part"),
  quantity: z.coerce.number().int().min(1, "At least 1").max(1000),
});
export type AddPartInput = z.input<typeof addPartSchema>;

export const inventoryItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "SKU is required")
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9-_.]*$/, "Letters, numbers, - _ . only"),
  quantity: z.coerce.number().int().min(0, "Cannot be negative").max(1_000_000),
  reorderThreshold: z.coerce.number().int().min(0).max(1_000_000),
  unitCostMinor: z.coerce.number().int().min(0).max(1_000_000_000),
});
export type InventoryItemInput = z.input<typeof inventoryItemInputSchema>;
export type InventoryItemData = z.output<typeof inventoryItemInputSchema>;

export const inventoryListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery,
  lowStock: z.stringbool().optional(),
});
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
