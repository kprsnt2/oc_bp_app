import type { ModelTier, ProviderId } from "./types";

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  label: string;
  tier: ModelTier;
  /** accepts image parts */
  vision: boolean;
  /** accepts native pdf parts (as opposed to needing extracted text) */
  pdf: boolean;
  /** env var that overrides the wire id */
  envKey?: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  nvidia: "NVIDIA",
  groq: "Groq",
};

/** Fallback order. First provider with a key is the default one. */
export const PROVIDER_ORDER: ProviderId[] = ["openai", "gemini", "nvidia", "groq"];

export const PROVIDER_ENV_KEYS: Record<ProviderId, string[]> = {
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  nvidia: ["NVIDIA_API_KEY", "NVIDIA_API_TOKEN"],
  groq: ["GROQ_API_KEY"],
};

export const MODEL_CATALOG: ModelSpec[] = [
  // ---- OpenAI ------------------------------------------------------------
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "GPT-5.4 mini",
    tier: "smart",
    vision: true,
    pdf: true,
    envKey: "OPENAI_MODEL_SMART",
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    label: "GPT-5.4 nano",
    tier: "fast",
    vision: true,
    pdf: true,
    envKey: "OPENAI_MODEL_FAST",
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    label: "GPT-5.4",
    tier: "smart",
    vision: true,
    pdf: true,
  },
  {
    id: "gpt-5.1",
    provider: "openai",
    label: "GPT-5.1",
    tier: "smart",
    vision: true,
    pdf: true,
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    tier: "smart",
    vision: true,
    pdf: false,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    tier: "fast",
    vision: true,
    pdf: false,
  },

  // ---- Gemini ------------------------------------------------------------
  {
    id: "gemini-flash-latest",
    provider: "gemini",
    label: "Gemini Flash",
    tier: "smart",
    vision: true,
    pdf: true,
    envKey: "GEMINI_MODEL_SMART",
  },
  {
    id: "gemini-flash-lite-latest",
    provider: "gemini",
    label: "Gemini Flash Lite",
    tier: "fast",
    vision: true,
    pdf: true,
    envKey: "GEMINI_MODEL_FAST",
  },
  {
    id: "gemini-pro-latest",
    provider: "gemini",
    label: "Gemini Pro",
    tier: "smart",
    vision: true,
    pdf: true,
  },
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    label: "Gemini 3.8 Flash",
    tier: "smart",
    vision: true,
    pdf: true,
  },

  // ---- NVIDIA ------------------------------------------------------------
  {
    id: "meta/llama-3.1-70b-instruct",
    provider: "nvidia",
    label: "Llama 3.1 70B (NVIDIA)",
    tier: "smart",
    vision: false,
    pdf: false,
    envKey: "NVIDIA_MODEL_SMART",
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    provider: "nvidia",
    label: "Llama 3.1 8B (NVIDIA)",
    tier: "fast",
    vision: false,
    pdf: false,
    envKey: "NVIDIA_MODEL_FAST",
  },
  {
    id: "meta/llama-3.2-90b-vision-instruct",
    provider: "nvidia",
    label: "Llama 3.2 90B Vision (NVIDIA)",
    tier: "smart",
    vision: true,
    pdf: false,
  },

  // ---- Groq --------------------------------------------------------------
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B (Groq)",
    tier: "smart",
    vision: false,
    pdf: false,
    envKey: "GROQ_MODEL_SMART",
  },
  {
    id: "llama-3.1-8b-instant",
    provider: "groq",
    label: "Llama 3.1 8B (Groq)",
    tier: "fast",
    vision: false,
    pdf: false,
    envKey: "GROQ_MODEL_FAST",
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT-OSS 120B (Groq)",
    tier: "smart",
    vision: false,
    pdf: false,
  },
];

