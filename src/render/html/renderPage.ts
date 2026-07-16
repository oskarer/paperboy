// HTML backend orchestrator: AI layout spec → validate → compile → measure →
// adjust (knob ladder / rail rebalance / one AI repair) → screenshot PNG.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSettings } from "../../settings.ts";
import type { StyleId } from "../../styles.ts";
import type { IssueData, PageSpec } from "../../types.ts";
import type { CostGuard } from "../../cost/guard.ts";
import { downloadPhotos } from "../photos.ts";
import { closeBrowser, loadAndMeasure, newRenderPage, pdfPage, screenshotPage, type FitMetrics } from "./chromium.ts";
import { compilePage, normalizeLayout, substitutePhotos, type FitOverrides } from "./compile.ts";
import { PAGE_PAD_BOTTOM } from "./scaffold.ts";
import { feedbackNote, layoutProblems, nextOverrides, rebalanceRail, verdict } from "./fit.ts";
import { generateLayout } from "./layout.ts";
import type { PageLayout } from "./schema.ts";

const MAX_RENDER_ITERATIONS = 12;
/** Longest a single page render may take before we relaunch chromium. */
const PAGE_TIMEOUT_MS = 90_000;

// Archetypes already used per issue date, so pages within one paper vary.
const usedArchetypes = new Map<string, string[]>();

/** Headlines that wrap absurdly get their scale stepped down, once per slot. */
function demoteWrappedHeadlines(layout: PageLayout, m: FitMetrics, demoted: Set<number>): boolean {
  let changed = false;
  for (const h of m.headlineLines) {
    const maxLines = h.scale >= 3 ? 3 : 4;
    if (h.lines <= maxLines || demoted.has(h.slot)) continue;
    for (const row of layout.rows) {
      for (const slot of row.slots) {
        if (slot.type === "story" && slot.storyId === h.slot && (slot.headlineScale ?? 2) > 1) {
          slot.headlineScale = (slot.headlineScale ?? 2) - 1;
          demoted.add(h.slot);
          changed = true;
        }
      }
    }
  }
  return changed;
}

