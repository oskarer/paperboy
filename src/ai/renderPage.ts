import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { toFile } from "openai";
import { openai } from "./client.ts";
import { config } from "../config.ts";
import { loadSettings } from "../settings.ts";
import { STYLES, type StyleId } from "../styles.ts";
import type { IssueData, PageSpec, Story } from "../types.ts";
import type { CostGuard } from "../cost/guard.ts";

const EST_PAGE_USD = 0.15; // conservative pre-call estimate for the guard

interface Photo {
  buffer: ArrayBuffer;
  mime: string;
  storyIndex: number;
}

async function downloadPhotos(page: PageSpec): Promise<Photo[]> {
  const photos: Photo[] = [];
  for (const [i, story] of page.stories.entries()) {
    if (!story.imageUrl || photos.length >= config.maxPhotosPerPage) continue;
    try {
      const res = await fetch(story.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      if (!/image\/(jpeg|png|webp)/.test(mime)) continue;
      const buffer = await res.arrayBuffer();
      // SVT's "no photo" fallback is a blurry logo card that compresses tiny — skip those.
      if (buffer.byteLength < 12_000) continue;
      photos.push({ buffer, mime, storyIndex: i });
    } catch {
      // photo is optional — skip on any failure
    }
  }
  return photos;
}

function roleLabel(story: Story, index: number, leadIndex: number): string {
  if (index === leadIndex) return "LEAD STORY (largest headline, top of page)";
  return story.role === "brief" ? 'BRIEF (short notis under "I KORTHET")' : "SECONDARY STORY";
}

export function buildPagePrompt(
  page: PageSpec,
  issue: IssueData,
  photos: Photo[],
  styleOverride?: StyleId,
): string {
  const template = readFileSync("prompts/page.txt", "utf8");
  const settings = loadSettings();
  const paperName = settings.paperName;
  const style = STYLES[styleOverride ?? settings.style];
  const leadIndex = page.stories.findIndex((s) => s.role === "lead");

  const header =
    page.pageNumber === 1
      ? style.masthead(paperName, issue.dateSv)
      : style.pageHeader(paperName, page.title.toUpperCase(), issue.dateSv, page.pageNumber);

  const stories = page.stories
    .map((s, i) => {
      const lines = [
        `--- ARTICLE ${i + 1} · ${roleLabel(s, i, leadIndex)} ---`,
        `HEADLINE: ${s.headline}`,
        `BODY (typeset exactly):`,
        s.body,
        `CREDIT LINE AT STORY END: Källa: ${s.attribution}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  const photoMap =
    photos.length > 0
      ? photos.map((p, n) => `Attached photo ${n + 1} belongs to ARTICLE ${p.storyIndex + 1}.`).join("\n")
      : "This page has no photos: use typography only, with one thin-bordered box quote for visual variety.";

  return template
    .replace("{{PAPER_NAME}}", paperName)
    .replace("{{AESTHETIC}}", style.aesthetic)
    .replace("{{HEADER}}", header)
    .replace("{{STORY_COUNT}}", String(page.stories.length))
    .replace("{{STORIES}}", stories)
    .replace("{{PHOTO_MAP}}", photoMap);
}

async function callImageApi(prompt: string, photos: Photo[]) {
  const size = `${config.imageSize.width}x${config.imageSize.height}` as "1024x1536";
  const quality = loadSettings().imageQuality;
  if (photos.length > 0) {
    const files = await Promise.all(
      photos.map((p, n) =>
        toFile(p.buffer, `photo-${n + 1}.${p.mime.split("/")[1]}`, { type: p.mime }),
      ),
    );
    return openai.images.edit({
      model: config.imageModel,
      image: files,
      prompt,
      size,
      quality,
    });
  }
  return openai.images.generate({
    model: config.imageModel,
    prompt,
    size,
    quality,
  });
}

export async function renderPage(
  page: PageSpec,
  issue: IssueData,
  guard: CostGuard,
  outFile: string,
  styleOverride?: StyleId,
): Promise<void> {
  const photos = await downloadPhotos(page);
  const prompt = buildPagePrompt(page, issue, photos, styleOverride);
  const label = `page ${page.pageNumber} (${page.title})`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    guard.assertCanSpend(EST_PAGE_USD, label);
    try {
      const rsp = await callImageApi(prompt, photos);
      const b64 = rsp.data?.[0]?.b64_json;
      if (!b64) throw new Error("image API returned no b64_json");
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, Buffer.from(b64, "base64"));
      const usd = guard.recordImage(label, config.imageModel, rsp.usage, EST_PAGE_USD);
      console.log(`   ${label} → ${outFile} ($${usd.toFixed(3)})`);
      return;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (!retriable || attempt === 3) break;
      const waitS = attempt * 10;
      console.warn(`   ${label}: HTTP ${status}, retrying in ${waitS}s…`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  throw lastErr;
}
