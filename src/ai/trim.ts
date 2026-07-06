import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { openai } from "./client.ts";
import { config } from "../config.ts";
import type { ScrapedArticle } from "../types.ts";
import type { CostGuard } from "../cost/guard.ts";

const Trimmed = z.object({
  headline: z.string(),
  body: z.string(),
});

const SYSTEM = `Du är redigerare på en svensk tryckt morgontidning. Du kortar ner artiklar så att de får plats i spalterna.

Regler:
- Håll dig SÅ NÄRA originaltexten som möjligt: stryk meningar och bisatser i stället för att skriva om. Behåll journalistens ton och ordval.
- Sikta på angivet antal ord (±15 %). Behåll det viktigaste: vad som hänt, vem, var, konsekvenser.
- Rubrik: behåll originalrubriken om den är kort nog för en tidningsspalt (max ca 7 ord), annars korta den varsamt.
- Ren text på svenska, inga citattecken runt hela texten, ingen markdown, inga webbfraser ("Läs mer", "Klicka här").`;

export async function trimStory(
  article: ScrapedArticle,
  targetWords: number,
  guard: CostGuard,
): Promise<{ headline: string; body: string }> {
  const sourceBody = [article.lead, ...article.paragraphs].filter(Boolean).join("\n").slice(0, 6000);

  guard.assertCanSpend(0.002, `trim: ${article.headline.slice(0, 40)}`);
  const completion = await openai.chat.completions.parse({
    model: config.textModel,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Måltext: ca ${targetWords} ord.\n\nRUBRIK: ${article.headline}\n\nARTIKELTEXT:\n${sourceBody}`,
      },
    ],
    response_format: zodResponseFormat(Trimmed, "trimmed"),
  });
  guard.recordText(`trim: ${article.headline.slice(0, 40)}`, config.textModel, completion.usage);

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed?.body) {
    // Fall back to the untrimmed lead rather than failing the whole issue.
    return { headline: article.headline, body: article.lead || article.paragraphs[0] || "" };
  }
  return parsed;
}

export async function trimAll<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 5,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) await worker(item);
      }
    }),
  );
}
