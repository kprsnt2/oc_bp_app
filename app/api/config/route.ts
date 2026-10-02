import { NextRequest, NextResponse } from "next/server";
import { isAuthed, passcodeRequired } from "@/lib/auth";
import {
  MODEL_CATALOG,
  PROVIDER_ENV_KEYS,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  providerKey,
  wireId,
} from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client needs to know which models it may pick from, but it must never see
 * a key. Only the resolved wire ids cross the wire — never the credentials.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ ok: false, error: "Locked" }, { status: 401 });
  }

  const providers = PROVIDER_ORDER.map((p) => ({
    id: p,
    label: PROVIDER_LABELS[p],
    configured: Boolean(providerKey(p)),
    envKeys: PROVIDER_ENV_KEYS[p],
  }));

  const models = MODEL_CATALOG.map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    tier: m.tier,
    vision: m.vision,
    pdf: m.pdf,
    available: Boolean(providerKey(m.provider)),
    wire: wireId(m),
  }));

  return NextResponse.json({
    ok: true,
    required: passcodeRequired(),
    providers,
    models,
    defaults: {
      tier: "smart",
      provider: "auto",
    },
  });
}
