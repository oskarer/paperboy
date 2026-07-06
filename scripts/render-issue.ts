// Render an approved draft: out/<date>/run.json → pages + PDF (+ auto-print).
// Usage: bun run scripts/render-issue.ts [YYYY-MM-DD]
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { loadSettings } from "../src/settings.ts";
import { loadDraft, renderIssue, writeLedgers } from "../src/issue.ts";

const date = process.argv[2] ?? new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(new Date());
const settings = loadSettings();
const guard = new CostGuard(config.issueCostCapUsd);

try {
  const issue = loadDraft(date);
  await renderIssue(issue, guard, settings);
} finally {
  writeLedgers(guard, date, `render ${date}`);
}
