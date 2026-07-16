// Headless-Chromium lifecycle for the HTML render backend.
// Uses the Playwright browser cache already on disk — playwright-core is pinned
// (see package.json) to the version matching that browser build.
import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { config } from "../../config.ts";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const exe = chromium.executablePath();
  if (!existsSync(exe)) {
    throw new Error(
      `Chromium missing at ${exe} — run: bunx playwright-core install chromium ` +
        `(keep playwright-core pinned so the browser build matches)`,
    );
  }
  browser = await chromium.launch({ headless: true, timeout: 30_000 });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b?.isConnected()) await b.close().catch(() => {});
}

// A crashed render must not leave a zombie chromium behind.
process.once("SIGINT", () => void closeBrowser());
process.once("SIGTERM", () => void closeBrowser());

export async function newRenderPage(): Promise<Page> {
  const { cssWidth, cssHeight, deviceScaleFactor } = config.htmlPage;
  const b = await getBrowser();
  const pg = await b.newPage({ viewport: { width: cssWidth, height: cssHeight }, deviceScaleFactor });
  pg.setDefaultTimeout(15_000);
  return pg;
}

export interface FitMetrics {
  /** Natural height of the page content in CSS px (≥ cssHeight means overflow) */
  contentBottom: number;
  overflowY: number;
  overflowX: boolean;
  /** How far down the content reaches, 1.0 = exactly full */
  fillRatio: number;
  /** Bottom edge of the main region vs the rail — reveals imbalance */
  mainBottom: number;
  railBottom: number | null;
  /** Per row: how far apart the shortest and tallest slot contents end */
  rowImbalance: { row: number; gapPx: number }[];
  /** Rendered line count per headline, by slot index */
  headlineLines: { slot: number; lines: number; scale: number }[];
}

/** Load HTML and measure how well the content fits the fixed page. */
export async function loadAndMeasure(pg: Page, html: string): Promise<FitMetrics> {
  await pg.setContent(html, { waitUntil: "load" });
  await pg.evaluate(async () => {
    await (document as any).fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => img.decode().catch(() => {})),
    );
  });
  return pg.evaluate((cssHeight) => {
    const page = document.getElementById("page")!;
    const pageRect = page.getBoundingClientRect();
    // CSS zoom multiplies rects but not computed lengths — normalize.
    const zoom = parseFloat((getComputedStyle(page) as any).zoom) || 1;
    const padBottom = parseFloat(getComputedStyle(page).paddingBottom) * zoom;
    const innerBottom = pageRect.top + cssHeight - padBottom;

    // Deepest visible bottom edge of actual content (overflow:hidden clips, so
    // scrollHeight alone can't see past the page box — measure children directly).
    let contentBottom = 0;
    let overflowX = false;
    for (const el of page.querySelectorAll<HTMLElement>(".slot, .brief, .photo, .story-body, .headline")) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom);
      if (r.right > pageRect.left + pageRect.width + 1) overflowX = true;
    }

    const regionBottom = (sel: string): number | null => {
      const region = page.querySelector<HTMLElement>(sel);
      if (!region) return null;
      let bottom = region.getBoundingClientRect().top;
      for (const el of region.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      return bottom - pageRect.top;
    };

    const headlineLines = Array.from(document.querySelectorAll<HTMLElement>(".headline")).map((h, i) => {
      const lh = parseFloat(getComputedStyle(h).lineHeight) * zoom;
      return {
        slot: Number(h.closest<HTMLElement>(".slot")?.dataset.slot ?? i),
        lines: lh > 0 ? Math.round(h.getBoundingClientRect().height / lh) : 1,
        scale: Number(h.dataset.scale ?? 0),
      };
    });

    // Where each slot's CONTENT ends (not the grid cell, which stretches to the row).
    const rowEnds = new Map<number, { min: number; max: number; count: number }>();
    for (const slot of page.querySelectorAll<HTMLElement>(".slot")) {
      const row = Number(slot.dataset.row ?? -1);
      let slotContentBottom = slot.getBoundingClientRect().top;
      for (const el of slot.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) slotContentBottom = Math.max(slotContentBottom, r.bottom);
      }
      const cur = rowEnds.get(row) ?? { min: Infinity, max: -Infinity, count: 0 };
      cur.min = Math.min(cur.min, slotContentBottom);
      cur.max = Math.max(cur.max, slotContentBottom);
      cur.count++;
      rowEnds.set(row, cur);
    }
    const rowImbalance = Array.from(rowEnds.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([row, v]) => ({ row, gapPx: Math.round(v.max - v.min) }));

    return {
      contentBottom: contentBottom - pageRect.top,
      overflowY: contentBottom - innerBottom,
      overflowX,
      fillRatio: (contentBottom - pageRect.top) / (innerBottom - pageRect.top),
      mainBottom: regionBottom(".main") ?? 0,
      railBottom: regionBottom(".rail"),
      rowImbalance,
      headlineLines,
    };
  }, config.htmlPage.cssHeight);
}

export async function screenshotPage(pg: Page, outFile: string): Promise<void> {
  const { cssWidth, cssHeight } = config.htmlPage;
  // Clip to the page box — overflowing content can never bleed into print.
  await pg.screenshot({ path: outFile, clip: { x: 0, y: 0, width: cssWidth, height: cssHeight } });
}

/** Vector PDF of the same page — text stays razor sharp at any print resolution. */
export async function pdfPage(pg: Page, outFile: string): Promise<void> {
  const { cssWidth, cssHeight } = config.htmlPage;
  await pg.pdf({
    path: outFile,
    width: `${cssWidth}px`,
    height: `${cssHeight}px`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true, // black section bars, knockout headlines
    scale: 1,
  });
}
