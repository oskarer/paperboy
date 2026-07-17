# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Personal AI-generated morning newspaper: fetches Swedish news via RSS, an AI editor selects and prioritizes stories, pages are rendered as vintage broadsheet A4 pages, assembled into a print-ready PDF and optionally auto-printed. Runs as a local web app (control panel + scheduler) on port 4711. UI text, prompts, and much of the log output are in **Swedish**.

## Commands

Use **bun**, never node/npm. There is no test suite; `typecheck` is the only static check.

```bash
bun run typecheck            # tsc --noEmit — run after changes
bun run dry-run              # text pipeline only → out/dev/run.json (~$0.01)
bun run render-page <N> [runJson] [style|-] [image|html]
                             # re-render ONE page from cached run.json → out/dev/
bun run issue                # FULL issue incl. rendering — real API spend (~$0.50)
bun run src/web/server.ts    # control panel + scheduler at http://localhost:4711
```

Dev-only scripts:

```bash
bun run scripts/dev-compile-test.ts [style] [page]  # HTML backend without AI (hand-written layout spec)
bun run scripts/dev-calibrate.ts                    # re-measure font-width CAL constants in src/render/html/fit.ts
PRINTNEWS_DEBUG=1 bun run render-page 1 - - html    # dumps per-iteration HTML+metrics to out/dev/debug/
```

**Every pipeline run costs real OpenAI money.** The standard dev loop is: `dry-run` once to cache text data, then iterate with `render-page` on a single page. Costs are tracked by `CostGuard` (`src/cost/guard.ts`) into `out/<date>/cost.json` and `out/dev-ledger.json`.

## Architecture

### Two-phase pipeline

The pipeline is split so the cheap text phase can run without committing to the expensive render phase (this powers the "ask-first" approval mode where rendering waits for a phone notification tap):

1. **Text phase** — `generateDraft` (`src/issue.ts`) → `buildIssueData` (`src/pipeline.ts`): fetch RSS (`src/fetch/rss.ts`) → dedupe against the last 7 issues (`src/history.ts`) → AI story selection with `textModel` (`src/ai/select.ts`) → scrape full articles (`src/fetch/scrape.ts`, per-site strategies `svt`/`ntm`/`generic`; paywall login in `src/auth.ts`) → AI-trim each story to its column budget (`src/ai/trim.ts`). Result: `out/<date>/run.json`.
2. **Render phase** — `renderIssue` (`src/issue.ts`): render each page to PNG → assemble PDF (`src/pdf/assemble.ts`) → optional CUPS print (`src/print.ts`).

Entry points: `src/index.ts` (both phases), `scripts/draft.ts` (phase 1), `scripts/render-issue.ts` (phase 2 from a saved draft).

### Two render backends

`src/render/index.ts` is the dispatcher; `settings.renderBackend` picks the backend, callers can override. Unattended runs pass `fallback: true` so an HTML-backend failure falls back to the image backend (a missing morning paper is the worst outcome).

- **`image`** — `src/ai/renderPage.ts`: `gpt-image-2` paints the whole page (prompt: `prompts/page.txt`, ~$0.31/page, small text may garble).
- **`html`** — `src/render/html/`: `layoutModel` (gpt-5.6-sol) emits a JSON layout spec only (`schema.ts`, prompt: `prompts/layout.txt`); a deterministic compiler (`compile.ts` + `scaffold.ts` CSS) inserts article text **verbatim** — body text never passes through the layout model; Playwright Chromium (`chromium.ts`) measures and screenshots. ~$0.02–0.08/page.

### HTML backend fit loop (`src/render/html/renderPage.ts`)

Spec → pre-render validation gate (`layoutProblems`, up to 2 re-asks) → compile → measure in Chromium → deterministic "knob ladder" adjustments (`fit.ts`) → at most one AI layout repair → CSS-`zoom` shrink as last resort, with a hard re-measure guarantee that clipped text never prints, then a "polish" pass that spreads leftover air. Key invariants:

- **Never use `transform: scale` to shrink pages** — transforms don't reflow; the page box clips at unscaled height while measured rects look fine (caused clipped prints). Use CSS `zoom` (`pageZoom` override).
- Each page also emits a **vector PDF twin** (`page-N.pdf` via Chromium `page.pdf()`); `assemblePdf` prefers it over the PNG so print text stays sharp. PNGs remain for web preview.
- `fit.ts` has per-style `CAL` glyph-width constants measured in Chromium — rerun `scripts/dev-calibrate.ts` if scaffold fonts/typography change.
- **`playwright-core` is pinned exact (no `^`)** — it must match the Chromium build cached in `~/Library/Caches/ms-playwright`. Bumping it requires `bunx playwright-core install chromium`.

### Config vs settings

- `src/config.ts` — compile-time constants: model names, page dimensions, the 5 fixed page sections, freshness windows, cost caps.
- `settings.json` (repo root, gitignored, zod-validated in `src/settings.ts`) — everything user-tunable from the web UI: schedule, sources, interests, printer, style, `renderBackend`, ntfy topic, paywall credentials. Never commit it and never write credentials into issue output.

### Web server (`src/web/server.ts`)

`Bun.serve` with the React frontend imported as `index.html` (bundled by bun, Tailwind 4 via `bun-plugin-tailwind`, shadcn-style components in `src/web/frontend/components/ui/`, path alias `@/*` → `src/web/frontend/*`). Generation jobs run as **spawned child processes** (`bun run src/index.ts` etc.) with logs pumped into an in-memory ring buffer — the server itself never renders. The scheduler loop lives inside the server (catch-up after sleep, max 3 attempts/day, ≥15 min apart). Approval flow: draft done → ntfy push with an Approve action hitting `/api/approve?token=…` over LAN.

### Styles

Four visual styles (`classic`, `modern`, `tabloid`, `minimal`) defined in `src/styles.ts`, consumed by both backends (prompt wording for image, CSS tokens for HTML). The blackletter masthead font is vendored at `assets/fonts/` and base64-inlined at render time.
