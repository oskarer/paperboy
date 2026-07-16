import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PRICES_PER_M = {
  "gpt-5.4-nano": { textIn: 0.2, textOut: 1.25 },
  "gpt-5.4-mini": { textIn: 0.75, textOut: 4.5 },
  "gpt-5.6-sol": { textIn: 5, textOut: 30 },
  "gpt-image-2": { textIn: 5, imageIn: 8, imageOut: 30 },
  "gpt-image-1-mini": { textIn: 2, imageIn: 2.5, imageOut: 8 },
} as const;

type PricedModel = keyof typeof PRICES_PER_M;

export interface LedgerEntry {
  label: string;
  model: string;
  usd: number;
  tokens: Record<string, number>;
  at: string;
}

export class BudgetExceededError extends Error {}

export class CostGuard {
  entries: LedgerEntry[] = [];

  constructor(public capUsd: number) {}

  totalUsd(): number {
    return this.entries.reduce((sum, e) => sum + e.usd, 0);
  }

  /** Throw before making a call that would likely bust the cap. */
  assertCanSpend(estimatedNextUsd: number, label: string) {
    const projected = this.totalUsd() + estimatedNextUsd;
    if (projected > this.capUsd) {
      throw new BudgetExceededError(
        `Cost guard: "${label}" (~$${estimatedNextUsd.toFixed(3)}) would take the issue to ` +
          `$${projected.toFixed(3)}, over the $${this.capUsd.toFixed(2)} cap. Aborting.`,
      );
    }
  }

  recordText(
    label: string,
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined | null,
  ): number {
    const prices = PRICES_PER_M[model as PricedModel];
    const inTok = usage?.prompt_tokens ?? 0;
    const outTok = usage?.completion_tokens ?? 0;
    const usd = prices ? (inTok * prices.textIn + outTok * ("textOut" in prices ? prices.textOut : 0)) / 1_000_000 : 0;
    this.push(label, model, usd, { textIn: inTok, textOut: outTok });
    return usd;
  }

  recordImage(
    label: string,
    model: string,
    usage:
      | {
          input_tokens?: number;
          output_tokens?: number;
          input_tokens_details?: { text_tokens?: number; image_tokens?: number };
        }
      | undefined
      | null,
    fallbackEstimateUsd: number,
  ): number {
    const prices = PRICES_PER_M[model as PricedModel];
    let usd = fallbackEstimateUsd;
    const tokens: Record<string, number> = {};
    if (usage && prices && "imageOut" in prices) {
      const textIn = usage.input_tokens_details?.text_tokens ?? 0;
      const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
      const imageOut = usage.output_tokens ?? 0;
      usd = (textIn * prices.textIn + imageIn * prices.imageIn + imageOut * prices.imageOut) / 1_000_000;
      tokens.textIn = textIn;
      tokens.imageIn = imageIn;
      tokens.imageOut = imageOut;
    } else {
      tokens.estimated = 1;
    }
    this.push(label, model, usd, tokens);
    if (this.totalUsd() > this.capUsd) {
      throw new BudgetExceededError(
        `Cost guard: issue total $${this.totalUsd().toFixed(3)} exceeded the $${this.capUsd.toFixed(2)} cap after "${label}".`,
      );
    }
    return usd;
  }

  private push(label: string, model: string, usd: number, tokens: Record<string, number>) {
    this.entries.push({ label, model, usd, tokens, at: new Date().toISOString() });
  }

  summary() {
    return { totalUsd: Number(this.totalUsd().toFixed(4)), capUsd: this.capUsd, entries: this.entries };
  }

  writeLedger(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(this.summary(), null, 2));
  }

  /** Append this run's total to a cumulative ledger (used to watch the dev budget). */
  appendCumulative(file: string, runLabel: string): number {
    let data: { totalUsd: number; runs: { label: string; usd: number; at: string }[] } = {
      totalUsd: 0,
      runs: [],
    };
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // first run
    }
    const usd = Number(this.totalUsd().toFixed(4));
    data.runs.push({ label: runLabel, usd, at: new Date().toISOString() });
    data.totalUsd = Number((data.totalUsd + usd).toFixed(4));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
    return data.totalUsd;
  }
}
