import type { ProviderId } from "../types";
import type { ProviderAdapter } from "./stream";
import { geminiAdapter } from "./gemini";
import { groqAdapter } from "./groq";
import { nvidiaAdapter } from "./nvidia";
import { openaiAdapter } from "./openai";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  gemini: geminiAdapter,
  nvidia: nvidiaAdapter,
  groq: groqAdapter,
};

export function adapterFor(provider: ProviderId): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`no adapter for provider ${provider}`);
  return adapter;
}
