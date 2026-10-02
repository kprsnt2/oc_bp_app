import type { ImagePart, MessagePart, TextPart } from "@/lib/types";

/** Images per message. Matches MAX_IMAGES_PER_MESSAGE in .env.example. */
export const MAX_IMAGES = 20;

/** Extracted document characters per message. */
export const MAX_DOC_CHARS = 120_000;

/** Longest edge of an image we send, in pixels. */
const MAX_EDGE = 1568;

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i;
const TEXTUAL = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|yaml|yml|ini|log|sql|py|js|ts|tsx|jsx|css|sh|bat|ps1)$/i;

export interface PreparedFile {
  parts: MessagePart[];
  /** short lines for the pending-attachment tray */
  chips: { name: string; kind: string; detail: string }[];
}

export function dataUrlToBase64(dataUrl: string): {
  mime: string;
  data: string;
} {
  const comma = dataUrl.indexOf(",");
  const meta = comma > 0 ? dataUrl.slice(0, comma) : "";
  const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  return { mime, data: comma > 0 ? dataUrl.slice(comma + 1) : "" };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("could not read file"));
    r.readAsDataURL(file);
  });
}

/**
 * Shrinks a photo before it is base64'd.
 *
 * A 12 MP phone photo is ~4 MB of JPEG and ~5.5 MB of base64, so twenty of them
 * would be 110 MB before a single token is spent. Every vision model resizes
 * internally anyway, so downscaling in the browser is free quality-wise and is
 * the only reason "attach thirty photos" works at all.
 */
async function compressImage(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.72), width, height };
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, " ")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  return xml ? xmlText(xml) : "";
}

async function extractPptx(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    out.push(`--- ${name.match(/slide(\d+)/)?.[1] ?? "?"} ---\n${xmlText(xml)}`);
  }
  return out.join("\n\n");
}

/** Minimal xlsx reader: shared strings plus the first worksheet, as TSV. */
async function extractXlsx(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared: string[] = [];
  if (sharedXml) {
    for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(xmlText(si));
    }
  }

  const sheetPath = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetPath) return "";
  const sheetXml = (await zip.file(sheetPath)?.async("string")) ?? "";

  const rows: string[] = [];
  for (const row of sheetXml.match(/<row[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cell of row.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const isShared = /t="s"/.test(cell);
      const v = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const inline = cell.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let value = "";
      if (isShared) value = shared[Number(v)] ?? "";
      else if (inline !== undefined) value = xmlText(inline);
      else value = v;
      cells.push(value.replace(/\s+/g, " ").replace(/\|/g, "/").trim());
    }
    if (cells.length) rows.push(cells.join(" | "));
  }
  return rows.join("\n");
}

