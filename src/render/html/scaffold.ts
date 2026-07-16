// Deterministic visual identity for the HTML backend: base page CSS, per-style
// typography tokens, masthead / page-header builders. The AI never touches any
// of this — it only decides the composition (see schema.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StyleId } from "../../styles.ts";
import { config } from "../../config.ts";

const { cssWidth, cssHeight } = config.htmlPage;
// Kept tight: the printer adds ~4mm unprintable hardware margin on top of this.
export const PAGE_PAD_X = 18;
export const PAGE_PAD_TOP = 16;
export const PAGE_PAD_BOTTOM = 18;
export const GRID_GAP = 14;
export const CONTENT_WIDTH = cssWidth - 2 * PAGE_PAD_X; // 768
/** Width of one column in the 12-col rhythm (gaps excluded) */
export const COL_WIDTH = (CONTENT_WIDTH - 11 * GRID_GAP) / 12;

/** Width in px of a cell spanning n of the 12 columns (incl. its inner gaps) */
export const spanWidth = (n: number) => Math.round(n * COL_WIDTH + (n - 1) * GRID_GAP);

const datelineRow = (dateline: string) => `${dateline}&ensp;·&ensp;Pris 5 kr&ensp;·&ensp;Grundad 2026`;

// Vendored UnifrakturMaguntia (SIL OFL) — inlined so rendering needs no network.
let blackletterCss = "";
function blackletter(): string {
  if (!blackletterCss) {
    const b64 = readFileSync(join("assets", "fonts", "UnifrakturMaguntia.woff2")).toString("base64");
    blackletterCss = `@font-face{font-family:'UnifrakturMaguntia';src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }
  return blackletterCss;
}

interface StyleTokens {
  bodyFamily: string;
  bodySize: number;
  bodyLh: number;
  bodyAlign: string;
  headlineFont: string;
  headlineWeight: number;
  headlineSpacing: string;
  /** Headline font-size px for scales 1..5 (index 0 = scale 1) */
  scale: [number, number, number, number, number];
  scaleLineHeight: [number, number, number, number, number];
  captionCss: string;
  kallaCss: string;
  briefHeadCss: string;
  pullquoteCss: string;
  railHeaderHtml: string;
  /** Style-specific decorations: rules, boxes, bars… */
  extraCss: string;
}

const RAIL_HEADER_TEXT = "I KORTHET";

const TOKENS: Record<StyleId, StyleTokens> = {
  classic: {
    bodyFamily: `'Times New Roman',Times,serif`,
    bodySize: 13.5,
    bodyLh: 1.24,
    bodyAlign: `text-align:justify`,
    headlineFont: `Georgia,'Times New Roman',serif`,
    headlineWeight: 700,
    headlineSpacing: `letter-spacing:-0.2px`,
    scale: [14, 19, 24, 30, 40],
    scaleLineHeight: [1.15, 1.1, 1.08, 1.06, 1.04],
    captionCss: `font-family:'Times New Roman',serif;font-size:11px;font-style:italic;line-height:1.25`,
    kallaCss: `font-family:'Times New Roman',serif;font-size:11px;font-weight:700`,
    briefHeadCss: `font-weight:700`,
    pullquoteCss: `font-family:Georgia,serif;font-style:italic;font-size:16px;line-height:1.3;font-weight:700;border:1px solid #000;padding:8px 12px;text-align:center`,
    railHeaderHtml: `<h3 class="rail-header">${RAIL_HEADER_TEXT}</h3>`,
    extraCss: `
      .story-body{column-rule:1px solid #999}
      .slot{position:relative}
      .row .slot:not(:first-child)::before{content:"";position:absolute;left:-${GRID_GAP / 2 + 0.5}px;top:0;bottom:0;width:1px;background:#999}
      .main .row:not(:first-child){border-top:1px solid #000;padding-top:9px}
      .rail{border-left:1px solid #000;padding-left:${GRID_GAP - 1}px}
      .rail.left{border-left:none;border-right:1px solid #000;padding-left:0;padding-right:${GRID_GAP - 1}px}
      .rail-header{font-family:Georgia,serif;font-size:12px;font-weight:700;letter-spacing:2.5px;text-align:center;border-top:1px solid #000;border-bottom:1px solid #000;padding:3px 0;margin-bottom:8px}
      .brief:not(:first-of-type){border-top:1px solid #999;padding-top:6px;margin-top:6px}
      .masthead{ text-align:center;padding-bottom:6px}
      .masthead .name{font-family:'UnifrakturMaguntia',Georgia,serif;font-size:58px;line-height:1.05}
      .masthead .rule{border-bottom:3px double #000;margin:4px 0 3px}
      .masthead .dateline{font-family:'Times New Roman',serif;font-size:11.5px}
      .page-header{border-bottom:3px double #000;padding-bottom:4px;display:flex;justify-content:space-between;align-items:baseline;font-family:'Times New Roman',serif;font-size:12px}
      .page-header .section{font-family:Georgia,serif;font-weight:700;letter-spacing:2px}`,
  },

  modern: {
    bodyFamily: `Georgia,'PT Serif',serif`,
    bodySize: 13.5,
    bodyLh: 1.3,
    bodyAlign: `text-align:justify`,
    headlineFont: `'Helvetica Neue',Helvetica,Arial,sans-serif`,
    headlineWeight: 700,
    headlineSpacing: `letter-spacing:-0.5px`,
    scale: [14.5, 20, 25, 32, 44],
    scaleLineHeight: [1.15, 1.1, 1.05, 1.02, 0.98],
    captionCss: `font-family:Georgia,serif;font-size:11px;font-style:italic;line-height:1.25`,
    kallaCss: `font-family:'Helvetica Neue',sans-serif;font-size:10.5px;font-weight:700`,
    briefHeadCss: `font-family:'Helvetica Neue',sans-serif;font-weight:700`,
    pullquoteCss: `font-family:'Helvetica Neue',sans-serif;font-weight:700;font-size:18px;line-height:1.25;border-left:4px solid #000;padding:2px 0 2px 12px`,
    railHeaderHtml: `<h3 class="rail-header">${RAIL_HEADER_TEXT}</h3>`,
    extraCss: `
      .slot.lead{border-top:3px solid #000;padding-top:7px}
      .main .row:not(:first-child){border-top:1px solid #000;padding-top:9px}
      .rail-header{font-family:'Helvetica Neue',sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;background:#000;color:#fff;padding:4px 8px;margin-bottom:8px}
      .brief:not(:first-of-type){border-top:1px solid #ccc;padding-top:6px;margin-top:6px}
      .masthead .name{font-family:'Helvetica Neue',sans-serif;font-weight:800;font-size:46px;letter-spacing:-2px;text-transform:uppercase;line-height:1}
      .masthead .rule{border-bottom:5px solid #000;margin:6px 0 3px}
      .masthead .dateline{font-family:'Helvetica Neue',sans-serif;font-size:11px;color:#333}
      .page-header{background:#000;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:5px 10px;font-family:'Helvetica Neue',sans-serif}
      .page-header .section{font-weight:700;font-size:15px;letter-spacing:1.5px;text-transform:uppercase}
      .page-header .meta{font-size:10.5px}`,
  },

  tabloid: {
    bodyFamily: `Georgia,serif`,
    bodySize: 13,
    bodyLh: 1.26,
    bodyAlign: `text-align:justify`,
    headlineFont: `'Arial Narrow','Helvetica Neue',Arial,sans-serif`,
    headlineWeight: 900,
    headlineSpacing: `letter-spacing:-1px`,
    scale: [15, 24, 32, 42, 58],
    scaleLineHeight: [1.1, 1.05, 1.0, 0.97, 0.94],
    captionCss: `font-family:'Helvetica Neue',sans-serif;font-size:11.5px;font-weight:700;line-height:1.2`,
    kallaCss: `font-family:'Helvetica Neue',sans-serif;font-size:11px;font-weight:700`,
    briefHeadCss: `font-family:'Arial Narrow',sans-serif;font-weight:900;text-transform:uppercase`,
    pullquoteCss: `font-family:'Arial Narrow','Helvetica Neue',sans-serif;font-weight:900;font-size:20px;line-height:1.15;border:3px solid #000;padding:8px 10px;text-transform:uppercase`,
    railHeaderHtml: `<h3 class="rail-header">${RAIL_HEADER_TEXT}</h3>`,
    extraCss: `
      .slot.boxed{border:3px solid #000;padding:9px;align-self:start}
      .headline.ko{background:#000;color:#fff;display:inline;padding:1px 10px 3px;line-height:1.16;-webkit-box-decoration-break:clone;box-decoration-break:clone}
      .headline-wrap.ko-wrap{margin-bottom:8px}
      .rail-header{font-family:'Arial Narrow',sans-serif;font-size:13px;font-weight:900;letter-spacing:1.5px;background:#000;color:#fff;padding:5px 8px;margin-bottom:8px}
      .brief:not(:first-of-type){border-top:2px solid #000;padding-top:6px;margin-top:6px}
      .masthead{display:flex;align-items:center;gap:12px;padding-bottom:4px;border-bottom:4px solid #000;margin-bottom:2px}
      .masthead .name{background:#000;color:#fff;font-family:'Arial Narrow',sans-serif;font-weight:900;font-size:34px;text-transform:uppercase;padding:6px 14px;line-height:1}
      .masthead .name span{display:inline-block;transform:skewX(-8deg)}
      .masthead .dateline{font-family:'Helvetica Neue',sans-serif;font-size:11px}
      .masthead .rule{display:none}
      .page-header{display:flex;align-items:center;gap:12px;border-bottom:4px solid #000;padding-bottom:5px;font-family:'Arial Narrow',sans-serif}
      .page-header .paper{background:#000;color:#fff;font-weight:900;text-transform:uppercase;font-size:14px;padding:3px 10px}
      .page-header .section{font-weight:900;font-size:26px;text-transform:uppercase;line-height:1}
      .page-header .meta{margin-left:auto;font-family:'Helvetica Neue',sans-serif;font-size:10.5px}`,
  },

  minimal: {
    bodyFamily: `'Helvetica Neue',Helvetica,Arial,sans-serif`,
    bodySize: 12.5,
    bodyLh: 1.45,
    bodyAlign: `text-align:left;hyphens:manual`,
    headlineFont: `'Helvetica Neue',Helvetica,Arial,sans-serif`,
    headlineWeight: 700,
    headlineSpacing: `letter-spacing:-0.3px`,
    scale: [12.5, 16, 20, 26, 34],
    scaleLineHeight: [1.2, 1.15, 1.12, 1.1, 1.08],
    captionCss: `font-family:'Helvetica Neue',sans-serif;font-size:10.5px;color:#333;line-height:1.3`,
    kallaCss: `font-family:'Helvetica Neue',sans-serif;font-size:10.5px;font-weight:700`,
    briefHeadCss: `font-weight:700`,
    pullquoteCss: `font-family:'Helvetica Neue',sans-serif;font-weight:300;font-size:19px;line-height:1.3;padding:4px 0`,
    railHeaderHtml: `<h3 class="rail-header">${RAIL_HEADER_TEXT}</h3>`,
    extraCss: `
      .photo img{border:none}
      .rail-header{font-family:'Helvetica Neue',sans-serif;font-size:12px;font-weight:700;margin-bottom:10px}
      .brief:not(:first-of-type){margin-top:12px}
      .masthead{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:5px}
      .masthead .name{font-family:'Helvetica Neue',sans-serif;font-weight:700;font-size:20px;text-transform:lowercase}
      .masthead .rule{display:none}
      .masthead{border-bottom:1px solid #000}
      .masthead .dateline{font-size:10px}
      .page-header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:4px;font-family:'Helvetica Neue',sans-serif;font-size:11px}
      .page-header .paper{font-weight:700}`,
  },
};

