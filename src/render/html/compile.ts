// Compiles an AI layout spec (schema.ts) to a full HTML document against the
// deterministic scaffold. Headlines, bodies and attributions are inserted here,
// verbatim — the model never rewrites article text.
import type { PageSpec, Story } from "../../types.ts";
import type { StyleId } from "../../styles.ts";
import type { Photo } from "../photos.ts";
import { toDataUri } from "../photos.ts";
import type { PageLayout, Slot } from "./schema.ts";
import {
  esc,
  mastheadHtml,
  pageHeaderHtml,
  railHeader,
  scaffoldCss,
  spanWidth,
  type TypeOverrides,
} from "./scaffold.ts";

export interface FitOverrides extends TypeOverrides {
  /** Shrink every photo this many size steps (0–3) */
  photoStep?: number;
  /** Demote all non-lead headlines one scale step */
  demoteHeadlines?: boolean;
  /** Ladder bookkeeping: growth steps taken on an underfull page */
  growSteps?: number;
  /** Ladder bookkeeping: current overflow rung */
  ladderStep?: number;
}

export interface CompileArgs {
  layout: PageLayout;
  page: PageSpec;
  style: StyleId;
  paperName: string;
  dateSv: string;
  photos: Photo[];
}

const PHOTO_SIZES = ["col", "span2", "span3", "wide"] as const;
type PhotoSize = (typeof PHOTO_SIZES)[number];
/** Photo width steps expressed in the page's 12-column rhythm */
const PHOTO_SPAN: Record<PhotoSize, number> = { col: 2, span2: 4, span3: 5, wide: 12 };
const ASPECTS = [16 / 9, 3 / 2, 4 / 5];

/**
 * Make an AI spec safe to compile: every story exactly once, sane spans,
 * photos only where they exist, style-gated decorations. Trivial problems are
 * repaired silently (returned as warnings); structural ones are for the
 * orchestrator to judge.
 */
