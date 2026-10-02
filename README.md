# AIWish

One chat app for yourself. Pick an agent like a plugin, drop in as many photos and
documents as you like, and let the app fall back to another model provider when one
fails — so you are never stuck at 3 attachments with an error.

- **20 agents**, grouped by category, switchable mid-chat
- **Unlimited-ish attachments**: many images at once, PDFs, Word, Excel, PowerPoint, text/code, voice notes
- **Automatic model fallback**: OpenAI → Gemini → NVIDIA → Groq
- **Private mode**: routes everything to Gemini only and keeps no history
- **Passcode gate** so the URL is not open to the world
- **History stays in your browser** (IndexedDB). No database, no server-side log of your chats

---

## 1. Local setup

```bash
npm install
cp .env.example .env.local     # then fill in your keys
npm run dev                    # http://localhost:3000
```

`APP_PASSCODE` and `SESSION_SECRET` are required — without them the app refuses to
start and the login page cannot unlock.

Two front-ends are kept in the tree right now:

| Route | Source | Use it for |
| --- | --- | --- |
| `/` | `components/ChatApp.tsx` | the full app: voice notes, print, agent picker |
| `/basic` | `app/basic/page.tsx` + `app/components/` | a leaner, all-client-side variant |

Both talk to the same `/api/chat` stream and the same auth gate. `/basic` extracts
documents in the browser instead of uploading them to `/api/extract`, which keeps
private files off the server entirely. Delete one when you have decided.

## 2. Deploy to Vercel

```bash
npx vercel            # first time
npx vercel --prod     # when it works locally
```

