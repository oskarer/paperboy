import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { discoverSource, testSourceLogin, type Settings, type Source } from "../api";

export function SourcesSection({
  sources,
  onChange,
}: {
  sources: Settings["sources"];
  onChange: (sources: Settings["sources"]) => void;
}) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Source>) =>
    onChange(sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const add = async () => {
    if (!url.trim()) return;
    setAdding(true);
    try {
      const d = await discoverSource(url);
      if (sources.some((s) => s.url === d.url)) {
        toast.info(`${d.name} finns redan`);
      } else {
        onChange([...sources, { url: d.url, name: d.name, enabled: true, feeds: d.feeds, strategy: d.strategy }]);
        toast.success(`${d.name} tillagd — ${d.feeds.length} flöde${d.feeds.length === 1 ? "" : "n"}${d.needsLogin ? " · kräver inloggning för betalspärr" : ""}`);
        if (d.needsLogin) setExpanded(d.url);
      }
      setUrl("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const setCred = (i: number, field: "username" | "password", value: string) => {
    const cur = sources[i]!.credentials ?? { username: "", password: "" };
    update(i, { credentials: { ...cur, [field]: value } });
  };

  const testLogin = async (source: Source) => {
    try {
      const r = await testSourceLogin(source);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {sources.map((source, i) => (
          <li key={source.url} className="p-3">
            <div className="flex items-center gap-3">
              <Switch checked={source.enabled} onCheckedChange={(on) => update(i, { enabled: on })} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{source.name}</span>
                  {source.strategy === "ntm" && (
                    <Badge variant={source.credentials ? "default" : "secondary"} className="gap-1">
                      <KeyRound className="size-3" aria-hidden />
                      {source.credentials ? "inloggad" : "betalspärr"}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new URL(source.url).hostname} · {source.feeds.length} flöde{source.feeds.length === 1 ? "" : "n"}
                </span>
              </div>
              {source.strategy === "ntm" && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Inloggning"
                  onClick={() => setExpanded(expanded === source.url ? null : source.url)}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${expanded === source.url ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Ta bort ${source.name}`}
                onClick={() => onChange(sources.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            {expanded === source.url && source.strategy === "ntm" && (
              <div className="mt-3 space-y-2 rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">
                  Logga in för att hämta hela artiklar bakom betalspärr. Uppgifterna sparas lokalt.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="användarnamn / e-post"
                    autoComplete="off"
                    className="w-52"
                    value={source.credentials?.username ?? ""}
                    onChange={(e) => setCred(i, "username", e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="lösenord"
                    autoComplete="off"
                    className="w-44"
                    value={source.credentials?.password ?? ""}
                    onChange={(e) => setCred(i, "password", e.target.value)}
                  />
                  <Button variant="outline" size="sm" onClick={() => testLogin(source)}>
                    Testa inloggning
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          placeholder="lägg till källa via URL, t.ex. mvt.se"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <Button variant="outline" onClick={add} disabled={adding}>
          {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Lägg till
        </Button>
      </div>
    </div>
  );
}
