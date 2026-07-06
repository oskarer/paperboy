export type StyleId = "classic" | "modern" | "tabloid" | "minimal";

export interface PaperStyle {
  id: StyleId;
  /** UI label */
  name: string;
  /** UI hint */
  description: string;
  /** Replaces the PRINT AESTHETIC paragraph in prompts/page.txt */
  aesthetic: string;
  /** Front-page masthead spec */
  masthead: (paperName: string, dateline: string) => string;
  /** Inside-page header spec */
  pageHeader: (paperName: string, section: string, dateline: string, page: number) => string;
}

const datelineRow = (dateline: string) => `"${dateline}  ·  Pris 5 kr  ·  Grundad 2026"`;

export const STYLES: Record<StyleId, PaperStyle> = {
  classic: {
    id: "classic",
    name: "Klassisk",
    description: "Anrik morgontidning: frakturstil, täta serifspalter, tunna linjer",
    aesthetic:
      "PURE WHITE paper background (plain white office paper — no cream tint, no gray tone, no paper texture, no ink-wash; large areas must stay completely white to save printer ink), crisp black ink, classic dense serif typography (Times-like), justified body text set SMALL and tight in exactly 4 narrow columns separated by thin vertical hairlines, compact headlines, tight leading, minimal whitespace, elegant thin horizontal rules between stories.",
    masthead: (paperName, dateline) =>
      `MASTHEAD: At the very top, the newspaper nameplate "${paperName}" in large ornate blackletter type, centered, with a thin double rule beneath it and a small line underneath reading exactly: ${datelineRow(dateline)}. This is the front page.`,
    pageHeader: (paperName, section, dateline, page) =>
      `PAGE HEADER: A slim header across the top with a thin double rule reading, left to right: "${paperName}", the section name "${section}", "${dateline}", and the page number "${page}". No large masthead — this is an inside page.`,
  },

  modern: {
    id: "modern",
    name: "Modern",
    description: "Samtida kvalitetstidning: fet sanserif-rubrik, serif-brödtext, svarta sektionsbalkar",
    aesthetic:
      "PURE WHITE paper background (no tint, no texture — large areas must stay completely white to save printer ink), contemporary quality-newspaper design: bold clean grotesque sans-serif headlines with tight letter-spacing, elegant readable serif body text, strong SOLID BLACK section bars with the section name knocked out in white, confident thick-and-thin horizontal rules, structured 4-column grid with clear typographic hierarchy, headlines get room to breathe while body columns stay dense and justified.",
    masthead: (paperName, dateline) =>
      `MASTHEAD: At the very top, the nameplate "${paperName}" set in very heavy modern grotesque sans-serif capitals with tight tracking, left-aligned, with a thick black rule underneath and a small light dateline row reading exactly: ${datelineRow(dateline)}. This is the front page.`,
    pageHeader: (paperName, section, dateline, page) =>
      `PAGE HEADER: A solid black bar across the top with "${section}" knocked out in bold white sans-serif capitals on the left, and "${paperName} · ${dateline} · sid ${page}" in small white type on the right. No large masthead — this is an inside page.`,
  },

  tabloid: {
    id: "tabloid",
    name: "Tabloid",
    description: "Kvällstidning: enorma feta rubriker, vitt-på-svart, tjocka ramar",
    aesthetic:
      "PURE WHITE paper background (no tint, no texture — unprinted areas must stay completely white to save printer ink), Swedish kvällstidning tabloid energy: HUGE ultra-bold condensed sans-serif headlines — the lead headline nearly shouts across the whole page width — several headline bars knocked out white-on-solid-black, thick black boxes framing individual stories, short punchy bold decks under headlines, high contrast, dense and loud but cleanly organized in a 3–4 column grid.",
    masthead: (paperName, dateline) =>
      `MASTHEAD: At the very top, the logotype "${paperName}" in very heavy slanted condensed sans-serif WHITE capitals inside a solid black rectangle, left-aligned, with a thin dateline row beside it reading exactly: ${datelineRow(dateline)}. This is the front page.`,
    pageHeader: (paperName, section, dateline, page) =>
      `PAGE HEADER: A compact black box on the left containing "${paperName}" in white condensed capitals, followed by "${section}" in huge bold black condensed type, with "${dateline} · sid ${page}" small on the right, a thick black rule underneath. This is an inside page.`,
  },

  minimal: {
    id: "minimal",
    name: "Minimalistisk",
    description: "Schweizisk typografi: strikt raster, en sanserif, luft och hierarki",
    aesthetic:
      "PURE WHITE paper background (nothing but type and photos may carry ink — everything else stays completely white), Swiss international typographic style: one single neo-grotesque sans-serif family (Helvetica-like) for everything, strict modular grid of 4 columns, flush-left ragged-right body text, NO decorative rules or boxes anywhere — hierarchy created purely through type size, weight and white space, generous but disciplined spacing, small refined headlines in bold, body text light and small, captions tiny.",
    masthead: (paperName, dateline) =>
      `MASTHEAD: At the very top left, the nameplate "${paperName}" set small and confident in bold lowercase neo-grotesque sans-serif, and on the same line to the far right a tiny dateline reading exactly: ${datelineRow(dateline)}. One single thin hairline rule below. Nothing else. This is the front page.`,
    pageHeader: (paperName, section, dateline, page) =>
      `PAGE HEADER: A single quiet line of small sans-serif text: "${paperName}" bold at left, "${section}" centered, "${dateline} — ${page}" at right. One thin hairline rule below. Nothing else. This is an inside page.`,
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