export async function renderPageHtml(
  page: PageSpec,
  issue: IssueData,
  guard: CostGuard,
  outFile: string,
  styleOverride?: StyleId,
): Promise<void> {
  const settings = loadSettings();
  const style = styleOverride ?? settings.style;
  const label = `page ${page.pageNumber} (${page.title})`;
  const archetypes = usedArchetypes.get(issue.date) ?? [];
  usedArchetypes.set(issue.date, archetypes);

  const photos = await downloadPhotos(page);
  let layout = await generateLayout({ page, issue, style, photos, guard, usedArchetypes: archetypes });
  let warnings = normalizeLayout(layout, page, photos);
  if (warnings.length > 0) console.log(`   ${label}: ${warnings.join(" · ")}`);

  // Pre-render gate: composition flaws the typography dials can never fix are
  // cheaper to fix with a re-ask now than after chromium round trips.
  for (let gate = 1; gate <= 2; gate++) {
    const problems = layoutProblems(layout, page, style);
    if (problems.length === 0) break;
    console.log(`   ${label}: spec-problem — ${problems.join("; ")}`);
    layout = await generateLayout({
      page, issue, style, photos, guard,
      usedArchetypes: archetypes,
      feedback: { previous: layout, note: `Före rendering: ${problems.join("; ")}.` },
    });
    warnings = normalizeLayout(layout, page, photos);
    if (warnings.length > 0) console.log(`   ${label} (spec ${gate + 1}): ${warnings.join(" · ")}`);
  }

  const work = async (): Promise<void> => {
    const pg = await newRenderPage();
    try {
      let overrides: FitOverrides = {};
      let aiRepairUsed = false;
      let railRebalanced = false;
      let scaled = false;
      const demoted = new Set<number>();
      let m: FitMetrics | null = null;
      let measured: FitOverrides | null = null; // overrides state `m` was measured with

      for (let iter = 1; iter <= MAX_RENDER_ITERATIONS; iter++) {
        const html = compilePage(
          { layout, page, style, paperName: settings.paperName, dateSv: issue.dateSv, photos },
          overrides,
        );
        m = await loadAndMeasure(pg, substitutePhotos(html, photos));
        measured = overrides;
        if (process.env.PRINTNEWS_DEBUG) {
          const dbgDir = join("out", "dev", "debug");
          mkdirSync(dbgDir, { recursive: true });
          writeFileSync(join(dbgDir, `p${page.pageNumber}-iter${iter}.html`), html);
          writeFileSync(
            join(dbgDir, `p${page.pageNumber}-iter${iter}.json`),
            JSON.stringify({ overrides, m, layout }, null, 2),
          );
        }
        const v = verdict(m);

        // Fits, but reads badly? Composition flaws earn the one AI repair too.
        if (v === "fit" && !aiRepairUsed) {
          const flaws: string[] = [];
          for (const r of m.rowImbalance) {
            if (r.gapPx > 150)
              flaws.push(
                `rad ${r.row + 1}: innehållen slutar ${r.gapPx}px isär — para ihop texter av liknande höjd eller justera colSpan/bodyColumns`,
              );
          }
          if (layout.rail && m.railBottom != null) {
            const railAir = 1176 - PAGE_PAD_BOTTOM - m.railBottom;
            if (railAir > 260)
              flaws.push(
                `I KORTHET-spalten slutar ~${Math.round(railAir)}px över sidfoten — ge den fler notiser, gör den smalare eller lägg notiserna som band`,
              );
            const mainAir = m.railBottom - m.mainBottom;
            if (mainAir > 260)
              flaws.push(
                `huvudytan slutar ~${Math.round(mainAir)}px över I KORTHET-spalten — bredda artiklarna, höj rubrikskalorna eller lägg notiserna som ett band under artiklarna så att hela sidan fylls`,
              );
          }
          if (flaws.length > 0) {
            aiRepairUsed = true;
            layout = await generateLayout({
              page, issue, style, photos, guard,
              usedArchetypes: archetypes,
              feedback: { previous: layout, note: `Layouten får plats men ser gles ut: ${flaws.join("; ")}.` },
            });
            warnings = normalizeLayout(layout, page, photos);
            if (warnings.length > 0) console.log(`   ${label} (försök 2): ${warnings.join(" · ")}`);
            overrides = {};
            railRebalanced = false;
            demoted.clear();
            continue;
          }
        }
        if (v === "fit" || scaled) break;

        // Structural, content-preserving fixes first.
        if (demoteWrappedHeadlines(layout, m, demoted)) continue;
        if (v === "overflow" && !railRebalanced && rebalanceRail(layout, m)) {
          railRebalanced = true;
          overrides = {};
          continue;
        }

        const next = nextOverrides(m, overrides);
        if (next) {
          overrides = next;
          continue;
        }

        if (!aiRepairUsed) {
          aiRepairUsed = true;
          layout = await generateLayout({
            page, issue, style, photos, guard,
            usedArchetypes: archetypes,
            feedback: { previous: layout, note: feedbackNote(m) },
          });
          warnings = normalizeLayout(layout, page, photos);
          if (warnings.length > 0) console.log(`   ${label} (försök 2): ${warnings.join(" · ")}`);
          overrides = {};
          railRebalanced = false;
          demoted.clear();
          continue;
        }

        if (m.overflowY > 0) {
          // Last resort: reflowing zoom-shrink. Reflow makes it approximate,
          // so compose and let the loop re-measure until it converges.
          const inner = 1176 - PAGE_PAD_BOTTOM - 2;
          overrides = { ...overrides, pageZoom: (overrides.pageZoom ?? 1) * (inner / m.contentBottom) };
          scaled = true;
          continue;
        }
        break; // underfull with all knobs spent — print it with some air
      }

      // The loop can exhaust right after advancing overrides — re-measure so the
      // guarantee below never computes a scale from stale geometry.
      if (m && measured !== overrides) {
        const html = compilePage(
          { layout, page, style, paperName: settings.paperName, dateSv: issue.dateSv, photos },
          overrides,
        );
        m = await loadAndMeasure(pg, substitutePhotos(html, photos));
      }

      // Hard guarantee: whatever happened above, clipped text never prints.
      // Zoom reflows, so shrink-and-remeasure until the content actually fits.
      for (let attempt = 0; m && m.overflowY > 0 && attempt < 4; attempt++) {
        const inner = 1176 - PAGE_PAD_BOTTOM - 2;
        overrides = {
          ...overrides,
          pageZoom: (overrides.pageZoom ?? 1) * Math.min(inner / m.contentBottom, 0.985),
        };
        const html = compilePage(
          { layout, page, style, paperName: settings.paperName, dateSv: issue.dateSv, photos },
          overrides,
        );
        m = await loadAndMeasure(pg, substitutePhotos(html, photos));
      }

      // Full-bottom polish: distribute leftover air between rows, and stretch a
      // short rail with a CAPPED gap (a sparse rail must not become islands).
      // Back out if polish overflows.
      if (m && m.overflowY <= 0) {
        const polish: FitOverrides = { ...overrides };
        if (m.fillRatio < 0.99) polish.spread = true;
        if (layout.rail && m.railBottom != null) {
          const railAir = 1176 - 30 - m.railBottom;
          const n = layout.rail.storyIds.length;
          if (railAir > 24 && n > 1) polish.railGap = Math.min(14 + railAir / n, 42);
        }
        if (polish.spread || polish.railGap) {
          const html = compilePage(
            { layout, page, style, paperName: settings.paperName, dateSv: issue.dateSv, photos },
            polish,
          );
          const polishedM = await loadAndMeasure(pg, substitutePhotos(html, photos));
          if (polishedM.overflowY <= 0) {
            overrides = polish;
            m = polishedM;
          } else {
            const plain = compilePage(
              { layout, page, style, paperName: settings.paperName, dateSv: issue.dateSv, photos },
              overrides,
            );
            m = await loadAndMeasure(pg, substitutePhotos(plain, photos));
          }
        }
      }

      mkdirSync(dirname(outFile), { recursive: true });
      await screenshotPage(pg, outFile);
      // Vector twin for print — assemblePdf prefers it over the raster PNG.
      await pdfPage(pg, outFile.replace(/\.png$/, ".pdf"));
      const fit = m
        ? `${Math.round(m.fillRatio * 100)}% fylld${
            overrides.pageZoom && overrides.pageZoom < 1 ? ` (zoom ${overrides.pageZoom.toFixed(2)})` : ""
          }`
        : "";
      console.log(`   ${label} → ${outFile} [${layout.archetype}, ${fit}]`);
      archetypes.push(layout.archetype);
    } finally {
      await pg.close().catch(() => {});
    }
  };

  // A wedged chromium must not hang the whole issue — relaunch once and retry.
  try {
    await withTimeout(work(), PAGE_TIMEOUT_MS, label);
  } catch (err) {
    console.warn(`   ${label}: chromium-problem (${err instanceof Error ? err.message : err}) — startar om läsaren`);
    await closeBrowser();
    await withTimeout(work(), PAGE_TIMEOUT_MS, label);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: rendering timade ut efter ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