async function extractPdf(file: File): Promise<string> {
  const { extractText } = await import("unpdf");
  const buf = new Uint8Array(await file.arrayBuffer());
  const { text } = await extractText(buf, { mergePages: true });
  return (text ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function asTextPart(name: string, text: string, limit: number): TextPart {
  const clipped = text.length > limit;
  return {
    type: "text",
    name,
    truncated: clipped,
    text: clipped ? text.slice(0, limit) : text,
  };
}

/**
 * Turns picked files into message parts.
 *
 * Images become downscaled base64. Everything else becomes text, extracted in
 * the browser, which keeps the request small and works identically on all four
 * providers instead of only the two that accept native file parts.
 */
export async function prepareFiles(
  files: File[],
  budget: { imagesLeft: number; docCharsLeft: number },
): Promise<PreparedFile> {
  const parts: MessagePart[] = [];
  const chips: PreparedFile["chips"] = [];
  let imagesLeft = budget.imagesLeft;
  let docCharsLeft = budget.docCharsLeft;

  for (const file of files) {
    const name = file.name || "attachment";
    const lower = name.toLowerCase();

    try {
      if (IMAGE_TYPES.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(lower)) {
        if (imagesLeft <= 0) {
          chips.push({ name, kind: "skipped", detail: `image limit ${MAX_IMAGES} reached` });
          continue;
        }
        const originalBytes = file.size;
        // Small images are already cheap; re-encoding them only loses quality.
        if (file.size <= 350_000) {
          const dataUrl = await readAsDataUrl(file);
          const { mime, data } = dataUrlToBase64(dataUrl);
          parts.push({ type: "image", mime, data, name, originalBytes });
        } else {
          const { dataUrl } = await compressImage(file);
          const { mime, data } = dataUrlToBase64(dataUrl);
          parts.push({ type: "image", mime, data, name, originalBytes });
        }
        imagesLeft -= 1;
        const bytes = parts[parts.length - 1] as ImagePart;
        chips.push({
          name,
          kind: "image",
          detail: `${Math.round(originalBytes / 1024)} KB → ${Math.round((bytes.data.length * 0.75) / 1024)} KB`,
        });
        continue;
      }

      if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
        const text = await extractPdf(file);
        if (!text.trim()) {
          parts.push({
            type: "text",
            name,
            text: `[${name}] is a scanned/image-only PDF, so no text could be extracted. Ask the user to attach photos of the pages instead.`,
          });
          chips.push({ name, kind: "pdf", detail: "no text layer — attach page photos" });
          continue;
        }
        const limit = Math.max(0, docCharsLeft);
        parts.push(asTextPart(name, text, limit));
        docCharsLeft -= Math.min(limit, text.length);
        chips.push({
          name,
          kind: "pdf",
          detail: `${text.length.toLocaleString()} chars${text.length > limit ? " (trimmed)" : ""}`,
        });
        continue;
      }

      if (lower.endsWith(".docx")) {
        const text = await extractDocx(file);
        const limit = Math.max(0, docCharsLeft);
        parts.push(asTextPart(name, text || `[${name}] produced no readable text.`, limit));
        docCharsLeft -= Math.min(limit, text.length);
        chips.push({ name, kind: "docx", detail: `${text.length.toLocaleString()} chars` });
        continue;
      }

      if (lower.endsWith(".pptx")) {
        const text = await extractPptx(file);
        const limit = Math.max(0, docCharsLeft);
        parts.push(asTextPart(name, text || `[${name}] produced no readable text.`, limit));
        docCharsLeft -= Math.min(limit, text.length);
        chips.push({ name, kind: "slides", detail: `${text.length.toLocaleString()} chars` });
        continue;
      }

      if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
        const text = await extractXlsx(file);
        const limit = Math.max(0, docCharsLeft);
        parts.push(asTextPart(name, text || `[${name}] produced no readable rows.`, limit));
        docCharsLeft -= Math.min(limit, text.length);
        chips.push({ name, kind: "sheet", detail: `${text.split("\n").length} rows` });
        continue;
      }

      if (file.type.startsWith("text/") || TEXTUAL.test(lower)) {
        const text = await file.text();
        const limit = Math.max(0, docCharsLeft);
        parts.push(asTextPart(name, text, limit));
        docCharsLeft -= Math.min(limit, text.length);
        chips.push({ name, kind: "text", detail: `${text.length.toLocaleString()} chars` });
        continue;
      }

      parts.push({
        type: "text",
        name,
        text: `[${name}] (${file.type || "unknown type"}) is a binary file this app cannot read. Supported: images, PDF, DOCX, XLSX, PPTX, CSV, TXT and code files.`,
      });
      chips.push({ name, kind: "unsupported", detail: file.type || "binary" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parts.push({
        type: "text",
        name,
        text: `[${name}] could not be read: ${message}`,
      });
      chips.push({ name, kind: "error", detail: message });
    }
  }

  return { parts, chips };
}

/** Renders parts back into the plain text of a message, for previews. */
export function partsToPlainText(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "image") return `[image: ${p.name ?? "attachment"}]`;
      return `[file: ${p.name}]`;
    })
    .join("\n");
}
