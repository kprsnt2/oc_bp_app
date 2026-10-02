import { NextResponse } from "next/server";
import {
  MODEL_CATALOG,
  availableProviders,
  providerKey,
  wireId,
} from "@/lib/models";

export const runtime = "nodejs";

/** Lets the client grey out providers that have no key before sending anything. */
export async function GET() {
  const providers = availableProviders();
  return NextResponse.json({
    providers,
    canTranscribe: Boolean(
      providerKey("groq") || providerKey("openai") || providerKey("gemini"),
    ),
    models: MODEL_CATALOG.map((m) => ({
      provider: m.provider,
      id: wireId(m),
      catalogId: m.id,
      label: m.label,
      tier: m.tier,
      vision: m.vision,
      pdf: m.pdf,
      enabled: Boolean(providerKey(m.provider)),
    })),
    limits: {
      maxImages: Number(process.env.MAX_IMAGES_PER_MESSAGE ?? 20),
      maxDocChars: Number(process.env.MAX_DOC_CHARS ?? 120_000),
    },
  });
}