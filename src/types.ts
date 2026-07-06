export type SectionKey = "inrikes" | "utrikes" | "ekonomi" | "kultur" | "sport" | "allmänt";

export type StoryRole = "lead" | "secondary" | "brief";

export interface Candidate {
  id: number;
  guid: string;
  section: SectionKey;
  sourceId: string;
  attribution: string;
  title: string;
  description: string;
  link: string;
  publishedAt: string;
  /** Image found in the feed itself (enclosure / media:content / content HTML) */
  feedImageUrl?: string;
}

export interface ScrapedArticle {
  headline: string;
  lead: string;
  paragraphs: string[];
  imageUrls: string[];
}

export interface Story {
  candidateId: number;
  section: SectionKey;
  attribution: string;
  link: string;
  role: StoryRole;
  headline: string;
  /** Original feed title — used by cross-issue history matching */
  sourceTitle?: string;
  body: string;
  imageUrl?: string;
}

export interface PageSpec {
  pageNumber: number;
  title: string;
  stories: Story[];
}

export interface IssueData {
  date: string;
  dateSv: string;
  /** When this issue was generated — the next issue only takes news newer than this */
  generatedAt: string;
  pages: PageSpec[];
}