Or import the repo at [vercel.com/new](https://vercel.com/new) — the build settings
are already correct (Next.js is auto-detected).

Add these as **Project → Settings → Environment Variables**:

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PASSCODE` | yes | the passcode you type to unlock |
| `SESSION_SECRET` | yes | signs the session cookie (any random string) |
| `OPENAI_API_KEY` | any one | primary provider |
| `GEMINI_API_KEY` | any one | backup 1 + the only provider in Private mode |
| `NVIDIA_API_KEY` | optional | backup 2 |
| `GROQ_API_KEY` | optional | backup 3 + cheap voice transcription |

You only need one provider key. The app skips any provider without a key and says so
in Settings.

Optional overrides: `OPENAI_MODEL_SMART`, `OPENAI_MODEL_FAST` and the same for
Gemini/NVIDIA/Groq (see `.env.example`), plus `MAX_IMAGES_PER_MESSAGE` and
`MAX_DOC_CHARS`.

## 3. Deploy to Cloudflare Workers

The code was written for this to be easy. Nothing in `lib/providers`, `lib/extract.ts`
or `lib/auth.ts` touches Node built-ins — only `fetch`, `ReadableStream`,
`TextDecoder`, `FormData`, `btoa` and Web Crypto.

1. `npm i @opennextjs/cloudflare` and follow the OpenNext adapter setup
   (`wrangler.jsonc` + `open-next.config.ts`).
2. Delete the `export const runtime = "nodejs"` lines in `app/api/*/route.ts` —
   Workers run on workerd, not Node. Nothing else changes.
3. `npx opennextjs-cloudflare build && npx wrangler deploy`
4. Set the same environment variables as `wrangler secret put APP_PASSCODE` etc.

Worker body limits are far more generous than Vercel's, so large multi-image messages
are actually easier there.

---

## How the model fallback works

`lib/models.ts` owns the catalog and the chain logic.

```
default order:  OpenAI  →  Gemini  →  NVIDIA  →  Groq
```

For every message the server builds the candidate list:

1. **Private mode on** → the list is exactly one entry: Gemini. OpenAI is never
   contacted, even if it is the pinned provider. That is the whole point of the mode.
2. **Providers without a key are dropped**, with the reason reported to Settings.
3. **Providers that cannot read your attachments are dropped.** This is what makes
   20 photos work: Groq has no vision model, so it is skipped for image messages
   instead of failing the request. NVIDIA keeps only its vision model; only OpenAI and
   Gemini get PDF parts, and PDFs are converted to text before the request if no
   PDF-capable provider is configured.
4. **The first provider that returns text wins.** If it fails *before the first token*,
   the app retries on the next provider and shows a banner: which provider failed,
   why, and who answered instead. If it fails *after* text has streamed, the partial
   answer is kept rather than replaying the message twice.

Every model id is overridable by env var, so a rename upstream is a one-line config
change, not a code change.

## How attachments are handled

| Type | Path |
| --- | --- |
| Images (jpg/png/webp/heic-as-jpeg) | Resized in your browser to ≤1568px and re-encoded until under ~220 KB, then sent as a data URI to a vision model |
| PDF | Sent natively to OpenAI/Gemini. If no PDF-capable provider is configured, text is extracted on the server instead |
| .docx / .xlsx / .pptx | Text extracted on the server (`jszip` for OOXML, `unpdf` for PDF), wrapped in `<document name="...">` tags |
| .txt / .md / .csv / code files | Read in the browser when small, otherwise extracted on the server |
| Audio | Transcribed (`/api/transcribe`) and injected as text |

Limits, and why:

- **~3.4 MB total payload per message.** Vercel caps a serverless request body at
  4.5 MB. The composer shows the live payload size and refuses to send a larger one,
  so you find out before wasting tokens.
- **History attachment pruning.** When the conversation plus attachments would exceed
  the budget, the oldest attachments are replaced with a short placeholder note rather
  than the request failing. Text is always kept.
- **Single files up to 8 MB** for extraction. Larger files go through the browser and
  are refused with a clear message.
- Scanned PDFs with no text layer report that they are image-only — send those as
  photos instead so a vision model can read them.

## Agents

| Category | Agents |
| --- | --- |
| Everyday | General Assistant, Note Maker, Email & Writing, Language Coach |
| Kids & School | KidStory, StudyBuddy, Worksheet, Parent Helper |
| Health & Mind | Doctor (Report Reader), Fitness & Health Log, Psycho |
| Work & Code | CodeBuddy, DataAnalyst, Career Coach |
| Life & Home | Chef, Trip Planner, Spiritual, Money, Life Admin, Home & DIY |

Every agent lives in `lib/agents.ts` as one object: name, emoji, tagline, category,
system prompt, three starter prompts, preferred model tier, and whether it offers a
Print button. Adding one is a single array entry — no registration step anywhere else.

Health-adjacent agents (Doctor, Psycho, Fitness, Money) carry explicit guardrails in
their prompts: no diagnosis, no dose changes, no guaranteed financial outcomes, and
crisis handling in Psycho that points at real human help.

## Adding an agent

```ts
{
  id: "myagent",
  name: "My Agent",
  emoji: "🦉",
  tagline: "One line for the picker",
  category: "work",            // general | kids | health | work | life
  tier: "smart",               // smart | fast
  printable: false,            // true shows a Print button on the reply
  attachmentHint: "Photos of reports",   // shown in the composer placeholder
  starters: ["First thing to try"],
  prompt: `Your instructions here.`,
}
```

## Project layout

```
app/
  page.tsx          mounts components/ChatApp
  basic/            the leaner client-side front-end
  api/chat/         streaming endpoint + fallback loop (SSE)
  api/extract/      pdf/docx/xlsx/pptx/text -> text
  api/transcribe/   audio -> text, with its own provider chain
  api/health/       which providers and models are usable
  api/config/       model catalog for the /basic model picker
  api/auth/         passcode in, signed cookie out (+ login/logout)
  components/       front-end used by /basic
  lib/              client helpers used by /basic
  login/            unlock screen
components/         chat shell, agent picker, composer, message rendering
lib/
  agents.ts         the 20 agent definitions
  models.ts         model catalog + chain builder (capability aware)
  providers/        one adapter per provider, Web APIs only
  trim.ts           history windowing + old attachments -> placeholder notes
  extract.ts        document text extraction
  attachments.ts    browser-side image compression and file preparation
  idb.ts            the single IndexedDB connection (both stores)
  store.ts          IndexedDB history + preferences
  format.ts         small display helpers
  auth.ts           HMAC-signed session cookie (Web Crypto, Edge-safe)
middleware.ts       passcode gate
verify/             adapter + SSE tests: npm run verify
```

## Checks

```bash
npm run typecheck    # tsc, no errors expected
npm run build        # 12 routes
npm run verify       # 13 assertions over the streaming adapters and SSE parser
npm run verify:smoke # 11 assertions against a running dev server
```

`npm run verify` compiles the provider adapters to a temp dir and runs them against
a local mock server, so it needs no API key and no network.

`npm run verify:smoke` needs `npm run dev` running in another terminal. It reads
`APP_PASSCODE` from `.env.local`, so it is zero-config. It checks the passcode gate,
both front-ends, and the error paths, and it asserts the rendered HTML is clean
UTF-8 — a cp1252 round trip once shipped mojibake into the UI, so this guards
against it coming back.

### The chat wire format

`POST /api/chat` takes `messages: [{ role, parts: [...] }]`. Attachments are inlined
as parts, there is no `attachments` or `content` field:

```jsonc
{
  "agentId": "general",
  "tier": "smart",              // smart | fast
  "provider": "auto",           // auto | openai | gemini | nvidia | groq
  "privacy": false,             // true collapses the chain to Gemini only
  "messages": [
    { "role": "user", "parts": [
      { "type": "text",  "text": "what is in this photo?" },
      { "type": "image", "mime": "image/jpeg", "data": "<base64>" },
      { "type": "file",  "name": "notes.pdf", "mime": "application/pdf", "data": "<base64>" }
    ]}
  ]
}
```

Responses are SSE `ChatEvent`s (`start`, `delta`, `fallback`, `done`, `error`).

## Notes

- Rotate `APP_PASSCODE` and `SESSION_SECRET` if the deployment URL ever leaks.
- The session cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- History is per-browser. Clearing site data clears the chats; there is no server copy
  to restore from.
