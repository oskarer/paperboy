import { load, type CheerioAPI } from "cheerio";
import { config } from "../config.ts";
import type { Source } from "../sources.ts";
import { ntmArticleId, ntmFetchBody, ntmLogin } from "../auth.ts";
import type { Candidate, ScrapedArticle } from "../types.ts";

// Full browser header set: sverigesradio.se (Akamai) returns 403 on bare UA requests,
// and it's harmless for the other sources.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua": '"Chromium";v="126", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

/** Rewrite svtstatic image URLs to a small width so image-input tokens stay cheap. */
function shrinkSvtImageUrl(url: string): string {
  return url
    .replace(/svtstatic\.se\/image\/(\w+)\/\d+\//, `svtstatic.se/image/$1/${config.photoWidth}/`)
    .replace(/svtstatic\.se\/image-news\/\d+\//, `svtstatic.se/image-news/${config.photoWidth}/`);
}

function ogImage($: CheerioAPI): string | undefined {
  return $('meta[property="og:image"]').attr("content") ?? undefined;
}

function ogHeadline($: CheerioAPI): string {
  return ($('meta[property="og:title"]').attr("content") ?? "").replace(/\s*[|–-]\s*(SVT|Sveriges Radio).*$/, "").trim();
}

function scrapeSvt($: CheerioAPI): ScrapedArticle | null {
  const article = $('article[class*="TextArticle__root"]').first();
  const h1 = article
    .find("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .find((t) => t.length > 0 && !/javascript/i.test(t));
  const headline = ogHeadline($) || h1 || "";

  const lead = article
    .find('div[class*="Lead__root"] p')
    .map((_, el) => $(el).text().trim())
    .get()
    .join(" ");

  const paragraphs = article
    .find('div[class*="TextArticle__body"] div[class*="InlineText__root"] p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((p) => p.length > 0);

  const imageUrls: string[] = [];
  const push = (u: string | undefined) => {
    if (!u || !u.includes("svtstatic.se")) return;
    const small = shrinkSvtImageUrl(u);
    if (!imageUrls.includes(small)) imageUrls.push(small);
  };
  push(ogImage($));
  article.find('img[src*="svtstatic.se/image"]').each((_, el) => push($(el).attr("src")));

  if (!headline) return null;
  return { headline, lead, paragraphs, imageUrls };
}

const JUNK_PARAGRAPH =
  /cookie|samtycke|prenumerera|gratiskonto|läs (mer|också|även)|annons|nyhetsbrev|artikelns ursprungsadress|chefredaktör|ai-genererad|mailto:/i;

/**
 * Best-effort extraction for non-SVT sites (order verified across AB/Expressen/DN/SvD/GP):
 * 1. JSON-LD NewsArticle articleBody, 2. scoped <p> harvest, 3. caller falls back to RSS description.
 */
function scrapeGeneric($: CheerioAPI): ScrapedArticle | null {
  const headline = ogHeadline($) || $("h1").first().text().trim();
  if (!headline) return null;

  let paragraphs: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    if (paragraphs.length > 0) return;
    try {
      const data = JSON.parse($(el).text());
      const nodes = Array.isArray(data) ? data : (data["@graph"] ?? [data]);
      for (const node of nodes) {
        const type = node?.["@type"];
        const isArticle = type === "NewsArticle" || (Array.isArray(type) && type.includes("NewsArticle"));
        if (isArticle && typeof node.articleBody === "string" && node.articleBody.length > 300) {
          paragraphs = node.articleBody.split(/\n+/).map((p: string) => p.trim()).filter(Boolean);
          return;
        }
      }
    } catch {
      // malformed JSON-LD — try the next block
    }
  });

  if (paragraphs.length === 0) {
    for (const selector of ['[itemprop="articleBody"]', "article", "main"]) {
      const container = $(selector).first();
      if (!container.length) continue;
      paragraphs = container
        .find("p")
        .map((_, el) => $(el).text().trim())
        .get()
        // Real body paragraphs are sentence-length; the regex drops nav/byline/paywall junk.
        .filter((p) => p.length > 60 && !JUNK_PARAGRAPH.test(p));
      if (paragraphs.length > 0) break;
    }
  }

  // Paywalled/truncated pages yield next to nothing — let the caller use the RSS teaser.
  if (paragraphs.join(" ").length < 200) return null;

  const lead = paragraphs.shift() ?? "";
  const og = ogImage($);
  return { headline, lead, paragraphs, imageUrls: og ? [og] : [] };
}

/** Full premium body from the NTM iris API (paragraph HTML → ScrapedArticle). */
async function scrapeNtm(candidate: Candidate, source: Source): Promise<ScrapedArticle | null> {
  if (!source.credentials) return null; // no login → fall back to RSS teaser
  const id = ntmArticleId(candidate.link);
  if (!id) return null;
  try {
    const token = await ntmLogin(source);
    const bodyHtml = await ntmFetchBody(source, id, token);
    if (!bodyHtml) return null;
    const $ = load(`<div>${bodyHtml}</div>`);
    const paragraphs = $("p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((p) => p.length > 0);
    if (paragraphs.join(" ").length < 200) return null;
    return {
      headline: candidate.title,
      lead: paragraphs.shift() ?? "",
      paragraphs,
      imageUrls: candidate.feedImageUrl ? [candidate.feedImageUrl] : [],
    };
  } catch (err) {
    console.warn(`   ntm scrape failed for ${candidate.link}: ${err}`);
    return null;
  }
}

export async function scrapeArticle(candidate: Candidate, source: Source): Promise<ScrapedArticle | null> {
  if (source.strategy === "ntm") return scrapeNtm(candidate, source);

  let html: string;
  try {
    const res = await fetch(candidate.link, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const $ = load(html);
  return source.strategy === "svt" ? scrapeSvt($) : scrapeGeneric($);
}
