import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

const A4 = { width: 595.28, height: 841.89 };

/** Place each page PNG centered and scaled to fit on an A4 page. */
export async function assemblePdf(pngPaths: string[], outPath: string, title = "print-news"): Promise<void> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  for (const path of pngPaths) {
    const image = await doc.embedPng(readFileSync(path));
    const scale = Math.min(A4.width / image.width, A4.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const page = doc.addPage([A4.width, A4.height]);
    page.drawImage(image, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h });
  }
  writeFileSync(outPath, await doc.save());
}