export function normalizeLayout(layout: PageLayout, page: PageSpec, photos: Photo[]): string[] {
  const warnings: string[] = [];
  const n = page.stories.length;
  const photoByStory = new Map(photos.map((p) => [p.storyIndex, p]));

  const seen = new Set<number>();
  const claim = (id: number): boolean => {
    if (id < 0 || id >= n || seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  if (layout.rail) {
    layout.rail.storyIds = layout.rail.storyIds.filter(claim);
    if (layout.rail.storyIds.length === 0) {
      layout.rail = null;
      warnings.push("rail hade inga giltiga stories — borttagen");
    }
  }
  const mainCols = 12 - (layout.rail?.colSpan ?? 0);

  for (const row of layout.rows) {
    row.slots = row.slots.filter((slot) => {
      if (slot.type === "briefs") {
        slot.storyIds = (slot.storyIds ?? []).filter(claim);
        return slot.storyIds.length > 0;
      }
      return slot.storyId != null && claim(slot.storyId);
    });
  }
  layout.rows = layout.rows.filter((r) => r.slots.length > 0);

  // Orphaned stories: append rather than lose content.
  const missing = page.stories.map((_, i) => i).filter((i) => !seen.has(i));
  if (missing.length > 0) {
    warnings.push(`stories saknades i layouten: ${missing.join(", ")} — tillagda i slutet`);
    const briefs = missing.filter((i) => page.stories[i]!.role === "brief");
    const rest = missing.filter((i) => page.stories[i]!.role !== "brief");
    if (briefs.length > 0) {
      if (layout.rail) layout.rail.storyIds.push(...briefs);
      else
        layout.rows.push({
          slots: [{ type: "briefs", storyIds: briefs, colSpan: mainCols, storyId: null, headlineScale: null, bodyColumns: null, photo: null, pullQuote: null, boxed: null, knockoutHeadline: null }],
        });
    }
    for (const i of rest) {
      layout.rows.push({
        slots: [{ type: "story", storyId: i, colSpan: mainCols, headlineScale: 2, bodyColumns: Math.min(3, Math.floor(mainCols / 3)), storyIds: null, photo: null, pullQuote: null, boxed: null, knockoutHeadline: null }],
      });
    }
  }
  if (layout.rows.length === 0) {
    throw new Error("layout innehåller inga rader efter normalisering");
  }

  // Per-row: clamp spans so each row fills its width exactly.
  for (const row of layout.rows) {
    for (const slot of row.slots) slot.colSpan = Math.min(Math.max(slot.colSpan, 2), mainCols);
    const sum = row.slots.reduce((s, sl) => s + sl.colSpan, 0);
    if (sum !== mainCols) {
      warnings.push(`radbredd ${sum}≠${mainCols} — justerad`);
      // Distribute the difference, largest slots first (they absorb change best).
      let diff = mainCols - sum;
      const order = [...row.slots].sort((a, b) => b.colSpan - a.colSpan);
      while (diff !== 0) {
        const slot = order[Math.abs(diff) % order.length]!;
        const step = diff > 0 ? 1 : -1;
        if (slot.colSpan + step >= 2 && slot.colSpan + step <= mainCols) {
          slot.colSpan += step;
          diff -= step;
        } else if (order.every((s) => s.colSpan <= 2) && diff < 0) {
          break; // cannot shrink further
        } else {
          order.push(order.shift()!); // try another slot
        }
      }
    }
  }

  const leadIndex = page.stories.findIndex((s) => s.role === "lead");
  for (const [ri, row] of layout.rows.entries()) {
    for (const slot of row.slots) {
      if (slot.type !== "story") continue;
      const story = page.stories[slot.storyId!]!;
      const words = story.body.split(/\s+/).length;

      slot.headlineScale = Math.min(Math.max(slot.headlineScale ?? 2, 1), 5);
      if (slot.storyId === leadIndex && slot.headlineScale < 4) {
        slot.headlineScale = 4;
        warnings.push("huvudnyhetens rubrik uppgraderad till skala 4");
      }
      if (slot.storyId === leadIndex && ri > 0) warnings.push("huvudnyheten ligger inte i första raden");

      const maxCols = Math.max(1, Math.min(3, Math.floor(slot.colSpan / 3), Math.ceil(words / 45)));
      slot.bodyColumns = Math.min(Math.max(slot.bodyColumns ?? 1, 1), maxCols);

      if (slot.pullQuote) {
        const q = slot.pullQuote.trim();
        if (q.length > 160 || !story.body.includes(q)) {
          slot.pullQuote = null;
          warnings.push(`citat för artikel ${slot.storyId} var inte ordagrant ur brödtexten — borttaget`);
        } else {
          slot.pullQuote = q;
        }
      }
      if (slot.photo) {
        if (!photoByStory.has(slot.storyId!) || story.role === "brief") {
          slot.photo = null;
        } else {
          // A photo can't be wider than its slot (wide = full slot width).
          while (slot.photo.size !== "wide" && PHOTO_SPAN[slot.photo.size] > slot.colSpan) {
            slot.photo.size = PHOTO_SIZES[PHOTO_SIZES.indexOf(slot.photo.size) - 1] ?? "col";
          }
          // Side-by-side photo+text needs real width; narrow slots stack instead.
          if (["left", "right"].includes(slot.photo.position) && (slot.photo.size === "wide" || slot.colSpan < 5))
            slot.photo.position = "top";
        }
      }
    }
  }

  // Style-gated decorations are stripped in compileSlot (needs style context).
  return warnings;
}

function photoHtml(
  photo: Photo,
  photoNumber: number,
  spec: NonNullable<Slot["photo"]>,
  slotSpan: number,
  photoStep: number,
): { block: string; side: "left" | "right" | null } {
  const side = spec.position === "left" || spec.position === "right" ? spec.position : null;
  const sizeIdx = Math.max(0, PHOTO_SIZES.indexOf(spec.size) - photoStep);
  const size = PHOTO_SIZES[sizeIdx]!;
  // Side photos narrower than 3 columns leave captions wrapping one word per line.
  const span = Math.min(side ? Math.max(PHOTO_SPAN[size], 3) : PHOTO_SPAN[size], slotSpan);
  const widthPx = size === "wide" && !side ? spanWidth(slotSpan) : spanWidth(span);

  const srcAspect = photo.width && photo.height ? photo.width / photo.height : 3 / 2;
  const aspect = ASPECTS.reduce((best, a) =>
    Math.abs(a - srcAspect) < Math.abs(best - srcAspect) ? a : best,
  );

  // aspect-ratio + height:auto keeps proportions even if flex squeezes the figure.
  const block = `<figure class="photo" style="width:${widthPx}px">
<img src="{{PHOTO_${photoNumber}}}" style="aspect-ratio:${aspect.toFixed(4)}" alt="">
<figcaption class="caption">${esc(spec.caption)}</figcaption>
</figure>`;
  return { block, side };
}

function storyBody(story: Story, columns: number, pullQuote?: string | null): string {
  const paragraphs = story.body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`);
  // A pull quote sits mid-flow, like a set quote in a real column.
  if (pullQuote) paragraphs.splice(Math.ceil(paragraphs.length / 2), 0, `<blockquote class="pullquote">${esc(pullQuote)}</blockquote>`);
  const colCss = columns > 1 ? ` style="column-count:${columns}"` : "";
  return `<div class="story-body"${colCss}>${paragraphs.join("")}</div>`;
}

function briefHtml(story: Story): string {
  return `<div class="brief"><div class="brief-head">${esc(story.headline)}</div>${esc(
    story.body.replace(/\n+/g, " "),
  )} <span class="kalla">Källa: ${esc(story.attribution)}</span></div>`;
}

function compileSlot(
  slot: Slot,
  page: PageSpec,
  style: StyleId,
  photos: Photo[],
  o: FitOverrides,
  leadIndex: number,
  rowIndex: number,
  hasRail: boolean,
): string {
  if (slot.type === "briefs") {
    const items = (slot.storyIds ?? []).map((id) => briefHtml(page.stories[id]!)).join("");
    // Wide briefs bands flow in columns instead of one full-width wall of text.
    const cols = Math.max(1, Math.min(3, Math.round(slot.colSpan / 4)));
    const flow = cols > 1 ? ` style="column-count:${cols};column-gap:13px"` : "";
    // One I KORTHET label per page: a band next to a rail is a continuation.
    const header = hasRail ? "" : railHeader(style);
    return `<div class="slot briefs" style="grid-column:span ${slot.colSpan}" data-row="${rowIndex}">${header}<div class="briefs-flow"${flow}>${items}</div></div>`;
  }

  const story = page.stories[slot.storyId!]!;
  const isLead = slot.storyId === leadIndex;
  let scale = slot.headlineScale ?? 2;
  if (o.demoteHeadlines && !isLead && scale > 1) scale -= 1;

  const boxed = style === "tabloid" && slot.boxed;
  const knockout = style === "tabloid" && slot.knockoutHeadline;
  const headline = `<div class="headline-wrap${knockout ? " ko-wrap" : ""}"><h2 class="headline s${scale}${
    knockout ? " ko" : ""
  }" data-scale="${scale}">${esc(story.headline)}</h2></div>`;

  const photoIdx = photos.findIndex((p) => p.storyIndex === slot.storyId);
  let photoBlock = "";
  let photoSide: "left" | "right" | null = null;
  if (slot.photo && photoIdx >= 0) {
    const r = photoHtml(photos[photoIdx]!, photoIdx + 1, slot.photo, slot.colSpan, o.photoStep ?? 0);
    photoBlock = r.block;
    photoSide = r.side;
  }

  const body = storyBody(story, slot.bodyColumns ?? 1, slot.pullQuote);
  const kalla = `<div class="kalla">Källa: ${esc(story.attribution)}</div>`;

  let inner: string;
  if (photoSide) {
    const content =
      photoSide === "left" ? `${photoBlock}<div>${body}${kalla}</div>` : `<div>${body}${kalla}</div>${photoBlock}`;
    inner = `${headline}<div class="slot-content">${content}</div>`;
  } else if (slot.photo?.position === "top" && photoBlock) {
    inner = `${photoBlock}${headline}${body}${kalla}`;
  } else {
    inner = `${headline}${photoBlock}${body}${kalla}`;
  }

  const classes = ["slot", "story", isLead ? "lead" : "", boxed ? "boxed" : ""].filter(Boolean).join(" ");
  return `<article class="${classes}" style="grid-column:span ${slot.colSpan}" data-slot="${slot.storyId}" data-row="${rowIndex}">${inner}</article>`;
}

export function compilePage(args: CompileArgs, o: FitOverrides = {}): string {
  const { layout, page, style, paperName, dateSv, photos } = args;
  const leadIndex = page.stories.findIndex((s) => s.role === "lead");
  const mainCols = 12 - (layout.rail?.colSpan ?? 0);

  const rows = layout.rows
    .map((row, ri) => {
      const slots = row.slots
        .map((s) => compileSlot(s, page, style, photos, o, leadIndex, ri, layout.rail != null))
        .join("");
      return `<div class="row" style="grid-template-columns:repeat(${mainCols},1fr)">${slots}</div>`;
    })
    .join("");

  let railBlock = "";
  if (layout.rail) {
    const items = layout.rail.storyIds.map((id) => briefHtml(page.stories[id]!)).join("");
    railBlock = `<aside class="rail ${layout.rail.side}" style="width:${spanWidth(layout.rail.colSpan)}px">${railHeader(style)}<div class="rail-flow">${items}</div></aside>`;
  }

  const main = `<div class="main">${rows}</div>`;
  const grid =
    layout.rail?.side === "left" ? `${railBlock}${main}` : `${main}${railBlock}`;

  const header =
    page.pageNumber === 1
      ? mastheadHtml(style, paperName, dateSv)
      : pageHeaderHtml(style, paperName, page.title.toUpperCase(), dateSv, page.pageNumber);

  return `<!DOCTYPE html>
<html lang="sv"><head><meta charset="utf-8">
<style>${scaffoldCss(style, layout.density, o)}</style>
</head><body><div id="page" class="style-${style}">
${header}
<div class="body-grid">${grid}</div>
</div></body></html>`;
}

/** Swap {{PHOTO_n}} tokens for data URIs right before rendering. */
export function substitutePhotos(html: string, photos: Photo[]): string {
  return html.replace(/\{\{PHOTO_(\d+)\}\}/g, (_, n) => {
    const photo = photos[Number(n) - 1];
    return photo ? toDataUri(photo) : "";
  });
}