export function providerKey(p: ProviderId): string | undefined {
  for (const k of PROVIDER_ENV_KEYS[p]) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function availableProviders(): ProviderId[] {
  return PROVIDER_ORDER.filter((p) => Boolean(providerKey(p)));
}

/** Wire id for a spec, honouring the env override. */
export function wireId(spec: ModelSpec): string {
  if (spec.envKey) {
    const override = process.env[spec.envKey];
    if (override && override.trim()) return override.trim();
  }
  return spec.id;
}

export function defaultModelFor(provider: ProviderId, tier: ModelTier): ModelSpec {
  const exact = MODEL_CATALOG.find((m) => m.provider === provider && m.tier === tier);
  if (exact) return exact;
  const any = MODEL_CATALOG.find((m) => m.provider === provider);
  if (any) return any;
  return MODEL_CATALOG[0];
}

/**
 * Picks the best model on a provider for a given request.
 *
 * The tier only expresses a *preference*: a fast vision model beats a smart
 * blind one, because a model that cannot read the photo is useless no matter
 * how clever it is.
 *
 * Returns null when the provider cannot serve the request at all, which only
 * happens when images are attached and the provider ships no vision model.
 */
export function pickForProvider(
  provider: ProviderId,
  tier: ModelTier,
  needs: { vision: boolean; pdf: boolean },
): ModelSpec | null {
  const pool = MODEL_CATALOG.filter((m) => m.provider === provider);
  if (pool.length === 0) return null;

  const other: ModelTier = tier === "smart" ? "fast" : "smart";
  const ordered = [
    ...pool.filter((m) => m.tier === tier),
    ...pool.filter((m) => m.tier === other),
  ];

  const satisfies = (m: ModelSpec) =>
    (!needs.vision || m.vision) && (!needs.pdf || m.pdf);

  const exact = ordered.find(satisfies);
  if (exact) return exact;

  // Images are a hard requirement. PDFs arrive as extracted text from the
  // client, so a provider without native PDF support can still answer.
  if (needs.vision) return null;
  return ordered.find((m) => !needs.pdf || m.pdf) ?? ordered[0];
}

/**
 * Builds the ordered candidate list for a request.
 *
 * - Private mode collapses the chain to Gemini only, so no request can reach
 *   a provider whose data-retention terms the user did not accept.
 * - Candidates that cannot handle the request's attachments are dropped, which
 *   is what keeps "20 photos in one message" from silently failing on Groq.
 * - Only providers with an API key present are considered.
 */
export function buildChain(opts: {
  tier: ModelTier;
  provider: ProviderId | "auto";
  privacy: boolean;
  needsVision: boolean;
  needsPdf: boolean;
}): { chain: ModelSpec[]; skipped: string[] } {
  const skipped: string[] = [];

  if (opts.privacy) {
    if (!providerKey("gemini")) {
      return { chain: [], skipped: ["Private mode needs GEMINI_API_KEY"] };
    }
    const model = pickForProvider("gemini", opts.tier, {
      vision: opts.needsVision,
      pdf: opts.needsPdf,
    });
    if (!model) {
      return { chain: [], skipped: ["Private mode: Gemini cannot read images"] };
    }
    return { chain: [model], skipped: [] };
  }

  const providers =
    opts.provider === "auto"
      ? PROVIDER_ORDER
      : [opts.provider, ...PROVIDER_ORDER.filter((p) => p !== opts.provider)];

  const chain: ModelSpec[] = [];
  for (const p of providers) {
    if (!providerKey(p)) {
      skipped.push(`${PROVIDER_LABELS[p]} has no API key`);
      continue;
    }
    const model = pickForProvider(p, opts.tier, {
      vision: opts.needsVision,
      pdf: opts.needsPdf,
    });
    if (!model) {
      skipped.push(`${PROVIDER_LABELS[p]} has no model that can read images`);
      continue;
    }
    if (chain.some((m) => m.provider === p)) continue;
    chain.push(model);
  }

  return { chain, skipped };
}