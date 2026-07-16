import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { BellRing, Save, Settings2, X } from "lucide-react";
import { STYLES, STYLE_IDS } from "../../../styles";
import { SourcesSection } from "./SourcesSection";
import { getPrinters, postTestNotification, putSettings, type Printer, type Settings } from "../api";

const DAY_NAMES = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function SettingsCard({
  settings,
  onChange,
  onSaved,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onSaved: () => void;
}) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPrinters().then(setPrinters).catch(() => setPrinters([]));
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });

  const addInterests = () => {
    const items = interestInput.split(",").map((v) => v.trim()).filter(Boolean);
    if (items.length === 0) return;
    set("interests", [...new Set([...settings.interests, ...items])]);
    setInterestInput("");
  };

  const save = async () => {
    setSaving(true);
    try {
      onChange(await putSettings(settings));
      toast.success("Sparat — gäller från nästa nummer");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const testNotify = async () => {
    try {
      await putSettings(settings);
      await postTestNotification();
      toast.success("Testnotis skickad — kolla mobilen!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="size-5" aria-hidden />
          Inställningar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Section title="Tidningen">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paper-name">Namn</Label>
              <Input
                id="paper-name"
                value={settings.paperName}
                maxLength={40}
                onChange={(e) => set("paperName", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STYLE_IDS.map((id) => {
              const style = STYLES[id];
              const selected = settings.style === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => set("style", id)}
                  aria-pressed={selected}
                  className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                    selected ? "border-primary ring-2 ring-primary/30" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{style.name}</span>
                    {selected && <Badge>vald</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{style.description}</p>
                </button>
              );
            })}
          </div>
        </Section>

        <Separator />

        <Section title="Schema">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Läge</Label>
              <Select value={settings.schedule.mode} onValueChange={(mode) => set("schedule", { ...settings.schedule, mode: mode as Settings["schedule"]["mode"] })}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Generera automatiskt</SelectItem>
                  <SelectItem value="approve">Fråga först — notis till mobilen</SelectItem>
                  <SelectItem value="off">Av — bara manuellt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sched-time">Klockan</Label>
              <Input
                id="sched-time"
                type="time"
                className="w-28"
                value={settings.schedule.time}
                onChange={(e) => set("schedule", { ...settings.schedule, time: e.target.value || "06:00" })}
              />
            </div>
            <div className="flex gap-2 pb-1">
              {DAY_NAMES.map((name, i) => {
                const day = i + 1;
                const checked = settings.schedule.days.includes(day);
                return (
                  <label key={day} className="flex flex-col items-center gap-1 text-xs">
                    {name}
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(on) =>
                        set("schedule", {
                          ...settings.schedule,
                          days: on
                            ? [...settings.schedule.days, day].sort((a, b) => a - b)
                            : settings.schedule.days.filter((d) => d !== day),
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="ntfy-topic (hemligt namn)"
              className="w-72"
              value={settings.ntfyTopic ?? ""}
              onChange={(e) => set("ntfyTopic", e.target.value.trim() || null)}
            />
            <Button variant="outline" size="sm" onClick={testNotify}>
              <BellRing aria-hidden /> Testa notis
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Installera ntfy-appen och prenumerera på samma topic. Vid "Fråga först" skickas en notis när utkastet är
            klart (~$0,02) — rendering (~$0,50) sker först när du godkänner.
          </p>
        </Section>

        <Separator />

        <Section title="Intresseområden">
          <div className="flex flex-wrap gap-2">
            {settings.interests.map((interest) => (
              <Badge key={interest} variant="secondary" className="gap-1 pr-1">
                {interest}
                <button
                  type="button"
                  aria-label={`Ta bort ${interest}`}
                  className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                  onClick={() => set("interests", settings.interests.filter((i) => i !== interest))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            ))}
            {settings.interests.length === 0 && (
              <p className="text-xs text-muted-foreground">Inga ännu — nyheter som matchar viktas upp i urvalet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="t.ex. AI, Formel 1, Norrköping…"
              value={interestInput}
              onChange={(e) => setInterestInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addInterests())}
            />
            <Button variant="outline" onClick={addInterests}>
              Lägg till
            </Button>
          </div>
        </Section>

        <Separator />

        <Section title="Källor">
          <SourcesSection sources={settings.sources} onChange={(sources) => set("sources", sources)} />
        </Section>

        <Separator />

        <Section title="Skrivare & utskrift">
          <div className="flex flex-wrap items-center gap-4">
            <Select
              value={settings.printer.printerName ?? "__default__"}
              onValueChange={(name) =>
                set("printer", { ...settings.printer, printerName: name === "__default__" ? null : name })
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Standardskrivare" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Standardskrivare</SelectItem>
                {printers.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} ({p.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={settings.printer.autoPrint}
                onCheckedChange={(on) => set("printer", { ...settings.printer, autoPrint: on })}
              />
              Skriv ut automatiskt efter rendering
            </label>
          </div>
          {printers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Inga skrivare hittades — lägg till en i macOS Systeminställningar → Skrivare.
            </p>
          )}
        </Section>

        <Separator />

        <Section title="Kvalitet & täthet">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Renderingsmotor</Label>
              <Select
                value={settings.renderBackend}
                onValueChange={(b) => set("renderBackend", b as Settings["renderBackend"])}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">AI-bild (gpt-image-2, ~$0,30/sida)</SelectItem>
                  <SelectItem value="html">HTML (AI-layout, ~$0,06/sida)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bildkvalitet</Label>
              <Select
                value={settings.imageQuality}
                onValueChange={(q) => set("imageQuality", q as Settings["imageQuality"])}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Låg (~$0,10/nummer)</SelectItem>
                  <SelectItem value="medium">Medium (~$0,50/nummer)</SelectItem>
                  <SelectItem value="high">Hög (över $1-taket)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Täthet</Label>
              <Select value={settings.density} onValueChange={(d) => set("density", d as Settings["density"])}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Kompakt (6–8 artiklar/sida)</SelectItem>
                  <SelectItem value="normal">Normal (4–6 artiklar/sida)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex justify-end gap-2 rounded-b-xl border-t bg-card/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <Button onClick={save} disabled={saving}>
            <Save aria-hidden /> {saving ? "Sparar…" : "Spara inställningar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
