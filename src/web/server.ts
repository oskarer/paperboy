import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { loadSettings, saveSettings, SettingsSchema } from "../settings.ts";
import type { Source } from "../sources.ts";
import { discoverSource } from "../discover.ts";
import { testLogin } from "../auth.ts";
import { listPrinters, printPdf } from "../print.ts";
import { isDue, nextRun } from "../scheduler.ts";
import { draftPending, loadDraft } from "../issue.ts";
import { sendNtfy } from "../notify.ts";

import indexHtml from "./index.html";

const PORT = 4711;

// ————— generation child process —————
const gen = {
  running: false,
  kind: null as "issue" | "draft" | "render" | null,
  startedAt: null as string | null,
  lastExit: null as number | null,
  log: [] as string[],
};

function pushLog(text: string) {
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed) gen.log.push(trimmed);
  }
  if (gen.log.length > 300) gen.log = gen.log.slice(-300);
}

async function pump(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) pushLog(decoder.decode(chunk));
}

const JOB_SCRIPTS = {
  issue: "src/index.ts",
  draft: "scripts/draft.ts",
  render: "scripts/render-issue.ts",
} as const;

function startJob(kind: keyof typeof JOB_SCRIPTS, args: string[] = []): boolean {
  if (gen.running) return false;
  gen.running = true;
  gen.kind = kind;
  gen.startedAt = new Date().toISOString();
  gen.lastExit = null;
  gen.log = [];
  const proc = Bun.spawn(["bun", "run", JOB_SCRIPTS[kind], ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  void pump(proc.stdout);
  void pump(proc.stderr);
  void proc.exited.then(async (code) => {
    gen.running = false;
    gen.lastExit = code;
    pushLog(code === 0 ? "✓ klart" : `✗ avslutades med kod ${code}`);
    if (kind === "draft" && code === 0) await sendApprovalRequest(todayStr());
  });
  return true;
}

// ————— issue helpers —————
function todayStr(): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(new Date());
}

// ————— approval notifications (schedule mode "approve") —————
function approveTokenFor(date: string): string {
  const tokenPath = join(config.outDir, date, "approve-token");
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    const token = crypto.randomUUID();
    writeFileSync(tokenPath, token);
    return token;
  }
}

function lanUrl(path: string): string {
  const host = hostname().replace(/\.local$/, "");
  return `http://${host}.local:${PORT}${path}`;
}

async function sendApprovalRequest(date: string): Promise<{ ok: boolean; message: string }> {
  const settings = loadSettings();
  if (!settings.ntfyTopic) return { ok: false, message: "ingen ntfy-topic inställd" };
  if (!draftPending(date)) return { ok: false, message: "inget utkast väntar" };

  const issue = loadDraft(date);
  const stories = issue.pages.flatMap((p) => p.stories);
  const headlines = issue.pages
    .map((p) => p.stories.find((s) => s.role === "lead")?.headline)
    .filter(Boolean)
    .map((h) => `• ${h}`)
    .join("\n");
  const token = approveTokenFor(date);

  const result = await sendNtfy(settings.ntfyTopic, {
    title: `${settings.paperName} ${date} — ${stories.length} artiklar klara`,
    message: `${headlines}\n\nGodkänn för att rendera${settings.printer.autoPrint ? " och skriva ut" : ""} (~$0.50).`,
    actions: [
      { action: "http", label: "Godkänn ✓", url: lanUrl(`/api/approve?token=${token}&date=${date}`), method: "POST", clear: true },
      { action: "view", label: "Öppna panelen", url: lanUrl("/") },
    ],
  });
  pushLog(result.ok ? `📱 godkännande-notis skickad` : `📱 notis misslyckades: ${result.message}`);
  return result;
}

// ————— automatic schedule —————
// Bounded retry so a failing run can't burn money all morning:
// max 3 attempts per day, at least 15 minutes apart.
const auto = { date: "", attempts: 0, lastAttemptAt: 0 };

function scheduleTick() {
  const settings = loadSettings();
  const now = new Date();
  const today = todayStr();
  // In approve mode a finished draft counts as "done" — rendering waits for the user.
  const doneMarker =
    settings.schedule.mode === "approve"
      ? existsSync(join(config.outDir, today, "run.json"))
      : existsSync(join(config.outDir, today, "issue.pdf"));
  if (!isDue(settings.schedule, now, doneMarker) || gen.running) return;

  if (auto.date !== today) Object.assign(auto, { date: today, attempts: 0, lastAttemptAt: 0 });
  if (auto.attempts >= 3) return;
  if (auto.attempts > 0 && Date.now() - auto.lastAttemptAt < 15 * 60_000) return;

  auto.attempts++;
  auto.lastAttemptAt = Date.now();
  const kind = settings.schedule.mode === "approve" ? "draft" : "issue";
  pushLog(`⏰ schemalagd ${kind === "draft" ? "utkast" : "generering"} (försök ${auto.attempts})`);
  startJob(kind);
}

setInterval(scheduleTick, 60_000);
setTimeout(scheduleTick, 5_000); // catch-up shortly after boot/login

function issueCost(date: string): number | null {
  try {
    return JSON.parse(readFileSync(join(config.outDir, date, "cost.json"), "utf8")).totalUsd ?? null;
  } catch {
    return null;
  }
}

