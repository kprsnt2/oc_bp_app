"use client";

import type { MessagePart, ProviderId } from "./types";

export type AttachmentKind = "image" | "document" | "audio" | "text";

export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  /** object URL for immediate preview, not persisted */
  previewUrl?: string;
  /** human readable status such as "3 pages · 12,400 chars" */
  note?: string;
  error?: string;
  /** the payload that will be sent to the model */
  parts: MessagePart[];
}

export interface PrepareOptions {
  /** providers that can read native PDFs; when empty, PDFs are extracted to text */
  pdfCapable: ProviderId[];
  maxImageBytes?: number;
  maxImages?: number;
}

export const PER_IMAGE_BUDGET = 220 * 1024;
/** Vercel's request body ceiling for a serverless function is ~4.5 MB. */
export const TOTAL_PAYLOAD_BUDGET = 3.4 * 1024 * 1024;

export function payloadBytes(parts: MessagePart[]): number {
  return parts.reduce((n, p) => {
    if (p.type === "text") return n + p.text.length;
    return n + Math.ceil(p.data.length * 0.75);
  }, 0);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fileToBase64(file: Blob): Promise<string> {
  return file.arrayBuffer().then((buf) => bytesToBase64(new Uint8Array(buf)));
}

// -------------------------------------------------------------------- images

interface CompressionResult {
  base64: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not decode image"));
      img.src = url;
    });
    return img;
  } finally {
    // keep the object URL alive until the bitmap is drawn
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function bitmapSize(bmp: ImageBitmap | HTMLImageElement) {
  return {
    w: bmp instanceof HTMLImageElement ? bmp.naturalWidth : bmp.width,
    h: bmp instanceof HTMLImageElement ? bmp.naturalHeight : bmp.height,
  };
}

/**
 * Shrinks an image until it fits the per-image budget. Photos of documents are
 * the dominant use case, so quality is traded away before resolution.
 */
export async function compressImage(
  file: File,
  maxBytes = PER_IMAGE_BUDGET,
): Promise<CompressionResult> {
  const bmp = await loadBitmap(file);
  const { w: naturalW, h: naturalH } = bitmapSize(bmp);

  if (naturalW === 0 || naturalH === 0) throw new Error("image has no dimensions");

  // 1568px is the largest size most vision models accept without downscaling.
  const maxDim = 1568;
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  let dim = Math.max(1, Math.round(naturalW * scale));
  let quality = 0.82;

  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas is unavailable in this browser");

  const draw = () => {
    canvas.width = dim;
    canvas.height = Math.max(1, Math.round(naturalH * (dim / naturalW)));
    ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  };

  draw();
  let blob = await toBlob(canvas);
  const qualities = [0.82, 0.7, 0.58, 0.45, 0.32];
  let qi = 0;
  while (blob.size > maxBytes && qi < qualities.length - 1) {
    quality = qualities[qi];
    blob = await toBlob(canvas, quality);
    qi++;
  }

  // Still too big: reduce resolution and retry once.
  if (blob.size > maxBytes && dim > 640) {
    dim = Math.round(dim * 0.72);
    draw();
    blob = await toBlob(canvas, 0.55);
  }

  if (bmp instanceof ImageBitmap) bmp.close();

  const buffer = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(buffer),
    width: canvas.width,
    height: canvas.height,
    bytes: buffer.byteLength,
    mime: blob.type || "image/jpeg",
  };
}

function toBlob(canvas: HTMLCanvasElement, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("image encoding failed"))),
      "image/jpeg",
      quality,
    );
  });
}

// ---------------------------------------------------------------- extraction

function docTextPart(name: string, text: string): MessagePart {
  return {
    type: "text",
    text: `<document name="${name.replace(/"/g, "'")}">\n${text}\n</document>`,
  };
}

async function extractViaApi(file: File): Promise<ExtractedDocumentResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extract", { method: "POST", body: fd });
  const data = (await res.json()) as ExtractedDocumentResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "could not read the file");
  return data;
}

interface ExtractedDocumentResult {
  name: string;
  chars: number;
  text: string;
  truncated: boolean;
  kind: string;
}

async function transcribeViaApi(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/transcribe", { method: "POST", body: fd });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "transcription failed");
  if (!data.text) throw new Error("empty transcript");
  return data.text;
}

const PLAIN_EXT =
  /\.(txt|md|markdown|csv|tsv|log|json|jsonl|ya?ml|xml|html?|py|js|jsx|ts|tsx|java|c|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|bash|ps1|ini|toml|env)$/i;

function kindOf(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/") || /\.(webm|m4a|mp3|wav|ogg|oga|mp4|mov)$/i.test(file.name)) {
    return "audio";
  }
  if (file.type.startsWith("text/") || PLAIN_EXT.test(file.name) || file.type === "application/json") {
    return "text";
  }
  return "document";
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Turns one picked/dropped file into a sendable attachment. */
export async function prepareFile(file: File, opts: PrepareOptions): Promise<Attachment> {
  const base: Attachment = {
    id: crypto.randomUUID(),
    name: file.name || "attachment",
    kind: kindOf(file),
    mime: file.type || "application/octet-stream",
    bytes: file.size,
    parts: [],
  };

  try {
    if (base.kind === "image") {
      const out = await compressImage(file, opts.maxImageBytes ?? PER_IMAGE_BUDGET);
      base.previewUrl = `data:${out.mime};base64,${out.base64}`;
      base.bytes = out.bytes;
      base.note = `${out.width}×${out.height} · ${human(out.bytes)}`;
      base.parts = [{ type: "image", mime: out.mime, data: out.base64 }];
      return base;
    }

    if (base.kind === "audio") {
      const transcript = await transcribeViaApi(file);
      base.note = `transcript · ${human(transcript.length)} chars`;
      base.parts = [
        {
          type: "text",
          text: `[voice note "${base.name}" transcribed]\n${transcript}`,
        },
      ];
      return base;
    }

    const isPdf = base.mime === "application/pdf" || /\.pdf$/i.test(base.name);

    if (isPdf && opts.pdfCapable.length > 0) {
      base.parts = [
        { type: "file", name: base.name, mime: "application/pdf", data: await fileToBase64(file) },
      ];
      base.note = `${human(file.size)} · sent as PDF`;
      return base;
    }

    // Small plain text is cheaper to read in the browser than to round-trip.
    if (base.kind === "text" && file.size < 300 * 1024) {
      const text = await file.text();
      base.note = `${human(text.length)} chars`;
      base.parts = [docTextPart(base.name, text)];
      return base;
    }

    const doc = await extractViaApi(file);
    if (!doc.text.trim()) {
      throw new Error(
        "no text could be read from this file (it may be a scan). Try sending it as a PDF, or attach a photo of the page.",
      );
    }
    base.note = `${human(doc.chars)} chars${doc.truncated ? " (truncated)" : ""}`;
    base.parts = [docTextPart(base.name, doc.text)];
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : "could not read file";
    return base;
  }
}

/** Runs prepareFile over a list with limited concurrency. */
export async function prepareFiles(
  files: File[],
  opts: PrepareOptions,
  onEach?: (a: Attachment) => void,
): Promise<Attachment[]> {
  const out: { index: number; attachment: Attachment }[] = [];
  const limit = 3;
  let cursor = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++;
      const attachment = await prepareFile(files[index], opts);
      onEach?.(attachment);
      out.push({ index, attachment });
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
  return out.sort((a, b) => a.index - b.index).map((o) => o.attachment);
}

export function dropToFiles(dt: DataTransfer): File[] {
  return Array.from(dt.files ?? []);
}