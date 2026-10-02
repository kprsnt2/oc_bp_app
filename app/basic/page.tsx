"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import {
  deleteConversation,
  listConversations,
  newConversation,
  putConversation,
  type Conversation,
  type StoredMessage,
} from "@/app/lib/db";
import type { ModelTier, ProviderId } from "@/lib/types";
import Composer from "@/app/components/Composer";
import MessageList from "@/app/components/MessageList";
import PasscodeGate from "@/app/components/PasscodeGate";
import PrintSheet from "@/app/components/PrintSheet";
import Sidebar from "@/app/components/Sidebar";
import { MAX_DOC_CHARS, MAX_IMAGES, prepareFiles } from "@/app/lib/attach";
import { LockedError, streamChat } from "@/app/lib/stream";

const SETTINGS_KEY = "aiwish:settings";

type Gate = "loading" | "locked" | "open";

interface ConfigModel {
  id: string;
  provider: ProviderId;
  label: string;
  tier: ModelTier;
  vision: boolean;
  available: boolean;
  wire: string;
}

interface Config {
  providers: { id: ProviderId; label: string; configured: boolean; envKeys: string[] }[];
  models: ConfigModel[];
}

interface Settings {
  activeId: string | null;
  agentId: string;
  tier: ModelTier;
  provider: ProviderId | "auto";
  privacy: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  activeId: null,
  agentId: AGENTS[0].id,
  tier: "smart",
  provider: "auto",
  privacy: false,
};

function readSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(s: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage disabled */
  }
}

