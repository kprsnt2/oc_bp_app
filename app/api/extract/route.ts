import { NextResponse } from "next/server";
import { extractDocument, MAX_EXTRACT_BYTES } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_EXTRACT_BYTES) {
    return NextResponse.json(
      { error: `${file.name} is larger than ${MAX_EXTRACT_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await extractDocument(file.name, file.type, bytes);
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 422 },
    );
  }
}