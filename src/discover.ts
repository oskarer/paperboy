import { load } from "cheerio";
import Parser from "rss-parser";
import { detectStrategy, hostOf, normalizeUrl, type ScrapeStrategy } from "./sources.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

const PROBE_PATHS = ["/rss", "/rss.xml", "/feed", "/feed/", "/feed.xml", "/rss/nyheter", "/atom.xml"];

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** True if the body parses as a feed with at least one item. */
async function isValidFeed(url: string, parser: Parser): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const body = await res.text();
    if (!/^\s*<\?xml|^\s*<(rss|feed)/i.test(body)) return false; // reject SPA 200-HTML
    const feed = await parser.parseString(body);
    return (feed.items?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function deriveName(html: string, host: string): string {
  const $ = load(html);
  const site = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (site) return site;
  const title = $('meta[property="og:title"]').attr("content")?.trim();
  if (title) return title.split(/[|–—,]/)[0]!.trim();
  const bare = host.replace(/^www\./, "").split(".")[0]!;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export interface Discovered {
  url: string;
  name: string;
  feeds: string[];
  strategy: ScrapeStrategy;
  needsLogin: boolean;
}

/** Turn a bare domain into a source: resolve feeds, display name and scrape strategy. */
export async function discoverSource(input: string): Promise<Discovered> {
  const url = normalizeUrl(input);
  const host = hostOf(url);
  const homepage = await fetchText(`${url}/`);
  if (homepage === null) throw new Error(`kunde inte nå ${host}`);

  const parser = new Parser({ timeout: 10_000 });
  const candidates: string[] = [];

  // 1. Declared feeds via <link rel="alternate">.
  const $ = load(homepage);
  $('link[rel="alternate"]').each((_, el) => {
    const type = $(el).attr("type") ?? "";
    const href = $(el).attr("href");
    if (href && /(rss|atom)\+xml/.test(type)) {
      try {
        candidates.push(new URL(href, url).href);
      } catch {
        /* skip malformed href */
      }
    }
  });

  // 2. Probe common paths if nothing was declared.
  if (candidates.length === 0) candidates.push(...PROBE_PATHS.map((p) => `${url}${p}`));

  const feeds: string[] = [];
  for (const candidate of candidates) {
    if (await isValidFeed(candidate, parser)) feeds.push(candidate);
    if (feeds.length >= 5) break;
  }
  if (feeds.length === 0) throw new Error(`hittade inget RSS-flöde för ${host}`);

  const strategy = detectStrategy(host, homepage);
  return { url, name: deriveName(homepage, host), feeds, strategy, needsLogin: strategy === "ntm" };
}
