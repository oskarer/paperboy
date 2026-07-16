// The one AI call of the HTML backend: gpt-5.6-sol composes a PageLayout spec.
// Article text never enters the model's output — only composition + captions.
import { readFileSync } from "node:fs";
import { zodResponseFormat } from "openai/helpers/zod";
import { openai } from "../../ai/client.ts";
import { config } from "../../config.ts";
import type { CostGuard } from "../../cost/guard.ts";
import type { StyleId } from "../../styles.ts";
import type { IssueData, PageSpec } from "../../types.ts";
import type { Photo } from "../photos.ts";
import { estimateContentRatio } from "./fit.ts";
import { PageLayoutSchema, type PageLayout } from "./schema.ts";

const EST_LAYOUT_USD = 0.1; // sol at $5/$30 per M: ~3k in + ~1.5k out ≈ $0.06

const STYLE_GRAMMAR: Record<StyleId, { grammar: string; archetypes: string }> = {
  classic: {
    grammar:
      "Tät klassisk morgontidning. boxed och knockoutHeadline används ALDRIG. I KORTHET-rail är typisk (höger). Återhållsamma rubrikskalor — lead oftast 4, sekundärer 2–3. Många smala celler: gärna 2–3 slots per rad under ledaren. Foton små (col/span2).",
    archetypes: [
      "lead-banner-rail: lead över hela huvudytan med 3 textspalter, rail till höger, sekundärer i rad under",
      "lead-photo-right: lead 6–7 kolumner med foto right, sekundär bredvid, notisrail",
      "double-decker: två breda rader med 2 artiklar vardera, briefs-band längst ner i stället för rail",
      "three-column-classic: lead + två sekundärer sida vid sida i rad 2, alla 3 kolumner breda",
      "quiet-bottom: lead + sekundärrad + smal briefs-slot längst ner till vänster",
    ].join("\n"),
  },
  modern: {
    grammar:
      "Samtida kvalitetstidning. Ledaren får dominera: skala 5, gärna foto (span2/span3). boxed och knockoutHeadline används ALDRIG — svarta balkar och kraftiga linjer kommer från stilmallen. Tydlig hierarki: stor lead, kompakta sekundärer.",
    archetypes: [
      "photo-lead-rail: lead 9 kolumner med foto right/top, I KORTHET-rail höger",
      "hero-lead: lead över hela huvudytan med wide-foto top, sekundärer i rad 2, briefs-band i rad 3",
      "asymmetric: lead 6 kolumner + hög sekundär 3 kolumner bredvid, rail höger",
      "magazine-row: lead med foto left, sedan rad med tre lika breda sekundärer",
    ].join("\n"),
  },
  tabloid: {
    grammar:
      "Kvällstidning. ENORM leadrubrik (skala 5) — gärna knockoutHeadline på leaden. boxed på en eller två sekundärer ger tryck. Foton får ta plats (span2–span3). Rail eller briefs-band längst ner. Density dense.",
    archetypes: [
      "shout-lead: lead över hela huvudytan, knockout-rubrik, stort foto top",
      "boxed-grid: lead + rad med 2–3 boxade sekundärer",
      "photo-dominant: lead med span3-foto left, sekundärer staplade till höger",
      "knockout-stack: två rader med knockout-rubriker, briefs-band längst ner",
    ].join("\n"),
  },
  minimal: {
    grammar:
      "Schweizisk typografi. Färre och bredare celler: max 2 slots per rad. 1–2 textspalter per slot. density airy eller normal. Små foton (col/span2). boxed och knockoutHeadline används ALDRIG. Rail valfri — notiser kan lika gärna ligga som ett lugnt band längst ner.",
    archetypes: [
      "quiet-lead: lead brett med litet foto right, en sekundär under, briefs-band sist",
      "two-block: lead + sekundär sida vid sida (7+5), notiser i rail",
      "column-flow: allt i en enda bred kolumnföljd, inga foton större än col",
      "whitespace-rail: smal rail vänster, luftig huvudyta med två rader",
    ].join("\n"),
  },
};

