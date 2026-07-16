import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

const A4 = { width: 595.28, height: 841.89 };

/**
 * Assemble the issue PDF. For each page, a vector PDF twin (page-N.pdf, written
 * by the HTML backend) is preferred — text stays sharp at print resolution.
 * Pages without one (image backend) fall back to embedding the PNG.
 */
export async function assemblePdf(pngPaths: string[], outPath: string, title = "print-news"): Promise<void> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  for (const path of pngPaths) {
    const vectorPath = path.replace(/\.png$/, ".pdf");
    const page = doc.addPage([A4.width, A4.height]);
    if (existsSync(vectorPath)) {
      const [embedded] = await doc.embedPdf(readFileSync(vectorPath));
      const scale = Math.min(A4.width / embedded!.width, A4.height / embedded!.height);
      const w = embedded!.width * scale;
      const h = embedded!.height * scale;
      page.drawPage(embedded!, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h });
    } else {
      const image = await doc.embedPng(readFileSync(path));
      const scale = Math.min(A4.width / image.width, A4.height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h });
    }
  }
  writeFileSync(outPath, await doc.save());
}
