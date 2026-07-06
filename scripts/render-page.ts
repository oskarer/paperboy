// Re-render ONE page from the cached dry-run data. Usage:
//   bun run scripts/render-page.ts <pageNumber> [runJsonPath]
import { readFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { renderPage } from "../src/ai/renderPage.ts";
import type { IssueData } from "../src/types.ts";

const pageNumber = Number(process.argv[2] ?? 1);
const runPath = process.argv[3] ?? "out/dev/run.json";

const issue: IssueData = JSON.parse(readFileSync(runPath, "utf8"));
const page = issue.pages.find((p) => p.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} not found in ${runPath}`);

const guard = new CostGuard(config.issueCostCapUsd);
try {
  await renderPage(page, issue, guard, `out/dev/page-${pageNumber}.png`);
  console.log(`✓ out/dev/page-${pageNumber}.png — cost $${guard.totalUsd().toFixed(4)}`);
} finally {
  const cumulative = guard.appendCumulative("out/dev-ledger.json", `render-page ${pageNumber}`);
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
