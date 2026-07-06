import type { Settings } from "../../settings.ts";
import type { Source, ScrapeStrategy } from "../../sources.ts";

export type { Source };

export interface Discovered {
  url: string;
  name: string;
  feeds: string[];
  strategy: ScrapeStrategy;
  needsLogin: boolean;
}

export interface Status {
  today: string;
  paperName: string;
  todayHasIssue: boolean;
  generating: boolean;
  generatingKind: "issue" | "draft" | "render" | null;
  startedAt: string | null;
  lastExit: number | null;
  log: string[];
  todayCostUsd: number | null;
  cumulativeUsd: number | null;
  scheduleMode: Settings["schedule"]["mode"];
  nextRunAt: string | null;
  autoAttemptsToday: number;
  draftPending: boolean;
  draftStories: number | null;
  approveToken: string | null;
  ntfyConfigured: boolean;
}

export interface Issue {
  date: string;
  hasPdf: boolean;
  costUsd: number | null;
}

export interface Printer {
  name: string;
  status: string;
}

export type { Settings };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { error?: unknown }).error;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
  }
  return data as T;
}

export const getStatus = () => api<Status>("/api/status");
export const getIssues = () => api<Issue[]>("/api/issues");
export const getPrinters = () => api<Printer[]>("/api/printers");
export const getSettings = () => api<{ settings: Settings }>("/api/settings").then((d) => d.settings);
export const putSettings = (settings: Settings) =>
  api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }).then(
    (d) => d.settings,
  );
export const postGenerate = () => api("/api/generate", { method: "POST" });
export const postApprove = (token: string) => api(`/api/approve?token=${token}`, { method: "POST" });
export const postPrint = (date?: string) =>
  api<{ ok: boolean; message: string }>("/api/print", { method: "POST", body: JSON.stringify({ date }) });
export const postTestNotification = () => api<{ ok: boolean }>("/api/test-notification", { method: "POST" });
export const discoverSource = (url: string) =>
  api<Discovered>("/api/sources/discover", { method: "POST", body: JSON.stringify({ url }) });
export const testSourceLogin = (source: Source) =>
  api<{ ok: boolean; message: string }>("/api/sources/test-login", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
