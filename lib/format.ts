"use client";

export const DOC_OPEN = /<document name="([^"]*)">/;

/** Hides the <document> wrapper used for the model and shows a readable chip instead. */
export function displayText(text: string): { text: string; docs: string[] } {
  const docs: string[] = [];
  const out = text
    .replace(/<document name="([^"]*)">([\s\S]*?)<\/document>/g, (_, name: string) => {
      docs.push(name);
      return "";
    })
    .trim();
  return { text: out, docs };
}

export function countImages(parts: { type: string }[]): number {
  return parts.filter((p) => p.type === "image").length;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

export function bytesHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function partSummary(parts: { type: string; name?: string }[]): string {
  const counts: Record<string, number> = {};
  const names: string[] = [];
  for (const p of parts) {
    if (p.type === "text") continue;
    counts[p.type] = (counts[p.type] ?? 0) + 1;
    if (p.name && !names.includes(p.name)) names.push(p.name);
  }
  const bits: string[] = [];
  if (counts.image) bits.push(`${counts.image} image${counts.image > 1 ? "s" : ""}`);
  if (counts.file) bits.push(`${counts.file} document${counts.file > 1 ? "s" : ""}`);
  return bits.join(" · ");
}

export function dataUrlOf(mime: string, data: string): string {
  return `data:${mime};base64,${data}`;
}