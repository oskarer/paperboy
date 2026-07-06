import { existsSync, readdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { loadSettings, saveSettings, SettingsSchema } from "../settings.ts";
import { SOURCE_CATALOG } from "../sources.ts";
import { listPrinters, printPdf } from "../print.ts";
import { isDue, nextRun } from "../scheduler.ts";

const PORT = 4711;
const HTML_PATH = join(import.meta.dir, "public", "index.html");

// ————— generation child process —————
const gen = {
  running: false,
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

function startGeneration(): boolean {
  if (gen.running) return false;
  gen.running = true;
  gen.startedAt = new Date().toISOString();
  gen.lastExit = null;
  gen.log = [];
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  void pump(proc.stdout);
  void pump(proc.stderr);
  void proc.exited.then((code) => {
    gen.running = false;
    gen.lastExit = code;
    pushLog(code === 0 ? "✓ klart" : `✗ avslutades med kod ${code}`);
  });
  return true;
}

// ————— issue helpers —————
function todayStr(): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" }).format(new Date());
}

// ————— automatic schedule —————
// Bounded retry so a failing run can't burn money all morning:
// max 3 attempts per day, at least 15 minutes apart.
const auto = { date: "", attempts: 0, lastAttemptAt: 0 };

function scheduleTick() {
  const settings = loadSettings();
  const now = new Date();
  const todayHasIssue = existsSync(join(config.outDir, todayStr(), "issue.pdf"));
  if (!isDue(settings.schedule, now, todayHasIssue) || gen.running) return;

  if (auto.date !== todayStr()) Object.assign(auto, { date: todayStr(), attempts: 0, lastAttemptAt: 0 });
  if (auto.attempts >= 3) return;
  if (auto.attempts > 0 && Date.now() - auto.lastAttemptAt < 15 * 60_000) return;

  auto.attempts++;
  auto.lastAttemptAt = Date.now();
  pushLog(`⏰ schemalagd generering (försök ${auto.attempts})`);
  startGeneration();
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
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(readFileSync(HTML_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/status") {
      const today = todayStr();
      const settings = loadSettings();
      return json({
        today,
        paperName: settings.paperName,
        todayHasIssue: existsSync(join(config.outDir, today, "issue.pdf")),
        generating: gen.running,
        startedAt: gen.startedAt,
        lastExit: gen.lastExit,
        log: gen.log.slice(-50),
        todayCostUsd: issueCost(today),
        cumulativeUsd: cumulativeSpend(),
        scheduleEnabled: settings.schedule.enabled,
        nextRunAt: nextRun(settings.schedule, new Date())?.toISOString() ?? null,
        autoAttemptsToday: auto.date === today ? auto.attempts : 0,
      });
    }

    if (path === "/api/generate" && req.method === "POST") {
      const started = startGeneration();
      return json({ started, alreadyRunning: !started }, started ? 202 : 409);
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
      return json({
        settings: loadSettings(),
        catalog: SOURCE_CATALOG.map((s) => ({
          id: s.id,
          name: s.name,
          attribution: s.attribution,
          section: s.section,
          strategy: s.strategy,
          defaultEnabled: s.defaultEnabled,
        })),
      });
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

console.log(`print-news control panel: http://localhost:${PORT} (LAN: http://${hostname()}.local:${PORT})`);
