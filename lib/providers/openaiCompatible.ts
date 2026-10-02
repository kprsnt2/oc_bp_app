import type { ChatMessage, ProviderId } from "../types";
import {
  ProviderError,
  dataUrl,
  readErrorBody,
  ssePayloads,
  type ProviderAdapter,
  type ProviderRequest,
} from "./stream";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * NVIDIA NIM and Groq both expose OpenAI's `/chat/completions` dialect, so they
 * share one adapter. They differ from OpenAI itself in two ways that matter:
 *
 * 1. They cannot read a PDF or any raw file, so a `FilePart` is degraded to a
 *    text note. Losing the bytes is better than failing the whole request, and
 *    the client already extracts text from documents before sending.
 * 2. They speak SSE `chat.completion.chunk`, not the Responses API events.
 */
export function openAiCompatibleAdapter(
  id: ProviderId,
  label: string,
  base: string,
  envKeys: string[],
): ProviderAdapter {
  function apiKey(): string {
    for (const k of envKeys) {
      const v = process.env[k]?.trim();
      if (v) return v;
    }
    throw new ProviderError(`${envKeys[0]} is not set`, id);
  }

  function toMessages(system: string, messages: ChatMessage[]) {
    const out: {
      role: string;
      content: string | ContentBlock[];
    }[] = [];

    if (system) out.push({ role: "system", content: system });

    for (const m of messages) {
      const blocks: ContentBlock[] = [];
      for (const part of m.parts) {
        if (part.type === "text") {
          if (part.text.trim()) blocks.push({ type: "text", text: part.text });
        } else if (part.type === "image") {
          blocks.push({
            type: "image_url",
            image_url: { url: dataUrl(part.mime, part.data) },
          });
        } else {
          blocks.push({
            type: "text",
            text: `[attached file ${part.name} could not be read by ${label}]`,
          });
        }
      }
      if (!blocks.length) continue;
      out.push({
        role: m.role,
        content: blocks.length === 1 && blocks[0].type === "text"
          ? blocks[0].text
          : blocks,
      });
    }
    return out;
  }

  return {
    id,
    label,
    async *stream(req: ProviderRequest) {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toMessages(req.system, req.messages),
        stream: true,
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.maxOutputTokens) body.max_tokens = req.maxOutputTokens;

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok) {
        throw new ProviderError(await readErrorBody(res), id, res.status);
      }

      for await (const payload of ssePayloads(res)) {
        let evt: {
          choices?: {
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }[];
          error?: { message?: string } | string;
          message?: string;
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.error) {
          const msg =
            (typeof evt.error === "object" && evt.error.message) ||
            (typeof evt.error === "string" ? evt.error : `${label} error`);
          throw new ProviderError(msg, id);
        }
        for (const choice of evt.choices ?? []) {
          const text = choice.delta?.content;
          if (text) yield text;
        }
      }
    },
  };
}
