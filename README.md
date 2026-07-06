# print-news 🗞

Your personal AI-generated morning newspaper. Every morning it fetches news
from real news sites, an AI editor picks and prioritizes the best stories, and
each page is rendered by an image model as a dense, multi-column vintage
broadsheet — with the articles' real press photos. Out comes a print-ready A4
PDF, optionally sent straight to your printer before you wake up.

Built for Swedish news (SVT, Sveriges Radio, Aftonbladet, Expressen, DN, SvD,
GP) but the source catalog is easy to extend.

## How it works

1. **Fetch** — RSS feeds from all enabled sources (`src/sources.ts`). Only news
   published since the previous issue is considered (with no previous issue,
   since the previous scheduled slot — a weekdays-only paper covers the whole
   weekend on Monday), and articles printed in the last 7 issues are filtered
   out (`src/history.ts`)
2. **Select** — a cheap text model (gpt-5.4-nano) acts as news editor: picks
   stories, weights your interests, assigns them to 5 themed pages, then runs
   a dedup pass so the same event never appears twice
3. **Scrape** — full article text + photos from the article pages (per-site
   strategies; paywalled articles fall back to their RSS teasers)
4. **Trim** — each story is gently shortened to fit its column space, staying
   close to the original wording
5. **Render** — `gpt-image-2` (images.edit) renders each page as a newspaper
   page at 1664×2352 (~200 dpi on A4), embedding the real press photos
6. **Assemble** — the 5 page images become one A4 PDF; optional auto-print
   via CUPS `lp`

A note on fidelity: image models typeset *most* text faithfully but small
print occasionally garbles — that's the trade-off for pages that genuinely
look like a printed paper. If you want pixel-perfect text, this is not the
project for you (render HTML to PDF instead); if you want your mornings to
feel like 1994, proceed.

## Requirements

- [bun](https://bun.sh) ≥ 1.1
- An OpenAI API key with access to `gpt-image-2` (may require one-time
  organization verification) and a gpt-5-class nano/mini text model
- macOS for the included service installer and printing; the server itself
  runs anywhere bun runs (use systemd or similar to keep it alive on Linux)

## Quick start

```bash
git clone <this-repo> && cd print-news
bun install
cp .env.example .env        # add your OPENAI_API_KEY
bun run issue               # generate today's paper (~$0.50 in API cost)
open out/*/issue.pdf
```

## Control panel + automatic mornings

```bash
./install.sh                # installs a LaunchAgent (login item, kept alive)
```

Then open **http://localhost:4711** (or `http://<your-machine>.local:4711`
from your phone). From there you can:

- generate and print issues, browse the archive
- set the **schedule**: time of day, which weekdays, and one of three modes —
  **auto** (generate fully), **ask first** (see below), or **off** (the
  scheduler runs inside the server — catch-up after sleep, max 3 attempts/day)
- set **interests** that bias story selection (main news keeps the leads)
- toggle **sources**, pick a **printer** and enable **auto-print**
- rename the paper, tune image quality and page density

### Ask-first mode: approve from your phone

Image rendering is the expensive part (~$0.45 of the ~$0.50 issue). In
**ask-first** mode the scheduler only runs the cheap text pipeline (~$0.02),
then pushes a notification to your phone via [ntfy](https://ntfy.sh) with the
day's lead headlines and an **Approve** button. Nothing renders until you tap
it (the button reaches your machine over LAN/Wi-Fi; the pending draft can also
be approved from the control panel).

Setup: install the ntfy app, subscribe to a secret topic name of your choice,
enter the same topic in the control panel, and hit "Test notification".

All of it lives in `settings.json` and applies from the next issue.

## Cost

Roughly **$0.50 per issue** at defaults (5 pages, medium quality): ~$0.45 of
image generation and ~$0.03 of text. A hard cap (default **$1.00/issue**,
`src/config.ts`) aborts any run that would exceed it. Every API call's real
token usage is logged to `out/<date>/cost.json` and accumulated in
`out/dev-ledger.json`.

## Development loop

```bash
bun run dry-run        # text pipeline only → out/dev/run.json (~$0.01)
bun run render-page 1  # re-render ONE page from that cache (~$0.09)
bun run typecheck
```

The page-layout prompt is `prompts/page.txt` — edit, re-render one page, look
at the PNG, repeat.

## Adding sources

Add an entry to `SOURCE_CATALOG` in `src/sources.ts` with a feed URL, a
section (or `inferSection` for mixed feeds), and a scrape strategy:
`generic` (JSON-LD/article-tag extraction), `rss-only` (feed text only), or a
custom one like the built-in `svt`. It appears in the control panel
automatically.

## Uninstall

```bash
launchctl bootout gui/$(id -u)/com.printnews.web
rm ~/Library/LaunchAgents/com.printnews.web.plist
```

## License & fair use

MIT. This tool is for **personal use**: it prints one copy of publicly
available news for your own breakfast table, with source attribution on every
story. Don't redistribute the generated papers, and respect the source sites'
terms and robots policies.
