"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AgentPicker from "./AgentPicker";
import Composer from "./Composer";
import { Markdown } from "./Markdown";
import MessageBubble from "./MessageBubble";
import Sidebar from "./Sidebar";
import { AGENTS, getAgent } from "@/lib/agents";
import { TOTAL_PAYLOAD_BUDGET, payloadBytes, type Attachment } from "@/lib/attachments";
import { bytesHuman } from "@/lib/format";
import {
  type StoredChat,
  type UiPrefs,
  deleteChat as dbDelete,
  listChats,
  loadPrefs,
  newChat,
  putChat,
  savePrefs,
  storageUsage,
  titleFromFirstMessage,
} from "@/lib/store";
import type { ChatEvent, ChatMessage, MessagePart, ProviderId } from "@/lib/types";

interface Health {
  providers: ProviderId[];
  canTranscribe: boolean;
  models: {
    provider: ProviderId;
    id: string;
    label: string;
    tier: "fast" | "smart";
    vision: boolean;
    pdf: boolean;
    enabled: boolean;
  }[];
  limits: { maxImages: number; maxDocChars: number };
}

interface Stream {
  text: string;
  provider?: ProviderId;
  model?: string;
  label?: string;
  notice?: string;
  failed?: string;
}

const DEFAULT_PREFS: UiPrefs = {
  agentId: "general",
  tier: "smart",
  provider: "auto",
  privacy: false,
  sendKey: "enter",
  theme: "dark",
};

