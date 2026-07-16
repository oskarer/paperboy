// Re-render ONE page from the cached dry-run data. Usage:
//   bun run scripts/render-page.ts <pageNumber> [runJsonPath] [styleId|-] [backend]
//   backend: image | html (default: settings.renderBackend)
import { readFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { closeBrowser, renderPage, type RenderBackend } from "../src/render/index.ts";
import { STYLE_IDS, type StyleId } from "../src/styles.ts";
import type { IssueData } from "../src/types.ts";

const pageNumber = Number(process.argv[2] ?? 1);
const runPath = process.argv[3] ?? "out/dev/run.json";
const styleArg = process.argv[4];
const style = styleArg && styleArg !== "-" ? (styleArg as StyleId) : undefined;
if (style && !STYLE_IDS.includes(style)) throw new Error(`unknown style "${style}" (${STYLE_IDS.join(", ")})`);
const backend = process.argv[5] as RenderBackend | undefined;
if (backend && !["image", "html"].includes(backend)) throw new Error(`unknown backend "${backend}" (image, html)`);

const issue: IssueData = JSON.parse(readFileSync(runPath, "utf8"));
const page = issue.pages.find((p) => p.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} not found in ${runPath}`);

const guard = new CostGuard(config.issueCostCapUsd);
const outFile = `out/dev/page-${pageNumber}${style ? `-${style}` : ""}${backend === "html" ? "-html" : ""}.png`;
try {
  // Dev tool: fail loudly, never silently fall back to the other backend.
  await renderPage(page, issue, guard, outFile, { style, backend, fallback: false });
  console.log(`✓ ${outFile} — cost $${guard.totalUsd().toFixed(4)}`);
} finally {
  await closeBrowser();
  const cumulative = guard.appendCumulative("out/dev-ledger.json", `render-page ${pageNumber}${style ? ` (${style})` : ""}`);
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
