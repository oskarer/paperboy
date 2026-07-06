import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { CostGuard } from "./cost/guard.ts";
import { buildIssueData } from "./pipeline.ts";
import { renderPage } from "./ai/renderPage.ts";
import { assemblePdf } from "./pdf/assemble.ts";
import { printPdf } from "./print.ts";
import type { Settings } from "./settings.ts";
import type { IssueData } from "./types.ts";

export function issueDir(date: string): string {
  return join(config.outDir, date);
}

/** Text phase: fetch → select → scrape → trim. Writes run.json. ~$0.02, no images. */
export async function generateDraft(guard: CostGuard, settings: Settings, now = new Date()): Promise<IssueData> {
  const issue = await buildIssueData(guard, now, settings);
  const dir = issueDir(issue.date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify(issue, null, 2));
  return issue;
}

export function loadDraft(date: string): IssueData {
  return JSON.parse(readFileSync(join(issueDir(date), "run.json"), "utf8"));
}

export function draftPending(date: string): boolean {
  return existsSync(join(issueDir(date), "run.json")) && !existsSync(join(issueDir(date), "issue.pdf"));
}

/** Render phase: pages → PDF → optional auto-print. The expensive part. */
export async function renderIssue(issue: IssueData, guard: CostGuard, settings: Settings): Promise<string> {
  const dir = issueDir(issue.date);
  console.log("⑤ Rendering pages…");
  const pngPaths: string[] = [];
  for (const page of issue.pages) {
    const outFile = join(dir, `page-${page.pageNumber}.png`);
    await renderPage(page, issue, guard, outFile);
    pngPaths.push(outFile);
  }

  console.log("⑥ Assembling PDF…");
  const pdfPath = join(dir, "issue.pdf");
  await assemblePdf(pngPaths, pdfPath, settings.paperName);
  console.log(`✓ ${pdfPath} — total cost $${guard.totalUsd().toFixed(3)} (cap $${config.issueCostCapUsd})`);

  if (settings.printer.autoPrint) {
    console.log("⑦ Printing…");
    const result = await printPdf(pdfPath, settings.printer.printerName);
    // A print failure must never fail the issue — the PDF is already on disk.
    console.log(result.ok ? `   ${result.message}` : `   print failed: ${result.message}`);
  }
  return pdfPath;
}

export function writeLedgers(guard: CostGuard, date: string, label: string): void {
  guard.writeLedger(join(issueDir(date), "cost.json"));
  const cumulative = guard.appendCumulative(join(config.outDir, "dev-ledger.json"), label);
  console.log(`  cumulative spend to date: $${cumulative.toFixed(2)}`);
}
