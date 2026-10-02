import type { ChatMessage, MessagePart } from "./types";

/** Older turns are dropped from the request once a chat gets long. */
const MAX_HISTORY_MESSAGES = 30;

/**
 * Images are the expensive part of a payload, so they are only kept for the
 * most recent turns. Older ones become a short text note, which preserves the
 * fact that a photo was there without resending megabytes of base64.
 */
const KEEP_ATTACHMENTS_FOR = 3;

export interface TrimResult {
  messages: ChatMessage[];
  /** messages dropped from the tail because the window is full */
  dropped: number;
  /** attachments replaced by a text note to save payload */
  stripped: number;
}

function describe(p: Extract<MessagePart, { type: "image" | "file" }>): string {
  return p.type === "image"
    ? "[an image was attached to this earlier message]"
    : `[file attached earlier: ${p.name}]`;
}

export function trimHistory(
  messages: ChatMessage[],
  opts: {
    maxMessages?: number;
    keepAttachmentsFor?: number;
  } = {},
): TrimResult {
  const maxMessages = opts.maxMessages ?? MAX_HISTORY_MESSAGES;
  const keepAttachmentsFor = opts.keepAttachmentsFor ?? KEEP_ATTACHMENTS_FOR;

  const dropped = Math.max(0, messages.length - maxMessages);
  const window = messages.slice(-maxMessages);
  const attachmentCutoff = window.length - keepAttachmentsFor;

  let stripped = 0;
  const out = window.map((m, i) => {
    if (i >= attachmentCutoff) return m;
    if (!m.parts.some((p) => p.type !== "text")) return m;

    const parts: MessagePart[] = m.parts.map((p) => {
      if (p.type === "text") return p;
      stripped += 1;
      return { type: "text", text: describe(p) };
    });
    return { ...m, parts };
  });

  return { messages: out, dropped, stripped };
}

/** An image forces a vision-capable model; a raw file forces native pdf/file support. */
export function requestNeeds(messages: ChatMessage[]): {
  vision: boolean;
  pdf: boolean;
} {
  let vision = false;
  let pdf = false;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "image") vision = true;
      if (p.type === "file") pdf = true;
    }
  }
  return { vision, pdf };
}

/** Rough guard so a runaway paste cannot build a multi-megabyte request. */
export function estimateChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text") total += p.text.length;
      else total += (p.data?.length ?? 0) * 0.75;
    }
  }
  return total;
}
