import type { ChatMessage, ProviderId } from "../types";

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** true when the adapter can stream text deltas */
  stream(req: ProviderRequest): AsyncGenerator<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Errors worth retrying on the next provider in the chain. */
export function isTransient(err: unknown): boolean {
  if (err instanceof ProviderError) {
    if (err.status === undefined) return true;
    return err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
  }
  return true;
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return res.statusText;
    try {
      const json = JSON.parse(raw) as {
        error?: { message?: string; code?: string } | string;
        message?: string;
      };
      const e = json.error;
      if (typeof e === "string") return e;
      if (e && typeof e === "object" && e.message) return e.message;
      if (json.message) return json.message;
    } catch {
      /* not json */
    }
    return raw.slice(0, 400);
  } catch {
    return res.statusText;
  }
}

/**
 * Yields the payload of every `data:` line of an SSE response.
 * Handles chunk boundaries and stops at `[DONE]`.
 */
export async function* ssePayloads(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error("no response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      if (payload) yield payload;
    }
  }
}

/** Concatenates every text part of a message (used for logging + routing). */
export function messageText(messages: ChatMessage[]): string {
  return messages
    .flatMap((m) => m.parts)
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function dataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/** GPT-5/6 style reasoning models reject non-default sampling params. */
export function supportsTemperature(model: string): boolean {
  return !/^(gpt-5|gpt-6|o1|o3|o4)/i.test(model);
}

export function clampTemp(t: number | undefined): number | undefined {
  if (t === undefined || Number.isNaN(t)) return undefined;
  return Math.min(2, Math.max(0, t));
}
