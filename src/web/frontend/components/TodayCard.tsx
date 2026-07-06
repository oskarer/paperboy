import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, Loader2, Newspaper, Printer, Sparkles } from "lucide-react";
import { getStatus, postApprove, postGenerate, postPrint, type Status } from "../api";

function statusLine(s: Status): { text: string; badge?: string } {
  if (s.generating) {
    const kind = { draft: "Tar fram utkast…", render: "Renderar sidor…", issue: "Genererar…" };
    return { text: kind[s.generatingKind ?? "issue"], badge: "kör" };
  }
  if (s.draftPending) return { text: `Utkast klart — ${s.draftStories} artiklar`, badge: "väntar på godkännande" };
  if (s.todayHasIssue) return { text: "Dagens nummer finns", badge: "klart" };
  return { text: "Inget nummer genererat i dag" };
}

export function TodayCard({ status, refresh }: { status: Status; refresh: () => void }) {
  const [thumbKey, setThumbKey] = useState(0);
  const wasGenerating = useRef(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (wasGenerating.current && !status.generating) setThumbKey((k) => k + 1);
    wasGenerating.current = status.generating;
  }, [status.generating]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status.log]);

  const line = statusLine(status);
  const pdfUrl = `/issues/${status.today}/issue.pdf`;

  const act = (fn: () => Promise<unknown>, ok: string) => async () => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Newspaper className="size-5" aria-hidden />
          Dagens tidning
          {line.badge && <Badge variant={status.draftPending ? "destructive" : "secondary"}>{line.badge}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          {status.todayHasIssue && (
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                key={thumbKey}
                src={`/issues/${status.today}/page-1.png?t=${thumbKey}`}
                alt={`Förstasidan ${status.today}`}
                className="w-28 rounded-md border shadow-sm"
              />
            </a>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm">
              {status.generating && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {line.text}
            </p>
            <p className="text-sm text-muted-foreground">
              {status.todayCostUsd != null && <>Kostnad i dag: ${status.todayCostUsd.toFixed(2)} · </>}
              {status.cumulativeUsd != null && <>totalt: ${status.cumulativeUsd.toFixed(2)} · </>}
              {status.scheduleMode !== "off" && status.nextRunAt
                ? `nästa ${status.scheduleMode === "approve" ? "utkast" : "körning"}: ${new Date(
                    status.nextRunAt,
                  ).toLocaleString("sv-SE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                : "automatik avstängd"}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {status.draftPending && status.approveToken && (
                <Button size="sm" onClick={act(() => postApprove(status.approveToken!), "Godkänt — renderar!")}>
                  <CheckCircle2 aria-hidden /> Godkänn & rendera
                </Button>
              )}
              <Button
                size="sm"
                variant={status.draftPending ? "outline" : "default"}
                disabled={status.generating}
                onClick={act(postGenerate, "Generering startad")}
              >
                <Sparkles aria-hidden /> Generera nu
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!status.todayHasIssue || status.generating}
                onClick={act(() => postPrint(), "Skickad till skrivaren")}
              >
                <Printer aria-hidden /> Skriv ut
              </Button>
              {status.todayHasIssue && (
                <Button size="sm" variant="outline" asChild>
                  <a href={pdfUrl} target="_blank" rel="noreferrer">
                    <FileText aria-hidden /> Öppna PDF
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
        {(status.generating || status.log.length > 0) && (
          <pre
            ref={logRef}
            className="max-h-44 overflow-y-auto rounded-md bg-neutral-950 p-3 text-xs leading-relaxed text-green-300"
          >
            {status.log.join("\n")}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
