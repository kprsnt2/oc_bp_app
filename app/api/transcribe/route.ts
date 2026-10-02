import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Speech-to-text with its own fallback chain:
 * Groq whisper (cheapest/fastest) -> OpenAI transcribe -> Gemini transcribe.
 * Returns plain text; the transcript is injected into the chat as text.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Audio file is larger than 25 MB" }, { status: 413 });
  }

  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();

  const order: { name: string; run: () => Promise<Response> }[] = [];

  if (groqKey) {
    order.push({
      name: "groq",
      run: () =>
        fetch(`${trimSlash(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1")}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${groqKey}` },
          body: formFor(file, process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo"),
        }),
    });
  }
  if (openaiKey) {
    order.push({
      name: "openai",
      run: () =>
        fetch(`${trimSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${openaiKey}` },
          body: formFor(file, process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe"),
        }),
    });
  }
  if (geminiKey) {
    order.push({
      name: "gemini",
      run: async () => transcribeWithGemini(geminiKey, file),
    });
  }

  if (!order.length) {
    return NextResponse.json(
      { error: "No transcription provider configured (need GROQ_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)" },
      { status: 503 },
    );
  }

  const errors: string[] = [];
  for (const attempt of order) {
    try {
      const res = await attempt.run();
      if (!res.ok) {
        errors.push(`${attempt.name}: ${(await res.text()).slice(0, 160)}`);
        continue;
      }
      const data = (await res.json()) as { text?: string; candidates?: unknown };
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (text) {
        return NextResponse.json({ text, provider: attempt.name });
      }
      errors.push(`${attempt.name}: empty transcript`);
    } catch (err) {
      errors.push(`${attempt.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json(
    { error: `Transcription failed — ${errors.join(" | ")}` },
    { status: 502 },
  );
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function formFor(file: File, model: string): FormData {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("model", model);
  fd.append("response_format", "json");
  return fd;
}

async function transcribeWithGemini(key: string, file: File): Promise<Response> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: file.type || "audio/webm", data: base64(bytes) } },
          {
            text: "Transcribe this audio verbatim. No commentary, no timestamps unless speech is unclear, in which case mark it [unclear].",
          },
        ],
      },
    ],
  };
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) return res;

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}