export default function ChatApp() {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_PREFS);
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [chat, setChat] = useState<StoredChat | null>(null);
  const [stream, setStream] = useState<Stream | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [print, setPrint] = useState<{ text: string; title: string } | null>(null);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<StoredChat | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const agent = getAgent(chat?.agentId ?? prefs.agentId);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  // ------------------------------------------------------------------ boot

  useEffect(() => {
    const saved = loadPrefs();
    const merged = { ...DEFAULT_PREFS, ...saved };
    setPrefs(merged);

    void (async () => {
      const list = await listChats();
      setChats(list);
      if (list.length) {
        const first = list[0];
        chatRef.current = first;
        setChat(first);
        setPrefs((p) => ({
          ...p,
          agentId: first.agentId,
          privacy: first.privacy,
          tier: first.tier,
          provider: first.provider,
        }));
      } else {
        const fresh = newChat(merged.agentId, merged.privacy);
        chatRef.current = fresh;
        setChat(fresh);
      }
      setUsage(await storageUsage());
    })();

    void fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: stream ? "auto" : "smooth" });
  }, [chat?.messages.length, stream?.text, stream]);

  // ------------------------------------------------------------ persistence

  const persist = useCallback((next: StoredChat) => {
    if (next.privacy) return; // private chats are never written to disk
    setChats((prev) => {
      const others = prev.filter((c) => c.id !== next.id);
      return [next, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    void putChat(next);
  }, []);

  /** Single place that commits a chat to state + storage. */
  const commit = useCallback(
    (next: StoredChat) => {
      chatRef.current = next;
      setChat(next);
      if (!next.privacy) persist(next);
    },
    [persist],
  );

  const updateChat = useCallback(
    (patch: Partial<StoredChat>) => {
      const prev = chatRef.current;
      if (!prev) return;
      commit({ ...prev, ...patch, updatedAt: Date.now() });
    },
    [commit],
  );

  const startNewChat = useCallback(() => {
    const fresh = newChat(prefs.agentId, prefs.privacy);
    chatRef.current = fresh;
    setChat(fresh);
    setStream(null);
    setSidebarOpen(false);
  }, [prefs.agentId, prefs.privacy]);

  const selectChat = useCallback(
    (id: string) => {
      const found = chats.find((c) => c.id === id);
      if (!found) return;
      chatRef.current = found;
      setChat(found);
      setPrefs((p) => ({
        ...p,
        agentId: found.agentId,
        privacy: found.privacy,
        tier: found.tier,
        provider: found.provider,
      }));
      setStream(null);
      abortRef.current?.abort();
    },
    [chats],
  );

  const removeChat = useCallback(
    (id: string) => {
      void dbDelete(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (chat?.id === id) startNewChat();
      void storageUsage().then(setUsage);
    },
    [chat?.id, startNewChat],
  );

  // ------------------------------------------------------------- streaming

  const buildWireMessages = useCallback((messages: ChatMessage[]): ChatMessage[] => {
    let budget = TOTAL_PAYLOAD_BUDGET;
    const out: ChatMessage[] = new Array(messages.length);

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const bytes = payloadBytes(m.parts);
      if (bytes <= budget) {
        budget -= bytes;
        out[i] = m;
        continue;
      }
      const dropped: string[] = [];
      const parts: MessagePart[] = [];
      for (const p of m.parts) {
        if (p.type === "text") {
          if (p.text.trim()) parts.push(p);
          continue;
        }
        dropped.push(p.type === "image" ? "image" : `file ${p.name}`);
      }
      const note = dropped.length
        ? `[${dropped.length} earlier attachment${dropped.length > 1 ? "s" : ""} (${dropped.join(", ")}) omitted from history to fit the request size limit]`
        : "";
      out[i] = { ...m, parts: note ? [...parts, { type: "text", text: note }] : parts };
    }
    return out;
  }, []);

  const runAssistant = useCallback(
    async (history: ChatMessage[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const started = Date.now();

      let provider: ProviderId | undefined;
      let model: string | undefined;
      let label: string | undefined;
      let acc = "";
      let failure: string | undefined;
      let stopped = false;

      setStream({ text: "" });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: buildWireMessages(history),
            agentId: agent.id,
            tier: prefs.tier,
            provider: prefs.privacy ? "gemini" : prefs.provider,
            privacy: prefs.privacy,
            temperature: prefs.temperature,
          }),
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            let event: ChatEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as ChatEvent;
            } catch {
              continue;
            }
if (event.type === "start") {
              provider = event.provider;
              model = event.model;
              label = event.label;
              setStream((s) => ({
                text: s?.text ?? "",
                provider,
                model,
                label,
              }));
            } else if (event.type === "delta") {
              acc += event.text;
              setStream((s) => ({
                text: acc,
                provider,
                model,
                label,
                notice: s?.notice,
              }));
            } else if (event.type === "fallback") {
              setStream((s) => ({
                text: s?.text ?? "",
                provider,
                model,
                label,
                notice: `${label ?? event.from} failed (${event.reason}). Switching to ${event.to}.`,
              }));
            } else if (event.type === "error") {
              failure = event.message;
              setStream((s) => ({ ...(s ?? { text: acc }), failed: event.message }));
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          stopped = true;
        } else {
          failure = err instanceof Error ? err.message : "Request failed";
        }
      }

setStream(null);
      abortRef.current = null;

      const partial = stopped || Boolean(failure);
      const reply: ChatMessage = acc.trim()
        ? {
            role: "assistant",
            parts: [{ type: "text", text: acc }],
            meta: { provider, model, label, ms: Date.now() - started, partial },
          }
        : {
            role: "assistant",
            parts: [
              {
                type: "text",
                text: `⚠️ ${failure ?? "No response was produced."}`,
              },
            ],
            meta: { provider, model, label, partial: true },
          };

      const prev = chatRef.current;
      if (!prev) return;
      commit({
        ...prev,
        messages: [...prev.messages, reply],
        lastModel: model ?? prev.lastModel,
        lastProvider: provider ?? prev.lastProvider,
        updatedAt: Date.now(),
      });
    },
    [
      agent.id,
      buildWireMessages,
      commit,
      prefs.privacy,
      prefs.provider,
      prefs.temperature,
      prefs.tier,
    ],
  );

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      const parts: MessagePart[] = [];
      if (text.trim()) parts.push({ type: "text", text: text.trim() });
      for (const a of attachments) parts.push(...a.parts);
      if (parts.length === 0) return;

      const prev = chatRef.current;
      if (!prev) return;

      const messages: ChatMessage[] = [...prev.messages, { role: "user", parts }];
      const title =
        prev.messages.length === 0
          ? titleFromFirstMessage(text || attachments[0]?.name || "New chat")
          : prev.title;

      commit({ ...prev, messages, title, updatedAt: Date.now() });
      await runAssistant(messages);
    },
    [commit, runAssistant],
  );

  const regenerate = useCallback(async () => {
    const prev = chatRef.current;
    if (!prev?.messages.length) return;

    let history = prev.messages;
    if (history[history.length - 1]?.role === "assistant") history = history.slice(0, -1);
    if (!history.length) return;

    commit({ ...prev, messages: history, updatedAt: Date.now() });
    await runAssistant(history);
  }, [commit, runAssistant]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // --------------------------------------------------------------- derived

  const pdfCapable = useMemo<ProviderId[]>(() => {
    if (prefs.privacy) return health?.providers.includes("gemini") ? ["gemini"] : [];
    const source = health?.models ?? [];
    if (!source.length) return ["openai", "gemini"];
    if (prefs.provider !== "auto") {
      return source.some((m) => m.provider === prefs.provider && m.pdf && m.enabled)
        ? [prefs.provider]
        : [];
    }
    return source.filter((m) => m.pdf && m.enabled).map((m) => m.provider);
  }, [health, prefs.privacy, prefs.provider]);

  const effectiveModel = useMemo(() => {
    if (stream?.model) return { label: stream.label ?? stream.model, provider: stream.provider };
    const models = health?.models ?? [];
    const tier = prefs.tier;
    let chosen = models.find((m) => m.tier === tier && m.enabled);
    if (prefs.provider !== "auto") {
      chosen = models.find((m) => m.provider === prefs.provider && m.tier === tier && m.enabled) ?? chosen;
    }
    if (prefs.privacy) {
      chosen = models.find((m) => m.provider === "gemini" && m.tier === tier && m.enabled) ?? chosen;
    }
    return chosen ? { label: chosen.label, provider: chosen.provider } : null;
  }, [health, prefs.privacy, prefs.provider, prefs.tier, stream?.label, stream?.model, stream?.provider]);

  const messages = chat?.messages ?? [];
  const busy = stream !== null;

  const doPrint = useCallback((text: string, title: string) => {
    setPrint({ text, title });
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }, []);

  // ------------------------------------------------------------------ view

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950">
      <aside className="hidden w-72 shrink-0 border-r border-ink-800 lg:block">
        <Sidebar
          chats={chats}
          activeId={chat?.id ?? null}
          onSelect={selectChat}
          onNew={startNewChat}
          onDelete={removeChat}
        />
        <SettingsBar prefs={prefs} onToggle={() => setSettingsOpen(true)} />
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex w-72 max-w-[85vw] flex-col border-r border-ink-800">
            <Sidebar
              chats={chats}
              activeId={chat?.id ?? null}
              onSelect={selectChat}
              onNew={startNewChat}
              onDelete={removeChat}
              onClose={() => setSidebarOpen(false)}
            />
            <SettingsBar
              prefs={prefs}
              onToggle={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-800 bg-ink-900/80 px-3 py-2.5 backdrop-blur sm:px-5">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Chats"
            className="rounded-xl p-2 text-ink-300 transition hover:bg-ink-800 lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>

          <div className="min-w-0 flex-1 sm:max-w-xs">
            <AgentPicker
              agentId={agent.id}
              onChange={(id) => {
                setPrefs((p) => ({ ...p, agentId: id }));
                updateChat({ agentId: id });
              }}
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => {
                const privacy = !prefs.privacy;
                setPrefs((p) => ({ ...p, privacy, provider: privacy ? "gemini" : p.provider }));
                updateChat({ privacy });
              }}
              title="Private mode routes everything to Gemini only and keeps no history"
              className={`rounded-xl border px-2.5 py-2 text-xs font-medium transition ${
                prefs.privacy
                  ? "border-good/50 bg-good/15 text-good"
                  : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600"
              }`}
            >
              {prefs.privacy ? "🔒 Gemini only" : "🔓 Private"}
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              title="Model and settings"
              className="flex items-center gap-1.5 rounded-xl border border-ink-700 bg-ink-850 px-2.5 py-2 text-xs text-ink-300 transition hover:border-ink-600"
            >
              <span className="hidden sm:inline">{effectiveModel?.label ?? "loading…"}</span>
              <span className="hidden text-ink-400 md:inline">
                {stream?.notice ? "↺" : `· ${effectiveModel?.provider ?? "?"}`}
              </span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !busy ? (
            <EmptyState
              agentId={agent.id}
              onPick={(id) => {
                setPrefs((p) => ({ ...p, agentId: id }));
                updateChat({ agentId: id });
              }}
              onSeed={(text) => setSeed({ text, nonce: Date.now() })}
            />
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-5 py-6">
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  message={m}
                  agent={agent}
                  isLast={i === messages.length - 1}
                  onRegenerate={m.role === "assistant" && i === messages.length - 1 ? () => void regenerate() : undefined}
                  onPrint={doPrint}
                />
              ))}

              {stream ? (
                <div className="flex gap-3 px-3 sm:px-5">
                  <div className="flex min-w-0 max-w-[min(46rem,92%)] flex-col">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-400">
                      <span>{agent.emoji}</span>
                      <span className="font-medium text-ink-300">{agent.name}</span>
                      {stream.label ? (
                        <span className="rounded-full bg-ink-800 px-2 py-0.5 text-ink-400">
                          {stream.label}
                        </span>
                      ) : null}
                    </div>
                    <div className="rounded-2xl bg-ink-900 px-4 py-3 ring-1 ring-ink-800">
                      {stream.notice ? (
                        <p className="mb-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">
                          {stream.notice}
                        </p>
                      ) : null}
                      {stream.text ? (
                        <Markdown>{stream.text}</Markdown>
                      ) : (
                        <p className="text-sm text-ink-400">
                          <span className="streaming-dot">●</span> {stream.failed ?? "thinking…"}
                        </p>
                      )}
                      {stream.failed && stream.text ? (
                        <p className="mt-2 text-[11px] text-bad">{stream.failed}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Composer
          agent={agent}
          pdfCapable={pdfCapable}
          canTranscribe={health?.canTranscribe ?? false}
          busy={busy}
          streaming={busy}
          sendKey={prefs.sendKey}
          maxImages={health?.limits.maxImages ?? 20}
          seed={seed}
          onSend={(text, attachments) => void send(text, attachments)}
          onStop={stop}
        />
      </main>

      {settingsOpen ? (
        <SettingsSheet
          prefs={prefs}
          health={health}
          usage={usage}
          onChange={setPrefs}
          onClose={() => setSettingsOpen(false)}
          onUsage={() => void storageUsage().then(setUsage)}
        />
      ) : null}

      <div id="print-root">
        {print ? (
          <>
            <div className="print-head">
              <strong>{print.title}</strong> · generated with AIWish ·{" "}
              {new Date().toLocaleString()}
            </div>
            <Markdown>{print.text}</Markdown>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function EmptyState({
  agentId,
  onPick,
  onSeed,
}: {
  agentId: string;
  onPick: (id: string) => void;
  onSeed: (text: string) => void;
}) {
  const agent = getAgent(agentId);
  const others = AGENTS.filter((a) => a.id !== agentId).slice(0, 8);
  return (
    <div className="mx-auto max-w-2xl px-5 py-14 text-center">
      <p className="text-4xl">{agent.emoji}</p>
      <h2 className="mt-3 text-xl font-semibold text-ink-200">{agent.name}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-400">{agent.tagline}</p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {agent.starters.map((s) => (
          <button
            key={s}
            onClick={() => onSeed(s)}
            className="rounded-xl border border-ink-800 bg-ink-900 px-3.5 py-2.5 text-left text-sm text-ink-300 transition hover:border-accent/50 hover:text-ink-200"
          >
            {s}
          </button>
        ))}
      </div>

      <p className="mt-10 text-[11px] tracking-wider text-ink-400 uppercase">Switch agent</p>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {others.map((a) => (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            className="rounded-full border border-ink-800 bg-ink-900 px-3 py-1.5 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-200"
          >
            {a.emoji} {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsBar({
  prefs,
  onToggle,
}: {
  prefs: UiPrefs;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-ink-800 px-3 py-2.5">
      <button
        onClick={onToggle}
        className="flex flex-1 items-center gap-2 rounded-xl border border-ink-800 bg-ink-850 px-3 py-2 text-left text-xs text-ink-300 transition hover:border-ink-700"
      >
        <span className="text-sm leading-none">⚙️</span>
        <span className="min-w-0 flex-1 truncate">
          {prefs.tier === "smart" ? "Smart model" : "Fast model"} ·{" "}
          {prefs.provider === "auto" ? "auto provider" : prefs.provider}
        </span>
      </button>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        aria-label="Lock the app"
        className="rounded-xl border border-ink-800 bg-ink-850 p-2 text-ink-400 transition hover:text-ink-200"
      >
        🔒
      </button>
    </div>
  );
}

function SettingsSheet({
  prefs,
  health,
  usage,
  onChange,
  onClose,
  onUsage,
}: {
  prefs: UiPrefs;
  health: Health | null;
  usage: { used: number; quota: number } | null;
  onChange: (p: UiPrefs) => void;
  onClose: () => void;
  onUsage: () => void;
}) {
  const providers: (ProviderId | "auto")[] = ["auto", "openai", "gemini", "nvidia", "groq"];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-ink-800 bg-ink-900 p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-200">Model & settings</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <Section label="Model tier">
          <div className="grid grid-cols-2 gap-2">
            {(["smart", "fast"] as const).map((tier) => (
              <Choice
                key={tier}
                active={prefs.tier === tier}
                onClick={() => onChange({ ...prefs, tier })}
                title={tier === "smart" ? "Smart" : "Fast"}
                hint={
                  tier === "smart"
                    ? "Strongest model for hard reasoning"
                    : "Quickest and cheapest, good for short tasks"
                }
              />
            ))}
          </div>
        </Section>

        <Section label="Provider (fallback is automatic)">
          <div className="space-y-1.5">
            {providers.map((p) => {
              const enabled = p === "auto" || (health?.providers.includes(p as ProviderId) ?? false);
              const active = prefs.provider === p;
              return (
                <button
                  key={p}
                  disabled={!enabled}
                  onClick={() => onChange({ ...prefs, provider: p })}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40 ${
                    active ? "border-accent/50 bg-accent/10" : "border-ink-800 hover:border-ink-700"
                  }`}
                >
                  <span className="flex-1 text-sm text-ink-200">
                    {p === "auto" ? "Auto (use my fallback order)" : p}
                  </span>
                  <span className="text-[11px] text-ink-400">
                    {enabled ? (p === "auto" ? `${health?.providers.length ?? 0} available` : "ready") : "no key"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            Order: OpenAI → Gemini → NVIDIA → Groq. If the first one errors before replying, the
            next provider answers automatically and the app tells you what happened.
          </p>
        </Section>

        <Section label={`Creativity: ${prefs.temperature?.toFixed(1) ?? "1.0 (default)"}`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={prefs.temperature ?? 1}
            onChange={(e) => onChange({ ...prefs, temperature: Number(e.target.value) })}
            className="w-full accent-accent"
          />
          <p className="mt-1 text-[11px] text-ink-400">
            Higher is more imaginative (good for stories), lower is more predictable (good for
            formulas and code).
          </p>
        </Section>

        <Section label="Enter key">
          <div className="grid grid-cols-2 gap-2">
            {(["enter", "shift-enter"] as const).map((k) => (
              <Choice
                key={k}
                active={prefs.sendKey === k}
                onClick={() => onChange({ ...prefs, sendKey: k })}
                title={k === "enter" ? "Enter sends" : "Shift+Enter sends"}
              />
            ))}
          </div>
        </Section>

        <Section label="Privacy">
          <div className="rounded-xl border border-ink-800 bg-ink-850 px-3 py-2.5 text-[11px] leading-relaxed text-ink-300">
            <p className="mb-1 font-medium text-ink-200">
              {prefs.privacy ? "Private mode is ON" : "Private mode is OFF"}
            </p>
            <p>
              {prefs.privacy
                ? "Every request goes to Gemini only, and nothing is saved in this browser."
                : "Chats are stored only in this browser. Requests use whichever provider answers first, starting with OpenAI."}
            </p>
          </div>
        </Section>

        <Section label="This browser">
          <div className="space-y-1.5 text-[11px] text-ink-400">
            <p>
              {usage
                ? `Using ${bytesHuman(usage.used)} of about ${bytesHuman(usage.quota)} available.`
                : "Storage usage unavailable in this browser."}
            </p>
            <button onClick={onUsage} className="rounded-lg border border-ink-800 px-2.5 py-1.5 hover:border-ink-600 hover:text-ink-200">
              Refresh
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{label}</p>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active ? "border-accent/50 bg-accent/10" : "border-ink-800 hover:border-ink-700"
      }`}
    >
      <span className="block text-sm text-ink-200">{title}</span>
      {hint ? <span className="mt-0.5 block text-[11px] text-ink-400">{hint}</span> : null}
    </button>
  );
}