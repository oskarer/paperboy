import { useCallback, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { TodayCard } from "./components/TodayCard";
import { SettingsCard } from "./components/SettingsCard";
import { ArchiveCard } from "./components/ArchiveCard";
import { getIssues, getSettings, getStatus, type Issue, type Settings, type Status } from "./api";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);

  const refresh = useCallback(() => {
    getStatus().then(setStatus).catch(() => {});
    getIssues().then(setIssues).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    getSettings().then(setSettings).catch(() => {});
  }, [refresh]);

  // Poll faster while a job is running so the log streams.
  useEffect(() => {
    const interval = setInterval(refresh, status?.generating ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [refresh, status?.generating]);

  useEffect(() => {
    if (status?.paperName) document.title = `${status.paperName} · Kontrollpanel`;
  }, [status?.paperName]);

  return (
    <div className="min-h-screen">
      <header className="border-b-4 border-double border-foreground/80 bg-card px-4 py-6 text-center">
        <h1 className="font-serif text-4xl font-bold uppercase tracking-wide">
          {status?.paperName ?? "…"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Kontrollpanel · {status?.today ?? ""}</p>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        {status ? <TodayCard status={status} refresh={refresh} /> : <Skeleton className="h-48 w-full" />}
        {settings ? (
          <SettingsCard settings={settings} onChange={setSettings} onSaved={refresh} />
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
        <ArchiveCard issues={issues} />
        <footer className="pb-6 pt-2 text-center text-xs text-muted-foreground">
          print-news · öppen källkod · MIT
        </footer>
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}
