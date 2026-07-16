// Dev-only: measure per-style average character widths in chromium so the
// fit estimator (src/render/html/fit.ts) can predict story heights.
import { STYLE_IDS } from "../src/styles.ts";
import { scaffoldCss } from "../src/render/html/scaffold.ts";
import { closeBrowser, newRenderPage } from "../src/render/html/chromium.ts";

// Representative Swedish news text (mixed case, å/ä/ö, digits).
const SAMPLE =
  "Regeringen föreslår nya åtgärder för att stärka försvaret under 2026. " +
  "Beslutet väntas få stora konsekvenser för kommunerna i norra Sverige, " +
  "där omkring 14 000 personer berörs av förändringarna enligt myndigheten.";
const HEADLINE_SAMPLE = "Regeringen föreslår kraftigt höjda anslag till försvaret";

const pg = await newRenderPage();
try {
  const results: Record<string, unknown> = {};
  for (const style of STYLE_IDS) {
    const html = `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8">
<style>${scaffoldCss(style, "normal")}
.probe{position:absolute;white-space:nowrap;visibility:hidden}</style></head>
<body><div id="page">
<span class="probe story-body" id="body-probe">${SAMPLE}</span>
<span class="probe headline s5" id="h5-probe">${HEADLINE_SAMPLE}</span>
<span class="probe headline s2" id="h2-probe">${HEADLINE_SAMPLE}</span>
</div></body></html>`;
    await pg.setContent(html, { waitUntil: "load" });
    await pg.evaluate(() => (document as any).fonts.ready);
    results[style] = await pg.evaluate(
      ([bodyLen, headLen]) => {
        const w = (id: string) => document.getElementById(id)!.getBoundingClientRect().width;
        const fs = (id: string) => parseFloat(getComputedStyle(document.getElementById(id)!).fontSize);
        return {
          bodyCharW: w("body-probe") / bodyLen!,
          bodyFontPx: fs("body-probe"),
          h5CharFactor: w("h5-probe") / headLen! / fs("h5-probe"),
          h2CharFactor: w("h2-probe") / headLen! / fs("h2-probe"),
        };
      },
      [SAMPLE.length, HEADLINE_SAMPLE.length],
    );
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await closeBrowser();
}
