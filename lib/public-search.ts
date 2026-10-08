export type PublicSearchEntry = { title: string; page: string; section: string; href: string; text: string };

export function publishedDocumentText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown[] };
  return [typeof node.text === "string" ? node.text : "", ...(Array.isArray(node.content) ? node.content.map(publishedDocumentText) : [])].filter(Boolean).join(" ");
}

export function searchPublicEntries(entries: readonly PublicSearchEntry[], query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const terms = normalize(query.trim().slice(0, 120)).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries.map(entry => {
    const haystack = normalize(`${entry.title} ${entry.page} ${entry.section} ${entry.text}`);
    const score = terms.every(term => haystack.includes(term))
      ? terms.reduce((sum, term) => sum + (normalize(entry.title).includes(term) ? 4 : 1), 0) : 0;
    const offset = Math.max(0, normalize(entry.text).indexOf(terms[0]) - 65);
    return { ...entry, score, snippet: `${offset ? "…" : ""}${entry.text.slice(offset, offset + 250)}${entry.text.length > offset + 250 ? "…" : ""}` };
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 60);
}
