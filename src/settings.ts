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
      enabled: z.boolean().default(true),
      /** Local time HH:MM */
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("06:00"),
      /** ISO weekdays, 1 = Monday … 7 = Sunday */
      days: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5, 6, 7]),
    })
    .default({ enabled: true, time: "06:00", days: [1, 2, 3, 4, 5, 6, 7] }),
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
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    // missing or corrupt file → defaults
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
