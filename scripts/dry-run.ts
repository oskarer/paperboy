// Text pipeline only (fetch → select → scrape → trim). No image spend.
// Result is cached in out/dev/run.json for cheap single-page render iterations.
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { buildIssueData } from "../src/pipeline.ts";

const guard = new CostGuard(config.issueCostCapUsd);
try {
  const issue = await buildIssueData(guard);
  mkdirSync("out/dev", { recursive: true });
  writeFileSync("out/dev/run.json", JSON.stringify(issue, null, 2));
  for (const page of issue.pages) {
    console.log(
      `  page ${page.pageNumber} ${page.title}: ` +
        page.stories.map((s) => `[${s.role}${s.imageUrl ? "+📷" : ""}] ${s.headline}`).join(" | "),
    );
  }
  console.log(`✓ out/dev/run.json — text cost $${guard.totalUsd().toFixed(4)}`);
} finally {
  const cumulative = guard.appendCumulative("out/dev-ledger.json", "dry-run");
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
