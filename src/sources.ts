import type { SectionKey } from "./types.ts";

export type ScrapeStrategy = "svt" | "ntm" | "generic";

/** A user-configured source, stored in settings.json. */
export interface Source {
  /** Normalized origin, e.g. "https://www.mvt.se" */
  url: string;
  /** Display name + article attribution, e.g. "MVT" */
  name: string;
  enabled: boolean;
  /** Discovered feed URLs (cached so we don't re-probe every run) */
  feeds: string[];
  strategy: ScrapeStrategy;
  /** Optional paywall login (NTM sites). Plaintext, local-only (settings.json is gitignored). */
  credentials?: { username: string; password: string };
}

/** Normalize any user input ("mvt.se", "http://mvt.se/foo") to a bare https origin. */
export function normalizeUrl(input: string): string {
  let s = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!s) throw new Error("tom URL");
  // Prefer the www host — NTM's clientName and most feeds live there.
  if (!s.startsWith("www.") && s.split(".").length === 2) s = `www.${s}`;
  return `https://${s}`;
}

export function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** Default source on a fresh install: SVT public service, five section feeds. */
export function defaultSources(): Source[] {
  return [
    {
      url: "https://www.svt.se",
      name: "SVT",
      enabled: true,
      strategy: "svt",
      feeds: [
        "https://www.svt.se/nyheter/inrikes/rss.xml",
        "https://www.svt.se/nyheter/utrikes/rss.xml",
        "https://www.svt.se/nyheter/ekonomi/rss.xml",
        "https://www.svt.se/kultur/rss.xml",
        "https://www.svt.se/sport/rss.xml",
      ],
    },
  ];
}

/** Pick the scrape strategy for a host given hints from its homepage HTML. */
export function detectStrategy(host: string, homepageHtml: string): ScrapeStrategy {
  if (/(^|\.)svt\.se$/.test(host)) return "svt";
  // NTM's "iris" SPA powers mvt, corren, nt, vt, … — full text via the iris API when logged in.
  if (/ng-app-id="iris"|id="iris-state"|iris-api\.ntm\.eu/.test(homepageHtml)) return "ntm";
  return "generic";
}

const LINK_SECTION_PATTERNS: [RegExp, SectionKey][] = [
  [/\/(sverige|inrikes|sthlm|goteborg|stockholm|motala|vadstena|linkoping|norrkoping)\//, "inrikes"],
  [/\/(varlden|utrikes|world)\//, "utrikes"],
  [/\/(ekonomi|naringsliv|dinapengar|bors|bostad)\//, "ekonomi"],
  [/\/(kultur|noje|scen|film|musik|kronika)/, "kultur"],
  [/\/(sport|fotboll|hockey)/, "sport"],
];

/** Best-effort section for an article from its link path; falls back to "allmänt". */
export function inferSection(link: string): SectionKey {
  for (const [re, section] of LINK_SECTION_PATTERNS) if (re.test(link)) return section;
  return "allmänt";
}
