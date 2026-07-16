export const config = {
  textModel: "gpt-5.4-nano",
  imageModel: "gpt-image-2",
  // True A4 ratio at ~200 dpi so dense small text stays legible in print.
  // (Image quality lives in settings.json — tunable from the web UI.)
  imageSize: { width: 1664, height: 2352 },
  maxPhotosPerPage: 4,
  photoWidth: 480,
  // No per-issue cap: the guard still tracks and reports spend, but never aborts a render.
  issueCostCapUsd: Infinity,
  devBudgetUsd: 10.0,
  outDir: "out",
  pages: [
    { pageNumber: 1, title: "Förstasidan", brief: "dagens allra viktigaste nyheter oavsett ämne" },
    { pageNumber: 2, title: "Inrikes", brief: "svenska inrikesnyheter" },
    { pageNumber: 3, title: "Utrikes", brief: "nyheter från övriga världen" },
    { pageNumber: 4, title: "Ekonomi", brief: "ekonomi, näringsliv och privatekonomi" },
    { pageNumber: 5, title: "Kultur & Sport", brief: "kultur och sport" },
  ],
  candidates: {
    /** Fallback freshness window when there is no previous issue and no schedule */
    maxAgeHours: 26,
    /** Never look back further than this, even after a long pause */
    maxLookbackDays: 14,
    /** Overlap into the previous window so publish-time skew can't lose an article
     *  (the cross-issue history filter prevents actual repeats) */
    overlapMinutes: 60,
    maxPerSource: 30,
    /** How many past issues to check so an article never runs twice */
    historyIssues: 7,
  },
};
