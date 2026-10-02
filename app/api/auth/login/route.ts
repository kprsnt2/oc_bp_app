import { NextResponse } from "next/server";
import { COOKIE_NAME, checkPasscode, createSessionToken, isSecure } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let passcode = "";
  try {
    const body = (await req.json()) as { passcode?: string };
    passcode = String(body.passcode ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!process.env.APP_PASSCODE) {
    return NextResponse.json(
      { error: "APP_PASSCODE is not configured on the server" },
      { status: 500 },
    );
  }

  if (!checkPasscode(passcode)) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}