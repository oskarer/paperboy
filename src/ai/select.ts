import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { openai } from "./client.ts";
import { config } from "../config.ts";
import type { Settings } from "../settings.ts";
import type { Candidate, StoryRole } from "../types.ts";
import type { CostGuard } from "../cost/guard.ts";

const Selection = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number().int(),
      stories: z.array(
        z.object({
          id: z.number().int(),
          role: z.enum(["lead", "secondary", "brief"]),
          targetWords: z.number().int(),
        }),
      ),
    }),
  ),
});

export interface SelectedStory {
  candidate: Candidate;
  role: StoryRole;
  targetWords: number;
}

export interface SelectedPage {
  pageNumber: number;
  title: string;
  stories: SelectedStory[];
}

function buildSystemPrompt(settings: Settings): string {
  const dense = settings.density === "compact";
  const perPage = dense ? "6–8" : "4–6";
  const minPerPage = dense ? 6 : 4;
  const frontPage = dense ? "6–7" : "4–5";

  const interests =
    settings.interests.length > 0
      ? `\nLäsarens intresseområden: ${settings.interests.join(", ")}. Vikta upp artiklar som matchar dessa områden — de får gärna ta secondary- och brief-platser — men dagens viktigaste huvudnyheter behåller alltid lead-platserna.`
      : "";

  return `Du är nyhetschef på en svensk morgontidning i tryckt format. Du får dagens kandidatartiklar (id, sektion, källa, rubrik, ingress) och ska sätta ihop tidningens ${config.pages.length} sidor.

Sidorna:
${config.pages.map((p) => `${p.pageNumber}. ${p.title} — ${p.brief}`).join("\n")}

Regler:
- Välj ${perPage} artiklar per sida — VARJE sida måste ha MINST ${minPerPage} artiklar; använd hellre fler notiser än att lämna en sida tunn. Varje artikel-id får bara användas EN gång i hela tidningen.
- Förstasidan: dagens ${frontPage} viktigaste nyheter oavsett sektion.
- Exakt en artikel per sida har role "lead" (störst). 2–3 "secondary". Resten "brief" (notiser).
- targetWords: lead 90–120, secondary 50–70, brief 25–40.
- Prioritera nyhetsvärde och bredd: viktiga inrikes- och utrikeshändelser före kuriosa och lokala smånyheter.
- VIKTIGAST AV ALLT — INGA DUBBLETTER: samma händelse får bara förekomma EN gång i hela tidningen. Flera källor rapporterar ofta samma nyhet med olika rubriker (t.ex. "Ryssland bombar Kiev" och "Ryskt anfall mot Kiev" är SAMMA händelse). Gå igenom ditt urval en extra gång och stryk varje artikel som täcker en händelse som redan finns med — behåll bara den bästa versionen.
- Sidorna 2–5 ska hålla sig till sitt tema.${interests}`;
}

const DropList = z.object({ dropIds: z.array(z.number().int()) });

/**
 * Second cheap pass over just the selected headlines: with ~35 titles the
 * "same event, different source" cases are easy to spot, unlike in the
 * full 250-candidate list.
 */
async function dedupeSelection(pages: SelectedPage[], guard: CostGuard): Promise<void> {
  const listing = pages
    .flatMap((p) => p.stories)
    .map((s) => `${s.candidate.id}: ${s.candidate.title} (${s.candidate.attribution})`)
    .join("\n");

  guard.assertCanSpend(0.005, "dedupe");
  const completion = await openai.chat.completions.parse({
    model: config.textModel,
    messages: [
      {
        role: "system",
        content:
          "Du får rubriker valda till en tidning. Olika källor rapporterar ibland SAMMA händelse med olika rubriker. Hitta varje grupp rubriker som täcker samma händelse och returnera id:na som ska strykas — behåll ett (1) id per händelse, helst det med mest informativ rubrik. Returnera tom lista om alla är unika händelser.",
      },
      { role: "user", content: listing },
    ],
    response_format: zodResponseFormat(DropList, "droplist"),
  });
  guard.recordText("dedupe", config.textModel, completion.usage);

  const drop = new Set(completion.choices[0]?.message.parsed?.dropIds ?? []);
  if (drop.size === 0) return;
  for (const page of pages) {
    page.stories = page.stories.filter((s) => !drop.has(s.candidate.id));
    if (page.stories.length === 0) continue;
    // Keep exactly one lead per page even after drops.
    if (!page.stories.some((s) => s.role === "lead")) page.stories[0]!.role = "lead";
  }
  console.log(`   dedupe dropped ${drop.size} duplicate stor${drop.size === 1 ? "y" : "ies"}`);
}

export async function selectStories(
  candidates: Candidate[],
  guard: CostGuard,
  settings: Settings,
): Promise<SelectedPage[]> {
  const catalog = candidates
    .map((c) => `${c.id} [${c.section}] (${c.attribution}) ${c.title} — ${c.description.slice(0, 180)}`)
    .join("\n");

  guard.assertCanSpend(0.02, "selection");
  const completion = await openai.chat.completions.parse({
    model: config.textModel,
    messages: [
      { role: "system", content: buildSystemPrompt(settings) },
      { role: "user", content: `Dagens kandidater:\n\n${catalog}` },
    ],
    response_format: zodResponseFormat(Selection, "selection"),
  });
  guard.recordText("selection", config.textModel, completion.usage);

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error("selection: model returned no parsed output");

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const used = new Set<number>();
  const pages: SelectedPage[] = [];

  for (const pageDef of config.pages) {
    const plan = parsed.pages.find((p) => p.pageNumber === pageDef.pageNumber);
    const stories: SelectedStory[] = [];
    for (const s of plan?.stories ?? []) {
      const candidate = byId.get(s.id);
      if (!candidate || used.has(s.id) || stories.length >= 8) continue;
      used.add(s.id);
      stories.push({
        candidate,
        role: s.role,
        targetWords: Math.min(Math.max(s.targetWords, 25), 140),
      });
    }
    if (stories.length === 0) throw new Error(`selection: page ${pageDef.pageNumber} got no stories`);
    // Guarantee exactly one lead per page.
    const leads = stories.filter((s) => s.role === "lead");
    if (leads.length === 0) stories[0]!.role = "lead";
    else leads.slice(1).forEach((s) => (s.role = "secondary"));
    pages.push({ pageNumber: pageDef.pageNumber, title: pageDef.title, stories });
  }
  await dedupeSelection(pages, guard);
  return pages;
}
