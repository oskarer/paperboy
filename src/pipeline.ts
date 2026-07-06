import { config } from "./config.ts";
import { loadSettings, type Settings } from "./settings.ts";
import { normalizeTitle, recentlyPublished } from "./history.ts";
import { fetchCandidates } from "./fetch/rss.ts";
import { scrapeArticle } from "./fetch/scrape.ts";
import { selectStories, type SelectedPage, type SelectedStory } from "./ai/select.ts";
import { trimStory, trimAll } from "./ai/trim.ts";
import type { CostGuard } from "./cost/guard.ts";
import type { IssueData, PageSpec, ScrapedArticle, Story } from "./types.ts";

function svDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function isoDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(date); // YYYY-MM-DD
}

/** Runs the full text pipeline: fetch → select → scrape → trim. No image spend. */
export async function buildIssueData(
  guard: CostGuard,
  now = new Date(),
  settings: Settings = loadSettings(),
): Promise<IssueData> {
  console.log("① Fetching feeds…");
  const fetched = await fetchCandidates(settings.sources);

  // Never print an article that already ran in a recent issue.
  const history = recentlyPublished(isoDate(now));
  const candidates = fetched.filter(
    (c) => !history.links.has(c.link) && !history.titles.has(normalizeTitle(c.title)),
  );
  const skipped = fetched.length - candidates.length;
  if (skipped > 0) console.log(`   ${skipped} already printed in recent issues — skipped`);

  if (candidates.length < 20) throw new Error(`only ${candidates.length} candidates fetched — feeds down?`);
  const sourceCount = new Set(candidates.map((c) => c.sourceId)).size;
  console.log(`   ${candidates.length} candidates from ${sourceCount} feeds`);

  console.log("② Selecting stories…");
  const selectedPages = await selectStories(candidates, guard, settings);
  const picked = selectedPages.flatMap((p) => p.stories);
  console.log(`   ${picked.length} stories across ${selectedPages.length} pages ($${guard.totalUsd().toFixed(3)})`);

  console.log("③ Scraping articles…");
  const scraped = new Map<number, ScrapedArticle>();
  await trimAll(picked, async (s: SelectedStory) => {
    const article = await scrapeArticle(s.candidate);
    if (article && (article.lead || article.paragraphs.length > 0)) scraped.set(s.candidate.id, article);
  });

  console.log("④ Trimming texts…");
  const stories = new Map<number, Story>();
  await trimAll(picked, async (s: SelectedStory) => {
    // rss-only sources (and failed scrapes) fall back to the RSS teaser as body.
    const article: ScrapedArticle = scraped.get(s.candidate.id) ?? {
      headline: s.candidate.title,
      lead: s.candidate.description,
      paragraphs: [],
      imageUrls: [],
    };
    const trimmed = await trimStory(article, s.targetWords, guard);
    stories.set(s.candidate.id, {
      candidateId: s.candidate.id,
      section: s.candidate.section,
      attribution: s.candidate.attribution,
      link: s.candidate.link,
      role: s.role,
      headline: trimmed.headline,
      sourceTitle: s.candidate.title,
      body: trimmed.body,
      imageUrl: article.imageUrls[0] ?? s.candidate.feedImageUrl,
    });
  });

  const usedImageUrls = new Set<string>();
  const pages: PageSpec[] = selectedPages.map((p: SelectedPage) => {
    const pageStories = p.stories
      .map((s) => stories.get(s.candidate.id))
      .filter((s): s is Story => Boolean(s))
      .sort((a, b) => roleRank(a) - roleRank(b));
    // Only lead/secondary stories keep their photo (briefs are text-only notiser),
    // and a photo URL may only appear once in the whole issue (repeats = placeholder cards).
    let photos = 0;
    for (const story of pageStories) {
      const eligible = story.role !== "brief" && story.imageUrl && !usedImageUrls.has(story.imageUrl);
      if (eligible && photos < config.maxPhotosPerPage) {
        usedImageUrls.add(story.imageUrl!);
        photos++;
      } else {
        story.imageUrl = undefined;
      }
    }
    return { pageNumber: p.pageNumber, title: p.title, stories: pageStories };
  });

  console.log(`   text pipeline done ($${guard.totalUsd().toFixed(3)})`);
  return { date: isoDate(now), dateSv: svDate(now), pages };
}

function roleRank(s: Story): number {
  return s.role === "lead" ? 0 : s.role === "secondary" ? 1 : 2;
}
