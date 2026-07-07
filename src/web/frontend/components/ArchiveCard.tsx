import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Archive, FileText, Printer } from "lucide-react";
import { postPrint, type Issue } from "../api";

export function ArchiveCard({ issues }: { issues: Issue[] }) {
  const print = async (date: string) => {
    try {
      await postPrint(date);
      toast.success(`${date} skickad till skrivaren`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="size-5" aria-hidden />
          Arkiv
        </CardTitle>
      </CardHeader>
      <CardContent>
        {issues.length === 0 && <p className="text-sm text-muted-foreground">Inga nummer ännu.</p>}
        <ul className="divide-y">
          {issues.map((issue) => (
            <li key={issue.date} className="flex flex-wrap items-center justify-between gap-y-1 py-2.5 text-sm">
              <span className="whitespace-nowrap">
                🗞 {issue.date}
                {issue.costUsd != null && (
                  <span className="ml-2 text-xs text-muted-foreground">${issue.costUsd.toFixed(2)}</span>
                )}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/issues/${issue.date}/issue.pdf`} target="_blank" rel="noreferrer">
                    <FileText aria-hidden /> Öppna
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => print(issue.date)}>
                  <Printer aria-hidden /> Skriv ut
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
