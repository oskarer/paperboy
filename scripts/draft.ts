// Draft only: text pipeline → out/<date>/run.json. No image spend (~$0.02).
// Used by schedule mode "approve" — rendering happens after phone approval.
import { config } from "../src/config.ts";
import { CostGuard } from "../src/cost/guard.ts";
import { loadSettings } from "../src/settings.ts";
import { generateDraft, writeLedgers } from "../src/issue.ts";

const settings = loadSettings();
const guard = new CostGuard(config.issueCostCapUsd);
let date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(new Date());

try {
  const issue = await generateDraft(guard, settings);
  date = issue.date;
  const stories = issue.pages.reduce((n, p) => n + p.stories.length, 0);
  console.log(`✓ draft ${date}: ${stories} stories, waiting for approval ($${guard.totalUsd().toFixed(3)})`);
} finally {
  writeLedgers(guard, date, `draft ${date}`);
}
