import Parser from "rss-parser";
import { config } from "../config.ts";
import { enabledSources, inferSection, type SourceDef } from "../sources.ts";
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

export async function fetchCandidates(sourceToggles: Record<string, boolean> = {}): Promise<Candidate[]> {
  const parser = new Parser({
    timeout: 15_000,
    customFields: { item: [["media:content", "mediaContent"], "enclosure", "summary"] },
  });
  const { maxAgeHours, minPerSource, maxPerSource } = config.candidates;
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const seen = new Set<string>();
  const all: Candidate[] = [];
  let id = 0;

  const sources = enabledSources(sourceToggles);
  // Fetch with Bun's fetch (handles forced gzip, e.g. gp.se) and parse the string.
  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const res = await fetch(s.feedUrl, {
        headers: { "User-Agent": "print-news/1.0 (personal morning paper)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parser.parseString(await res.text());
    }),
  );

  for (const [i, result] of results.entries()) {
    const source = sources[i] as SourceDef;
    if (result.status === "rejected") {
      console.error(`rss: failed to fetch ${source.id}: ${result.reason}`);
      continue;
    }
    // rss-only sources carry their whole story text in the feed — keep more of it.
    const descriptionCap = source.strategy === "rss-only" ? 1500 : 300;
    const candidates = (result.value.items as FeedItem[])
      .map((item) => {
        const link = item.link ?? "";
        const categories = (item.categories ?? []).map(String);
        return {
          guid: item.guid ?? link,
          section: source.inferSection ? inferSection(link, categories) : source.section,
          sourceId: source.id,
          attribution: source.attribution,
          title: cleanText(item.title),
          description: cleanText(item.contentSnippet ?? item.content ?? item.summary).slice(0, descriptionCap),
          link,
          publishedAt: item.isoDate ?? item.pubDate ?? "",
          feedImageUrl: feedImage(item),
        };
      })
      .filter((c) => c.guid && c.link && c.title)
      .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1));

    const fresh = candidates.filter((c) => new Date(c.publishedAt).getTime() >= cutoff);
    // Thin news days: always keep at least the newest N per source.
    const kept = (fresh.length >= minPerSource ? fresh : candidates.slice(0, minPerSource)).slice(0, maxPerSource);

    for (const c of kept) {
      // Dedupe on guid and title — the same wire story often runs in several papers
      // (Schibsted syndicates identical articles to Aftonbladet and SvD).
      const titleKey = c.title.toLowerCase().replace(/[^a-zåäö0-9]+/g, " ").trim();
      if (seen.has(c.guid) || seen.has(titleKey)) continue;
      seen.add(c.guid);
      seen.add(titleKey);
      all.push({ id: id++, ...c });
    }
  }
  return all;
}