const DENSITY_GAP = { airy: 18, normal: 14, dense: 10 } as const;

/** Numeric dials the fit ladder may turn without touching the AI's layout. */
export interface TypeOverrides {
  /** Added to the style's body font-size (px), e.g. -0.5 */
  bodyDelta?: number;
  /** Added to the style's body line-height, e.g. -0.04 */
  lhDelta?: number;
  /** CSS zoom: reflows all type — >1 grows thin pages, <1 shrinks overfull ones.
   *  (Never transform:scale — transforms don't reflow, so the page box would
   *  clip content at its unscaled height while measurements look fine.) */
  pageZoom?: number;
  /** Distribute leftover air between rows/rail items so the page reads full-bottom */
  spread?: boolean;
  /** Explicit rail item gap in px — capped stretch for sparse rails */
  railGap?: number;
}

export function bodyMetrics(style: StyleId): { size: number; lh: number } {
  return { size: TOKENS[style].bodySize, lh: TOKENS[style].bodyLh };
}

export function headlineScalePx(style: StyleId, scale: number): number {
  return TOKENS[style].scale[Math.min(Math.max(scale, 1), 5) - 1]!;
}

export function scaffoldCss(
  style: StyleId,
  density: keyof typeof DENSITY_GAP,
  o: TypeOverrides = {},
): string {
  const t = TOKENS[style];
  const bodySize = t.bodySize + (o.bodyDelta ?? 0);
  const bodyLh = t.bodyLh + (o.lhDelta ?? 0);
  const bodyCss = `font-family:${t.bodyFamily};font-size:${bodySize}px;line-height:${bodyLh};${t.bodyAlign}`;
  // zoom reflows (unlike transform) — compensate the frame so the page still
  // fills exactly cssWidth×cssHeight visually.
  const pageZoom =
    o.pageZoom && Math.abs(o.pageZoom - 1) > 0.001
      ? `#page{zoom:${o.pageZoom.toFixed(3)};width:${(cssWidth / o.pageZoom).toFixed(1)}px;height:${(cssHeight / o.pageZoom).toFixed(1)}px}`
      : "";
  // Full-bottom look: residual air is distributed between rows; rail items get a
  // capped gap so a sparse rail never turns into a few islands in white space.
  const spread = o.spread ? `.main{justify-content:space-between}` : "";
  const railGap = o.railGap ? `.rail-flow{gap:${Math.round(o.railGap)}px}` : "";
  const headlineScales = t.scale
    .map(
      (px, i) =>
        `.headline.s${i + 1}{font-size:${px}px;line-height:${t.scaleLineHeight[i]}}`,
    )
    .join("\n");

  return `
${style === "classic" ? blackletter() : ""}
*{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px}
body{width:${cssWidth}px;height:${cssHeight}px;background:#fff;color:#000;-webkit-font-smoothing:antialiased}
#page{width:${cssWidth}px;height:${cssHeight}px;padding:${PAGE_PAD_TOP}px ${PAGE_PAD_X}px ${PAGE_PAD_BOTTOM}px;display:flex;flex-direction:column;overflow:hidden;background:#fff}
.masthead,.page-header{flex:none}
.body-grid{flex:1;display:flex;gap:${GRID_GAP}px;margin-top:12px;min-height:0}
.main{flex:1;display:flex;flex-direction:column;gap:var(--story-gap);min-width:0}
.row{display:grid;column-gap:${GRID_GAP}px;grid-auto-rows:min-content}
.rail{flex:none;display:flex;flex-direction:column}
.rail-flow{flex:1;display:flex;flex-direction:column;gap:var(--story-gap)}
.rail-flow .brief{margin-top:0}
.slot{min-width:0}
.headline{font-family:${t.headlineFont};font-weight:${t.headlineWeight};${t.headlineSpacing};hyphens:manual;overflow-wrap:break-word;margin-bottom:5px}
${headlineScales}
.story-body{${bodyCss};column-gap:13px;hyphens:auto;overflow-wrap:break-word}
.story-body p{margin-bottom:0}
.story-body p+p{text-indent:12px}
.slot-content{display:flex;gap:13px}
.slot-content .story-body{flex:1;min-width:0}
.slot-content .photo{flex:none}
.photo{margin-bottom:6px}
.photo img{width:100%;height:auto;display:block;object-fit:cover;object-position:50% 30%;border:1px solid #000}
.caption{${t.captionCss};margin-top:3px}
.kalla{${t.kallaCss};margin-top:4px}
.brief{${bodyCss};text-align:left}
.brief .brief-head{break-after:avoid}
.briefs-flow{column-fill:balance}
.pullquote{${t.pullquoteCss};break-inside:avoid;margin:10px 0}
.brief .brief-head{${t.briefHeadCss}}
.brief .kalla{margin-top:2px}
:root{--story-gap:${DENSITY_GAP[density]}px}
${t.extraCss}
${spread}
${railGap}
${pageZoom}
`;
}

