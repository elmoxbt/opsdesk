import { MAX_UPLOAD_BYTES, PHOTO_CONTENT_TYPES } from "@opsdesk/shared";

/**
 * Phone photos are 3–12 MB. Downscaling to 1600px JPEG before queueing makes
 * uploads ~10× smaller (it matters on mobile data and in IndexedDB) while
 * staying clear enough for before/after evidence. Orientation is applied from EXIF.
 */
export async function compressPhoto(
  file: File,
  maxDim = 1600,
  quality = 0.8,
): Promise<{ blob: Blob; contentType: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob) return { blob, contentType: "image/jpeg" };
  } catch {
    // e.g. HEIC on browsers that can't decode it: fall through and try the original.
  }
  if ((PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type) && file.size <= MAX_UPLOAD_BYTES) {
    return { blob: file, contentType: file.type };
  }
  throw new Error("This photo format isn't supported. Take the photo with the camera, or choose a JPEG/PNG.");
}
