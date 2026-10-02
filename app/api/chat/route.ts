import { NextRequest } from "next/server";
import { z } from "zod";
import { AGENTS } from "@/lib/agents";
import { isAuthed } from "@/lib/auth";
import { buildChain, wireId, type ModelSpec } from "@/lib/models";
import { adapterFor } from "@/lib/providers";
import { ProviderError, isTransient } from "@/lib/providers/stream";
import { requestNeeds, trimHistory } from "@/lib/trim";
import type { ChatEvent, ChatMessage, ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(500_000) }),
  z.object({
    type: z.literal("image"),
    mime: z.string().max(100),
    data: z.string().max(12_000_000),
  }),
  z.object({
    type: z.literal("file"),
    name: z.string().max(300),
    mime: z.string().max(100),
    data: z.string().max(20_000_000),
  }),
]);

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        parts: z.array(partSchema).max(200),
      }),
    )
    .min(1)
    .max(200),
  agentId: z.string().max(60),
  tier: z.enum(["fast", "smart"]).default("smart"),
  provider: z.enum(["openai", "gemini", "nvidia", "groq", "auto"]).default("auto"),
  privacy: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().max(64_000).optional(),
});

const encoder = new TextEncoder();

function sse(event: ChatEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function label(spec: ModelSpec): string {
  return spec.label;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) {
    return Response.json({ ok: false, error: "Locked" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { messages, agentId, tier, provider, privacy, temperature, maxOutputTokens } =
    parsed.data;

  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    return Response.json({ ok: false, error: `Unknown agent ${agentId}` }, { status: 400 });
  }

  const trimmed = trimHistory(messages as ChatMessage[]);
  const needs = requestNeeds(trimmed.messages);

  const { chain, skipped } = buildChain({ tier, provider, privacy, needsVision: needs.vision, needsPdf: needs.pdf });
  if (chain.length === 0) {
    const why =
      skipped.length > 0
        ? skipped.join(" · ")
        : "Set OPENAI_API_KEY (or GEMINI_API_KEY / NVIDIA_API_KEY / GROQ_API_KEY) in .env.local";
    return Response.json(
      { ok: false, error: privacy ? `Private mode unavailable — ${why}` : `No usable provider — ${why}` },
      { status: 503 },
    );
  }

  const controller = new AbortController();
  // A client that navigates away should not keep a provider stream open.
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let opened = false;
      const send = (e: ChatEvent) => {
        opened = true;
        streamController.enqueue(sse(e));
      };

      const failures: string[] = [];

      for (let i = 0; i < chain.length; i++) {
        const spec = chain[i];
        const id = spec.provider as ProviderId;
        let produced = false;

        try {
          const adapter = adapterFor(id);
          for await (const text of adapter.stream({
            model: wireId(spec),
            system: agent.prompt,
            messages: trimmed.messages,
            temperature,
            maxOutputTokens,
            signal: controller.signal,
          })) {
            if (!produced) {
              produced = true;
              send({ type: "start", provider: id, model: wireId(spec), label: label(spec) });
            }
            send({ type: "delta", text });
          }

          send({ type: "done", provider: id, model: wireId(spec), label: label(spec) });
          streamController.close();
          return;
        } catch (err) {
          if (controller.signal.aborted) {
            streamController.close();
            return;
          }

          // A provider that already streamed text cannot be swapped out
          // mid-answer without the user seeing two half-answers merge.
          if (produced) {
            send({ type: "error", message: describeError(err) });
            streamController.close();
            return;
          }

          const reason = describeError(err);
          failures.push(`${label(spec)}: ${reason}`);

          const next = chain[i + 1];
          if (!next) {
            send({ type: "error", message: `All providers failed — ${failures.join(" | ")}` });
            streamController.close();
            return;
          }

          const recoverable = err instanceof ProviderError ? isTransient(err) : false;
          send({
            type: "fallback",
            from: id,
            to: next.provider,
            reason: recoverable
              ? `${label(spec)} — ${reason}`
              : `${label(spec)} rejected the request — ${reason}`,
          });
        }
      }

      if (!opened) {
        streamController.enqueue(
          sse({ type: "error", message: "No provider produced a response" }),
        );
      }
      streamController.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function describeError(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
