// The verifier: plain code, no model. A claim survives only if its page can be fetched (and may be fetched, per
// robots.txt), the quote appears on it word for word, and the value follows from the quote. Everything else is
// dropped with a reason, which is kept for audit.
import { type Fetch, USER_AGENT } from "@/server/http";
import type { Claim } from "@/server/research/claims";

export type Verified = Claim & { domain: string; confidence: "high" | "medium" };
export type Rejected = { claim: Claim; reason: string };

const BLOCKED = /(^|\.)(qloo\.com|tastedive\.com|youtube\.com|youtu\.be|spotify\.com)$/i;

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/** Visible text of an HTML page, roughly: scripts, styles and tags out, entities decoded. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ");
}

/** robots.txt for "*": true when the path is not disallowed. Missing or unreadable robots.txt allows. */
export async function allowedByRobots(url: URL, f: Fetch = fetch): Promise<boolean> {
  try {
    const res = await f(`${url.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return true;
    let applies = false;
    for (const raw of (await res.text()).split("\n")) {
      const line = raw.split("#")[0].trim();
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*";
      else if (applies && /^disallow$/i.test(k) && v && url.pathname.startsWith(v)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

const words = (s: string) => norm(s).split(" ").filter(Boolean);
const STOP = new Set("a an the and or of in on at to from for with by is are was were be been it its this that as who which their his her they he she".split(" "));

/** Does the value follow from the quote? Exact containment for names, IDs, places and genres; for descriptions,
 * most of the value's content words must appear in the quote (no added facts). */
export function supports(field: Claim["field"], value: string, quote: string): boolean {
  const q = norm(quote);
  if (field === "properties.short_description") {
    const content = words(value).filter((w) => !STOP.has(w));
    if (!content.length) return false;
    const qs = new Set(words(quote));
    return content.filter((w) => qs.has(w)).length / content.length >= 0.7;
  }
  const v = norm(value.replace(/^@/, ""));
  return v.length > 0 && q.includes(v);
}

export async function verifyClaims(claims: Claim[], { fetch: f = fetch }: { fetch?: Fetch } = {}): Promise<{ verified: Verified[]; rejected: Rejected[] }> {
  const verified: Verified[] = [];
  const rejected: Rejected[] = [];
  const pages = new Map<string, Promise<string | null>>();
  const load = (url: URL) => {
    if (!pages.has(url.href))
      pages.set(
        url.href,
        (async () => {
          if (!(await allowedByRobots(url, f))) return null;
          const res = await f(url.href, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
          return res?.ok ? norm(pageText(await res.text())) : null;
        })(),
      );
    return pages.get(url.href)!;
  };

  for (const claim of claims) {
    let url: URL;
    try {
      url = new URL(claim.source_url);
    } catch {
      rejected.push({ claim, reason: "not a URL" });
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) rejected.push({ claim, reason: "not http(s)" });
    else if (BLOCKED.test(url.hostname)) rejected.push({ claim, reason: `source not allowed (${url.hostname})` });
    else if (words(claim.quote).length < 3 || words(claim.quote).length > 40) rejected.push({ claim, reason: "quote must be 3 to 40 words" });
    else if (!supports(claim.field, claim.value, claim.quote)) rejected.push({ claim, reason: "value does not follow from the quote" });
    else {
      const text = await load(url);
      if (text === null) rejected.push({ claim, reason: "page could not be fetched or robots.txt disallows it" });
      else if (!text.includes(norm(claim.quote))) rejected.push({ claim, reason: "quote not found on the page" });
      else verified.push({ ...claim, domain: url.hostname.replace(/^www\./, ""), confidence: "medium" });
    }
  }

  // The same value backed by two or more independent sites is high confidence.
  const domainsFor = new Map<string, Set<string>>();
  for (const v of verified) {
    const k = `${v.field}|${norm(v.value)}`;
    (domainsFor.get(k) ?? domainsFor.set(k, new Set()).get(k)!).add(v.domain);
  }
  for (const v of verified) if ((domainsFor.get(`${v.field}|${norm(v.value)}`)?.size ?? 0) >= 2) v.confidence = "high";
  return { verified, rejected };
}
