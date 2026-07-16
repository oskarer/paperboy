export interface Printer {
  name: string;
  status: string;
}

async function run(cmd: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout, stderr };
}

/** Parse `lpstat -p` output: "printer <name> is idle.  enabled since …" */
export async function listPrinters(): Promise<Printer[]> {
  const res = await run(["lpstat", "-p"]);
  if (!res.ok) return [];
  return res.stdout
    .split("\n")
    .map((line) => line.match(/^printer (\S+) (?:is |)(.*?)\.?\s*$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[1]!, status: m[2] ?? "unknown" }));
}

export async function printPdf(
  pdfPath: string,
  printerName?: string | null,
): Promise<{ ok: boolean; message: string }> {
  // Duplex: flip on the long edge so an upright A4 stack reads front→back like a book.
  const cmd = ["lp", ...(printerName ? ["-d", printerName] : []), "-o", "sides=two-sided-long-edge", pdfPath];
  const res = await run(cmd);
  return {
    ok: res.ok,
    message: res.ok ? res.stdout.trim() : res.stderr.trim() || `lp exited non-zero`,
  };
}
