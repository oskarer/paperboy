import { hostOf, type Source } from "./sources.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// NTM "iris" platform: crm-api login → Bearer token → iris-api article content.
// One access token per host per run is plenty (JWTs outlive a single issue).
const NTM_CRM = "https://crm-api.ntm.eu/api/v1/auth/login";
const NTM_IRIS = "https://iris-api.ntm.eu/api/v1/iris/page/article";
const tokenCache = new Map<string, string>();

/** clientName is the site's www hostname, e.g. "www.mvt.se". */
function ntmClientName(source: Source): string {
  return hostOf(source.url);
}

export async function ntmLogin(source: Source): Promise<string> {
  const host = ntmClientName(source);
  const cached = tokenCache.get(host);
  if (cached) return cached;
  if (!source.credentials) throw new Error(`${host}: inga inloggningsuppgifter`);

  const res = await fetch(NTM_CRM, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: source.url },
    body: JSON.stringify({
      Username: source.credentials.username,
      Password: source.credentials.password,
      clientName: host,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json: any = await res.json().catch(() => ({}));
  const token: string | undefined = json?.token?.accessToken;
  if (!res.ok || !token) {
    throw new Error(`${host}: inloggning misslyckades (${res.status}${json?.message ? ` ${json.message}` : ""})`);
  }
  tokenCache.set(host, token);
  return token;
}

/** The short article id is the last path segment (== RSS guid). */
export function ntmArticleId(link: string): string | null {
  const seg = new URL(link).pathname.split("/").filter(Boolean).pop();
  return seg ?? null;
}

/** Fetch full premium article body via the iris API. Returns HTML paragraphs joined, or null. */
export async function ntmFetchBody(source: Source, articleId: string, token: string): Promise<string | null> {
  const res = await fetch(`${NTM_IRIS}/${articleId}`, {
    headers: { "User-Agent": UA, Origin: source.url, ClientName: ntmClientName(source), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null; // 423 = still locked (bad/expired token) → caller falls back to teaser
  const json = await res.json().catch(() => null);
  if (!json) return null;

  // The article body lives in irisArticle.body nodes scattered through the page tree.
  const parts: string[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (o.irisArticle?.body && typeof o.irisArticle.body === "string") parts.push(o.irisArticle.body);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(json);
  const html = parts.join("\n").trim();
  return html.length > 0 ? html : null;
}

/** Log in and try to raise credential-related errors early (used by the "test login" button). */
export async function testLogin(source: Source): Promise<{ ok: boolean; message: string }> {
  try {
    await ntmLogin({ ...source, url: source.url });
    return { ok: true, message: "Inloggning lyckades" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
