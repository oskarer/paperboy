// Fit machinery for the HTML backend: a text-volume estimator that grounds the
// AI's composition, and a deterministic knob ladder that nudges a rendered page
// into the fixed A4 box without ever touching article text.
import type { PageSpec, Story } from "../../types.ts";
import type { StyleId } from "../../styles.ts";
import type { Photo } from "../photos.ts";
import { config } from "../../config.ts";
import { bodyMetrics, headlineScalePx, spanWidth, GRID_GAP, PAGE_PAD_X, PAGE_PAD_TOP, PAGE_PAD_BOTTOM } from "./scaffold.ts";
import type { FitOverrides } from "./compile.ts";
import type { PageLayout, Slot } from "./schema.ts";
import type { FitMetrics } from "./chromium.ts";

// Average glyph width / font-size, measured in chromium per style
// (scripts/dev-calibrate.ts — rerun if fonts or tokens change).
const CAL: Record<StyleId, { bodyCharF: number; headCharF: number }> = {
  classic: { bodyCharF: 0.406, headCharF: 0.49 },
  modern: { bodyCharF: 0.45, headCharF: 0.44 },
  tabloid: { bodyCharF: 0.45, headCharF: 0.34 },
  minimal: { bodyCharF: 0.452, headCharF: 0.44 },
};

const CONTENT_W = config.htmlPage.cssWidth - 2 * PAGE_PAD_X;
const CONTENT_H = config.htmlPage.cssHeight - PAGE_PAD_TOP - PAGE_PAD_BOTTOM;

/**
 * How full the page would be at normal sizing, as a ratio of usable area.
 * Column-width independent: a story's text area ≈ chars × charWidth × lineHeight.
 */
export function estimateContentRatio(
  page: PageSpec,
  style: StyleId,
  photos: Photo[],
): { ratio: number; storyShare: Map<number, number> } {
  const { size, lh } = bodyMetrics(style);
  const cal = CAL[style];
  const lineH = size * lh;

  const headerH = page.pageNumber === 1 ? 110 : 40;
  const pageArea = CONTENT_W * (CONTENT_H - headerH - 12);

  const storyShare = new Map<number, number>();
  let total = 0;
  for (const [i, story] of page.stories.entries()) {
    const bodyArea = story.body.length * (size * cal.bodyCharF) * lineH * 1.08; // widows/paragraph slack
    // Headline at a mid scale + credit line + spacing, roughly.
    const headlinePx = story.role === "lead" ? 40 : story.role === "brief" ? 0 : 24;
    const headArea = story.headline.length * (headlinePx * cal.headCharF) * headlinePx * 1.1;
    const chromeArea = CONTENT_W * 0.35 * 26; // källa + margins on a typical slot width
    let area = bodyArea + headArea + chromeArea;
    if (photos.some((p) => p.storyIndex === i)) area += 220 * 150; // typical compact photo + caption
    storyShare.set(i, area);
    total += area;
  }
  for (const [i, a] of storyShare) storyShare.set(i, a / pageArea);
  return { ratio: total / pageArea, storyShare };
}

/** Rough rendered height in px of one slot's content. */
export function estimateSlotHeight(slot: Slot, page: PageSpec, style: StyleId): number {
  const { size, lh } = bodyMetrics(style);
  const cal = CAL[style];
  const lineH = size * lh;
  const charW = size * cal.bodyCharF;
  const slotW = spanWidth(slot.colSpan);

  if (slot.type === "briefs") {
    const cols = Math.max(1, Math.min(3, Math.round(slot.colSpan / 4)));
    const colW = (slotW - (cols - 1) * GRID_GAP) / cols;
    let total = 34; // I KORTHET header
    for (const id of slot.storyIds ?? []) {
      const s = page.stories[id]!;
      const chars = s.headline.length + s.body.length + 14;
      total += (Math.ceil((chars * charW) / colW) * lineH) / cols + 14;
    }
    return total;
  }

  const story = page.stories[slot.storyId!]!;
  const scale = slot.headlineScale ?? 2;
  const headPx = headlineScalePx(style, scale);
  const headLineChars = slotW / (headPx * cal.headCharF);
  let h = Math.ceil(story.headline.length / headLineChars) * headPx * 1.1 + 10;

  let bodyW = slotW;
  let photoH = 0;
  if (slot.photo) {
    const photoW = slot.photo.size === "wide" ? slotW : Math.min(slotW, spanWidth(4));
    photoH = photoW / 1.65 + 34; // typical crop + caption
    if (slot.photo.position === "left" || slot.photo.position === "right") {
      bodyW = slotW - photoW - GRID_GAP;
      photoH = 0; // sits beside the text, does not add height
    } else {
      h += photoH;
    }
  }
  const cols = slot.bodyColumns ?? 1;
  const colW = Math.max((bodyW - (cols - 1) * 13) / cols, 40);
  const lines = Math.ceil((story.body.length * charW * 1.06) / colW);
  h += Math.ceil(lines / cols) * lineH;
  h += 24; // källa + margins
  return Math.round(h);
}

/**
 * Pre-render sanity gate: catches compositions no typography dial can save —
 * a long story wedged into a sliver, an overstuffed rail, wildly uneven rows.
 * Returns problem notes for a cheap re-ask before any pixel is rendered.
 */
