import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { z } from "zod";

const SETTINGS_PATH = "settings.json";

export const SettingsSchema = z.object({
  paperName: z.string().min(1).max(40).default("MORGONBLADET"),
  interests: z.array(z.string()).default([]),
  // catalog source id → enabled; ids missing here fall back to the catalog's default
  sources: z.record(z.string(), z.boolean()).default({}),
  schedule: z
    .object({
      /** auto = generate fully · approve = draft + phone approval · off = manual only */
      mode: z.enum(["auto", "approve", "off"]).default("auto"),
      /** Local time HH:MM */
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("06:00"),
      /** ISO weekdays, 1 = Monday … 7 = Sunday */
      days: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5, 6, 7]),
    })
    .default({ mode: "auto", time: "06:00", days: [1, 2, 3, 4, 5, 6, 7] }),
  /** ntfy.sh topic for approval notifications (acts as the shared secret) */
  ntfyTopic: z.string().nullable().default(null),
  printer: z
    .object({
      autoPrint: z.boolean().default(false),
      printerName: z.string().nullable().default(null),
    })
    .default({ autoPrint: false, printerName: null }),
  imageQuality: z.enum(["low", "medium", "high"]).default("medium"),
  density: z.enum(["normal", "compact"]).default("compact"),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(): Settings {
  let raw: any = {};
  try {
    raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    // missing or corrupt file → defaults
  }
  // Migrate pre-mode settings: schedule.enabled boolean → schedule.mode enum.
  if (raw?.schedule && typeof raw.schedule.enabled === "boolean" && !raw.schedule.mode) {
    raw.schedule.mode = raw.schedule.enabled ? "auto" : "off";
    delete raw.schedule.enabled;
  }
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export function saveSettings(settings: Settings): Settings {
  const validated = SettingsSchema.parse(settings);
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(validated, null, 2));
  renameSync(tmp, SETTINGS_PATH);
  return validated;
}
