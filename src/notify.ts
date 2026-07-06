/** Push notifications via ntfy.sh — the topic name is the shared secret. */

export interface NtfyAction {
  action: "http" | "view";
  label: string;
  url: string;
  method?: "POST" | "GET";
  clear?: boolean;
}

export async function sendNtfy(
  topic: string,
  opts: { title: string; message: string; tags?: string[]; priority?: number; actions?: NtfyAction[] },
): Promise<{ ok: boolean; message: string }> {
  try {
    // JSON publishing (POST to the root) — plain headers only allow ASCII,
    // which breaks Swedish titles and button labels.
    const res = await fetch("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: opts.title,
        message: opts.message,
        tags: opts.tags ?? ["newspaper"],
        priority: opts.priority ?? 4,
        actions: opts.actions ?? [],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, message: res.ok ? "notification sent" : `ntfy HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: `ntfy failed: ${err}` };
  }
}
