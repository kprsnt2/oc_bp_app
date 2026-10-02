import {
  ProviderError,
  readErrorBody,
  ssePayloads,
  type ProviderAdapter,
  type ProviderRequest,
} from "./stream";
import type { ChatMessage } from "../types";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function base(): string {
  return (process.env.GEMINI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) throw new ProviderError("GEMINI_API_KEY is not set", "gemini");
  return key;
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function toContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.parts.flatMap<GeminiPart>((part) => {
      if (part.type === "text") return part.text.trim() ? [{ text: part.text }] : [];
      if (part.type === "image") {
        return [{ inlineData: { mimeType: part.mime, data: part.data } }];
      }
      return [{ inlineData: { mimeType: part.mime, data: part.data } }];
    }),
  }));
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  label: "Gemini",
  async *stream(req: ProviderRequest) {
    const model = req.model.startsWith("models/")
      ? req.model
      : `models/${req.model}`;

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxOutputTokens) generationConfig.maxOutputTokens = req.maxOutputTokens;

    const body: Record<string, unknown> = {
      contents: toContents(req.messages),
    };
    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const res = await fetch(`${base()}/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      throw new ProviderError(await readErrorBody(res), "gemini", res.status);
    }

    for await (const payload of ssePayloads(res)) {
      let evt: {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
        promptFeedback?: { blockReason?: string };
        error?: { message?: string } | string;
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.error) {
        const msg =
          (typeof evt.error === "object" && evt.error.message) ||
          (typeof evt.error === "string" ? evt.error : "gemini error");
        throw new ProviderError(msg, "gemini");
      }
      if (evt.promptFeedback?.blockReason) {
        throw new ProviderError(
          `Blocked by safety filter (${evt.promptFeedback.blockReason})`,
          "gemini",
          400,
        );
      }
      for (const cand of evt.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          if (part.text) yield part.text;
        }
      }
    }
  },
};