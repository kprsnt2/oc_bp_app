// Smoke test for the running dev server. No API key and no network needed.
//
//   npm run dev          # in one terminal
//   npm run verify:smoke # in another
//
// Checks the passcode gate, both front-ends, and the error paths that matter
// when no provider is configured. Reads APP_PASSCODE from .env.local.

const fs = require("fs");
const path = require("path");

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
const MANGLED = /\u00C3|\u00E2\u20AC|\u00F0\u0178|\u00C2\u00B7/;
const EMOJI = /\p{Extended_Pictographic}/gu;

function passcodeFromEnvFile() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("APP_PASSCODE="));
  return line && line.slice("APP_PASSCODE=".length).trim();
}

const PASSCODE = process.env.APP_PASSCODE || passcodeFromEnvFile();
let cookie = "";

async function get(p) {
  const res = await fetch(BASE + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

function report(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

const send = (payload) =>
  fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  });

(async () => {
  if (!PASSCODE) {
    console.log("FAIL  APP_PASSCODE not set and .env.local has none");
    process.exit(1);
  }

  const locked = await get("/");
  report(
    "locked / redirects to /login",
    locked.status === 307 && (locked.headers.get("location") || "").includes("/login"),
    locked.status + " " + locked.headers.get("location"),
  );

  const api = await get("/api/chat");
  report("locked /api/chat is 401", api.status === 401, String(api.status));

  const bad = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: "definitely-wrong" }),
  });
  report("wrong passcode is 401", bad.status === 401, String(bad.status));

  const good = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: PASSCODE }),
  });
  cookie = (good.headers.get("set-cookie") || "").split(";")[0];
  report(
    "correct passcode is 200 + cookie",
    good.status === 200 && cookie.includes("aiwish_session"),
    good.status + " " + cookie.split("=")[0],
  );

  // Both front-ends must render clean UTF-8. A cp1252 round trip used to ship
  // mojibake here, so this guards against it coming back.
  for (const p of ["/", "/basic"]) {
    const res = await get(p);
    const html = await res.text();
    report(
      `${p} renders 200, no mojibake`,
      res.status === 200 && !MANGLED.test(html),
      `status=${res.status} bytes=${html.length} emoji=${(html.match(EMOJI) || []).length}`,
    );
  }

  const health = await (await get("/api/health")).json();
  report(
    "health lists configured providers",
    Array.isArray(health.providers),
    "providers=" + JSON.stringify(health.providers),
  );

  // The wire format is messages: [{ role, parts: [...] }]. Attachments are
  // inlined as image/file parts, so 503 here means "no usable provider", which
  // is the expected local-only state before any keys are added.
  const textMsg = { role: "user", parts: [{ type: "text", text: "hi" }] };

  if (health.providers.length === 0) {
    const none = await send({ messages: [textMsg], agentId: "general" });
    report("no keys -> 503 naming every provider", none.status === 503, String(none.status));

    const priv = await send({ messages: [textMsg], agentId: "general", privacy: true });
    report(
      "private mode, no Gemini key -> 503",
      priv.status === 503 && (await priv.text()).includes("GEMINI_API_KEY"),
      String(priv.status),
    );
  }

  const badAgent = await send({ messages: [textMsg], agentId: "nope" });
  report("unknown agent -> 400", badAgent.status === 400, String(badAgent.status));

  const junk = await send({ messages: [{ role: "user", content: "hi" }], agentId: "general" });
  report("wrong message shape -> 400, not 500", junk.status === 400, String(junk.status));
})().catch((err) => {
  console.log(`FAIL  could not reach ${BASE} — is "npm run dev" running? (${err.message})`);
  process.exit(1);
});
