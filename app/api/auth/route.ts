import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createToken,
  isAuthed,
  passcodeMatches,
  passcodeRequired,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets the client know whether it must show the passcode screen. */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: await isAuthed(req),
    required: passcodeRequired(),
  });
}

export async function POST(req: NextRequest) {
  let passcode = "";
  try {
    const body = await req.json();
    passcode = typeof body?.passcode === "string" ? body.passcode : "";
  } catch {
    /* fall through to a failed check */
  }

  if (!passcodeMatches(passcode)) {
    return NextResponse.json(
      { ok: false, error: "Wrong passcode" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createToken(), sessionCookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: false });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