export function layoutProblems(layout: PageLayout, page: PageSpec, style: StyleId): string[] {
  const problems: string[] = [];
  const MAX_SLOT_H = 660;
  const usableH = CONTENT_H - (page.pageNumber === 1 ? 110 : 40) - 12;

  for (const [ri, row] of layout.rows.entries()) {
    const heights = row.slots.map((s) => estimateSlotHeight(s, page, style));
    for (const [si, hEst] of heights.entries()) {
      const slot = row.slots[si]!;
      if (hEst > MAX_SLOT_H && slot.type === "story") {
        problems.push(
          `rad ${ri + 1}: artikel id ${slot.storyId} blir ~${hEst}px hög (max ~${MAX_SLOT_H}) — ge den bredare colSpan och fler bodyColumns`,
        );
      }
    }
    if (heights.length >= 2) {
      const min = Math.min(...heights);
      const max = Math.max(...heights);
      if (max - min > 240)
        problems.push(
          `rad ${ri + 1}: beräknade höjder ${heights.map((h) => Math.round(h)).join("/")}px — para ihop innehåll av liknande höjd eller justera colSpan/bodyColumns`,
        );
    }
  }

  if (layout.rail) {
    const railSlot: Slot = {
      type: "briefs",
      storyIds: layout.rail.storyIds,
      colSpan: layout.rail.colSpan,
      storyId: null, headlineScale: null, bodyColumns: null, photo: null, pullQuote: null, boxed: null, knockoutHeadline: null,
    };
    const railH = estimateSlotHeight(railSlot, page, style);
    if (railH > usableH * 1.05)
      problems.push(
        `I KORTHET-spalten kräver ~${Math.round(railH)}px men sidan rymmer ~${Math.round(usableH)}px — flytta notiser till ett briefs-band eller gör railen bredare`,
      );
  }
  return problems;
}

/** One rung down the ladder. Returns null when out of deterministic knobs. */
export function nextOverrides(m: FitMetrics, o: FitOverrides): FitOverrides | null {
  const { minFill, acceptFill } = config.htmlPage;

  if (m.overflowY > 0) {
    // Chunky rungs: each render round trip costs ~1s, so combine knobs.
    const rung = (o.ladderStep ?? 0) + 1;
    if (rung === 1) return { ...o, ladderStep: rung, bodyDelta: -0.5, lhDelta: -0.04 };
    if (rung === 2) return { ...o, ladderStep: rung, bodyDelta: -1, lhDelta: -0.08, photoStep: 1 };
    if (rung === 3) return { ...o, ladderStep: rung, demoteHeadlines: true };
    return null; // typography spent — caller goes structural (AI repair) or scales
  }

  // Thin pages: deep underfill goes straight to a reflowing zoom (poster
  // treatment); moderate underfill grows type in +0.5px steps first.
  const growSteps = o.growSteps ?? 0;
  if (m.fillRatio < acceptFill) {
    if (!o.pageZoom && m.fillRatio < 0.8) {
      return { ...o, pageZoom: Math.min(0.985 / m.fillRatio, 1.45) };
    }
    if (growSteps < 3) {
      return { ...o, growSteps: growSteps + 1, bodyDelta: (o.bodyDelta ?? 0) + 0.5, lhDelta: (o.lhDelta ?? 0) + 0.04 };
    }
    if (!o.pageZoom) {
      return { ...o, pageZoom: Math.min(0.985 / m.fillRatio, 1.45) };
    }
    return null;
  }
  if (m.fillRatio < minFill && growSteps === 0) {
    return { ...o, growSteps: 1, bodyDelta: (o.bodyDelta ?? 0) + 0.5, lhDelta: (o.lhDelta ?? 0) + 0.04 };
  }
  return null;
}

/** Fit verdict for a measured page. */
export function verdict(m: FitMetrics): "fit" | "overflow" | "underfull" {
  if (m.overflowY > 0 || m.overflowX) return "overflow";
  if (m.fillRatio < config.htmlPage.acceptFill) return "underfull";
  return "fit";
}

/**
 * Rail much taller than main → move trailing rail briefs into a bottom band in
 * the main region. Structural but content-preserving, so allowed here.
 */
export function rebalanceRail(layout: PageLayout, m: FitMetrics): boolean {
  if (!layout.rail || m.railBottom == null) return false;
  const imbalance = m.railBottom - m.mainBottom;
  if (m.railBottom <= config.htmlPage.cssHeight - PAGE_PAD_BOTTOM || imbalance < 80) return false;

  const move = Math.max(1, Math.floor(layout.rail.storyIds.length * 0.3));
  const moved = layout.rail.storyIds.splice(layout.rail.storyIds.length - move, move);
  if (moved.length === 0) return false;
  layout.rows.push({
    slots: [
      {
        type: "briefs",
        storyIds: moved,
        colSpan: 12 - layout.rail.colSpan,
        storyId: null,
        headlineScale: null,
        bodyColumns: null,
        photo: null,
        pullQuote: null,
        boxed: null,
        knockoutHeadline: null,
      },
    ],
  });
  if (layout.rail.storyIds.length === 0) layout.rail = null;
  return true;
}

/** Human-readable feedback line for the one AI repair call. */
export function feedbackNote(m: FitMetrics): string {
  const pct = Math.round(Math.abs(m.overflowY) / config.htmlPage.cssHeight * 100);
  if (m.overflowY > 0) {
    const railNote =
      m.railBottom != null && m.railBottom > m.mainBottom + 60
        ? " Det är I KORTHET-spalten som svämmar över — flytta notiser till huvudytan eller gör spalten bredare."
        : "";
    return `Sidan svämmar över med ca ${Math.round(m.overflowY)}px (~${pct}%). Komprimera: färre spalter för korta texter, mindre foton eller lägre rubrikskala på sekundära artiklar.${railNote}`;
  }
  return `Sidans nedre ${100 - Math.round(m.fillRatio * 100)}% är tom. Fyll sidan: större foto- och rubrikstorlekar, bredare artiklar med färre spalter, eller luftigare densitet.`;
}
