import JSZip from "jszip";
import type { ExtractedDocument } from "./types";

const MAX_CHARS = Number(process.env.MAX_DOC_CHARS ?? 120_000);
const MAX_SHEET_ROWS = 400;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function clean(s: string): string {
  return decodeEntities(s).replace(/[ \t]+/g, " ").trim();
}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_CHARS), truncated: true };
}

function finalise(
  kind: ExtractedDocument["kind"],
  name: string,
  mime: string,
  text: string,
): ExtractedDocument {
  const { text: capped, truncated } = cap(text.trim());
  return {
    name,
    mime,
    chars: capped.length,
    text: capped,
    truncated,
    kind: capped.length < 40 ? "image-only" : kind,
  };
}

// ---------------------------------------------------------------- plain text

function extractPlain(name: string, mime: string, bytes: Uint8Array): ExtractedDocument {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return finalise("text", name, mime, text);
}

// ---------------------------------------------------------------------- pdf

async function extractPdf(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const result = (await extractText(pdf, { mergePages: true })) as {
    totalPages?: number;
    text: string[] | string;
  };
  const raw = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  const doc = finalise("pdf", name, mime, raw ?? "");
  if (result.totalPages) {
    doc.text = `[Pages: ${result.totalPages}]\n\n${doc.text}`;
  }
  return doc;
}

// --------------------------------------------------------------------- docx

async function extractDocx(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("not a .docx file (word/document.xml missing)");
  const xml = await file.async("string");

  const paragraphs: string[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml))) {
    const runs = [...m[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((r) => decodeEntities(r[1]))
      .join("");
    const line = clean(runs).replace(/\s+$/, "");
    paragraphs.push(line);
  }

  const body = paragraphs.join("\n").replace(/\n{3,}/g, "\n\n");
  return finalise("docx", name, mime, body);
}

// --------------------------------------------------------------------- xlsx

function colToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const c = ch.charCodeAt(0) - 64;
    if (c < 1 || c > 26) return n;
    n = n * 26 + c;
  }
  return n - 1;
}

async function extractXlsx(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(bytes);

  // shared strings
  const shared: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const runs = [...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((r) => decodeEntities(r[1]))
        .join("");
      shared.push(clean(runs));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/(\d+)\.xml$/)![1]);
      return na - nb;
    });

  // sheet names in order
  const names: string[] = [];
  const wb = zip.file("xl/workbook.xml");
  if (wb) {
    const xml = await wb.async("string");
    for (const s of xml.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*\/?>/g)) {
      names.push(clean(s[1]));
    }
  }

  const out: string[] = [];
  for (let i = 0; i < sheetFiles.length; i++) {
    const xml = await zip.file(sheetFiles[i])!.async("string");
    const sheetName = names[i] ?? `Sheet${i + 1}`;
    out.push(`## ${sheetName}`);

    let rowCount = 0;
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (rowCount >= MAX_SHEET_ROWS) {
        out.push(`_... truncated at ${MAX_SHEET_ROWS} rows ...`);
        break;
      }
      rowCount++;
      const cells: string[] = [];
      for (const c of row[2].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const col = ref ? colToIndex(ref.replace(/\d+/g, "")) : cells.length;
        while (cells.length < col) cells.push("");

        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
        let value = "";
        if (type === "s") {
          const idx = Number(clean(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "-1"));
          value = shared[idx] ?? "";
        } else if (type === "inlineStr") {
          value = clean(
            [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
              .map((r) => decodeEntities(r[1]))
              .join(""),
          );
        } else {
          value = clean(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        }
        cells[col] = value;
      }
      out.push(cells.join("\t").replace(/\t+$/, ""));
    }
    out.push("");
  }

  return finalise("xlsx", name, mime, out.join("\n"));
}

// --------------------------------------------------------------------- pptx

async function extractPptx(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/(\d+)\.xml$/)![1]);
      return na - nb;
    });

  const out: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.file(slides[i])!.async("string");
    out.push(`## Slide ${i + 1}`);
    for (const para of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const line = clean(
        [...para[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((r) => decodeEntities(r[1]))
          .join(""),
      );
      if (line) out.push(line);
    }
    for (const note of zip.files[`ppt/notesSlides/notesSlide${i + 1}.xml`]
      ? [zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`)!]
      : []) {
      const nx = await note.async("string");
      const lines = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((r) => clean(decodeEntities(r[1])))
        .filter(Boolean);
      if (lines.length) out.push(`> speaker notes: ${lines.join(" ")}`);
    }
    out.push("");
  }

  return finalise("pptx", name, mime, out.join("\n"));
}

// -------------------------------------------------------------------- router

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|log|json|jsonl|yaml|yml|xml|html?|py|js|jsx|ts|tsx|java|c|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|bash|ps1|r|swift|ini|toml|env|gitignore|dockerfile)$/i;

export async function extractDocument(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const lower = name.toLowerCase();
  try {
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      return await extractPdf(name, mime, bytes);
    }
    if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")
    ) {
      return await extractDocx(name, mime, bytes);
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      lower.endsWith(".xlsx") ||
      mime === "text/csv" ||
      lower.endsWith(".csv") ||
      lower.endsWith(".tsv")
    ) {
      if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
        return extractPlain(name, mime, bytes);
      }
      return await extractXlsx(name, mime, bytes);
    }
    if (
      mime ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      lower.endsWith(".pptx")
    ) {
      return await extractPptx(name, mime, bytes);
    }
    // legacy .doc / .ppt / .xls and everything else: best-effort text read
    return extractPlain(name, mime, bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read ${name}: ${message}`);
  }
}

export function looksLikeTextFile(name: string, mime: string): boolean {
  return (
    TEXT_EXT.test(name.toLowerCase()) ||
    mime.startsWith("text/") ||
    mime === "application/json"
  );
}

export const MAX_EXTRACT_BYTES = 8 * 1024 * 1024;
