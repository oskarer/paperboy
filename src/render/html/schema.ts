// The layout spec the AI produces for one page. Deterministic code compiles it
// to HTML — article text never passes through the model, so it stays verbatim.
// (Nullable rather than optional throughout: OpenAI structured outputs require
// every key present.)
import { z } from "zod";

export const PhotoSpecSchema = z.object({
  /** Width step relative to the page's 12-column rhythm */
  size: z.enum(["col", "span2", "span3", "wide"]),
  position: z.enum(["top", "left", "right", "under-headline"]),
  /** One short factual sentence from the story — never a repeat of the headline */
  caption: z.string().max(140),
});

export const SlotSchema = z.object({
  type: z.enum(["story", "briefs"]),
  /** story: which story fills this slot */
  storyId: z.number().int().nullable(),
  /** briefs: stacked short items, in order */
  storyIds: z.array(z.number().int()).nullable(),
  /** Grid columns (of 12 minus rail) this slot spans */
  colSpan: z.number().int().min(2).max(12),
  /** 1 smallest … 5 lead-sized. Ignored for briefs. */
  headlineScale: z.number().int().min(1).max(5).nullable(),
  /** Text columns inside the slot. Ignored for briefs (always 1). */
  bodyColumns: z.number().int().min(1).max(3).nullable(),
  photo: PhotoSpecSchema.nullable(),
  /** One sentence copied VERBATIM from the story body, as a box-quote eye-catcher
   *  on photo-less stories. Anything not found verbatim in the body is dropped. */
  pullQuote: z.string().nullable(),
  /** tabloid only: thick black frame around the story */
  boxed: z.boolean().nullable(),
  /** tabloid only: white-on-black headline bar */
  knockoutHeadline: z.boolean().nullable(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const PageLayoutSchema = z.object({
  /** Named composition, e.g. "lead-banner-rail" — logged so variety is auditable */
  archetype: z.string(),
  /** Full-height "I KORTHET" column. Null when briefs sit in a briefs slot instead. */
  rail: z
    .object({
      side: z.enum(["left", "right"]),
      colSpan: z.number().int().min(2).max(3),
      storyIds: z.array(z.number().int()),
    })
    .nullable(),
  /** Top-to-bottom rows; each row's slot colSpans must sum to 12 − rail.colSpan */
  rows: z.array(z.object({ slots: z.array(SlotSchema).min(1) })).min(1),
  density: z.enum(["airy", "normal", "dense"]),
});
export type PageLayout = z.infer<typeof PageLayoutSchema>;
