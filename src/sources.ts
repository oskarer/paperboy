import type { SectionKey } from "./types.ts";

export type ScrapeStrategy = "svt" | "generic" | "rss-only";

export interface SourceDef {
  id: string;
  /** Display name in the web UI */
  name: string;
  /** Credit line printed in the paper, e.g. "Källa: SVT" */
  attribution: string;
  /** Section for all items, or "allmänt" for mixed feeds (see inferSection) */
  section: SectionKey;
  feedUrl: string;
  strategy: ScrapeStrategy;
  /** For mixed feeds: try to infer section from link path / feed categories */
  inferSection?: boolean;
  /** Enabled when the user hasn't toggled it yet */
  defaultEnabled: boolean;
}

/**
 * Curated catalog of Swedish news sources. All feed URLs live-verified 2026-07-06.
 * - SR/Ekot: Atom feed whose content carries full text + image; article pages sit
 *   behind Akamai (403 without full browser headers) → rss-only.
 * - Aftonbladet/Expressen/DN/SvD/GP: server-rendered article pages → generic scrape.
 *   Paywalled items (AB Plus, DN/SvD premium) come back truncated and fall back to
 *   the RSS description automatically.
 */
export const SOURCE_CATALOG: SourceDef[] = [
  // — SVT (public service, full text, default on) —
  { id: "svt-inrikes", name: "SVT Inrikes", attribution: "SVT", section: "inrikes", feedUrl: "https://www.svt.se/nyheter/inrikes/rss.xml", strategy: "svt", defaultEnabled: true },
  { id: "svt-utrikes", name: "SVT Utrikes", attribution: "SVT", section: "utrikes", feedUrl: "https://www.svt.se/nyheter/utrikes/rss.xml", strategy: "svt", defaultEnabled: true },
  { id: "svt-ekonomi", name: "SVT Ekonomi", attribution: "SVT", section: "ekonomi", feedUrl: "https://www.svt.se/nyheter/ekonomi/rss.xml", strategy: "svt", defaultEnabled: true },
  { id: "svt-kultur", name: "SVT Kultur", attribution: "SVT", section: "kultur", feedUrl: "https://www.svt.se/kultur/rss.xml", strategy: "svt", defaultEnabled: true },
  { id: "svt-sport", name: "SVT Sport", attribution: "SVT", section: "sport", feedUrl: "https://www.svt.se/sport/rss.xml", strategy: "svt", defaultEnabled: true },

  // — Sveriges Radio / Ekot —
  { id: "sr-ekot", name: "Sveriges Radio Ekot", attribution: "Ekot", section: "allmänt", feedUrl: "https://api.sr.se/api/rss/program/83", strategy: "rss-only", inferSection: true, defaultEnabled: false },

  // — Aftonbladet —
  { id: "ab-nyheter", name: "Aftonbladet Nyheter", attribution: "Aftonbladet", section: "allmänt", feedUrl: "https://rss.aftonbladet.se/rss2/small/pages/sections/nyheter/", strategy: "generic", inferSection: true, defaultEnabled: false },
  { id: "ab-ekonomi", name: "Aftonbladet Ekonomi", attribution: "Aftonbladet", section: "ekonomi", feedUrl: "https://rss.aftonbladet.se/rss2/small/pages/sections/ekonomi/", strategy: "generic", defaultEnabled: false },
  { id: "ab-sport", name: "Sportbladet", attribution: "Sportbladet", section: "sport", feedUrl: "https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/", strategy: "generic", defaultEnabled: false },

  // — Expressen —
  { id: "expressen-nyheter", name: "Expressen Nyheter", attribution: "Expressen", section: "allmänt", feedUrl: "https://feeds.expressen.se/nyheter/", strategy: "generic", inferSection: true, defaultEnabled: false },
  { id: "expressen-sport", name: "Expressen Sport", attribution: "Expressen", section: "sport", feedUrl: "https://feeds.expressen.se/sport/", strategy: "generic", defaultEnabled: false },
  { id: "expressen-ekonomi", name: "Expressen Ekonomi", attribution: "Expressen", section: "ekonomi", feedUrl: "https://feeds.expressen.se/ekonomi/", strategy: "generic", defaultEnabled: false },
  { id: "expressen-kultur", name: "Expressen Kultur", attribution: "Expressen", section: "kultur", feedUrl: "https://feeds.expressen.se/kultur/", strategy: "generic", defaultEnabled: false },

  // — Dagens Nyheter (premium items fall back to the good RSS descriptions) —
  { id: "dn", name: "Dagens Nyheter", attribution: "DN", section: "allmänt", feedUrl: "https://www.dn.se/rss/", strategy: "generic", inferSection: true, defaultEnabled: false },

  // — Svenska Dagbladet —
  { id: "svd", name: "Svenska Dagbladet", attribution: "SvD", section: "allmänt", feedUrl: "https://www.svd.se/feed/articles.rss", strategy: "generic", inferSection: true, defaultEnabled: false },

  // — Göteborgs-Posten —
  { id: "gp", name: "Göteborgs-Posten", attribution: "GP", section: "allmänt", feedUrl: "https://www.gp.se/rss", strategy: "generic", inferSection: true, defaultEnabled: false },
];

export function enabledSources(toggles: Record<string, boolean>): SourceDef[] {
  return SOURCE_CATALOG.filter((s) => toggles[s.id] ?? s.defaultEnabled);
}

export function sourceById(id: string): SourceDef | undefined {
  return SOURCE_CATALOG.find((s) => s.id === id);
}

const LINK_SECTION_PATTERNS: [RegExp, SectionKey][] = [
  [/\/(sverige|inrikes|sthlm|goteborg|stockholm)\//, "inrikes"],
  [/\/(varlden|utrikes|world)\//, "utrikes"],
  [/\/(ekonomi|naringsliv|dinapengar|bors)\//, "ekonomi"],
  [/\/(kultur|noje|scen|film|musik)/, "kultur"],
  [/\/(sport|fotboll|hockey)/, "sport"],
];

const CATEGORY_SECTIONS: [RegExp, SectionKey][] = [
  [/sverige|inrikes/i, "inrikes"],
  [/världen|utrikes/i, "utrikes"],
  [/ekonomi|näringsliv/i, "ekonomi"],
  [/kultur|nöje|scen|litteratur|film|musik/i, "kultur"],
  [/sport/i, "sport"],
];

/** Best-effort section for items from mixed feeds; falls back to "allmänt". */
export function inferSection(link: string, categories: string[]): SectionKey {
  for (const [re, section] of LINK_SECTION_PATTERNS) if (re.test(link)) return section;
  for (const category of categories) {
    for (const [re, section] of CATEGORY_SECTIONS) if (re.test(category)) return section;
  }
  return "allmänt";
}
