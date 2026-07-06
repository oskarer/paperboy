import Parser from "rss-parser";
import { config } from "../config.ts";
import { inferSection, type Source } from "../sources.ts";
import type { Candidate } from "../types.ts";

type FeedItem = Parser.Item & {
  enclosure?: { url?: string };
  mediaContent?: { $?: { url?: string } };
  summary?: string;
};

function cleanText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/Lyssna:.*$/m, "") // SR appends an audio link to its content
    .replace(/\s+/g, " ")
    .trim();
}

function feedImage(item: FeedItem): string | undefined {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  const img = (item.content ?? "").match(/<img[^>]+src="([^"]+)"/)?.[1];
  return img?.startsWith("http") ? img : undefined;
}

export async function fetchCandidates(
  sources: Source[],
  since: Date = new Date(Date.now() - config.candidates.maxAgeHours * 3_600_000),
): Promise<Candidate[]> {
  const parser = new Parser({
    timeout: 15_000,
    customFields: { item: [["media:content", "mediaContent"], "enclosure", "summary"] },
  });
  const { maxPerSource } = config.candidates;
  const cutoff = since.getTime();
  const seen = new Set<string>();
  const all: Candidate[] = [];
  let id = 0;

  // One fetch job per (enabled source × its feeds).
  const jobs = sources
    .filter((s) => s.enabled)
    .flatMap((source) => source.feeds.map((feedUrl) => ({ source, feedUrl })));
  const results = await Promise.allSettled(
    jobs.map(async ({ feedUrl }) => {
      // Bun's fetch handles forced gzip (e.g. gp.se); parse the string.
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "print-news/1.0 (personal morning paper)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parser.parseString(await res.text());
    }),
  );

  for (const [i, result] of results.entries()) {
    const { source, feedUrl } = jobs[i]!;
    if (result.status === "rejected") {
      console.error(`rss: failed to fetch ${feedUrl}: ${result.reason}`);
      continue;
    }
    const candidates = (result.value.items as FeedItem[])
      .map((item) => {
        const link = item.link ?? "";
        return {
          guid: item.guid ?? link,
          section: inferSection(link),
          sourceUrl: source.url,
          attribution: source.name,
          title: cleanText(item.title),
          description: cleanText(item.contentSnippet ?? item.content ?? item.summary).slice(0, 300),
          link,
          publishedAt: item.isoDate ?? item.pubDate ?? "",
          feedImageUrl: feedImage(item),
        };
      })
      .filter((c) => c.guid && c.link && c.title)
      .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1));

    // Only news published after the previous issue — no keep-old fallback:
    // stale stories must never reappear in a later issue.
    const kept = candidates.filter((c) => new Date(c.publishedAt).getTime() >= cutoff).slice(0, maxPerSource);

    for (const c of kept) {
      // Dedupe on guid and title — the same wire story often runs in several papers.
      const titleKey = c.title.toLowerCase().replace(/[^a-zåäö0-9]+/g, " ").trim();
      if (seen.has(c.guid) || seen.has(titleKey)) continue;
      seen.add(c.guid);
      seen.add(titleKey);
      all.push({ id: id++, ...c });
    }
  }
  return all;
}
