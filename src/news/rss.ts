import { XMLParser } from "fast-xml-parser";
import { fetchText } from "./fetch";
import type { NewsHeadline } from "./types";

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pickLink(node: any): string | null {
  if (!node) return null;
  if (typeof node === "string") return node;
  if (typeof node === "object") {
    if (typeof node.href === "string") return node.href;
    if (typeof node["@_href"] === "string") return node["@_href"];
    if (typeof node["#text"] === "string") return node["#text"];
  }
  return null;
}

export async function fetchFeedHeadlines(params: {
  url: string;
  sourceName: string;
  maxItems: number;
  withinHours?: number;
}): Promise<NewsHeadline[]> {
  const xml = await fetchText(params.url);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);

  const nowMs = Date.now();
  const withinMs = (params.withinHours ?? 24) * 60 * 60_000;

  const items: Array<{ title?: any; link?: any; pubDate?: any; updated?: any; published?: any }> = [];

  // RSS 2.0
  const rssItems = asArray(doc?.rss?.channel?.item);
  for (const it of rssItems) items.push(it);

  // Atom
  const atomEntries = asArray(doc?.feed?.entry);
  for (const e of atomEntries) items.push(e);

  const out: NewsHeadline[] = [];
  for (const it of items) {
    const title = String(it?.title?.["#text"] ?? it?.title ?? "").trim();
    const link = pickLink(it?.link) ?? pickLink(asArray(it?.link)[0]);
    const publishedRaw = String(it?.pubDate ?? it?.updated ?? it?.published ?? "").trim();

    if (!title || !link) continue;

    const publishedAt = publishedRaw ? new Date(publishedRaw).toISOString() : null;
    if (publishedAt) {
      const age = nowMs - new Date(publishedAt).getTime();
      if (Number.isFinite(age) && age > withinMs) continue;
    }

    out.push({ source: params.sourceName, title, url: link, publishedAt });
    if (out.length >= params.maxItems) break;
  }

  return out;
}