function listIssues() {
  let dirs: string[] = [];
  try {
    dirs = readdirSync(config.outDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    // out/ missing on first run
  }
  return dirs
    .sort()
    .reverse()
    .map((date) => ({
      date,
      hasPdf: existsSync(join(config.outDir, date, "issue.pdf")),
      costUsd: issueCost(date),
    }))
    .filter((i) => i.hasPdf);
}

function cumulativeSpend(): number | null {
  try {
    return JSON.parse(readFileSync(join(config.outDir, "dev-ledger.json"), "utf8")).totalUsd ?? null;
  } catch {
    return null;
  }
}

// ————— http —————
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 60,
  routes: { "/": indexHtml },
  // Launchd runs without NODE_ENV → production mode (cached, minified bundles).
  development: process.env.NODE_ENV === "development" ? { hmr: true, console: true } : false,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/status") {
      const today = todayStr();
      const settings = loadSettings();
      const pending = draftPending(today) && !gen.running;
      return json({
        today,
        paperName: settings.paperName,
        todayHasIssue: existsSync(join(config.outDir, today, "issue.pdf")),
        generating: gen.running,
        generatingKind: gen.kind,
        startedAt: gen.startedAt,
        lastExit: gen.lastExit,
        log: gen.log.slice(-50),
        todayCostUsd: issueCost(today),
        cumulativeUsd: cumulativeSpend(),
        scheduleMode: settings.schedule.mode,
        nextRunAt: nextRun(settings.schedule, new Date())?.toISOString() ?? null,
        autoAttemptsToday: auto.date === today ? auto.attempts : 0,
        draftPending: pending,
        draftStories: pending ? loadDraft(today).pages.reduce((n, p) => n + p.stories.length, 0) : null,
        approveToken: pending ? approveTokenFor(today) : null,
        ntfyConfigured: Boolean(settings.ntfyTopic),
      });
    }

    if (path === "/api/generate" && req.method === "POST") {
      const started = startJob("issue");
      return json({ started, alreadyRunning: !started }, started ? 202 : 409);
    }

    // Approve a pending draft → render. GET supported so the link also works
    // from a phone browser; ntfy's action button POSTs.
    if (path === "/api/approve" && (req.method === "POST" || req.method === "GET")) {
      const date = url.searchParams.get("date") ?? todayStr();
      const token = url.searchParams.get("token") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
      if (!draftPending(date)) return json({ error: "inget utkast väntar på godkännande" }, 409);
      if (token !== approveTokenFor(date)) return json({ error: "fel token" }, 403);
      const started = startJob("render", [date]);
      if (req.method === "GET") {
        return new Response(
          `<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;text-align:center;padding-top:30vh">` +
            (started ? "🗞 Godkänt — tidningen renderas!" : "⏳ Rendering pågår redan"),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      return json({ started }, started ? 202 : 409);
    }

    if (path === "/api/test-notification" && req.method === "POST") {
      const settings = loadSettings();
      if (!settings.ntfyTopic) return json({ ok: false, message: "ingen ntfy-topic inställd" }, 400);
      const result = await sendNtfy(settings.ntfyTopic, {
        title: `${settings.paperName}: testnotis`,
        message: "Notiser fungerar! Så här kommer godkännande-frågan se ut.",
        actions: [{ action: "view", label: "Öppna panelen", url: lanUrl("/") }],
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (path === "/api/issues") return json(listIssues());

    // /issues/<YYYY-MM-DD>/<issue.pdf | page-N.png>
    const fileMatch = path.match(/^\/issues\/(\d{4}-\d{2}-\d{2})\/(issue\.pdf|page-\d\.png)$/);
    if (fileMatch) {
      const filePath = join(config.outDir, fileMatch[1]!, fileMatch[2]!);
      if (!existsSync(filePath)) return json({ error: "not found" }, 404);
      const type = filePath.endsWith(".pdf") ? "application/pdf" : "image/png";
      return new Response(Bun.file(filePath), { headers: { "Content-Type": type } });
    }

    if (path === "/api/print" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { date?: string };
      const date = body.date ?? todayStr();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
      const pdf = join(config.outDir, date, "issue.pdf");
      if (!existsSync(pdf)) return json({ error: `ingen tidning för ${date}` }, 404);
      const settings = loadSettings();
      const result = await printPdf(pdf, settings.printer.printerName);
      return json(result, result.ok ? 200 : 500);
    }

    if (path === "/api/printers") return json(await listPrinters());

    if (path === "/api/settings" && req.method === "GET") {
      return json({ settings: loadSettings() });
    }

    // Resolve a bare URL to feeds + name + strategy (preview before adding).
    if (path === "/api/sources/discover" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { url?: string };
      if (!body.url) return json({ error: "ingen URL" }, 400);
      try {
        return json(await discoverSource(body.url));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 422);
      }
    }

    // Verify paywall credentials for one source.
    if (path === "/api/sources/test-login" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { source?: Source };
      if (!body.source?.credentials) return json({ ok: false, message: "inga uppgifter" }, 400);
      const result = await testLogin(body.source);
      return json(result, result.ok ? 200 : 401);
    }

    if (path === "/api/settings" && req.method === "PUT") {
      const body = await req.json().catch(() => null);
      const parsed = SettingsSchema.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.issues }, 400);
      return json({ settings: saveSettings(parsed.data) });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`paperboy control panel: http://localhost:${PORT} (LAN: http://${hostname()}.local:${PORT})`);
