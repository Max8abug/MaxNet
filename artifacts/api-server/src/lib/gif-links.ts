const websiteHosts = new Set(["tenor.com", "www.tenor.com", "m.tenor.com", "tenor.co", "www.tenor.co"]);
const mediaHost = /^(?:media\d*|c)\.tenor\.com$/i;
const cache = new Map<string, { url: string; expires: number }>();

function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function decodeAttribute(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, digits: string) => {
      const code = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : Number(digits);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}
export function extractTenorGif(html: string): string | null {
  const candidates: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
    }
    const name = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
    if (["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(name)) {
      const content = attributes.get("content");
      if (content) candidates.push(decodeAttribute(content));
    }
  }
  // A share page may advertise a video first. Only pick an image, never MP4/HTML.
  candidates.push(...(html.match(/https:\/\/(?:media\d*|c)\.tenor\.com\/[^"'\\\s<>]+/gi) || []));
  for (const candidate of candidates) {
    const url = parseUrl(candidate);
    if (url?.protocol === "https:" && mediaHost.test(url.hostname) && /\.(?:gif|webp)$/i.test(url.pathname)) return url.href;
  }
  return null;
}

export async function normalizeGifUrl(value: unknown): Promise<string | null> {
  const input = parseUrl(value);
  if (!input) return null;
  // Tenor's website URLs can end in .gif yet redirect to HTML. Resolve them
  // before the general direct-GIF path; only CDN images are already resolved.
  if (!websiteHosts.has(input.hostname.toLowerCase())) {
    if (/\.gif$/i.test(input.pathname) || (mediaHost.test(input.hostname) && /\.webp$/i.test(input.pathname))) return input.href;
    return null;
  }
  const cached = cache.get(input.href);
  if (cached && cached.expires > Date.now()) return cached.url;
  try {
    let current = input;
    const signal = AbortSignal.timeout(8000);
    for (let hop = 0; hop < 5; hop++) {
      // Never follow a provider redirect to an arbitrary server or private IP.
      if (!websiteHosts.has(current.hostname.toLowerCase()) && !mediaHost.test(current.hostname)) return null;
      const response = await fetch(current.href, { signal, redirect: "manual", headers: { accept: "text/html,image/gif,image/webp" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return null;
        const redirected = parseUrl(new URL(location, current).href);
        if (!redirected) return null;
        current = redirected;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return null; }
      const type = response.headers.get("content-type") || "";
      let resolved: string | null = null;
      if (/^image\/(?:gif|webp)\b/i.test(type)) {
        resolved = current.href;
        await response.body?.cancel();
      } else if (/^text\/html\b/i.test(type)) {
        const reader = response.body?.getReader();
        if (!reader) return null;
        const decoder = new TextDecoder();
        let html = "", size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 2_000_000) return null;
            html += decoder.decode(chunk.value, { stream: true });
          }
          html += decoder.decode();
        } finally { await reader.cancel(); }
        resolved = extractTenorGif(html);
      } else { await response.body?.cancel(); }
      if (resolved) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(input.href, { url: resolved, expires: Date.now() + 10 * 60_000 });
      }
      return resolved;
    }
  } catch { return null; }
  return null;
}
