import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { CostGuard } from "./cost/guard.ts";
import { buildIssueData } from "./pipeline.ts";
import { renderPage } from "./ai/renderPage.ts";
import { assemblePdf } from "./pdf/assemble.ts";
import { loadSettings } from "./settings.ts";
import { printPdf } from "./print.ts";

const settings = loadSettings();
const guard = new CostGuard(config.issueCostCapUsd);
const now = new Date();
const dateStr = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(now);
const issueDir = join(config.outDir, dateStr);
mkdirSync(issueDir, { recursive: true });

try {
  const issue = await buildIssueData(guard, now, settings);
  writeFileSync(join(issueDir, "run.json"), JSON.stringify(issue, null, 2));

  console.log("⑤ Rendering pages…");
  const pngPaths: string[] = [];
  for (const page of issue.pages) {
    const outFile = join(issueDir, `page-${page.pageNumber}.png`);
    await renderPage(page, issue, guard, outFile);
    pngPaths.push(outFile);
  }

  console.log("⑥ Assembling PDF…");
  const pdfPath = join(issueDir, "issue.pdf");
  await assemblePdf(pngPaths, pdfPath, settings.paperName);

  console.log(`✓ ${pdfPath} — total cost $${guard.totalUsd().toFixed(3)} (cap $${config.issueCostCapUsd})`);

  if (settings.printer.autoPrint) {
    console.log("⑦ Printing…");
    const result = await printPdf(pdfPath, settings.printer.printerName);
    // A print failure must never fail the issue — the PDF is already on disk.
    console.log(result.ok ? `   ${result.message}` : `   print failed: ${result.message}`);
  }
} finally {
  guard.writeLedger(join(issueDir, "cost.json"));
  const cumulative = guard.appendCumulative(join(config.outDir, "dev-ledger.json"), `issue ${dateStr}`);
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
