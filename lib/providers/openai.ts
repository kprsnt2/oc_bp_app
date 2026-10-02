import type { ProviderId } from "../types";
import {
  ProviderError,
  dataUrl,
  readErrorBody,
  ssePayloads,
  supportsTemperature,
  type ProviderAdapter,
  type ProviderRequest,
} from "./stream";

const DEFAULT_BASE = "https://api.openai.com/v1";

function base(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

type ContentBlock =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

function toInput(system: string, messages: ProviderRequest["messages"]) {
  const input: { role: string; content: ContentBlock[] }[] = [];

  if (system) input.push({ role: "system", content: [{ type: "input_text", text: system }] });

  for (const m of messages) {
    const content: ContentBlock[] = [];
    for (const part of m.parts) {
      if (part.type === "text") {
        if (part.text.trim()) content.push({ type: "input_text", text: part.text });
      } else if (part.type === "image") {
        content.push({
          type: "input_image",
          image_url: dataUrl(part.mime, part.data),
        });
      } else {
        content.push({
          type: "input_file",
          filename: part.name,
          file_data: dataUrl(part.mime, part.data),
        });
      }
    }
    if (content.length) input.push({ role: m.role, content });
  }
  return input;
}

async function call(req: ProviderRequest, temperature?: number): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new ProviderError("OPENAI_API_KEY is not set", "openai");

  const body: Record<string, unknown> = {
    model: req.model,
    input: toInput(req.system, req.messages),
    stream: true,
    store: false,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (req.maxOutputTokens) body.max_output_tokens = req.maxOutputTokens;

  const res = await fetch(`${base()}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const message = await readErrorBody(res);
    throw new ProviderError(message, "openai", res.status);
  }
  return res;
}

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  async *stream(req) {
    const temperature = supportsTemperature(req.model) ? req.temperature : undefined;

    let res: Response;
    try {
      res = await call(req, temperature);
    } catch (err) {
      // Some deployments reject sampling params; one retry without them.
      if (
        err instanceof ProviderError &&
        err.status === 400 &&
        /temperature|top_p|unsupported/i.test(err.message)
      ) {
        res = await call(req, undefined);
      } else {
        throw err;
      }
    }

    const id: ProviderId = "openai";
    for await (const payload of ssePayloads(res)) {
      let evt: {
        type?: string;
        delta?: string;
        response?: { error?: { message?: string } };
        error?: { message?: string } | string;
        message?: string;
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === "response.output_text.delta" && evt.delta) {
        yield evt.delta;
      } else if (evt.type === "error" || evt.response?.error || evt.error) {
        const msg =
          (typeof evt.error === "object" && evt.error?.message) ||
          (typeof evt.error === "string" ? evt.error : undefined) ||
          evt.response?.error?.message ||
          evt.message ||
          "stream error";
        throw new ProviderError(msg, id);
      }
    }
  },
};