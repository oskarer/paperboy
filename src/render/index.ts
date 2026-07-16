// Render backend dispatcher — the one entry point callers use.
import { loadSettings } from "../settings.ts";
import type { StyleId } from "../styles.ts";
import type { IssueData, PageSpec } from "../types.ts";
import type { CostGuard } from "../cost/guard.ts";
import { renderPage as renderPageImage } from "../ai/renderPage.ts";
import { renderPageHtml } from "./html/renderPage.ts";

export { closeBrowser } from "./html/chromium.ts";

export type RenderBackend = "image" | "html";

export interface RenderOpts {
  style?: StyleId;
  backend?: RenderBackend;
  /** Fall back to the image backend if the HTML backend fails (unattended runs) */
  fallback?: boolean;
}

export async function renderPage(
  page: PageSpec,
  issue: IssueData,
  guard: CostGuard,
  outFile: string,
  opts: RenderOpts = {},
): Promise<void> {
  const backend = opts.backend ?? loadSettings().renderBackend;
  if (backend !== "html") {
    return renderPageImage(page, issue, guard, outFile, opts.style);
  }
  try {
    return await renderPageHtml(page, issue, guard, outFile, opts.style);
  } catch (err) {
    if (!opts.fallback) throw err;
    // A missing morning paper is worse than a page from the old backend.
    console.warn(
      `   HTML-rendering misslyckades: ${err instanceof Error ? err.message : err} — faller tillbaka till bildmotorn`,
    );
    return renderPageImage(page, issue, guard, outFile, opts.style);
  }
}
