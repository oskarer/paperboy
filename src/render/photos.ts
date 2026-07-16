// Press-photo download shared by both render backends (image gen + HTML).
import { config } from "../config.ts";
import type { PageSpec } from "../types.ts";

export interface Photo {
  buffer: ArrayBuffer;
  mime: string;
  storyIndex: number;
  /** Pixel dimensions parsed from the file header — layout hint, undefined if unparseable */
  width?: number;
  height?: number;
}

export async function downloadPhotos(page: PageSpec): Promise<Photo[]> {
  const photos: Photo[] = [];
  for (const [i, story] of page.stories.entries()) {
    if (!story.imageUrl || photos.length >= config.maxPhotosPerPage) continue;
    try {
      const res = await fetch(story.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      if (!/image\/(jpeg|png|webp)/.test(mime)) continue;
      const buffer = await res.arrayBuffer();
      // SVT's "no photo" fallback is a blurry logo card that compresses tiny — skip those.
      if (buffer.byteLength < 12_000) continue;
      const dims = probeDims(buffer, mime);
      photos.push({ buffer, mime, storyIndex: i, ...dims });
    } catch {
      // photo is optional — skip on any failure
    }
  }
  return photos;
}

export function toDataUri(photo: Photo): string {
  return `data:${photo.mime};base64,${Buffer.from(photo.buffer).toString("base64")}`;
}

/** Parse pixel dimensions from JPEG/PNG/WebP headers — no image library needed. */
export function probeDims(
  buffer: ArrayBuffer,
  mime: string,
): { width: number; height: number } | undefined {
  const b = new DataView(buffer);
  try {
    if (mime === "image/png" && b.getUint32(12) === 0x49484452 /* IHDR */) {
      return { width: b.getUint32(16), height: b.getUint32(20) };
    }
    if (mime === "image/jpeg") {
      // Walk segment markers to the first SOFn frame header.
      let off = 2;
      while (off + 9 < b.byteLength) {
        if (b.getUint8(off) !== 0xff) break;
        const marker = b.getUint8(off + 1);
        const size = b.getUint16(off + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isSof) return { height: b.getUint16(off + 5), width: b.getUint16(off + 7) };
        off += 2 + size;
      }
    }
    if (mime === "image/webp" && b.getUint32(8) === 0x57454250 /* WEBP */) {
      const fourcc = b.getUint32(12);
      if (fourcc === 0x56503858 /* VP8X */) {
        const w = b.getUint8(24) | (b.getUint8(25) << 8) | (b.getUint8(26) << 16);
        const h = b.getUint8(27) | (b.getUint8(28) << 8) | (b.getUint8(29) << 16);
        return { width: w + 1, height: h + 1 };
      }
      if (fourcc === 0x56503820 /* "VP8 " lossy */) {
        return { width: b.getUint16(26, true) & 0x3fff, height: b.getUint16(28, true) & 0x3fff };
      }
    }
  } catch {
    // dimension probe is best-effort
  }
  return undefined;
}
