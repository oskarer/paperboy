import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { IssueData } from "./types.ts";

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-zåäö0-9]+/g, " ").trim();
}

/**
 * Links and titles of every story printed in recent issues, so the same
 * article never runs twice. excludeDate (today) is skipped — regenerating
 * today's issue may reuse today's stories.
 */
export function recentlyPublished(
  excludeDate: string,
  issueCount = config.candidates.historyIssues,
): { links: Set<string>; titles: Set<string> } {
  const links = new Set<string>();
  const titles = new Set<string>();

  let dirs: string[] = [];
  try {
    dirs = readdirSync(config.outDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== excludeDate);
  } catch {
    // out/ missing on first run
  }

  for (const dir of dirs.sort().reverse().slice(0, issueCount)) {
    let issue: IssueData;
    try {
      issue = JSON.parse(readFileSync(join(config.outDir, dir, "run.json"), "utf8"));
    } catch {
      continue; // no run.json (partial/failed issue)
    }
    for (const page of issue.pages ?? []) {
      for (const story of page.stories ?? []) {
        if (story.link) links.add(story.link);
        // sourceTitle is the original feed title; older issues only have the
        // trimmed headline, which usually matches closely enough for exact keys.
        for (const t of [story.sourceTitle, story.headline]) {
          if (t) titles.add(normalizeTitle(t));
        }
      }
    }
  }
  return { links, titles };
}
