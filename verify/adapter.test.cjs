/* eslint-disable */
// Standalone test for the streaming adapter + SSE parser.
// Compiled TS is loaded from ../.tmp-verify (see run-verify.ps1).
const http = require("node:http");
const path = require("node:path");

const OUT = path.join(__dirname, "..", ".tmp-verify");
const { openAiCompatibleAdapter } = require(path.join(OUT, "providers", "openaiCompatible.js"));
const { ssePayloads } = require(path.join(OUT, "providers", "stream.js"));

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
}

function startServer(handler) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer(handler);
    server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    server.closeAll = () => { for (const s of sockets) s.destroy(); };
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function collect(gen) {
  return (async () => {
    let out = "";
    for await (const chunk of gen) out += chunk;
    return out;
  })();
}

async function main() {
  // ---- 1. happy path: SSE deltas reassemble, split across chunk boundaries
  {
    const body =
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":", world"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}]}\n\n' +
      "data: [DONE]\n\n";
    // Deliberately split mid-line and mid-frame to exercise the buffer.
    const pieces = [body.slice(0, 30), body.slice(30, 31), body.slice(31, 95), body.slice(95)];
    const server = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let i = 0;
      const tick = () => {
        if (i < pieces.length) {
          res.write(pieces[i++]);
          setTimeout(tick, 5);
        } else {
          res.end();
        }
      };
      tick();
    });
    const port = server.address().port;
    const adapter = openAiCompatibleAdapter("groq", "Groq", `http://127.0.0.1:${port}/v1`, ["GROQ_API_KEY"]);
    process.env.GROQ_API_KEY = "test-key";
    const out = await collect(
      adapter.stream({
        model: "llama-3.3-70b-versatile",
        system: "sys",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
        signal: new AbortController().signal,
      }),
    );
    server.closeAll(); server.close();
    check("SSE deltas reassemble across chunk boundaries", out === "Hello, world", JSON.stringify(out));
  }

  // ---- 2. request shape: system message + image part + no file part leakage
  {
    let captured = null;
    const server = await startServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        captured = JSON.parse(raw);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("data: [DONE]\n\n");
      });
    });
    const port = server.address().port;
    const adapter = openAiCompatibleAdapter("nvidia", "NVIDIA", `http://127.0.0.1:${port}/v1`, ["NVIDIA_API_KEY"]);
    process.env.NVIDIA_API_KEY = "test-key";
    await collect(
      adapter.stream({
        model: "meta/llama-3.2-90b-vision-instruct",
        system: "You are Worksheet",
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "make a worksheet" },
              { type: "image", mime: "image/jpeg", data: "QUJD" },
              { type: "file", name: "notes.pdf", mime: "application/pdf", data: "UERG" },
            ],
          },
        ],
        signal: new AbortController().signal,
      }),
    );
    server.closeAll(); server.close();
    const m = captured.messages;
    check("system prompt is the first message", m[0].role === "system" && m[0].content === "You are Worksheet");
    const parts = m[1].content;
    check("text part present", parts[0].type === "text" && parts[0].text === "make a worksheet");
    check(
      "image becomes an image_url data url",
      parts[1].type === "image_url" && parts[1].image_url.url === "data:image/jpeg;base64,QUJD",
      JSON.stringify(parts[1]),
    );
    check(
      "unreadable file degrades to a text note",
      parts[2].type === "text" && parts[2].text.includes("notes.pdf"),
      JSON.stringify(parts[2]),
    );
    check("model id is passed through", captured.model === "meta/llama-3.2-90b-vision-instruct");
    check("streaming requested", captured.stream === true);
  }

  // ---- 3. provider error: status + parsed message surface as ProviderError
  {
    const server = await startServer((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached for gpt" } }));
    });
    const port = server.address().port;
    const adapter = openAiCompatibleAdapter("groq", "Groq", `http://127.0.0.1:${port}/v1`, ["GROQ_API_KEY"]);
    process.env.GROQ_API_KEY = "test-key";
    let caught = null;
    try {
      await collect(
        adapter.stream({
          model: "llama-3.3-70b-versatile",
          system: "",
          messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }],
          signal: new AbortController().signal,
        }),
      );
    } catch (e) {
      caught = e;
    }
    server.closeAll(); server.close();
    check("429 throws ProviderError", !!caught && caught.name === "ProviderError", caught && caught.name);
    check("429 keeps its status for the retry decision", caught && caught.status === 429, String(caught && caught.status));
    check("error message is parsed out of the JSON body", caught && /Rate limit/.test(caught.message), caught && caught.message);
    check("error is treated as transient (fallback-worthy)", caught && require(path.join(OUT, "providers", "stream.js")).isTransient(caught));
  }

  // ---- 4. abort mid-stream stops iteration
  {
    const server = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      // never ends on its own
    });
    const port = server.address().port;
    const adapter = openAiCompatibleAdapter("groq", "Groq", `http://127.0.0.1:${port}/v1`, ["GROQ_API_KEY"]);
    process.env.GROQ_API_KEY = "test-key";
    const ac = new AbortController();
    let count = 0;
    let aborted = false;
    try {
      for await (const _ of adapter.stream({
        model: "m",
        system: "",
        messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }],
        signal: ac.signal,
      })) {
        count++;
        if (count === 1) ac.abort();
      }
    } catch (e) {
      aborted = true;
    }
    server.closeAll(); server.close();
    check("abort stops the stream", count === 1 && aborted, `chunks=${count} threw=${aborted}`);
  }

  // ---- 5. ssePayloads ignores non-data lines and comments
  {
    const payload = ": keep-alive\n\nid: 7\ndata: one\n\ndata: two\n\n";
    const res = new Response(new Blob([payload]).stream(), {
      headers: { "content-type": "text/event-stream" },
    });
    const got = [];
    for await (const p of ssePayloads(res)) got.push(p);
    check("ssePayloads yields only data payloads", JSON.stringify(got) === JSON.stringify(["one", "two"]), JSON.stringify(got));
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
