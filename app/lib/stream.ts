import type { ChatEvent } from "@/lib/types";

export interface StreamHandlers {
  onStart?: (e: Extract<ChatEvent, { type: "start" }>) => void;
  onDelta?: (text: string) => void;
  onFallback?: (e: Extract<ChatEvent, { type: "fallback" }>) => void;
  onDone?: (e: Extract<ChatEvent, { type: "done" }>) => void;
  onError?: (message: string) => void;
}

export class LockedError extends Error {
  constructor() {
    super("Session locked");
    this.name = "LockedError";
  }
}

/**
 * Consumes the SSE stream from /api/chat.
 *
 * The server owns provider fallback, so a single fetch can cross several
 * providers: it emits a `fallback` event, then continues streaming from the
 * next one. The caller never needs to retry.
 */
export async function streamChat(
  payload: unknown,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (res.status === 401) throw new LockedError();

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep the status line */
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error("no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (event: ChatEvent) => {
    switch (event.type) {
      case "start":
        handlers.onStart?.(event);
        break;
      case "delta":
        handlers.onDelta?.(event.text);
        break;
      case "fallback":
        handlers.onFallback?.(event);
        break;
      case "done":
        handlers.onDone?.(event);
        break;
      case "error":
        handlers.onError?.(event.message);
        break;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            handle(JSON.parse(raw) as ChatEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