export function mastheadHtml(style: StyleId, paperName: string, dateSv: string): string {
  const name =
    style === "tabloid" ? `<div class="name"><span>${esc(paperName)}</span></div>` : `<div class="name">${esc(paperName)}</div>`;
  return `<header class="masthead">${name}<div class="rule"></div><div class="dateline">${datelineRow(esc(dateSv))}</div></header>`;
}

export function pageHeaderHtml(
  style: StyleId,
  paperName: string,
  section: string,
  dateSv: string,
  pageNumber: number,
): string {
  const p = esc(paperName);
  const s = esc(section);
  const d = esc(dateSv);
  switch (style) {
    case "classic":
      return `<header class="page-header"><span class="paper">${p}</span><span class="section">${s}</span><span>${d}</span><span>${pageNumber}</span></header>`;
    case "modern":
      return `<header class="page-header"><span class="section">${s}</span><span class="meta">${p} · ${d} · sid ${pageNumber}</span></header>`;
    case "tabloid":
      return `<header class="page-header"><span class="paper">${p}</span><span class="section">${s}</span><span class="meta">${d} · sid ${pageNumber}</span></header>`;
    case "minimal":
      return `<header class="page-header"><span class="paper">${p}</span><span class="section">${s}</span><span>${d} — ${pageNumber}</span></header>`;
  }
}

export function railHeader(style: StyleId): string {
  return TOKENS[style].railHeaderHtml;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
