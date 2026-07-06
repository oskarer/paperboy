// Re-render ONE page from the cached dry-run data. Usage:
//   bun run scripts/render-page.ts <pageNumber> [runJsonPath] [styleId]
import { readFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { renderPage } from "../src/ai/renderPage.ts";
import { STYLE_IDS, type StyleId } from "../src/styles.ts";
import type { IssueData } from "../src/types.ts";

const pageNumber = Number(process.argv[2] ?? 1);
const runPath = process.argv[3] ?? "out/dev/run.json";
const style = process.argv[4] as StyleId | undefined;
if (style && !STYLE_IDS.includes(style)) throw new Error(`unknown style "${style}" (${STYLE_IDS.join(", ")})`);

const issue: IssueData = JSON.parse(readFileSync(runPath, "utf8"));
const page = issue.pages.find((p) => p.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} not found in ${runPath}`);

const guard = new CostGuard(config.issueCostCapUsd);
const outFile = `out/dev/page-${pageNumber}${style ? `-${style}` : ""}.png`;
try {
  await renderPage(page, issue, guard, outFile, style);
  console.log(`✓ ${outFile} — cost $${guard.totalUsd().toFixed(4)}`);
} finally {
  const cumulative = guard.appendCumulative("out/dev-ledger.json", `render-page ${pageNumber}${style ? ` (${style})` : ""}`);
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