function titleFrom(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const text = first.parts
    .map((p) => (p.type === "text" ? p.text : p.type === "image" ? `[${p.name ?? "photo"}]` : `[${p.name}]`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New chat";
  return text.length > 48 ? `${text.slice(0, 48)}â€¦` : text;
}

export default function Page() {
  const [gate, setGate] = useState<Gate>("loading");
  const [config, setConfig] = useState<Config | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<StoredMessage["parts"]>([]);
  const [streaming, setStreaming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<"all" | number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef<Set<string>>(new Set());
  const bufferRef = useRef<{ convId: string; text: string } | null>(null);
  const flushRef = useRef<number | null>(null);

  const agent = useMemo(
    () => AGENTS.find((a) => a.id === settings.agentId) ?? AGENTS[0],
    [settings.agentId],
  );
  const active = useMemo(
    () => conversations.find((c) => c.id === settings.activeId) ?? null,
    [conversations, settings.activeId],
  );
  const messages = active?.messages ?? [];

  /* ---------------------------------------------------------------- boot */

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    setConfig((await res.json()) as Config);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authRes = await fetch("/api/auth");
        const auth = await authRes.json();
        if (cancelled) return;
        if (auth.required && !auth.ok) {
          setGate("locked");
          return;
        }
        setGate("open");

        const saved = readSettings();
        const stored = await listConversations();
        if (cancelled) return;

        const activeId =
          saved.activeId && stored.some((c) => c.id === saved.activeId)
            ? saved.activeId
            : (stored[0]?.id ?? null);
        const next = {
          ...saved,
          activeId,
          agentId: AGENTS.some((a) => a.id === saved.agentId)
            ? saved.agentId
            : AGENTS[0].id,
        };
        setSettings(next);
        writeSettings(next);
        setConversations(stored);
        await loadConfig();
      } catch {
        if (!cancelled) setGate("open");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConfig]);

  /* --------------------------------------------------------- persistence */

  const patch = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      dirtyRef.current.add(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...fn(c), updatedAt: Date.now() } : c)),
      );
    },
    [],
  );

  useEffect(() => {
    if (gate !== "open") return;
    const timer = setInterval(() => {
      const ids = [...dirtyRef.current];
      if (!ids.length) return;
      dirtyRef.current.clear();
      for (const id of ids) {
        const c = conversations.find((x) => x.id === id);
        if (c) void putConversation(c);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [gate, conversations]);

  useEffect(() => {
    if (gate === "open") writeSettings(settings);
  }, [gate, settings]);

  /* ------------------------------------------------------------- streaming */

  const flush = useCallback(() => {
    const buffered = bufferRef.current;
    if (!buffered) return;
    const { convId, text } = buffered;
    bufferRef.current = null;
    patch(convId, (c) => {
      const list = [...c.messages];
      const last = list[list.length - 1];
      if (!last || last.role !== "assistant") return c;
      list[list.length - 1] = {
        ...last,
        parts: [{ type: "text", text: last.parts.map((p) => (p.type === "text" ? p.text : "")).join("") + text }],
      };
      return { ...c, messages: list };
    });
  }, [patch]);

  const scheduleFlush = useCallback(() => {
    if (flushRef.current !== null) return;
    flushRef.current = window.setTimeout(() => {
      flushRef.current = null;
      flush();
    }, 60);
  }, [flush]);

  useEffect(
    () => () => {
      if (flushRef.current !== null) window.clearTimeout(flushRef.current);
    },
    [],
  );

  const setLastAssistant = useCallback(
    (convId: string, fn: (m: StoredMessage) => StoredMessage) => {
      patch(convId, (c) => {
        const list = [...c.messages];
        const i = list.length - 1;
        if (i < 0 || list[i].role !== "assistant") return c;
        list[i] = fn(list[i]);
        return { ...c, messages: list };
      });
    },
    [patch],
  );

  /* ----------------------------------------------------------------- send */

  async function run(convId: string, history: StoredMessage[], privacy: boolean, agentId: string) {
    setStreaming(true);
    setNote(null);
    const ac = new AbortController();
    abortRef.current = ac;
    const startedAt = Date.now();

    try {
      await streamChat(
        {
          messages: history.map((m) => ({ role: m.role, parts: m.parts })),
          agentId,
          tier: settings.tier,
          provider: privacy ? "gemini" : settings.provider,
          privacy,
        },
        {
          onStart: (e) =>
            setLastAssistant(convId, (m) => ({
              ...m,
              modelLabel: e.label,
              provider: e.provider,
            })),
          onDelta: (t) => {
            if (!bufferRef.current || bufferRef.current.convId !== convId) {
              bufferRef.current = { convId, text: t };
            } else {
              bufferRef.current.text += t;
            }
            scheduleFlush();
          },
          onFallback: (e) => {
            const target = config?.providers.find((p) => p.id === e.to)?.label ?? e.to;
            setNote(`${e.reason} â†’ switching to ${target}`);
          },
          onDone: (e) => {
            flush();
            setLastAssistant(convId, (m) => ({ ...m, modelLabel: e.label, provider: e.provider }));
            setNote(null);
          },
          onError: (message) => {
            flush();
            setLastAssistant(convId, (m) => ({
              ...m,
              error: true,
              parts: [
                {
                  type: "text",
                  text:
                    (m.parts.map((p) => (p.type === "text" ? p.text : "")).join("") || "") +
                    `\n\nâš ï¸ ${message}`,
                },
              ],
            }));
          },
        },
        ac.signal,
      );
    } catch (err) {
      flush();
      if (err instanceof LockedError) {
        setGate("locked");
        return;
      }
      if (ac.signal.aborted) {
        setLastAssistant(convId, (m) => ({
          ...m,
          parts: [
            {
              type: "text",
              text:
                (m.parts.map((p) => (p.type === "text" ? p.text : "")).join("") || "") +
                "\n\n_(stopped)_",
            },
          ],
        }));
        return;
      }
      setLastAssistant(convId, (m) => ({
        ...m,
        error: true,
        parts: [
          {
            type: "text",
            text: `âš ï¸ ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void startedAt;
    }
  }

  const send = useCallback(
    (regenerate: boolean) => {
      if (streaming || !settings.activeId) return;
      const convId = settings.activeId;
      const current = conversations.find((c) => c.id === convId);
      if (!current) return;

      let history: StoredMessage[];
      if (regenerate) {
        if (current.messages.length < 2) return;
        history = current.messages.slice(0, -1);
      } else {
        const text = input.trim();
        if (!text && pending.length === 0) return;
        const parts: StoredMessage["parts"] = [...pending];
        if (text) parts.unshift({ type: "text", text });
        const userMsg: StoredMessage = { role: "user", parts, createdAt: Date.now() };
        history = [...current.messages, userMsg];
        setInput("");
        setPending([]);
        setAttachNote(null);
      }

      const placeholder: StoredMessage = {
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        createdAt: Date.now(),
      };

      patch(convId, (c) => ({
        ...c,
        title: c.messages.length === 0 ? titleFrom(history) : c.title,
        messages: [...history, placeholder],
      }));

      void run(convId, history, settings.privacy, settings.agentId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, input, pending, settings, streaming],
  );

  function stop() {
    abortRef.current?.abort();
  }

  /* ---------------------------------------------------------- attachments */

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const usedImages = pending.filter((p) => p.type === "image").length;
    const usedChars = pending
      .filter((p): p is Extract<StoredMessage["parts"][number], { type: "text" }> => p.type === "text")
      .reduce((n, p) => n + p.text.length, 0);

    const { parts, chips } = await prepareFiles(list, {
      imagesLeft: Math.max(0, MAX_IMAGES - usedImages),
      docCharsLeft: Math.max(0, MAX_DOC_CHARS - usedChars),
    });

    setPending((p) => [...p, ...parts]);
    const problems = chips.filter((c) => c.kind === "skipped" || c.kind === "error" || c.kind === "unsupported");
    setAttachNote(
      [
        chips
          .filter((c) => c.kind === "image" || c.kind === "pdf" || c.kind === "docx" || c.kind === "sheet" || c.kind === "slides")
          .map((c) => `${c.name} (${c.detail})`)
          .join(" Â· "),
        problems.length
          ? `âš ï¸ ${problems.map((c) => `${c.name}: ${c.detail}`).join(" Â· ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" â€” ") || null,
    );
  }

  /* -------------------------------------------------------------- actions */

  function newChat() {
    const conv = newConversation(settings.agentId, settings.privacy);
    setConversations((prev) => [conv, ...prev]);
    setSettings((s) => ({ ...s, activeId: conv.id }));
    setInput("");
    setPending([]);
    setNote(null);
    setAttachNote(null);
  }

  function selectAgent(id: string) {
    if (id === settings.agentId) return;
    if (streaming) stop();
    const conv = newConversation(id, settings.privacy);
    setConversations((prev) => [conv, ...prev]);
    setSettings((s) => ({ ...s, agentId: id, activeId: conv.id }));
    setInput("");
    setPending([]);
    setNote(null);
  }

  async function selectConversation(id: string) {
    if (id === settings.activeId) return;
    if (streaming) stop();
    const c = conversations.find((x) => x.id === id);
    if (!c) return;
    setSettings((s) => ({ ...s, activeId: id, agentId: c.agentId, privacy: c.privacy }));
    setNote(null);
    setAttachNote(null);
  }

  async function removeConversation(id: string) {
    if (streaming) stop();
    await deleteConversation(id);
    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (settings.activeId === id) {
      setSettings((s) => ({ ...s, activeId: rest[0]?.id ?? null }));
    }
  }

  async function lock() {
    if (streaming) stop();
    await fetch("/api/auth", { method: "DELETE" });
    setGate("locked");
  }

  /* ---------------------------------------------------------------- print */

  useEffect(() => {
    if (printTarget === null) return;
    document.documentElement.setAttribute("data-printing", "1");
    const t = setTimeout(() => window.print(), 80);
    const after = () => {
      document.documentElement.removeAttribute("data-printing");
      setPrintTarget(null);
    };
    window.addEventListener("afterprint", after);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", after);
      document.documentElement.removeAttribute("data-printing");
    };
  }, [printTarget]);

  useEffect(() => {
    const handler = (e: Event) => setInput((e as CustomEvent<string>).detail);
    window.addEventListener("aiwish:starter", handler);
    return () => window.removeEventListener("aiwish:starter", handler);
  }, []);

  /* ----------------------------------------------------------------- view */

  if (gate === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-neutral-500">Loadingâ€¦</div>;
  }
  if (gate === "locked") {
    return <PasscodeGate onUnlock={() => { setGate("open"); void loadConfig(); }} />;
  }

  const availableModels = (config?.models ?? []).filter((m) => m.available);
  const selectedModel = availableModels.find(
    (m) => m.provider === settings.provider && m.tier === settings.tier,
  );
  const privacyReady = config?.providers.find((p) => p.id === "gemini")?.configured ?? false;
  const printMessages =
    printTarget === "all"
      ? messages
      : typeof printTarget === "number"
        ? [messages[printTarget]].filter(Boolean)
        : [];

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-900 text-neutral-100">
      <Sidebar
        conversations={conversations}
        activeId={settings.activeId}
        agentId={settings.agentId}
        onSelectConversation={(id) => void selectConversation(id)}
        onDeleteConversation={(id) => void removeConversation(id)}
        onNewChat={newChat}
        onSelectAgent={selectAgent}
        onLock={() => void lock()}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-4 py-2.5">
          <div className="mr-1 flex items-center gap-2">
            <span className="text-lg">{agent.emoji}</span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{agent.name}</div>
              <div className="text-[11px] text-neutral-500">{agent.tagline}</div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="hidden sm:inline">Model</span>
              <select
                value={settings.provider === "auto" ? "auto" : `${settings.provider}:${settings.tier}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "auto") {
                    setSettings((s) => ({ ...s, provider: "auto" }));
                    return;
                  }
                  const [provider, tier] = v.split(":");
                  setSettings((s) => ({
                    ...s,
                    provider: provider as ProviderId,
                    tier: (tier as ModelTier) ?? "smart",
                  }));
                }}
                disabled={settings.privacy}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs disabled:opacity-40"
              >
                <option value="auto">
                  Auto chain{selectedModel ? ` (${selectedModel.label})` : ""}
                </option>
                {(["openai", "gemini", "nvidia", "groq"] as ProviderId[]).map((p) => {
                  const providerModels = availableModels.filter((m) => m.provider === p);
                  if (!providerModels.length) return null;
                  const label = config?.providers.find((x) => x.id === p)?.label ?? p;
                  return (
                    <optgroup key={p} label={label}>
                      {providerModels.map((m) => (
                        <option key={`${m.provider}:${m.tier}:${m.id}`} value={`${m.provider}:${m.tier}`}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>

            <button
              onClick={() => setSettings((s) => ({ ...s, tier: s.tier === "smart" ? "fast" : "smart" }))}
              disabled={settings.privacy}
              title="Smart = strongest model, Fast = quickest/cheapest"
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
            >
              {settings.tier === "smart" ? "ðŸ§  Smart" : "âš¡ Fast"}
            </button>

            <label
              title={
                privacyReady
                  ? "Sends everything to Gemini only"
                  : "Set GEMINI_API_KEY to enable private mode"
              }
              className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                settings.privacy
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              <input
                type="checkbox"
                checked={settings.privacy}
                onChange={(e) => setSettings((s) => ({ ...s, privacy: e.target.checked }))}
              />
              Private
            </label>

            {messages.some((m) => m.role === "assistant" && m.parts.some((p) => p.type === "text" && p.text)) && (
              <button
                onClick={() => setPrintTarget("all")}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
              >
                ðŸ–¨ Print
              </button>
            )}
          </div>
        </header>

        {availableModels.length === 0 && (
          <div className="border-b border-amber-700/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            No provider keys found. Copy <code>.env.example</code> to{" "}
            <code>.env.local</code>, add at least one key, then restart the dev server.
          </div>
        )}
        {settings.privacy && !privacyReady && (
          <div className="border-b border-amber-700/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            Private mode needs <code>GEMINI_API_KEY</code>. Add it to <code>.env.local</code> to keep
            your data away from OpenAI.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageList
            messages={messages}
            agent={agent}
            streaming={streaming}
            fallbackNote={note}
            onRegenerate={() => send(true)}
            onPrintMessage={(i) => setPrintTarget(i)}
          />
        </div>

        <Composer
          agent={agent}
          value={input}
          onChange={setInput}
          onSend={() => send(false)}
          onStop={stop}
          streaming={streaming}
          pending={pending}
          onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          onFiles={(f) => void onFiles(f)}
          busyNote={attachNote}
        />
      </main>

      <PrintSheet agent={agent} messages={printMessages} />
    </div>
  );
}
