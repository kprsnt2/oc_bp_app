/**
 * Passcode gate.
 *
 * This module is imported by `middleware.ts`, which runs on the Edge runtime,
 * so it uses Web Crypto (`crypto.subtle`) rather than `node:crypto`. The same
 * code therefore works unchanged in Node route handlers.
 *
 * Two naming sets are exported because both UIs in this repo are kept for now:
 *   - COOKIE_NAME / checkPasscode / createSessionToken / isSecure /
 *     verifySessionToken  (used by middleware.ts and /api/auth/login|logout)
 *   - SESSION_COOKIE / passcodeMatches / createToken / verifyToken / isAuthed
 *     (used by /api/auth and /api/chat)
 * They are aliases of one implementation, not two code paths.
 */

export const COOKIE_NAME = "aiwish_session";
export const SESSION_COOKIE = COOKIE_NAME;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function isSecure(): boolean {
  if (process.env.SECURE_COOKIES === "1") return true;
  return process.env.NODE_ENV === "production";
}

/** True when a passcode is configured. */
export function passcodeRequired(): boolean {
  return Boolean(process.env.APP_PASSCODE?.trim());
}

function secretBytes(): Uint8Array {
  const s = process.env.SESSION_SECRET?.trim();
  if (!s) {
    throw new Error(
      "SESSION_SECRET is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return new TextEncoder().encode(s);
}

async function hmac(payload: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    secretBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Length-independent, content-constant-time comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkPasscode(candidate: string): boolean {
  const expected = process.env.APP_PASSCODE?.trim();
  if (!expected) return false;
  return safeEqual(candidate ?? "", expected);
}

export const passcodeMatches = checkPasscode;

export async function createSessionToken(): Promise<string> {
  const payload = String(Date.now() + MAX_AGE_SECONDS * 1000);
  return `${payload}.${await hmac(payload)}`;
}

export const createToken = createSessionToken;

/**
 * Fails closed. With no passcode configured there is no valid session, so a
 * forgotten APP_PASSCODE locks the app rather than exposing the API keys.
 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  try {
    if (!safeEqual(mac, await hmac(payload))) return false;
  } catch {
    return false;
  }
  return Number(payload) > Date.now();
}

export const verifyToken = verifySessionToken;

export async function isAuthed(req: Request & { cookies: { get(name: string): { value: string } | undefined } }): Promise<boolean> {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return verifySessionToken(match?.[1]);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    secure: isSecure(),
  };
}