function contentInventory(page: PageSpec, photos: Photo[]): string {
  const withPhoto = new Set(photos.map((p) => p.storyIndex));
  return page.stories
    .map((s, i) => {
      const role = s.role === "lead" ? "LEAD" : s.role === "secondary" ? "SEKUNDÄR" : "NOTIS";
      const words = s.body.split(/\s+/).length;
      const photo = withPhoto.has(i)
        ? (() => {
            const p = photos.find((ph) => ph.storyIndex === i)!;
            const ar = p.width && p.height ? p.width / p.height : 1.5;
            return `, foto ${ar > 1.15 ? "liggande" : ar < 0.87 ? "stående" : "kvadratiskt"}`;
          })()
        : "";
      return `[id ${i}] ${role} "${s.headline}" — ${words} ord${photo}. Källa: ${s.attribution}`;
    })
    .join("\n");
}

export interface LayoutFeedback {
  previous: PageLayout;
  note: string;
}

export async function generateLayout(args: {
  page: PageSpec;
  issue: IssueData;
  style: StyleId;
  photos: Photo[];
  guard: CostGuard;
  usedArchetypes: string[];
  feedback?: LayoutFeedback;
}): Promise<PageLayout> {
  const { page, issue, style, photos, guard, usedArchetypes, feedback } = args;
  const styleBits = STYLE_GRAMMAR[style];

  const system = readFileSync("prompts/layout.txt", "utf8")
    .replace("{{STYLE_NAME}}", style)
    .replace("{{STYLE_GRAMMAR}}", styleBits.grammar)
    .replace("{{ARCHETYPES}}", styleBits.archetypes);

  const { ratio } = estimateContentRatio(page, style, photos);
  const pct = Math.round(ratio * 100);
  const fillHint =
    pct < 85
      ? " Innehållet är tunt — kompensera med större foton, generösare rubrikskalor, pullQuotes och density airy."
      : pct > 115
        ? " Innehållet är rikligt — density dense, små foton, kompakta rubriker och fler textspalter."
        : "";

  let user = `UPPDRAG: Komponera sidan "${page.title}" (sida ${page.pageNumber}${
    page.pageNumber === 1 ? ", förstasidan" : ""
  }) för ${issue.dateSv}.
Måltäckning: innehållet motsvarar ca ${pct} % av sidytan vid normal sättning.${fillHint}
${usedArchetypes.length > 0 ? `Arketyper som redan använts i tidningen: ${usedArchetypes.join(", ")}.` : ""}

ARTIKLAR:
${contentInventory(page, photos)}`;

  if (feedback) {
    user += `\n\nFÖRSÖK 2 — förra layouten:\n${JSON.stringify(feedback.previous)}\nResultat: ${feedback.note}\nGör en reviderad spec som åtgärdar detta.`;
  }

  const label = `${feedback ? "layout-fix" : "layout"} page ${page.pageNumber} (${page.title})`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    guard.assertCanSpend(EST_LAYOUT_USD, label);
    try {
      const completion = await openai.chat.completions.parse(
        {
          model: config.layoutModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: zodResponseFormat(PageLayoutSchema, "page_layout"),
        },
        // The SDK's 10-minute default would hang a whole page render; a layout
        // spec normally arrives in well under a minute.
        { timeout: 90_000, maxRetries: 0 },
      );
      guard.recordText(label, config.layoutModel, completion.usage);
      const parsed = completion.choices[0]?.message.parsed;
      if (!parsed) throw new Error(`layoutmodellen gav ingen giltig spec (${label})`);
      return parsed;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      // 401 is normally permanent, but the proxy throws sporadic ones — one retry is
      // cheap. No status = timeout/connection error, also worth retrying.
      const retriable =
        status == null || status === 429 || status === 401 || (status >= 500 && status < 600);
      if (!retriable || attempt === 3) break;
      const waitS = attempt * 5;
      console.warn(`   ${label}: HTTP ${status}, nytt försök om ${waitS}s…`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  throw lastErr;
}
