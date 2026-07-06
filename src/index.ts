// Full issue generation: text pipeline + page rendering + PDF (+ auto-print).
import { config } from "./config.ts";
import { CostGuard } from "./cost/guard.ts";
import { loadSettings } from "./settings.ts";
import { generateDraft, renderIssue, writeLedgers } from "./issue.ts";

const settings = loadSettings();
const guard = new CostGuard(config.issueCostCapUsd);
const now = new Date();
let date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(now);

try {
  const issue = await generateDraft(guard, settings, now);
  date = issue.date;
  await renderIssue(issue, guard, settings);
} finally {
  writeLedgers(guard, date, `issue ${date}`);
}
