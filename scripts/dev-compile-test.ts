// Dev-only: render one page from a hand-written layout spec (no AI call) to
// verify scaffold + compile + chromium end-to-end.
// Usage: bun run scripts/dev-compile-test.ts [styleId] [pageNumber]
import { readFileSync } from "node:fs";
import type { IssueData } from "../src/types.ts";
import { STYLE_IDS, type StyleId } from "../src/styles.ts";
import { downloadPhotos } from "../src/render/photos.ts";
import { compilePage, normalizeLayout, substitutePhotos } from "../src/render/html/compile.ts";
import type { PageLayout } from "../src/render/html/schema.ts";
import { closeBrowser, loadAndMeasure, newRenderPage, screenshotPage } from "../src/render/html/chromium.ts";

const style = (process.argv[2] ?? "modern") as StyleId;
if (!STYLE_IDS.includes(style)) throw new Error(`unknown style ${style}`);
const pageNumber = Number(process.argv[3] ?? 1);

const issue: IssueData = JSON.parse(readFileSync("out/dev/run.json", "utf8"));
const page = issue.pages.find((p) => p.pageNumber === pageNumber)!;

// Hand-written archetype: photo lead left, secondaries beside/below, briefs in right rail.
const briefs = page.stories.flatMap((s, i) => (s.role === "brief" ? [i] : []));
const secondaries = page.stories.flatMap((s, i) => (s.role === "secondary" ? [i] : []));
const lead = page.stories.findIndex((s) => s.role === "lead");

const nul = { storyIds: null, storyId: null, headlineScale: null, bodyColumns: null, photo: null, pullQuote: null, boxed: null, knockoutHeadline: null };
const layout: PageLayout = {
  archetype: "dev-hand-lead-rail",
  rail: briefs.length > 0 ? { side: "right", colSpan: 3, storyIds: briefs } : null,
  density: "dense",
  rows: [
    {
      slots: [
        {
          ...nul,
          type: "story",
          storyId: lead,
          colSpan: 9,
          headlineScale: 5,
          bodyColumns: 3,
          photo: page.stories[lead]!.imageUrl
            ? { size: "span3", position: "right", caption: "Pressbild till huvudnyheten på sidan." }
            : null,
        },
      ],
    },
    ...(secondaries.length > 0
      ? [
          {
            slots: secondaries.map((id, k) => ({
              ...nul,
              type: "story" as const,
              storyId: id,
              colSpan: Math.floor(9 / secondaries.length),
              headlineScale: 3 - Math.min(k, 1),
              bodyColumns: 2,
              photo:
                k === 0 && page.stories[id]!.imageUrl
                  ? { size: "span2" as const, position: "top" as const, caption: "Bild till artikeln." }
                  : null,
            })),
          },
        ]
      : []),
  ],
};

const photos = await downloadPhotos(page);
console.log(`photos: ${photos.length} (${photos.map((p) => `story ${p.storyIndex} ${p.width}×${p.height}`).join(", ")})`);
const warnings = normalizeLayout(layout, page, photos);
if (warnings.length) console.log("normalize:", warnings.join(" | "));

const html = compilePage({ layout, page, style, paperName: "TOBOBLADET", dateSv: issue.dateSv, photos });
const pg = await newRenderPage();
try {
  const m = await loadAndMeasure(pg, substitutePhotos(html, photos));
  console.log("fit:", JSON.stringify({ ...m, headlineLines: undefined }), "headlines:", JSON.stringify(m.headlineLines));
  const out = `out/dev/compile-test-${style}-p${pageNumber}.png`;
  await screenshotPage(pg, out);
  console.log(`→ ${out}`);
} finally {
  await closeBrowser();
}
